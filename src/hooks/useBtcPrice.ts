"use client";

import { useEffect, useRef, useState } from "react";

// Binance aggTrade stream — fires on every trade, ~100ms
const WS_URL = "wss://stream.binance.com/ws/btcusdt@aggTrade";

const STALE_MS      = 8_000;   // declare WS stale if no tick for this long
const REST_POLL_MS  = 3_000;   // REST fallback poll interval
const BACKOFF_BASE  = 1_000;   // initial reconnect delay
const BACKOFF_MAX   = 30_000;  // max reconnect delay
const THROTTLE_MS   = 1_000;   // push to React state at most once per second

export function useBtcPrice(): { price: number | null; dir: "up" | "down" | null } {
  const [price, setPrice] = useState<number | null>(null);
  const [dir,   setDir  ] = useState<"up" | "down" | null>(null);

  // All mutable state in refs — immune to closure staleness
  const refs = useRef({
    ws:          null as WebSocket | null,
    lastTick:    0,
    lastApplied: 0,   // timestamp of last React state update (for throttle)
    backoff:     BACKOFF_BASE,
    prevPrice:   null as number | null,
    dirTimer:    null as ReturnType<typeof setTimeout>   | null,
    reconnTimer: null as ReturnType<typeof setTimeout>   | null,
    staleTimer:  null as ReturnType<typeof setInterval>  | null,
    restTimer:   null as ReturnType<typeof setInterval>  | null,
    mounted:     false,
  });

  useEffect(() => {
    const r = refs.current;
    r.mounted = true;

    // ── helpers ──────────────────────────────────────────────────────────────

    function applyPrice(next: number) {
      if (!r.mounted) return;
      // Throttle: ignore ticks that arrive faster than THROTTLE_MS.
      // The WS fires on every trade (up to 50/s for BTC) — we only need 1s updates.
      const now = Date.now();
      if (now - r.lastApplied < THROTTLE_MS) return;
      r.lastApplied = now;
      setPrice(prev => {
        if (prev !== null && next !== prev) {
          const d = next > prev ? "up" : "down";
          setDir(d);
          if (r.dirTimer) clearTimeout(r.dirTimer);
          r.dirTimer = setTimeout(() => setDir(null), 2_000);
        }
        r.prevPrice = next;
        return next;
      });
    }

    function stopRest() {
      if (r.restTimer) { clearInterval(r.restTimer); r.restTimer = null; }
    }

    function startRest() {
      if (r.restTimer) return;
      const poll = async () => {
        try {
          const res  = await fetch("/api/price", { cache: "no-store" });
          const data = await res.json() as { price?: number };
          if (typeof data.price === "number") applyPrice(data.price);
        } catch { /* silent */ }
      };
      poll();
      r.restTimer = setInterval(poll, REST_POLL_MS);
    }

    function closeWs() {
      const ws = r.ws;
      if (!ws) return;
      ws.onopen    = null;
      ws.onmessage = null;
      ws.onerror   = null;
      ws.onclose   = null;
      ws.close();
      r.ws = null;
    }

    function connect() {
      if (!r.mounted) return;
      closeWs();

      const ws = new WebSocket(WS_URL);
      r.ws = ws;

      ws.onopen = () => {
        if (!r.mounted) { ws.close(); return; }
        console.log("[useBtcPrice] Binance WS connected");
        r.backoff = BACKOFF_BASE;
        stopRest();
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (!r.mounted) return;
        try {
          const data = JSON.parse(evt.data as string) as { p?: string };
          const next = parseFloat(data.p ?? "");
          if (!isFinite(next) || next <= 0) return;
          r.lastTick = Date.now();
          applyPrice(next);
        } catch { /* malformed frame */ }
      };

      ws.onerror = () => {
        // onclose always fires after onerror — handle reconnect there
      };

      ws.onclose = (evt) => {
        if (!r.mounted) return;
        console.log(`[useBtcPrice] WS closed (code=${evt.code}) — REST fallback active, reconnecting in ${r.backoff}ms`);
        r.ws = null;
        startRest();
        const delay = r.backoff;
        r.backoff = Math.min(delay * 2, BACKOFF_MAX);
        r.reconnTimer = setTimeout(connect, delay);
      };
    }

    // ── start ────────────────────────────────────────────────────────────────
    connect();

    // Stale detector: WS can be open but silently dead (no ping failure yet).
    // If no tick for STALE_MS, bridge with REST until messages resume.
    r.staleTimer = setInterval(() => {
      const ws     = r.ws;
      const isOpen = ws?.readyState === WebSocket.OPEN;
      const isStale = isOpen && r.lastTick > 0 && Date.now() - r.lastTick > STALE_MS;
      if (!isOpen || isStale) {
        startRest();
      } else {
        stopRest();
      }
    }, 4_000);

    // ── teardown ─────────────────────────────────────────────────────────────
    return () => {
      r.mounted = false;
      if (r.reconnTimer) clearTimeout(r.reconnTimer);
      if (r.staleTimer)  clearInterval(r.staleTimer);
      if (r.dirTimer)    clearTimeout(r.dirTimer);
      stopRest();
      closeWs();
    };
  }, []); // runs once — all state is in refs

  return { price, dir };
}
