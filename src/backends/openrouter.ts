// OpenRouter exposes Jev on an alpha "Decisions" endpoint rather than the
// usual /v1/chat/completions, and that endpoint happens to accept the same
// request/response shape as TypeSafe direct (model/state/questions in,
// model/answers/usage out). So unlike Vercel below, this adapter is just
// TypeSafe direct pointed at a different host, key, and default model --
// no field translation needed. (Alpha: OpenRouter may relocate this path.)

import { postJson } from "./http.js";
import type { EvaluateArgs, EvaluateBackend, EvaluateResult } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-latest";

export interface OpenRouterOptions {
  apiKey: string;
  /** Override the endpoint (proxy, test server). */
  baseUrl?: string;
}

/** The Decisions endpoint's response. Same answer shape as System One, plus cost. */
export interface DecisionsResponse {
  model?: string;
  answers?: EvaluateResult["answers"];
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

export class OpenRouterBackend implements EvaluateBackend {
  readonly name = "openrouter";

  constructor(private readonly options: OpenRouterOptions) {}

  async evaluate(args: EvaluateArgs): Promise<EvaluateResult> {
    const model = args.model ?? OPENROUTER_DEFAULT_MODEL;
    const response = (await postJson(
      this.name,
      this.options.baseUrl ?? OPENROUTER_URL,
      { Authorization: `Bearer ${this.options.apiKey}` },
      { ...args, model }
    )) as DecisionsResponse;
    return {
      model: response.model ?? model,
      answers: response.answers ?? {},
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}
