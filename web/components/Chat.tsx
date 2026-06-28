"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/server/shared/types";

// Render assistant/user text as GitHub-flavoured Markdown. Links open in a new
// tab; everything else (headings, bold, lists) renders properly instead of
// showing raw ### / ** symbols.
function renderContent(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function Chat({ onTrip }: { onTrip: (id: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
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
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text") {
            assistant += ev.v;
            setMessages([...next, { role: "assistant", content: assistant }]);
          } else if (ev.type === "trip") {
            onTrip(ev.id);
          } else if (ev.type === "error") {
            assistant += `\n\n⚠️ ${ev.message}`;
            setMessages([...next, { role: "assistant", content: assistant }]);
          }
        }
      }
    } catch (e: any) {
      setMessages([
        ...next,
        { role: "assistant", content: `Something went wrong: ${String(e?.message ?? e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tm-pane-title">🥾 TrailMate</div>
      <div className="tm-pane-sub">
        Your AI travel companion for Israel. Ask me to plan a trip anywhere in the country.
      </div>

      <div className="tm-chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="tm-msg">
            <div className="tm-msg-avatar">🥾</div>
            <div className="tm-msg-body">
              Hi! I&apos;m TrailMate. Tell me where you&apos;d like to go and I&apos;ll plan it out —
              for example, <em>“Plan a trip in the Galilee.”</em>
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`tm-msg ${m.role === "user" ? "tm-msg-user" : ""}`}>
            <div className="tm-msg-avatar">{m.role === "user" ? "🧑" : "🥾"}</div>
            <div className="tm-msg-body">
              {m.content ? renderContent(m.content) : busy && i === messages.length - 1 ? "…" : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="tm-input-row">
        <input
          className="tm-input"
          value={input}
          placeholder="Where do you want to travel? e.g. 'Plan a trip in the Galilee'"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          disabled={busy}
        />
        <button className="tm-send" onClick={send} disabled={busy || !input.trim()}>
          {busy ? "Planning…" : "Send"}
        </button>
      </div>
    </>
  );
}
