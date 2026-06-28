"use client";

import { useEffect, useState } from "react";
import type { Day, Itinerary, Place, Trail } from "@/server/shared/types";

function Link({ text, url }: { text: string; url?: string }) {
  if (!url) return <>{text}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
}

function TrailCard({ trail }: { trail?: Trail | null }) {
  if (!trail?.name) {
    return (
      <div className="tm-card tm-trail">
        <div className="tm-card-title">🥾 Where to Hike</div>
        <p>No trail selected yet</p>
      </div>
    );
  }
  const meta = [
    trail.distance_km && `📏 ${trail.distance_km} km`,
    trail.duration && `⏱️ ${trail.duration}`,
    trail.difficulty && `💪 ${trail.difficulty}`,
  ].filter(Boolean);
  const desc = trail.description
    ? trail.description.slice(0, 200) + (trail.description.length > 200 ? "…" : "")
    : null;
  return (
    <div className="tm-card tm-trail">
      <div className="tm-card-title">🥾 Where to Hike</div>
      <p style={{ fontSize: "1rem", fontWeight: 800 }}>{trail.name}</p>
      {(trail.start_maps || trail.waze) && (
        <p>
          {trail.start_maps && <Link text="📍 Maps" url={trail.start_maps} />}
          {trail.start_maps && trail.waze && " · "}
          {trail.waze && <Link text="🧭 Waze" url={trail.waze} />}
        </p>
      )}
      {meta.length > 0 && <p>{meta.join("  ·  ")}</p>}
      {desc && <p style={{ marginTop: 6, fontStyle: "italic" }}>{desc}</p>}
      {trail.tiuli_url && (
        <p style={{ marginTop: 6 }}>
          <Link text="🔗 Full guide on Tiuli" url={trail.tiuli_url} />
        </p>
      )}
    </div>
  );
}

function EatCard({ day }: { day: Day }) {
  const rows = ([["Lunch", day.lunch], ["Dinner", day.dinner]] as [string, Place | null | undefined][])
    .filter(([, p]) => p?.name);
  return (
    <div className="tm-card tm-eat">
      <div className="tm-card-title">🍽️ Where to Eat</div>
      {rows.length === 0 ? (
        <p>No dining picks yet</p>
      ) : (
        rows.map(([label, place]) => (
          <p key={label}>
            <strong>{label}:</strong> <Link text={place!.name ?? ""} url={place!.maps} />
            {place!.address && <span style={{ opacity: 0.7 }}> · {place!.address}</span>}
          </p>
        ))
      )}
    </div>
  );
}

function SleepCard({ hotel }: { hotel?: Place | null }) {
  return (
    <div className="tm-card tm-sleep">
      <div className="tm-card-title">🏨 Where to Sleep</div>
      {hotel?.name ? (
        <>
          <p>
            <Link text={hotel.name} url={hotel.maps} />
          </p>
          {hotel.address && <p style={{ opacity: 0.75 }}>{hotel.address}</p>}
        </>
      ) : (
        <p>No accommodation yet</p>
      )}
    </div>
  );
}

function WeatherCard({ day }: { day: Day }) {
  return (
    <div className="tm-card tm-weather">
      <div className="tm-card-title">🌡️ Weather</div>
      {day.weather ? <p>🌤️ {day.weather}</p> : <p>No forecast yet</p>}
      {day.weather_note && (
        <p>
          ⚠️ <strong>{day.weather_note}</strong>
        </p>
      )}
    </div>
  );
}

export default function Notebook({ tripId }: { tripId: string | null }) {
  const [itin, setItin] = useState<Itinerary | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!tripId) {
      setItin(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/trip/${tripId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && !d.error) {
          setItin(d);
          setActive(0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (!itin) {
    return (
      <>
        <div className="tm-pane-title">📓 Trip Notebook</div>
        <div className="tm-empty">
          🗺️
          <br />
          <br />
          Your day-by-day plan will appear here once TrailMate finishes planning.
          <br />
          Try: <em>&quot;Plan 2 days in the Galilee starting this Saturday&quot;</em>
        </div>
      </>
    );
  }

  const days: Day[] = itin.days ?? [];
  const day = days[active];
  const shareUrl =
    typeof window !== "undefined" && tripId ? `${window.location.origin}/?trip=${tripId}` : "";

  return (
    <>
      <div className="tm-pane-title">📓 {itin.title}</div>
      {itin.dates && <div className="tm-pane-sub">{itin.dates}</div>}
      {shareUrl && (
        <div className="tm-share">
          Share: <a href={shareUrl}>{shareUrl}</a>
        </div>
      )}
      <div className="tm-day-tabs">
        {days.map((d, i) => (
          <button
            key={i}
            className={`tm-tab ${i === active ? "tm-tab-active" : ""}`}
            onClick={() => setActive(i)}
          >
            Day {d.day_number ?? i + 1}
          </button>
        ))}
      </div>
      <div className="tm-notebook-scroll">
        {day && (
          <>
            <div className="tm-day-header">
              Day {day.day_number}
              <div className="tm-day-date">{day.date}</div>
            </div>
            <TrailCard trail={day.trail} />
            <EatCard day={day} />
            <SleepCard hotel={day.hotel} />
            <WeatherCard day={day} />
          </>
        )}
      </div>
    </>
  );
}
