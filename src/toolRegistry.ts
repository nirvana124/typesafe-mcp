// All MCP tools this CLI exposes.
//
// Add a new tool by: creating a `<name>.json` schema and a `<name>.ts`
// handler module (a `handle()` function) side by side under ./tools, then
// listing both here.

import evaluateSchema from "./tools/evaluate.json" with { type: "json" };
import * as evaluate from "./tools/evaluate.js";

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: (args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: RegisteredTool[] = [
  {
    name: evaluateSchema.name,
    description: evaluateSchema.description,
    inputSchema: evaluateSchema.inputSchema,
    handle: evaluate.handle,
  },
];

export function allTools(): RegisteredTool[] {
  return TOOLS;
}
