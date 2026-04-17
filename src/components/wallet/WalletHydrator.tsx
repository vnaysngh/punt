"use client";

import { useEffect } from "react";
import { useWalletStore } from "@/store/wallet-store";
import { useLoopConnect } from "@/hooks/useLoopConnect";

export default function WalletHydrator() {
  const connected = useWalletStore((s) => s.connected);
  const sessionToken = useWalletStore((s) => s.sessionToken);
  const setAppBalance = useWalletStore((s) => s.setAppBalance);
  const { autoConnect } = useLoopConnect();

  const fetchBalance = (token: string) => {
    fetch("/api/users", {
      headers: { "Authorization": `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        if (typeof data.appBalance === "number") setAppBalance(data.appBalance);
      })
      .catch(() => {});
  };

  // Restore session on page load (e.g. after refresh)
  useEffect(() => {
    // If localStorage has connected=true but no sessionToken, the stored state
    // is corrupt (happened during a broken auth flow). Clear it so user can re-login.
    if (connected && !sessionToken) {
      useWalletStore.getState().disconnect();
      return;
    }
    autoConnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected || !sessionToken) return;
    fetchBalance(sessionToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, sessionToken]);

  useEffect(() => {
    if (!connected || !sessionToken) return;
    const interval = setInterval(() => fetchBalance(sessionToken), 15_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, sessionToken]);

  return null;
}
