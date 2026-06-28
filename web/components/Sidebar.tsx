"use client";

import { createClient } from "@/lib/supabase-browser";
import type { TripSummary } from "@/server/shared/types";

export default function Sidebar({
  trips,
  activeId,
  onOpen,
  onNew,
}: {
  trips: TripSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="tm-sidebar">
      <div className="tm-sidebar-head">
        <div className="tm-pane-title" style={{ fontSize: "1.1rem" }}>
          🥾 My Trips
        </div>
        <button className="tm-newtrip" onClick={onNew}>
          + New
        </button>
      </div>

      <div className="tm-trips-list">
        {trips.length === 0 ? (
          <div className="tm-trips-empty">No saved trips yet. Plan one and tap Save.</div>
        ) : (
          trips.map((t) => (
            <button
              key={t.id}
              className={`tm-trip-item ${t.id === activeId ? "tm-trip-active" : ""}`}
              onClick={() => onOpen(t.id)}
            >
              <div className="tm-trip-title">{t.title}</div>
              {t.dates && <div className="tm-trip-dates">{t.dates}</div>}
            </button>
          ))
        )}
      </div>

      <button className="tm-signout" onClick={signOut}>
        Sign out
      </button>
    </aside>
  );
}
