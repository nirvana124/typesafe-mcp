# typesafe-mcp

Local stdio MCP server exposing [TypeSafe's System One API](https://docs.typesafe.ai/introduction) as an MCP tool, for Claude Code and other MCP agents. No install step required -- run it with `npx`.

## What it does

The downstream API answers one or more typed questions about a piece of content in a single call. This is exposed as one MCP tool:

| Tool | Description |
| --- | --- |
| `evaluate` | Evaluate `state` (text or structured content) against a map of `questions`, each typed `noul` (yes/no probability), `choice` (pick an option), or `score` (rate against a rubric). Multiple questions are answered in parallel in one call. |

## Setup

1. Get a TypeSafe API key (or a credential for one of the alternate backends below).
2. Run it with your key in the environment:

   ```bash
   TYPESAFE_API_KEY=your-key npx typesafe-mcp
   ```

   The process exits immediately with an error if no backend can be configured.

## Claude Code / agent config

```json
{
  "mcpServers": {
    "typesafe": {
      "command": "npx",
      "args": ["-y", "typesafe-mcp"],
      "env": {
        "TYPESAFE_API_KEY": "your-typesafe-api-key"
      }
    }
  }
}
```

## Backends

`evaluate` calls whichever backend is configured. Set exactly one credential and it's picked automatically, in this order:

| Backend | Env var | Notes |
| --- | --- | --- |
| TypeSafe direct (default) | `TYPESAFE_API_KEY` | Via the official [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js); also honors `TYPESAFE_BASE_URL` / `TYPESAFE_DEFAULT_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY` | Jev's alpha Decisions endpoint; `OPENROUTER_BASE_URL` overrides the host |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `AI_GATEWAY_BASE_URL` overrides the gateway host |

Set `JEV_BACKEND` (`typesafe` \| `openrouter` \| `vercel`) to force a specific backend instead of relying on auto-detection.

Already using `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, or `TYPESAFE_API_KEY` for something else in the same environment? Point this server at a different variable instead of renaming yours, by setting `<VAR>_ENV` to that variable's name:

```bash
OPENROUTER_API_KEY_ENV=MY_JEV_OPENROUTER_KEY MY_JEV_OPENROUTER_KEY=sk-... npx typesafe-mcp
```

This works the same way for all three credentialed backends (`TYPESAFE_API_KEY_ENV`, `OPENROUTER_API_KEY_ENV`, `AI_GATEWAY_API_KEY_ENV`).

## Development

```bash
npm install
cp .env.example .env   # fill in a credential
npm run dev             # run from source via tsx
npm run build            # bundle to dist/index.js
npm run typecheck
npm test
```

Tests (`npm test`) spawn the real stdio server as a child process (via `tsx`, exactly as an agent would run it) for each backend, pointed at a local mock HTTP server standing in for the real provider -- they prove credentials (including redirected ones) are forwarded correctly, downstream errors propagate unmodified, and retries happen where the API docs say they should. No live calls are made.

## Project layout

```
src/
  index.ts            MCP stdio server entrypoint
  toolRegistry.ts      Registers ./tools/* against the MCP server
  backends/            One adapter per provider behind a common EvaluateBackend interface
    types.ts            Shared types, reusing @typesafe-ai/sdk's own request/response types
    typesafe.ts          Default backend, via the official SDK
    openrouter.ts         Same wire dialect as TypeSafe, different host
    vercel.ts              Translates to/from Vercel AI Gateway's dialect
    http.ts                 Shared HTTP/retry plumbing for openrouter/vercel
    index.ts                Backend selection (JEV_BACKEND, auto-detect, *_API_KEY_ENV redirects)
  tools/
    evaluate.ts          Tool handler
    evaluate.json         Tool schema (name, description, input schema)
tests/
  evaluate.test.ts      End-to-end tests, one backend at a time
```

Add a new tool by creating `<name>.json` + `<name>.ts` side by side under `src/tools/`, then listing both in `toolRegistry.ts`.

## Security

Your credential is read once at startup and held only in this process's memory -- it is never written to disk or sent anywhere except as the `Authorization: Bearer <key>` header on calls to the configured backend's host (`api.typesafe.ai`, `openrouter.ai`, or `ai-gateway.vercel.sh`, per the table above). Treat it like any other bearer credential. Don't paste it into chat messages, tickets, or other insecure channels.

No secrets are committed to source control: `.env` is gitignored, and only `.env.example` (no real values) is tracked.
