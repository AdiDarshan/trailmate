"use client";

import { createClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "#fffdf6",
      }}
    >
      <div style={{ fontSize: "2rem", fontWeight: 800, color: "#1b3a1f" }}>🥾 TrailMate</div>
      <div style={{ color: "#6b7280" }}>Your AI travel companion for Israel.</div>
      <button
        onClick={signIn}
        style={{
          marginTop: 8,
          padding: "12px 22px",
          borderRadius: 12,
          border: "1px solid #e0ddd0",
          background: "#fff",
          fontWeight: 700,
          fontSize: "1rem",
          cursor: "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
        }}
      >
        Sign in with Google
      </button>
    </main>
  );
}
