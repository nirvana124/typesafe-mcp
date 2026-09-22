// The default backend: TypeSafe direct, via the official SDK
// (@typesafe-ai/sdk, https://github.com/typesafe-ai/typesafe-sdk-js)
// instead of a hand-rolled fetch client. The SDK owns transport concerns
// end to end: it reads TYPESAFE_API_KEY / TYPESAFE_BASE_URL itself, and
// its own RetryPolicy (2 retries, exponential backoff with jitter, on
// 408/429/500-599 and connection/timeout errors -- Retry-After honored)
// is what actually governs retries here, not anything in this repo.

import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EvaluateArgs, EvaluateBackend, EvaluateResult } from "./types.js";

export interface TypeSafeOptions {
  /**
   * Explicit API key, e.g. read from a caller-redirected env var
   * (TYPESAFE_API_KEY_ENV) instead of TYPESAFE_API_KEY. Omitted, the SDK
   * reads TYPESAFE_API_KEY itself.
   */
  apiKey?: string;
}

export class TypeSafeBackend implements EvaluateBackend {
  readonly name = "typesafe";

  // Constructed once: throws immediately if no API key can be resolved
  // (explicit or TYPESAFE_API_KEY), so startup fails fast with the SDK's
  // own remedy message.
  private readonly client: TypeSafeClient;

  constructor(options: TypeSafeOptions = {}) {
    this.client = new TypeSafeClient(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async evaluate(args: EvaluateArgs): Promise<EvaluateResult> {
    return await this.client.systemOne(args);
  }
}
