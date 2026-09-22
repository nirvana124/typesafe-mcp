// The `evaluate` tool: answers typed questions about content by calling
// whichever backend is configured (see ../backends/index.ts).
//
// The schema lives alongside this file in ./evaluate.json (see
// ../toolRegistry.ts); this module only supplies the handler that turns
// validated arguments into a backend call.

import { getBackend } from "../backends/index.js";
import type { EvaluateArgs } from "../backends/types.js";

export async function handle(args: Record<string, unknown>): Promise<unknown> {
  return getBackend().evaluate(args as unknown as EvaluateArgs);
}
