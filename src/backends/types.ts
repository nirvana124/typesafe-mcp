// Shared types for all three `evaluate` backends. The default (TypeSafe
// direct) goes through the official @typesafe-ai/sdk; OpenRouter and
// Vercel AI Gateway speak (or translate to/from) the same wire dialect the
// SDK already defines, so they reuse its request/response types directly
// instead of redeclaring parallel ones.

import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";

export type EvaluateArgs = SystemOneRequest;
export type EvaluateResult = SystemOneResult<Questions>;
export type EvaluateAnswer = EvaluateResult["answers"][string];

/** What every backend must provide. */
export interface EvaluateBackend {
  /** Short id, e.g. "typesafe" | "openrouter" | "vercel". */
  readonly name: string;
  evaluate(args: EvaluateArgs): Promise<EvaluateResult>;
}

/** Thrown by the non-default backends (openrouter/vercel) on failure. */
export class BackendError extends Error {
  constructor(
    public readonly backend: string,
    message: string,
    public readonly status?: number
  ) {
    super(`[${backend}] ${message}`);
    this.name = "BackendError";
  }
}
