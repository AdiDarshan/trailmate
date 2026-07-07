"use client";

import { useCallback, useRef, useState } from "react";
import { formatStepSummary } from "@/server/modules/chat/chat.helpers";
import type { ChatMessage, Itinerary } from "@/server/shared/types";

// One row in the inline "working" checklist (a tool the agent ran this turn).
export interface AgentStep {
  key: string;
  label: string;
}

// Shared streaming-agent hook. Every interaction surface — the welcome
// composer, per-section Refine popovers, and the collapsed global chat — funnels
// through send(), so they all append to one conversation and reuse /api/chat.
//
// History lives on the server (chat_sessions): send() posts only the new
// message plus the session id; hydrate() restores a persisted conversation.
export function useAgent(onItinerary: (data: Itinerary) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The tools the agent has run this turn, shown as a live checklist in the chat.
  // Reset on each send; kept after a turn so a tool-using answer keeps its trail.
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const onItineraryRef = useRef(onItinerary);
  onItineraryRef.current = onItinerary;
  // send() must use the freshest session id even when called before a
  // re-render (e.g. right after hydrate).
  const sessionIdRef = useRef<string | null>(null);

  const setSession = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // Start a fresh conversation. The previous session stays stored server-side
  // but is only reachable again if it belongs to a saved trip.
  const reset = useCallback(() => {
    setSession(null);
    setMessages([]);
    setSteps([]);
  }, [setSession]);

  // Restore a persisted conversation (current chat or a saved trip's chat).
  const hydrate = useCallback((id: string | null, msgs: ChatMessage[]) => {
    setSession(id);
    setMessages(msgs);
    setSteps([]);
  }, [setSession]);

  const send = useCallback(async (text: string, tripId: string | null) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    setSteps([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, sessionId: sessionIdRef.current, tripId }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";
      const turnSteps: string[] = [];
      let presented = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type: string; id?: string; v?: string; data?: Itinerary; message?: string; key?: string; label?: string };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "session" && ev.id) {
            setSession(ev.id);
          } else if (ev.type === "text") {
            assistant += ev.v ?? "";
            setMessages([...next, { role: "assistant", content: assistant }]);
          } else if (ev.type === "step" && ev.key) {
            if (!turnSteps.includes(ev.label ?? ev.key)) turnSteps.push(ev.label ?? ev.key);
            setSteps((prev) =>
              prev.some((s) => s.key === ev.key)
                ? prev
                : [...prev, { key: ev.key!, label: ev.label ?? ev.key! }],
            );
          } else if (ev.type === "itinerary" && ev.data) {
            presented = true;
            onItineraryRef.current(ev.data);
          } else if (ev.type === "error") {
            assistant += `\n\n⚠️ ${ev.message}`;
            setMessages([...next, { role: "assistant", content: assistant }]);
          }
        }
      }
      // Notebook-building turns stream no text. Materialize the checklist as
      // the turn's message — the same summary the server persists — so the
      // conversation keeps a durable record (and clear the live checklist,
      // which the message replaces). Otherwise drop the empty placeholder.
      if (!assistant) {
        if (presented && turnSteps.length > 0) {
          setMessages([...next, { role: "assistant", content: formatStepSummary(turnSteps) }]);
          setSteps([]);
        } else {
          setMessages(next);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages([...next, { role: "assistant", content: `Something went wrong: ${msg}` }]);
    } finally {
      setBusy(false);
      // Steps are kept after the turn (so a tool-using answer keeps its checklist);
      // they're cleared on the next send() or reset().
    }
  }, [messages, busy, setSession]);

  return { messages, sessionId, busy, steps, send, reset, hydrate };
}
