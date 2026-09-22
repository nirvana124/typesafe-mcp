import { config as loadEnv } from "dotenv";

// Deliberately the low-level `Server`, not `McpServer`: our tools are
// defined as hand-authored JSON Schema (src/tools/*.json), and
// `McpServer.registerTool()` only accepts Zod schemas for `inputSchema` --
// it derives the JSON Schema it sends clients FROM the Zod schema, so
// there's no way to hand it our schema verbatim. That's exactly the
// "advanced use case" the SDK's own deprecation note on `Server` carves
// out ("Only use `Server` for advanced use cases"). A JSON-Schema-to-Zod
// converter doesn't close that gap either: even a lossless one still
// leaves McpServer regenerating the JSON Schema from the Zod side, so
// clients would see a regenerated approximation instead of this file.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { getBackend } from "./backends/index.js";
import { allTools } from "./toolRegistry.js";

// Populate process.env from a local .env before anything reads a
// credential from it. `dotenv` never overwrites a variable that's already
// set, so an MCP host that injects TYPESAFE_API_KEY etc. via its own env
// config (the common case once this ships via npx) takes precedence over
// any .env file that happens to be present. `quiet: true` keeps dotenv's
// own "injected env" notice off stderr -- failFastIfNoBackend below
// already reports which backend actually got picked.
loadEnv({ quiet: true });

function failFastIfNoBackend(): void {
  try {
    const backend = getBackend();
    process.stderr.write(`typesafe-mcp: using backend "${backend.name}"\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `typesafe-mcp: ${message}\n` +
        `See the package README for supported backends and the Claude Code / agent config snippet.\n`
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  failFastIfNoBackend();

  const tools = allTools();
  const server = new Server(
    { name: "typesafe-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      };
    }

    try {
      const result = await tool.handle((request.params.arguments ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`typesafe-mcp: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
