"use client";

import { useState } from "react";

export function Login() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) window.location.reload();
    else {
      setError("That passcode didn't work.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1>KRO5</h1>
      <form onSubmit={submit}>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy || !passcode}>
          Unlock
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
