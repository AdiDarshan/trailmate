"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Chat from "@/components/Chat";
import Notebook from "@/components/Notebook";

function Home() {
  const params = useSearchParams();
  const [tripId, setTripId] = useState<string | null>(null);

  // Support shareable URLs: /?trip=<id> loads an existing itinerary.
  useEffect(() => {
    const t = params.get("trip");
    if (t) setTripId(t);
  }, [params]);

  return (
    <main className="tm-app">
      <section className="tm-pane tm-pane-chat">
        <Chat onTrip={setTripId} />
      </section>
      <section className="tm-pane">
        <Notebook tripId={tripId} />
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
