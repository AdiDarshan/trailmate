"use client";

import { useState } from "react";
import { Sparkles, ArrowUp } from "lucide-react";
import IsraelMap from "./IsraelMap";

const SUGGESTIONS = [
  "A day in the Galilee",
  "Negev stargazing",
  "Eilat by the sea",
];

export default function Welcome({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");

  function submit(text: string) {
    const t = text.trim();
    if (t) onSubmit(t);
    setValue("");
  }

  return (
    <div className="tm-welcome">
      <div className="tm-eyebrow">Your AI trail companion · Israel</div>
      <h1>Where to next?</h1>
      <p>
        Tell me a place or a vibe. I&apos;ll plan the whole day — a trail to walk, where to eat,
        a bed for the night, and the weather to expect.
      </p>

      <div style={{ position: "relative", width: 300, height: 300, margin: "8px 0 18px" }}>
        <IsraelMap glow />
      </div>

      <div className="tm-composer">
        <Sparkles className="tm-composer-lead" size={18} strokeWidth={1.8} />
        <input
          value={value}
          placeholder="A place or a vibe — e.g. 'a relaxed day around Eilat'"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(value);
          }}
        />
        <button className="tm-send" onClick={() => submit(value)} disabled={!value.trim()}>
          <ArrowUp size={17} strokeWidth={1.8} />
        </button>
      </div>

      <div className="tm-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="tm-chip" onClick={() => submit(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
