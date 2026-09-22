// Shared HTTP plumbing for the two hand-rolled evaluate backends (OpenRouter,
// Vercel AI Gateway) -- the default TypeSafe-direct path delegates all of
// this to the official @typesafe-ai/sdk instead. These two providers have
// no SDK of their own, so they get a small fixed timeout/retry policy
// here, generalized to an arbitrary backend name/url/headers.

import { BackendError } from "./types.js";

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5000;

export async function postJson(
  backend: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelayMs(attempt));
        attempt += 1;
        continue;
      }
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new BackendError(
        backend,
        aborted ? `request timed out after ${TIMEOUT_MS}ms` : `network error: ${String(err)}`
      );
    }
    clearTimeout(timer);

    if (response.status >= 400) {
      if (isRetryable(response.status) && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(response) ?? backoffDelayMs(attempt));
        attempt += 1;
        continue;
      }
      throw new BackendError(backend, `HTTP ${response.status}: ${await errorMessage(response)}`, response.status);
    }

    return response.json();
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = response.headers.get("retry-after");
  if (seconds === null) return undefined;
  const value = Number(seconds);
  return Number.isNaN(value) ? undefined : value * 1000;
}

function backoffDelayMs(attempt: number): number {
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return delay + delay * Math.random() * 0.25;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") {
      return String(body.error ?? body.message ?? JSON.stringify(body));
    }
    return String(body);
  } catch {
    return text.trim() || response.statusText;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
