"use client";

import { Compass, Footprints, Utensils, BedDouble, CloudSun } from "lucide-react";

const SKELETONS = [
  { label: "Hike", Icon: Footprints, color: "#5c6b3c", bg: "var(--card-hike)", line: "var(--card-hike-line)", bar: "#d6ddc2" },
  { label: "Eat", Icon: Utensils, color: "#9a6f2e", bg: "var(--card-eat)", line: "var(--card-eat-line)", bar: "#e6ddc6" },
  { label: "Sleep", Icon: BedDouble, color: "#6f5f80", bg: "var(--card-sleep)", line: "var(--card-sleep-line)", bar: "#e2dcea" },
  { label: "Weather", Icon: CloudSun, color: "#4a7382", bg: "var(--card-weather)", line: "var(--card-weather-line)", bar: "#d4e2e6" },
];

// Shown while the agent is planning the first itinerary. One prompt fans out to
// every section at once, so all four cards pulse together.
export default function Generating({ place }: { place?: string }) {
  return (
    <div className="tm-gen">
      <div className="tm-gen-status">
        <div className="tm-brand-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>
          <Compass size={15} color="var(--sage)" strokeWidth={1.8} />
        </div>
        <span>
          Planning your {place ? `${place} ` : ""}day — checking trails, food, a place to sleep and the
          forecast…
        </span>
      </div>
      <div className="tm-gen-cards">
        {SKELETONS.map(({ label, Icon, color, bg, line, bar }, i) => (
          <div
            key={label}
            className="tm-gen-card"
            style={{ background: bg, border: `1px solid ${line}`, animationDelay: `${i * 0.2}s` }}
          >
            <div className="tm-card-label" style={{ color, marginBottom: 10 }}>
              <Icon size={15} strokeWidth={1.8} />
              {label}
            </div>
            <div className="tm-gen-bar" style={{ background: bar, width: "80%" }} />
            <div className="tm-gen-bar" style={{ background: bar, width: "55%", marginBottom: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
