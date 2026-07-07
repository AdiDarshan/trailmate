"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Footprints, Utensils, BedDouble, CloudSun, WandSparkles, Clock, Gauge,
  ExternalLink, TriangleAlert, Calendar, Share2, ArrowUp, Sparkles, Compass,
  MessageSquare, ChevronDown, Mountain, LoaderCircle,
} from "lucide-react";
import IsraelMap from "./IsraelMap";
import StepChecklist from "./StepChecklist";
import type { AgentStep } from "@/lib/useAgent";
import type { Day, Itinerary, Place, Trail } from "@/server/shared/types";

// The trailhead coords are embedded in the Maps/Waze links (q=lat,lng / ll=lat,lng).
// Pull them back out to build an Israel Hiking Map link so the user can see the
// chosen area on a topographic hiking map. (Amud Anan has no coordinate deep-link.)
function hikingMapUrl(trail?: Trail | null): string | undefined {
  const src = trail?.start_maps || trail?.waze || "";
  const m = src.match(/(?:[?&]q=|ll=)(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  return m ? `https://israelhiking.osm.org.il/map/14/${m[1]}/${m[2]}` : undefined;
}

type Section = "hike" | "eat" | "sleep";

const REFINE: Record<Section, { title: string; tag: string; placeholder: string; chips: string[]; prefix: string }> = {
  hike: {
    title: "Refine this hike", tag: "Trail agent",
    placeholder: "Swap for a shorter trail with more shade…",
    chips: ["Shorter", "More shade", "Family-friendly"],
    prefix: "Refine the hike for this trip",
  },
  eat: {
    title: "Refine dining", tag: "Food agent",
    placeholder: "Something kosher near the water…",
    chips: ["Kosher", "Cheaper", "Vegetarian"],
    prefix: "Refine where to eat for this trip",
  },
  sleep: {
    title: "Refine the stay", tag: "Stay agent",
    placeholder: "Somewhere more central and highly rated…",
    chips: ["Cheaper", "More central", "Higher rated"],
    prefix: "Refine where to sleep for this trip",
  },
};

function Link({ text, url }: { text: string; url?: string }) {
  if (!url) return <>{text}</>;
  return <a href={url} target="_blank" rel="noreferrer">{text}</a>;
}

// The trail-guide link comes from either catalog; label it by its source domain.
function guideLabel(url?: string): string {
  if (!url) return "Trail guide";
  if (url.includes("nakeb.co.il")) return "Nakeb guide";
  if (url.includes("tiuli.com")) return "Tiuli guide";
  return "Trail guide";
}

function RefinePopover({
  section, busy, onSubmit, onClose,
}: {
  section: Section; busy: boolean; onSubmit: (text: string) => void; onClose: () => void;
}) {
  const cfg = REFINE[section];
  const [value, setValue] = useState("");
  function submit(text: string) {
    const t = text.trim();
    if (t && !busy) onSubmit(`${cfg.prefix}: ${t}`);
  }
  return (
    <>
      <div className="tm-sheet-scrim" onClick={onClose} />
      <div className="tm-refine">
        <div className="tm-refine-grip" />
        <div className="tm-refine-head">
          <WandSparkles size={15} strokeWidth={1.8} />
          <span className="tm-refine-title">{cfg.title}</span>
          <span className="tm-agent-tag">{cfg.tag}</span>
        </div>
        <div className="tm-refine-input">
          <input
            autoFocus
            value={value}
            placeholder={cfg.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(value); }}
          />
          <button className="tm-refine-send" onClick={() => submit(value)} disabled={busy || !value.trim()}>
            <ArrowUp size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="tm-refine-chips">
          {cfg.chips.map((c) => (
            <button key={c} className="tm-refine-chip" onClick={() => submit(c.toLowerCase())}>{c}</button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: "#8fa07f", lineHeight: 1.5 }}>
          Only this section changes — the rest of your plan stays put.
        </div>
      </div>
    </>
  );
}

function RefineBtn({ color, onClick }: { color: string; onClick: () => void }) {
  return (
    <button className="tm-refine-btn" style={{ color }} onClick={onClick}>
      <WandSparkles size={12} strokeWidth={1.8} style={{ color }} />
      Refine
    </button>
  );
}

function TrailCard({ trail, onRefine }: { trail?: Trail | null; onRefine: () => void }) {
  return (
    <div className="tm-card tm-card-hike">
      <div className="tm-card-head">
        <span className="tm-card-label" style={{ color: "#5c6b3c" }}>
          <Footprints size={15} strokeWidth={1.8} />Where to hike
        </span>
        <RefineBtn color="#2c4632" onClick={onRefine} />
      </div>
      {trail?.name ? (
        <>
          <div className="tm-card-title">{trail.name}</div>
          <div className="tm-meta">
            {trail.duration && <span className="tm-pill"><Clock size={12} strokeWidth={1.8} />{trail.duration}</span>}
            {trail.difficulty && <span className="tm-pill"><Gauge size={12} strokeWidth={1.8} />{trail.difficulty}</span>}
            {trail.distance_km && <span className="tm-pill"><Footprints size={12} strokeWidth={1.8} />{trail.distance_km} km</span>}
            {trail.start_maps && <span className="tm-pill"><Link text="Maps" url={trail.start_maps} /></span>}
            {trail.waze && <span className="tm-pill"><Link text="Waze" url={trail.waze} /></span>}
            {hikingMapUrl(trail) && (
              <a href={hikingMapUrl(trail)} target="_blank" rel="noreferrer" className="tm-pill">
                <Mountain size={12} strokeWidth={1.8} />Topo map
              </a>
            )}
            {trail.tiuli_url && (
              <a href={trail.tiuli_url} target="_blank" rel="noreferrer" className="tm-pill tm-pill-dark">
                <ExternalLink size={12} strokeWidth={1.8} />{guideLabel(trail.tiuli_url)}
              </a>
            )}
          </div>
        </>
      ) : (
        <div className="tm-card-title" style={{ color: "var(--muted)" }}>No trail selected yet</div>
      )}
    </div>
  );
}

function EatCard({ day, onRefine }: { day: Day; onRefine: () => void }) {
  const rows = ([["Lunch", day.lunch], ["Dinner", day.dinner]] as [string, Place | null | undefined][])
    .filter(([, p]) => p?.name);
  return (
    <div className="tm-card tm-card-eat">
      <div className="tm-card-head">
        <span className="tm-card-label" style={{ color: "#9a6f2e" }}>
          <Utensils size={14} strokeWidth={1.8} />Where to eat
        </span>
        <RefineBtn color="#8a5f22" onClick={onRefine} />
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No dining picks yet</p>
      ) : (
        rows.map(([label, place]) => (
          <div className="tm-kv" key={label}>
            <span className="tm-kv-k">{label}</span>
            <span className="tm-kv-v"><Link text={place!.name ?? ""} url={place!.maps} /></span>
          </div>
        ))
      )}
    </div>
  );
}

function SleepCard({ hotel, onRefine }: { hotel?: Place | null; onRefine: () => void }) {
  return (
    <div className="tm-card tm-card-sleep">
      <div className="tm-card-head">
        <span className="tm-card-label" style={{ color: "#6f5f80" }}>
          <BedDouble size={14} strokeWidth={1.8} />Where to sleep
        </span>
        <RefineBtn color="#6f5f80" onClick={onRefine} />
      </div>
      {hotel?.name ? (
        <>
          <div className="tm-card-title" style={{ fontSize: 15 }}>
            <Link text={hotel.name} url={hotel.maps} />
          </div>
          {hotel.address && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hotel.address}</div>}
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>No accommodation yet</p>
      )}
    </div>
  );
}

function WeatherCard({ day }: { day: Day }) {
  return (
    <div className="tm-card tm-card-weather">
      <div className="tm-weather-row">
        <span className="tm-card-label" style={{ color: "#4a7382" }}>
          <CloudSun size={15} strokeWidth={1.8} />
          <span className="tm-temp">{day.weather || "Forecast pending"}</span>
        </span>
        {day.weather_note && (
          <span className="tm-warn"><TriangleAlert size={13} strokeWidth={1.8} />{day.weather_note}</span>
        )}
      </div>
    </div>
  );
}

export default function Notebook({
  itinerary, tripId, canSave, onSave, messages, busy, steps, onSend,
}: {
  itinerary: Itinerary;
  tripId: string | null;
  canSave: boolean;
  onSave: () => void | Promise<void>;
  messages: { role: "user" | "assistant"; content: string }[];
  busy: boolean;
  steps: AgentStep[];
  onSend: (text: string) => void;
}) {
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState<Section | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [globalInput, setGlobalInput] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setActive(0); }, [itinerary]);
  // Close the refine popover once the agent finishes applying the change.
  useEffect(() => { if (!busy) setRefining(null); }, [busy]);

  // Keep the conversation log pinned to the latest message — on open and as
  // replies/steps stream in. Scrolls the log box itself, never the page.
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, steps, chatOpen]);

  const days: Day[] = itinerary.days ?? [];
  const day = days[active];
  const eyebrow = days.length <= 1 ? "One-day trip" : `${days.length}-day trip`;

  async function handleSave() {
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  }

  function shareLink() {
    if (!tripId) return;
    const url = `${window.location.origin}/?trip=${tripId}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  function submitGlobal(text: string) {
    const t = text.trim();
    if (t && !busy) { onSend(t); setGlobalInput(""); }
  }

  return (
    <div className="tm-result">
      <div className="tm-result-head">
        <div>
          <div className="tm-eyebrow">{eyebrow}</div>
          <div className="tm-result-title" style={{ marginTop: 6 }}>{itinerary.title}</div>
          {itinerary.dates && (
            <div className="tm-result-date"><Calendar size={14} strokeWidth={1.8} />{itinerary.dates}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          {canSave && (
            <button className="tm-btn-ghost" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save trip"}
            </button>
          )}
          {tripId && (
            <button className="tm-btn-ghost" onClick={shareLink}>
              <Share2 size={14} strokeWidth={1.8} />{copied ? "Copied!" : "Share"}
            </button>
          )}
        </div>
      </div>

      {days.length > 1 && (
        <div className="tm-daytabs">
          {days.map((d, i) => (
            <button
              key={i}
              className={`tm-daytab ${i === active ? "tm-daytab-active" : ""}`}
              onClick={() => setActive(i)}
            >
              Day {d.day_number ?? i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="tm-result-body">
        <div className="tm-map-panel">
          <div className="tm-map-inner">
            <div className="tm-map-tag">{itinerary.title}</div>
            <IsraelMap />
          </div>
        </div>

        <div className="tm-cards">
          {day && (
            <>
              <TrailCard trail={day.trail} onRefine={() => setRefining("hike")} />
              {refining === "hike" && (
                <RefinePopover section="hike" busy={busy} onSubmit={onSend} onClose={() => setRefining(null)} />
              )}

              <div className="tm-two">
                <EatCard day={day} onRefine={() => setRefining("eat")} />
                <SleepCard hotel={day.hotel} onRefine={() => setRefining("sleep")} />
              </div>
              {(refining === "eat" || refining === "sleep") && (
                <RefinePopover section={refining} busy={busy} onSubmit={onSend} onClose={() => setRefining(null)} />
              )}

              <WeatherCard day={day} />
            </>
          )}
        </div>
      </div>

      {/* Collapsed global chat — "change everything" edits that touch every section. */}
      <div className="tm-global">
        {messages.length > 0 && (
          <button className="tm-global-toggle" onClick={() => setChatOpen((o) => !o)}>
            <MessageSquare size={13} strokeWidth={1.8} />
            {chatOpen ? "Hide conversation" : `Conversation (${Math.ceil(messages.length / 2)})`}
            {/* Working while collapsed → a visible signal without expanding. */}
            {busy && !chatOpen && <LoaderCircle size={13} className="tm-spin" color="var(--olive)" />}
            <ChevronDown size={13} strokeWidth={1.8} style={{ transform: chatOpen ? "rotate(180deg)" : "none" }} />
          </button>
        )}
        {chatOpen && messages.length > 0 && (
          <div className="tm-global-log" ref={logRef}>
            {messages.map((m, i) => {
              // Skip an empty assistant bubble unless it's the live "…" placeholder
              // (busy, last, and no checklist showing) — the checklist stands in for it.
              // Mirrors Chat.tsx.
              const isPlaceholder = busy && i === messages.length - 1 && steps.length === 0;
              if (m.role === "assistant" && !m.content && !isPlaceholder) return null;
              return (
                <div key={i} className={`tm-msg ${m.role === "user" ? "tm-msg-user" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="tm-msg-avatar"><Compass size={14} strokeWidth={1.8} /></div>
                  )}
                  <div className="tm-msg-body">
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>
                        {m.content}
                      </ReactMarkdown>
                    ) : "…"}
                  </div>
                </div>
              );
            })}
            <StepChecklist steps={steps} busy={busy} />
          </div>
        )}
        <div className="tm-global-bar">
          <Sparkles size={16} strokeWidth={1.8} color="var(--olive)" style={{ flex: "0 0 auto" }} />
          <input
            value={globalInput}
            placeholder="Ask TrailMate to tweak this trip…"
            onChange={(e) => setGlobalInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitGlobal(globalInput); }}
            disabled={busy}
          />
          <button className="tm-send" style={{ width: 34, height: 34, borderRadius: 10 }}
            onClick={() => submitGlobal(globalInput)} disabled={busy || !globalInput.trim()}>
            <ArrowUp size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
