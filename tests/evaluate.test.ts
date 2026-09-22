// End-to-end tests through the real stdio MCP server (spawned as a real
// child process, exactly as an agent would run it). The `evaluate` tool
// can be answered by any of three backends (see ../src/backends); each
// describe block below drives one of them through a local mock HTTP
// server standing in for the real provider.

import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const ARGS = {
  state: "Hi, I've been trying to connect for 3 days and it keeps failing.",
  model: "jev-latest",
  questions: { urgency: { type: "noul", instructions: "Is this urgent?" } },
};

const NOUL_YES = {
  model: "jev-1.13.0",
  answers: { urgency: { type: "noul", noul: 1.0 } },
  usage: { input_tokens: 10, output_tokens: 5 },
};

let mockServer: Server;
let mockOrigin: string;
let receivedAuthHeader: string | undefined;
let receivedHeaders: IncomingMessage["headers"] = {};
let receivedBody: unknown;
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };
let responseQueue: { status: number; body: unknown }[] = [];

beforeAll(async () => {
  mockServer = createServer((req: IncomingMessage, res) => {
    receivedAuthHeader = req.headers["authorization"];
    receivedHeaders = req.headers;
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      receivedBody = raw ? JSON.parse(raw) : undefined;
      const response = responseQueue.shift() ?? nextResponse;
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  if (address === null || typeof address === "string") throw new Error("failed to bind mock server");
  // Origin only: the SDK appends /v1/systemone itself, and our custom
  // adapters (openrouter/vercel) are pointed at this same origin via their
  // own *_BASE_URL override, each appending nothing (their paths are fixed
  // into the URL passed to postJson).
  mockOrigin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

afterEach(() => {
  receivedAuthHeader = undefined;
  receivedHeaders = {};
  receivedBody = undefined;
  nextResponse = { status: 200, body: {} };
  responseQueue = [];
});

async function connectClient(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", path.join(projectRoot, "src", "index.ts")],
    cwd: projectRoot,
    env: {
      // The spawned server's cwd is projectRoot, and src/index.ts now
      // auto-loads .env from its cwd -- point dotenv at a file that can't
      // exist so a developer's own real .env (with a real TYPESAFE_API_KEY)
      // never leaks into these tests and silently overrides what each test
      // is deliberately configuring.
      DOTENV_CONFIG_PATH: path.join(projectRoot, "tests", ".env.does-not-exist"),
      ...env,
    },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

describe("evaluate tool -- typesafe backend (default, via @typesafe-ai/sdk)", () => {
  it("forwards the caller's TYPESAFE_API_KEY as a bearer token", async () => {
    nextResponse = { status: 200, body: NOUL_YES };

    const client = await connectClient({
      TYPESAFE_API_KEY: "caller-supplied-key-abc",
      TYPESAFE_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        structuredContent?: { answers?: { urgency?: { noul?: number } } };
      };
      expect(receivedAuthHeader).toBe("Bearer caller-supplied-key-abc");
      expect(result.structuredContent?.answers?.urgency?.noul).toBe(1.0);
    } finally {
      await client.close();
    }
  });

  it("propagates a downstream 401 as a tool error, unmodified", async () => {
    nextResponse = {
      status: 401,
      body: { error: "Missing or invalid API key. Check the Authorization header" },
    };

    const client = await connectClient({
      TYPESAFE_API_KEY: "a-key-the-downstream-rejects",
      TYPESAFE_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("401");
      expect(result.content[0].text).toContain("Missing or invalid API key");
    } finally {
      await client.close();
    }
  });

  it("retries a downstream 529 (Overloaded) response and succeeds, via the SDK's own retry policy", async () => {
    // Per https://docs.typesafe.ai/api, 529 Overloaded is retried with
    // exponential backoff, same as 429. This is the SDK's default
    // retry.httpStatuses (408, 429, 500-599) doing the work -- nothing in
    // this repo configures it.
    responseQueue = [{ status: 529, body: { error: "overloaded" } }];
    nextResponse = { status: 200, body: NOUL_YES };

    const client = await connectClient({
      TYPESAFE_API_KEY: "caller-supplied-key-abc",
      TYPESAFE_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        isError?: boolean;
        structuredContent?: { answers?: { urgency?: { noul?: number } } };
      };
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.answers?.urgency?.noul).toBe(1.0);
    } finally {
      await client.close();
    }
  });
});

describe("evaluate tool -- openrouter backend", () => {
  it("posts the native dialect to the Decisions endpoint with a bearer token", async () => {
    nextResponse = { status: 200, body: NOUL_YES };

    const client = await connectClient({
      JEV_BACKEND: "openrouter",
      OPENROUTER_API_KEY: "or-key-abc",
      OPENROUTER_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        structuredContent?: { answers?: { urgency?: { noul?: number } } };
      };
      expect(receivedAuthHeader).toBe("Bearer or-key-abc");
      expect((receivedBody as { questions?: unknown })?.questions).toEqual(ARGS.questions);
      expect(result.structuredContent?.answers?.urgency?.noul).toBe(1.0);
    } finally {
      await client.close();
    }
  });

  it("reads the key from a redirected env var when OPENROUTER_API_KEY is already taken by something else", async () => {
    nextResponse = { status: 200, body: NOUL_YES };

    // No OPENROUTER_API_KEY at all -- only the redirect and its target, as
    // if OPENROUTER_API_KEY were already in use by another tool.
    const client = await connectClient({
      OPENROUTER_API_KEY_ENV: "MY_OPENROUTER_KEY",
      MY_OPENROUTER_KEY: "redirected-key-abc",
      OPENROUTER_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        structuredContent?: { answers?: { urgency?: { noul?: number } } };
      };
      expect(receivedAuthHeader).toBe("Bearer redirected-key-abc");
      expect(result.structuredContent?.answers?.urgency?.noul).toBe(1.0);
    } finally {
      await client.close();
    }
  });
});

describe("evaluate tool -- vercel backend", () => {
  it("translates noul<->boolean, sends the model as a header, and reads back the answer", async () => {
    nextResponse = {
      status: 200,
      body: {
        answers: { urgency: { probability: 0.92 } },
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    };

    const client = await connectClient({
      JEV_BACKEND: "vercel",
      AI_GATEWAY_API_KEY: "gw-key-abc",
      AI_GATEWAY_BASE_URL: mockOrigin,
    });
    try {
      const result = (await client.callTool({ name: "evaluate", arguments: ARGS })) as {
        structuredContent?: {
          answers?: { urgency?: { noul?: number } };
          usage?: { input_tokens?: number };
        };
      };
      expect(receivedAuthHeader).toBe("Bearer gw-key-abc");
      expect(receivedHeaders["ai-model-id"]).toBe("jev-latest");
      expect((receivedBody as { questions?: Record<string, { type?: string }> })?.questions?.urgency?.type).toBe(
        "boolean"
      );
      expect(result.structuredContent?.answers?.urgency?.noul).toBe(0.92);
      expect(result.structuredContent?.usage?.input_tokens).toBe(7);
    } finally {
      await client.close();
    }
  });
});

describe("evaluate tool -- backend selection", () => {
  it("rejects an unknown JEV_BACKEND at startup", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", path.join(projectRoot, "src", "index.ts")],
      cwd: projectRoot,
      env: { JEV_BACKEND: "not-a-real-backend" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
    await expect(client.connect(transport)).rejects.toBeTruthy();
  });
});
