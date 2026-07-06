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

  // Agent presented a fresh plan or edited the open one. Either way it's now
  // unsaved so the Save button reappears; currentTripId is left intact so saving
  // an edited trip updates it in place rather than creating a duplicate.
  const onItinerary = useCallback((data: Itinerary) => {
    setItinerary(data);
    setIsSaved(false);
  }, []);

  const agent = useAgent(onItinerary);

  const loadTrips = useCallback(async () => {
    const res = await fetch("/api/trips", { cache: "no-store" });
    if (res.ok) setTrips((await res.json()).trips ?? []);
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Open a saved trip: load it, reset the conversation, mark it current.
  const openTrip = useCallback(async (id: string) => {
    const res = await fetch(`/api/trip/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Itinerary;
    setItinerary(data);
    setCurrentTripId(id);
    setIsSaved(true);
    agent.reset();
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
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary, id: currentTripId ?? undefined }),
    });
    if (res.ok) {
      const { trip_id } = await res.json();
      setCurrentTripId(trip_id);
      setIsSaved(true);
      loadTrips();
    }
  }, [itinerary, currentTripId, loadTrips]);

  const send = useCallback((text: string) => agent.send(text, currentTripId), [agent, currentTripId]);

  return (
    <main className="tm-app">
      {/* Mobile top bar */}
      <div className="tm-topbar">
        <button className="tm-icon-btn" onClick={() => setRailOpen(true)} aria-label="Menu">
          <Menu size={18} strokeWidth={1.8} />
        </button>
        <div className="tm-brand" style={{ margin: 0 }}>
          <div className="tm-brand-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>
            <Compass size={15} color="var(--sage)" strokeWidth={1.8} />
          </div>
          <span className="tm-brand-name">TrailMate</span>
        </div>
        <div className="tm-avatar">T</div>
      </div>

      {railOpen && <div className="tm-scrim" onClick={() => setRailOpen(false)} />}
      <Sidebar
        trips={trips}
        activeId={currentTripId}
        onOpen={openTrip}
        onNew={newTrip}
        className={railOpen ? "tm-rail-open" : ""}
      />

      <div className="tm-main">
        {/* Notebook only once there's a concrete plan; otherwise stay in the
            conversation (chat) until one emerges; Welcome is the empty state. */}
        {itinerary ? (
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
          <Chat messages={agent.messages} busy={agent.busy} onSend={send} />
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
