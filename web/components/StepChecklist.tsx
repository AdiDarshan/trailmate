"use client";

import { Check, Compass, LoaderCircle } from "lucide-react";
import type { AgentStep } from "@/lib/useAgent";

// The agent's live "working" checklist — one row per kind of tool run, spinner
// on the current one. Shared by the standalone Chat view and the Notebook's
// conversation log so the two can't drift. During planning turns the agent
// streams no prose, so this checklist IS the feedback.
export default function StepChecklist({ steps, busy }: { steps: AgentStep[]; busy: boolean }) {
  if (steps.length === 0) return null;
  return (
    <div className="tm-msg">
      <div className="tm-msg-avatar">
        <Compass size={14} strokeWidth={1.8} />
      </div>
      <div className="tm-msg-body" style={{ width: "100%" }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          {busy ? "Working on your trip…" : "Here's what I did"}
        </div>
        {steps.map((s, i) => {
          const inProgress = busy && i === steps.length - 1;
          return (
            <div
              key={s.key}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13.5 }}
            >
              {inProgress ? (
                <LoaderCircle size={14} className="tm-spin" color="var(--olive)" />
              ) : (
                <Check size={14} color="var(--olive)" strokeWidth={2.2} />
              )}
              <span style={{ color: inProgress ? "var(--text)" : "var(--muted)" }}>
                {s.label}
                {inProgress ? "…" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
