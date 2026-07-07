"use client";

import { useEffect, useState } from "react";
import { BedDouble, Check, Footprints, LoaderCircle, PencilLine, Utensils } from "lucide-react";
import { PREF_OPTIONS, type PrefKey, type PrefPicks } from "@/lib/prefs";

// Main-pane preferences screen ("How you like to travel") — one-tap chips that
// auto-save, plus a free-text row for the odd extra. The parent owns the picks
// and persistence; this component is pure UI over them.
export default function Preferences({
  picks,
  saving,
  onChange,
}: {
  picks: PrefPicks;
  saving: boolean;
  onChange: (picks: PrefPicks) => void;
}) {
  // Free text is committed on blur/Enter, not per keystroke, so the agent
  // string isn't PUT on every character.
  const [extra, setExtra] = useState(picks.extra);
  useEffect(() => setExtra(picks.extra), [picks.extra]);

  const toggle = (key: PrefKey, value: string) =>
    onChange({ ...picks, [key]: picks[key] === value ? null : value });

  const commitExtra = () => {
    if (extra.trim() !== picks.extra) onChange({ ...picks, extra: extra.trim() });
  };

  const chips = (key: PrefKey) => (
    <div className="tm-pref-chips">
      {PREF_OPTIONS[key].map((o) => (
        <button
          key={o.value}
          className={`tm-pref-chip ${picks[key] === o.value ? "tm-pref-chip-on" : ""}`}
          onClick={() => toggle(key, o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="tm-prefs-page">
      <div className="tm-prefs-head">
        <div>
          <div className="tm-eyebrow">My preferences</div>
          <div className="tm-prefs-title">How you like to travel</div>
          <div className="tm-prefs-sub">
            Every trip is planned against these. Tap to change — saves instantly.
          </div>
        </div>
        <div className="tm-prefs-saved">
          {saving ? (
            <>
              <LoaderCircle size={13} className="tm-spin" color="var(--olive)" />
              Saving…
            </>
          ) : (
            <>
              <Check size={13} color="var(--olive)" strokeWidth={2.2} />
              Saved
            </>
          )}
        </div>
      </div>

      <div className="tm-prefs-grid">
        <div className="tm-pref-card" style={{ background: "var(--card-hike)", borderColor: "var(--card-hike-line)" }}>
          <div className="tm-pref-card-head" style={{ color: "var(--olive-2)" }}>
            <Footprints size={15} strokeWidth={1.8} />
            Trails
          </div>
          <div className="tm-pref-label">Difficulty</div>
          {chips("difficulty")}
          <div className="tm-pref-label" style={{ marginTop: 13 }}>Length</div>
          {chips("length")}
        </div>

        <div className="tm-pref-card" style={{ background: "var(--card-eat)", borderColor: "var(--card-eat-line)" }}>
          <div className="tm-pref-card-head" style={{ color: "var(--gold)" }}>
            <Utensils size={15} strokeWidth={1.8} />
            Food
          </div>
          <div className="tm-pref-label">Diet</div>
          {chips("diet")}
        </div>

        <div className="tm-pref-card" style={{ background: "var(--card-weather)", borderColor: "var(--card-weather-line)" }}>
          <div className="tm-pref-card-head" style={{ color: "#4a7382" }}>
            <BedDouble size={15} strokeWidth={1.8} />
            Sleep
          </div>
          <div className="tm-pref-label">Stay</div>
          {chips("stay")}
        </div>
      </div>

      <div className="tm-prefs-extra">
        <PencilLine size={16} strokeWidth={1.8} color="var(--muted)" />
        <input
          value={extra}
          maxLength={500}
          placeholder={'Anything else? e.g. "no crowded spots", "dog joins every hike"…'}
          onChange={(e) => setExtra(e.target.value)}
          onBlur={commitExtra}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitExtra();
          }}
        />
      </div>
    </div>
  );
}
