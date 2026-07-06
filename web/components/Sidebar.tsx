"use client";

import { useEffect, useState } from "react";
import { Compass, Plus, Map, Send } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import About from "./About";
import type { TripSummary } from "@/server/shared/types";

export default function Sidebar({
  trips,
  activeId,
  onOpen,
  onNew,
  onHome,
  className = "",
}: {
  trips: TripSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onHome: () => void;
  className?: string;
}) {
  // The signed-in user, so the footer shows who's connected (not a generic "Account").
  const [user, setUser] = useState<{ name: string; email: string; initial: string } | null>(null);
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const u = data.user;
        if (!u) return;
        const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
        const name = meta.full_name || meta.name || u.email || "Account";
        setUser({ name, email: u.email ?? "", initial: (name[0] || "?").toUpperCase() });
      });
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function connectTelegram() {
    const res = await fetch("/api/telegram/link");
    if (!res.ok) return;
    const { url } = await res.json();
    if (url) window.open(url, "_blank");
  }

  return (
    <aside className={`tm-rail ${className}`}>
      <button type="button" className="tm-brand tm-brand-btn" onClick={onHome} aria-label="Go to home">
        <div className="tm-brand-mark">
          <Compass size={18} color="var(--sage)" strokeWidth={1.8} />
        </div>
        <div className="tm-brand-name">TrailMate</div>
      </button>

      <div className="tm-rail-head">
        <span className="tm-eyebrow">My trips</span>
        <button className="tm-newtrip" onClick={onNew}>
          <Plus size={13} color="var(--sage)" strokeWidth={2} />
          New
        </button>
      </div>

      <div className="tm-trips">
        {trips.length === 0 ? (
          <div className="tm-trips-empty">
            <Map size={22} strokeWidth={1.6} />
            <div>
              Trips you plan will
              <br />
              appear here.
            </div>
          </div>
        ) : (
          trips.map((t) => (
            <button
              key={t.id}
              className={`tm-trip ${t.id === activeId ? "tm-trip-active" : ""}`}
              onClick={() => onOpen(t.id)}
            >
              <div className="tm-trip-title">{t.title}</div>
              {t.dates && <div className="tm-trip-dates">{t.dates}</div>}
            </button>
          ))
        )}
      </div>

      <div className="tm-rail-foot">
        <About />
        <button className="tm-rail-btn" onClick={connectTelegram}>
          <Send size={14} strokeWidth={1.8} />
          Connect Telegram
        </button>
        <div className="tm-user">
          <div className="tm-avatar">{user?.initial ?? "·"}</div>
          <div className="tm-user-name" title={user?.email || undefined}>
            {user?.name ?? "Account"}
          </div>
          <button className="tm-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
