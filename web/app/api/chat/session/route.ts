// HTTP entry point — restore the current chat (or a saved trip's chat).

import { chatController } from "@/server/modules/chat/chat.controller";

export const runtime = "nodejs";

export function GET(req: Request) {
  return chatController.session(req);
}
