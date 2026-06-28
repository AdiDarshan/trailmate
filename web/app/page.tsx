"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Chat from "@/components/Chat";
import Notebook from "@/components/Notebook";
import Sidebar from "@/components/Sidebar";
import type { Itinerary, TripSummary } from "@/server/shared/types";

function Home() {
  const params = useSearchParams();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [chatKey, setChatKey] = useState(0); // bump to reset the chat

  const loadTrips = useCallback(async () => {
    const res = await fetch("/api/trips");
    if (res.ok) setTrips((await res.json()).trips ?? []);
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Agent presented a fresh (unsaved) plan.
  const onItinerary = useCallback((data: Itinerary) => {
    setItinerary(data);
    setCurrentTripId(null);
    setIsSaved(false);
  }, []);

  // Open a saved trip: load it, reset the chat, mark it the current trip.
  const openTrip = useCallback(async (id: string) => {
    const res = await fetch(`/api/trip/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as Itinerary;
    setItinerary(data);
    setCurrentTripId(id);
    setIsSaved(true);
    setChatKey((k) => k + 1);
  }, []);

  // Deep link: /?trip=<id>
  useEffect(() => {
    const t = params.get("trip");
    if (t) openTrip(t);
  }, [params, openTrip]);

  const newTrip = useCallback(() => {
    setItinerary(null);
    setCurrentTripId(null);
    setIsSaved(false);
    setChatKey((k) => k + 1);
  }, []);

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

  return (
    <main className="tm-app">
      <Sidebar
        trips={trips}
        activeId={currentTripId}
        onOpen={openTrip}
        onNew={newTrip}
      />
      <section className="tm-pane tm-pane-chat">
        <Chat key={chatKey} tripId={currentTripId} onItinerary={onItinerary} />
      </section>
      <section className="tm-pane">
        <Notebook
          itinerary={itinerary}
          tripId={isSaved ? currentTripId : null}
          canSave={!!itinerary && !isSaved}
          onSave={saveTrip}
        />
      </section>
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
