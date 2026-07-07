"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Menu, Compass } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Welcome from "@/components/Welcome";
import Chat from "@/components/Chat";
import Notebook from "@/components/Notebook";
import { useAgent } from "@/lib/useAgent";
import type { Itinerary, TripSummary } from "@/server/shared/types";

function Home() {
  const params = useSearchParams();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  // True once the persisted current chat has been restored (or ruled out) —
  // gates the main pane so a saved conversation doesn't flash as Welcome.
  const [booted, setBooted] = useState(false);

  // Agent presented a fresh plan or edited the open one. Either way it's now
  // unsaved so the Save button reappears; currentTripId is left intact so saving
  // an edited trip updates it in place rather than creating a duplicate.
  const onItinerary = useCallback((data: Itinerary) => {
    setItinerary(data);
    setIsSaved(false);
  }, []);

  const agent = useAgent(onItinerary);

  const loadTrips = useCallback(async () => {
    try {
      const res = await fetch("/api/trips", { cache: "no-store" });
      if (res.ok) setTrips((await res.json()).trips ?? []);
    } catch (e) {
      console.error("loadTrips failed:", e); // sidebar stays stale; next action retries
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Restore the persisted current chat on load (unless deep-linked to a trip).
  // Brings back both the conversation and a presented-but-unsaved plan.
  useEffect(() => {
    if (params.get("trip")) {
      setBooted(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/chat/session", { cache: "no-store" });
        if (res.ok) {
          const { sessionId, messages, itinerary: pending } = await res.json();
          if (sessionId) {
            agent.hydrate(sessionId, messages ?? []);
            if (pending) {
              setItinerary(pending);
              setIsSaved(false);
            }
          }
        }
      } catch (e) {
        console.error("chat restore failed:", e); // start fresh rather than block the app
      } finally {
        setBooted(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open a saved trip: load it, restore its chat (the only old conversations
  // that stay reachable), and mark it current. If the trip's session carries a
  // presented-but-unsaved edit, show that instead of the saved version.
  const openTrip = useCallback(async (id: string) => {
    let data: Itinerary;
    try {
      const res = await fetch(`/api/trip/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      data = (await res.json()) as Itinerary;
    } catch (e) {
      console.error("openTrip failed:", e); // keep current view; user can retry
      return;
    }
    let pending: Itinerary | null = null;
    try {
      const s = await fetch(`/api/chat/session?tripId=${id}`, { cache: "no-store" });
      if (s.ok) {
        const { sessionId, messages, itinerary } = await s.json();
        pending = itinerary ?? null;
        if (sessionId) agent.hydrate(sessionId, messages ?? []);
        else agent.reset();
      } else {
        agent.reset();
      }
    } catch {
      agent.reset();
    }
    setItinerary(pending ?? data);
    setCurrentTripId(id);
    setIsSaved(!pending);
    setRailOpen(false);
  }, [agent]);

  // Deep link: /?trip=<id>
  useEffect(() => {
    const t = params.get("trip");
    if (t) openTrip(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const newTrip = useCallback(() => {
    setItinerary(null);
    setCurrentTripId(null);
    setIsSaved(false);
    agent.reset();
    setRailOpen(false);
  }, [agent]);

  const saveTrip = useCallback(async () => {
    if (!itinerary) return;
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itinerary,
          id: currentTripId ?? undefined,
          // Attach this conversation to the trip so opening it later restores the chat.
          sessionId: agent.sessionId ?? undefined,
        }),
      });
      if (res.ok) {
        const { trip_id } = await res.json();
        setCurrentTripId(trip_id);
        setIsSaved(true);
        loadTrips();
      }
    } catch (e) {
      console.error("saveTrip failed:", e); // Save button stays visible for retry
    }
  }, [itinerary, currentTripId, agent.sessionId, loadTrips]);

  const send = useCallback((text: string) => agent.send(text, currentTripId), [agent, currentTripId]);

  return (
    <main className="tm-app">
      {/* Mobile top bar */}
      <div className="tm-topbar">
        <button className="tm-icon-btn" onClick={() => setRailOpen(true)} aria-label="Menu">
          <Menu size={18} strokeWidth={1.8} />
        </button>
        <button type="button" className="tm-brand tm-brand-btn" style={{ margin: 0 }} onClick={newTrip} aria-label="Go to home">
          <div className="tm-brand-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>
            <Compass size={15} color="var(--sage)" strokeWidth={1.8} />
          </div>
          <span className="tm-brand-name">TrailMate</span>
        </button>
        <div className="tm-avatar">T</div>
      </div>

      {railOpen && <div className="tm-scrim" onClick={() => setRailOpen(false)} />}
      <Sidebar
        trips={trips}
        activeId={currentTripId}
        onOpen={openTrip}
        onNew={newTrip}
        onHome={newTrip}
        className={railOpen ? "tm-rail-open" : ""}
      />

      <div className="tm-main">
        {/* Notebook once there's a concrete plan; otherwise the chat (which shows a
            live checklist while the agent works); Welcome is the empty state.
            Nothing renders until the persisted chat is restored (no Welcome flash). */}
        {!booted ? null : itinerary ? (
          <Notebook
            itinerary={itinerary}
            tripId={isSaved ? currentTripId : null}
            canSave={!!itinerary && !isSaved}
            onSave={saveTrip}
            messages={agent.messages}
            busy={agent.busy}
            onSend={send}
          />
        ) : agent.messages.length > 0 ? (
          <Chat messages={agent.messages} busy={agent.busy} steps={agent.steps} onSend={send} />
        ) : (
          <Welcome onSubmit={send} />
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
