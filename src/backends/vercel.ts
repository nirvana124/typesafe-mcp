// Vercel AI Gateway speaks a genuinely different dialect than TypeSafe
// direct/OpenRouter: POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model
// with the model named in a HEADER (ai-model-id) rather than the body,
// `noul` questions renamed to `boolean` (and their answer field is
// `probability`, not `noul`), camelCase usage counters, and Jev's
// confidence head relayed out-of-band in
// `providerMetadata.typesafe.confidence` -- a map keyed by question id
// that only ever carries `choice`/`score` confidence (boolean answers get
// none). This adapter is the one place in this codebase that has to
// translate both directions so the rest of the CLI never has to know
// Vercel's shape exists.

import { postJson } from "./http.js";
import { BackendError } from "./types.js";
import type { EvaluateAnswer, EvaluateArgs, EvaluateBackend, EvaluateResult } from "./types.js";

const VERCEL_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
const VERCEL_DEFAULT_MODEL = "typesafe-ai/jev";

export interface VercelOptions {
  apiKey: string;
  /** Override the gateway origin (proxy, test server). */
  baseUrl?: string;
}

/** One question as the gateway expects it -- `boolean` in place of `noul`. */
export interface GatewayQuestion {
  type: "boolean" | "choice" | "score";
  instructions?: unknown;
  criteria?: unknown;
}

/** One answer as the gateway returns it -- no `type` tag, no confidence. */
export interface GatewayAnswer {
  probability?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
}

/** The full evaluation-model response, confidence included. */
export interface GatewayResponse {
  answers?: Record<string, GatewayAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
}

export class VercelBackend implements EvaluateBackend {
  readonly name = "vercel";

  constructor(private readonly options: VercelOptions) {}

  async evaluate(args: EvaluateArgs): Promise<EvaluateResult> {
    const model = args.model ?? VERCEL_DEFAULT_MODEL;
    const questions: Record<string, GatewayQuestion> = {};
    for (const [id, question] of Object.entries(args.questions)) {
      questions[id] = {
        type: question.type === "noul" ? "boolean" : question.type,
        instructions: question.instructions,
        ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
      };
    }

    const response = (await postJson(
      this.name,
      this.options.baseUrl ?? VERCEL_URL,
      {
        Authorization: `Bearer ${this.options.apiKey}`,
        "ai-gateway-protocol-version": "0.0.1",
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": model,
      },
      { state: args.state, questions }
    )) as GatewayResponse;

    const reportedConfidence = response.providerMetadata?.typesafe?.confidence ?? {};
    const answers: Record<string, EvaluateAnswer> = {};
    for (const [id, question] of Object.entries(args.questions)) {
      const answer = response.answers?.[id];
      if (!answer) throw new BackendError(this.name, `response missing answer for question "${id}"`);

      switch (question.type) {
        case "noul":
          if (typeof answer.probability !== "number") {
            throw new BackendError(this.name, `answer "${id}" has no probability`);
          }
          // The confidence map omits boolean answers -- nothing to read here.
          answers[id] = { type: "noul", noul: answer.probability } as EvaluateAnswer;
          break;
        case "choice":
        case "score": {
          const confidence = reportedConfidence[id];
          if (typeof confidence !== "number") {
            throw new BackendError(this.name, `answer "${id}" is missing its reported confidence`);
          }
          answers[id] =
            question.type === "choice"
              ? assertChoiceAnswer(this.name, id, answer, confidence)
              : assertScoreAnswer(this.name, id, answer, confidence);
          break;
        }
      }
    }

    return {
      model,
      answers,
      usage: {
        input_tokens: response.usage?.inputTokens ?? 0,
        output_tokens: response.usage?.outputTokens ?? 0,
      },
    };
  }
}

function assertChoiceAnswer(
  backend: string,
  id: string,
  answer: GatewayAnswer,
  confidence: number
): EvaluateAnswer {
  if (typeof answer.choice !== "string") {
    throw new BackendError(backend, `answer "${id}" has no choice`);
  }
  return {
    type: "choice",
    choice: answer.choice,
    probabilities: answer.probabilities ?? {},
    confidence,
  } as EvaluateAnswer;
}

function assertScoreAnswer(
  backend: string,
  id: string,
  answer: GatewayAnswer,
  confidence: number
): EvaluateAnswer {
  if (typeof answer.score !== "number") {
    throw new BackendError(backend, `answer "${id}" has no score`);
  }
  return {
    type: "score",
    score: answer.score,
    probabilities: answer.probabilities ?? {},
    // The gateway doesn't echo the rubric back; System One's own shape has
    // a legend, so callers reading this generically can rely on the field
    // existing even though there's nothing to fill it with here.
    legend: {},
    confidence,
  } as EvaluateAnswer;
}
