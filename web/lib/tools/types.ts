// Shared shape for every agent tool: an OpenAI function schema plus a local
// executor that takes parsed args and returns a JSON-serialisable result.

import type OpenAI from "openai";

export interface ToolDef {
  schema: OpenAI.Chat.Completions.ChatCompletionTool;
  execute: (args: Record<string, any>) => Promise<unknown>;
}
