// Picks which backend answers `evaluate` calls. Explicit JEV_BACKEND
// wins; otherwise the first credential found decides, checked in this
// order: TypeSafe direct, OpenRouter, Vercel AI Gateway.

import { OpenRouterBackend } from "./openrouter.js";
import { TypeSafeBackend } from "./typesafe.js";
import { VercelBackend } from "./vercel.js";
import type { EvaluateBackend } from "./types.js";

const BACKEND_NAMES = ["typesafe", "openrouter", "vercel"] as const;
export type BackendName = (typeof BACKEND_NAMES)[number];

/**
 * Read a credential that normally lives in `defaultVar`, but can be
 * redirected to a differently-named variable via `${defaultVar}_ENV` --
 * for a caller who already uses `defaultVar`'s name for some other tool
 * and wants this one to read a different variable instead. Throws only
 * when the redirect itself is set but points at nothing; silently falling
 * back to `defaultVar` there would defeat the point of redirecting.
 */
function resolveCredential(env: NodeJS.ProcessEnv, defaultVar: string): string | undefined {
  const overrideVar = `${defaultVar}_ENV`;
  const customVarName = env[overrideVar]?.trim();
  if (!customVarName) return env[defaultVar];
  const value = env[customVarName];
  if (!value) throw new Error(`${overrideVar}=${customVarName}, but ${customVarName} is not set.`);
  return value;
}

function requireCredential(env: NodeJS.ProcessEnv, defaultVar: string, backend: string): string {
  const value = resolveCredential(env, defaultVar);
  if (!value) {
    throw new Error(`JEV_BACKEND=${backend} needs ${defaultVar} (or ${defaultVar}_ENV pointed at one).`);
  }
  return value;
}

export function resolveBackendName(env: NodeJS.ProcessEnv = process.env): BackendName {
  const requested = env.JEV_BACKEND?.trim().toLowerCase();
  if (requested) {
    if (!(BACKEND_NAMES as readonly string[]).includes(requested)) {
      throw new Error(`Unknown JEV_BACKEND "${requested}". Valid: ${BACKEND_NAMES.join(" | ")}.`);
    }
    return requested as BackendName;
  }
  if (resolveCredential(env, "TYPESAFE_API_KEY")) return "typesafe";
  if (resolveCredential(env, "OPENROUTER_API_KEY")) return "openrouter";
  if (resolveCredential(env, "AI_GATEWAY_API_KEY")) return "vercel";
  throw new Error(
    "No evaluate-backend credentials found. Set one of TYPESAFE_API_KEY (direct), " +
      "OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY (Vercel AI Gateway) -- each can also be " +
      "redirected to a different variable, e.g. OPENROUTER_API_KEY_ENV=MY_OPENROUTER_KEY, " +
      "if that default name is already taken by something else."
  );
}

export function createBackend(env: NodeJS.ProcessEnv = process.env): EvaluateBackend {
  switch (resolveBackendName(env)) {
    case "typesafe": {
      const apiKey = resolveCredential(env, "TYPESAFE_API_KEY");
      // Omit the option entirely when unresolved, so the SDK falls back to
      // its own TYPESAFE_API_KEY read and its own "unset" error message.
      return new TypeSafeBackend(apiKey ? { apiKey } : {});
    }
    case "openrouter":
      return new OpenRouterBackend({
        apiKey: requireCredential(env, "OPENROUTER_API_KEY", "openrouter"),
        baseUrl: env.OPENROUTER_BASE_URL,
      });
    case "vercel":
      return new VercelBackend({
        apiKey: requireCredential(env, "AI_GATEWAY_API_KEY", "vercel"),
        baseUrl: env.AI_GATEWAY_BASE_URL,
      });
  }
}

// This is a single-user stdio process, so it's safe -- and cheap -- to
// resolve the backend once and reuse it for every tool call rather than
// re-reading the environment and reconstructing a client each time.
let cached: EvaluateBackend | undefined;

export function getBackend(env: NodeJS.ProcessEnv = process.env): EvaluateBackend {
  if (!cached) cached = createBackend(env);
  return cached;
}
