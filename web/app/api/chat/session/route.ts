// HTTP entry point — restore the current chat (or a saved trip's chat),
// or discard an unsaved draft session.

import { chatController } from "@/server/modules/chat/chat.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";

export function GET(req: Request) {
  return withRequestContext(() => chatController.session(req));
}

export function DELETE(req: Request) {
  return withRequestContext(() => chatController.discard(req));
}
