"use client";

// Login — split screen from the design's FLOW 5: dark brand panel with the
// pulsing Israel silhouette on the left, the sign-in card on the right. The
// brand panel collapses away on small screens.

import { Compass, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { ISRAEL_OUTLINE } from "@/components/IsraelMap";

// Decorative region dots (Galilee, Tel Aviv, Negev, Eilat), staggered pulses.
const DOTS = [
  { left: 63.4, top: 8.8, delay: 0 },
  { left: 37.5, top: 46.3, delay: 0.5 },
  { left: 48.6, top: 82.3, delay: 1 },
  { left: 51.4, top: 97, delay: 1.5, terra: true },
];

function GoogleLogo() {
  return (
    <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="tm-login">
      <div className="tm-login-brand">
        <div className="tm-login-logo">
          <div className="tm-login-mark">
            <Compass size={20} color="var(--sage)" strokeWidth={1.8} />
          </div>
          TrailMate
        </div>
        <div className="tm-login-map" aria-hidden="true">
          <svg viewBox="160 34 215 639">
            <path
              d={ISRAEL_OUTLINE}
              fill="none"
              stroke="var(--olive)"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {DOTS.map((d, i) => (
            <div
              key={i}
              className="tm-login-dot"
              style={{
                left: `${d.left}%`,
                top: `${d.top}%`,
                background: d.terra ? "var(--terra)" : "var(--sage)",
                animationDelay: `${d.delay}s`,
              }}
            />
          ))}
        </div>
        <div className="tm-login-tag">
          <div className="tm-login-tagline">
            Every trail, meal and bed —
            <br />
            planned in one message.
          </div>
          <div className="tm-login-tagmono">TRAILS · ISRAEL</div>
        </div>
      </div>

      <div className="tm-login-pane">
        <div className="tm-eyebrow">Welcome</div>
        <h1 className="tm-login-title">Where to next?</h1>
        <p className="tm-login-sub">Sign in to save your trips and pick up where you left off.</p>
        <button className="tm-login-google" onClick={signIn}>
          <GoogleLogo />
          Sign in with Google
        </button>
        <div className="tm-login-note">
          <ShieldCheck size={14} strokeWidth={1.8} />
          We only use your account to keep your trips.
        </div>
      </div>
    </main>
  );
}
