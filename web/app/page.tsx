"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Menu, Compass, LoaderCircle } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Welcome from "@/components/Welcome";
import Chat from "@/components/Chat";
import Notebook from "@/components/Notebook";
import Preferences from "@/components/Preferences";
import { useAgent } from "@/lib/useAgent";
import { EMPTY_PICKS, countSetPrefs, parsePrefs, serializePrefs, type PrefPicks } from "@/lib/prefs";
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

  // Standing preferences — structured picks over the one stored text field.
  // Owned here so the sidebar badge and the preferences screen stay in sync.
  const [prefsView, setPrefsView] = useState(false);
  const [prefPicks, setPrefPicks] = useState<PrefPicks>(EMPTY_PICKS);
  const [prefsSaving, setPrefsSaving] = useState(false);
  useEffect(() => {
    fetch("/api/prefs", { cache: "no-store" })
      .then(async (res) => {
        if (res.ok) setPrefPicks(parsePrefs((await res.json()).preferences ?? ""));
      })
      .catch(() => {}); // screen starts empty; taps still save
  }, []);

  // Auto-save: every tap PUTs the serialized string (the field the agent reads).
  const updatePrefs = useCallback(async (picks: PrefPicks) => {
    setPrefPicks(picks);
    setPrefsSaving(true);
    try {
      await fetch("/api/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: serializePrefs(picks) }),
      });
    } catch (e) {
      console.error("savePrefs failed:", e); // next tap retries the whole state
    } finally {
      setPrefsSaving(false);
    }
  }, []);

  const openPrefs = useCallback(() => {
    setPrefsView(true);
    setRailOpen(false);
  }, []);

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

  // Open a saved trip: load it and its chat in PARALLEL (they're independent),
  // with instant feedback — the card highlights and the main pane shows a
  // loading state the moment the user clicks. If the trip's session carries a
  // presented-but-unsaved edit, show that instead of the saved version.
  const [tripLoading, setTripLoading] = useState(false);
  const openSeq = useRef(0); // rapid clicks: only the newest request may apply
  const openTrip = useCallback(async (id: string) => {
    const seq = ++openSeq.current;
    const prevTripId = currentTripId;
    setCurrentTripId(id);
    setTripLoading(true);
    setPrefsView(false);
    setRailOpen(false);

    const [tripRes, sessionRes] = await Promise.allSettled([
      fetch(`/api/trip/${id}`, { cache: "no-store" }),
      fetch(`/api/chat/session?tripId=${id}`, { cache: "no-store" }),
    ]);
    if (seq !== openSeq.current) return; // superseded by a newer click

    let data: Itinerary | null = null;
    try {
      if (tripRes.status === "fulfilled" && tripRes.value.ok) {
        data = (await tripRes.value.json()) as Itinerary;
      }
    } catch (e) {
      console.error("openTrip parse failed:", e);
    }

    let pending: Itinerary | null = null;
    let hydrated = false;
    try {
      if (sessionRes.status === "fulfilled" && sessionRes.value.ok) {
        const { sessionId, messages, itinerary } = await sessionRes.value.json();
        pending = itinerary ?? null;
        if (sessionId) {
          agent.hydrate(sessionId, messages ?? []);
          hydrated = true;
        }
      }
    } catch {
      /* fall through to reset below */
    }
    if (seq !== openSeq.current) return;
    if (!hydrated) agent.reset();

    if (!data && !pending) {
      // Nothing loaded — undo the optimistic selection; user can retry.
      console.error("openTrip failed:", id);
      setCurrentTripId(prevTripId);
      setTripLoading(false);
      return;
    }
    setItinerary(pending ?? data);
    setIsSaved(!pending);
    setTripLoading(false);
  }, [agent, currentTripId]);

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
    setPrefsView(false);
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
        onPrefs={openPrefs}
        prefsCount={countSetPrefs(prefPicks)}
        className={railOpen ? "tm-rail-open" : ""}
      />

      <div className="tm-main">
        {/* Notebook once there's a concrete plan; otherwise the chat (which shows a
            live checklist while the agent works); Welcome is the empty state.
            Nothing renders until the persisted chat is restored (no Welcome flash). */}
        {!booted ? null : tripLoading ? (
          <div className="tm-trip-loading">
            <LoaderCircle size={18} className="tm-spin" color="var(--olive)" />
            Opening trip…
          </div>
        ) : prefsView ? (
          <Preferences picks={prefPicks} saving={prefsSaving} onChange={updatePrefs} />
        ) : itinerary ? (
          <Notebook
            itinerary={itinerary}
            tripId={isSaved ? currentTripId : null}
            canSave={!!itinerary && !isSaved}
            onSave={saveTrip}
            messages={agent.messages}
            busy={agent.busy}
            steps={agent.steps}
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
