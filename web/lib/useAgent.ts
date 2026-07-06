"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, Itinerary } from "@/server/shared/types";

// Shared streaming-agent hook. Every interaction surface — the welcome
// composer, per-section Refine popovers, and the collapsed global chat — funnels
// through send(), so they all append to one conversation and reuse /api/chat.
export function useAgent(onItinerary: (data: Itinerary) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const onItineraryRef = useRef(onItinerary);
  onItineraryRef.current = onItinerary;

  const reset = useCallback(() => setMessages([]), []);

  const send = useCallback(async (text: string, tripId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, tripId }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type: string; v?: string; data?: Itinerary; message?: string };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text") {
            assistant += ev.v ?? "";
            setMessages([...next, { role: "assistant", content: assistant }]);
          } else if (ev.type === "itinerary" && ev.data) {
            onItineraryRef.current(ev.data);
          } else if (ev.type === "error") {
            assistant += `\n\n⚠️ ${ev.message}`;
            setMessages([...next, { role: "assistant", content: assistant }]);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages([...next, { role: "assistant", content: `Something went wrong: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }, [messages, busy]);

  return { messages, busy, send, reset };
}
