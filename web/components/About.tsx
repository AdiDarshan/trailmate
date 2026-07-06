"use client";

import { useState } from "react";
import { Info, X, Compass, MessageSquare, Footprints, Save } from "lucide-react";

// "How it works" info button + modal. Explains what TrailMate does and the basic
// flow — self-contained (own state + overlay), dropped into the sidebar footer.
const STEPS: { Icon: typeof MessageSquare; title: string; body: string }[] = [
  {
    Icon: MessageSquare,
    title: "Tell it a place or a vibe",
    body: "“A relaxed day near the Galilee”, “a waterfall hike with kids”. It'll ask a quick question or two — area, dates — to narrow things down.",
  },
  {
    Icon: Footprints,
    title: "It plans the whole day",
    body: "A real Israeli trail (from a curated catalog), where to eat, a place to sleep, and the weather — matched to what you asked for.",
  },
  {
    Icon: Save,
    title: "Review, refine, save",
    body: "Tweak any part by chatting (“shorter hike”, “kosher lunch”). Save the trip and, if you connect Telegram, get a reminder before each day.",
  },
];

export default function About() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="tm-rail-btn" onClick={() => setOpen(true)}>
        <Info size={14} strokeWidth={1.8} />
        How it works
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(28, 40, 30, 0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="How TrailMate works"
            style={{
              width: "100%",
              maxWidth: 440,
              background: "var(--paper-2)",
              border: "1px solid var(--line-2)",
              borderRadius: 18,
              boxShadow: "0 24px 60px -24px rgba(28, 40, 30, 0.6)",
              padding: "22px 22px 20px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div className="tm-brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }}>
                <Compass size={16} color="var(--sage)" strokeWidth={1.8} />
              </div>
              <div style={{ flex: 1, fontFamily: "var(--font-serif)", fontSize: 20, color: "var(--ink)" }}>
                What is TrailMate?
              </div>
              <button
                className="tm-icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.8} />
              </button>
            </div>

            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: "0 0 16px" }}>
              Your AI trail companion for Israel. Describe a day out and it plans the whole thing —
              a trail to walk, where to eat, a bed for the night, and the weather to expect.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {STEPS.map(({ Icon, title, body }) => (
                <div key={title} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <div
                    className="tm-brand-mark"
                    style={{ width: 26, height: 26, borderRadius: 8, flex: "0 0 auto", marginTop: 1 }}
                  >
                    <Icon size={14} color="var(--sage)" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{title}</div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>{body}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="tm-btn-ghost"
              onClick={() => setOpen(false)}
              style={{ marginTop: 18, width: "100%", justifyContent: "center" }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
