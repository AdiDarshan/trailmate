"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Compass, Sparkles, ArrowUp } from "lucide-react";
import type { ChatMessage } from "@/server/shared/types";

// Standalone conversation view. Shown while the agent is still talking things
// through (answering, asking questions) — before it commits to a concrete plan.
// Once a concrete itinerary arrives, page.tsx swaps this for the Notebook.
export default function Chat({
  messages,
  busy,
  onSend,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(text: string) {
    const t = text.trim();
    if (t && !busy) {
      onSend(t);
      setValue("");
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "28px 24px",
          width: "100%",
          maxWidth: 680,
          margin: "0 auto",
        }}
      >
        {messages.map((m, i) => (
          <div key={i} className={`tm-msg ${m.role === "user" ? "tm-msg-user" : ""}`}>
            {m.role === "assistant" && (
              <div className="tm-msg-avatar">
                <Compass size={14} strokeWidth={1.8} />
              </div>
            )}
            <div className="tm-msg-body">
              {m.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}
                >
                  {m.content}
                </ReactMarkdown>
              ) : busy && i === messages.length - 1 ? (
                "…"
              ) : (
                ""
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div
        style={{
          padding: "12px 24px 22px",
          display: "flex",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div className="tm-composer" style={{ maxWidth: 680 }}>
          <Sparkles className="tm-composer-lead" size={18} strokeWidth={1.8} />
          <input
            value={value}
            placeholder="Message TrailMate…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(value);
            }}
            disabled={busy}
          />
          <button className="tm-send" onClick={() => submit(value)} disabled={busy || !value.trim()}>
            <ArrowUp size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
