// HTTP entry point — delegates to the chat controller.

import { chatController } from "@/server/modules/chat/chat.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";
// Trip planning makes several LLM + external API calls; give it room. Vercel
// Hobby caps at 60s — upgrade to Pro (Fluid Compute) for heavier trips.
export const maxDuration = 60;

export function POST(req: Request) {
  return withRequestContext(() => chatController.handle(req));
}
