"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Bitcoin, Lock, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

import MarketTimer from "@/components/market/MarketTimer";
import PriceChart from "@/components/market/PriceChart";
import { useMarketStore, type Market, type Bet } from "@/store/market-store";
import { useWalletStore } from "@/store/wallet-store";
import WalletConnectModal from "@/components/wallet/WalletConnectModal";
import clsx from "clsx";

const FRACS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "75%", f: 0.75 },
  { label: "MAX", f: 1 },
];

type BetStep = "input" | "submitting" | "success" | "error";

export default function MarketsPage() {
  const { markets, myBets, setMarkets, setMyBets, setLoading, loading } = useMarketStore();
  const { connected, partyId, appBalance, setAppBalance } = useWalletStore();
  const [connectOpen, setConnectOpen] = useState(false);
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);
  const priceDirTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bet panel state
  const [direction, setDirection] = useState<"UP" | "DOWN" | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<BetStep>("input");
  const [betError, setBetError] = useState<string | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const liveMarket = markets.find((m: Market) => m.status === "OPEN") ?? null;
  const settledMarkets = markets.filter((m: Market) => m.status === "SETTLED");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/markets");
      const data = await res.json();
      setMarkets(Array.isArray(data) ? data : []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [setLoading, setMarkets]);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/price");
      const data = await res.json();
      if (data.price) {
        const newPrice = data.price;
        setBtcPrice((prev) => {
          if (prev !== null && newPrice !== prev) {
            const dir = newPrice > prev ? "up" : "down";
            setPriceDir(dir);
            if (priceDirTimer.current) clearTimeout(priceDirTimer.current);
            priceDirTimer.current = setTimeout(() => setPriceDir(null), 2000);
          }
          return newPrice;
        });
      }
    } catch { /* silent */ }
  }, []);

  const fetchBets = useCallback(async () => {
    if (!partyId) return;
    try {
      const res = await fetch(`/api/bets?partyId=${partyId}`);
      const data = await res.json();
      setMyBets(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, [partyId, setMyBets]);

  useEffect(() => {
    fetchMarkets();
    fetchPrice();
    const marketsId = setInterval(fetchMarkets, 30_000);
    const priceId = setInterval(fetchPrice, 15_000);
    return () => { clearInterval(marketsId); clearInterval(priceId); };
  }, [fetchMarkets, fetchPrice]);

  useEffect(() => { fetchBets(); }, [fetchBets]);

  // Reset bet form when market changes
  useEffect(() => {
    setDirection(null);
    setAmount("");
    setStep("input");
    setBetError(null);
    setTimerExpired(false);
  }, [liveMarket?.id]);

  const myBetMap = myBets.reduce<Record<string, Bet>>((acc, b: Bet) => { acc[b.marketId] = b; return acc; }, {});

  // Bet logic
  const parsed = parseFloat(amount);
  const totalPool = liveMarket ? liveMarket.totalUp + liveMarket.totalDown : 0;
  const upPct = totalPool > 0 ? (liveMarket!.totalUp / totalPool) * 100 : 50;
  const downPct = 100 - upPct;
  const isValid = direction !== null && parsed > 0 && parsed <= appBalance && liveMarket !== null;
  const potentialPool = totalPool + (isValid ? parsed : 0);
  const winningPool = direction === "UP"
    ? (liveMarket?.totalUp ?? 0) + (isValid && direction === "UP" ? parsed : 0)
    : (liveMarket?.totalDown ?? 0) + (isValid && direction === "DOWN" ? parsed : 0);
  const potentialPayout = winningPool > 0 && isValid ? (parsed / winningPool) * potentialPool : 0;
  const profit = potentialPayout - (isValid ? parsed : 0);

  const myBet = liveMarket ? myBetMap[liveMarket.id] : null;
  const isOpen = liveMarket?.status === "OPEN" && !timerExpired;

  const handleBet = async () => {
    if (!isValid || !partyId || !liveMarket) return;
    setStep("submitting");
    setBetError(null);
    try {
      const res = await fetch(`/api/markets/${liveMarket.id}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId, direction, amount: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bet failed");
      setAppBalance(data.appBalance);
      setStep("success");
      fetchBets();
    } catch (err) {
      setBetError(err instanceof Error ? err.message : "Failed to place bet");
      setStep("error");
    }
  };

  const resetBet = () => { setDirection(null); setAmount(""); setStep("input"); setBetError(null); };

  return (
    <div className="min-h-screen">
      {/* BG orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-80 -left-40 w-[700px] h-[700px] rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, #f97316 0%, transparent 70%)" }} />
        <div className="absolute -bottom-60 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }} />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-10">

        {/* ─── Top bar: market label + live BTC price ─── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-between mb-8"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-400 pulse-dot" />
            <span className="text-orange-400/70 text-xs font-semibold uppercase tracking-widest" style={{ fontFamily: "var(--font-space-mono)" }}>
              Canton Network · BTC/USD · 15-min rounds
            </span>
          </div>

          {/* Live price chip */}
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <Bitcoin className="w-4 h-4 text-amber-400 shrink-0" />
            <AnimatePresence mode="wait">
              {btcPrice ? (
                <motion.span
                  key={btcPrice}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.2 }}
                  className={clsx(
                    "font-bold tabular-nums text-sm transition-colors duration-500",
                    priceDir === "up" ? "text-green-300" : priceDir === "down" ? "text-red-400" : "text-amber-200"
                  )}
                  style={{ fontFamily: "var(--font-space-mono)" }}
                >
                  ${btcPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </motion.span>
              ) : (
                <div className="h-4 w-24 rounded skeleton" />
              )}
            </AnimatePresence>
            {priceDir && (
              <motion.span
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className={clsx("text-xs font-bold", priceDir === "up" ? "text-green-400" : "text-red-400")}
              >
                {priceDir === "up" ? "▲" : "▼"}
              </motion.span>
            )}
            <span className="text-white/20 text-[10px]" style={{ fontFamily: "var(--font-space-mono)" }}>· 15s</span>
          </div>
        </motion.div>

        {/* ─── Main Market Layout ─── */}
        {loading && markets.length === 0 ? (
          <div className="space-y-4">
            <div className="h-12 rounded-2xl skeleton w-2/3" />
            <div className="h-64 rounded-3xl skeleton" />
          </div>
        ) : !liveMarket ? (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Bitcoin className="w-9 h-9 text-white/15" />
            </div>
            <p className="text-white/40 font-semibold" style={{ fontFamily: "var(--font-syne)" }}>No active round</p>
            <p className="text-white/20 text-sm mt-1.5">The market will auto-start shortly</p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* ─── Market question row ─── */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  {isOpen ? (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg" style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.2)" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 pulse-dot" /> LIVE
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white/30" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      CLOSING
                    </span>
                  )}
                  <span className="text-white/25 text-[11px]" style={{ fontFamily: "var(--font-space-mono)" }}>Round #{markets.length}</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-snug" style={{ fontFamily: "var(--font-syne)" }}>
                  {liveMarket.question}
                </h1>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/25 text-xs">Locked price</span>
                    <span className="text-white/60 text-xs font-bold" style={{ fontFamily: "var(--font-space-mono)" }}>
                      ${liveMarket.startPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <span className="text-white/10">·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/25 text-xs">Pool</span>
                    <span className="text-white/60 text-xs font-bold" style={{ fontFamily: "var(--font-space-mono)" }}>
                      {totalPool.toFixed(4)} cBTC
                    </span>
                  </div>
                  {btcPrice && liveMarket.startPrice > 0 && (
                    <>
                      <span className="text-white/10">·</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-white/25 text-xs">Δ since open</span>
                        <span
                          className={clsx("text-xs font-bold", btcPrice >= liveMarket.startPrice ? "text-green-400" : "text-red-400")}
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {btcPrice >= liveMarket.startPrice ? "+" : ""}
                          {((btcPrice - liveMarket.startPrice) / liveMarket.startPrice * 100).toFixed(3)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Timer */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <MarketTimer closeAt={liveMarket.closeAt} onExpire={() => setTimerExpired(true)} />
                <span className="text-white/20 text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-space-mono)" }}>remaining</span>
              </div>
            </div>

            {/* ─── Chart + Bet panel side by side (Kalshi layout) ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 mb-5">

              {/* LEFT — chart */}
              <PriceChart
                openAt={liveMarket.openAt}
                closeAt={liveMarket.closeAt}
                startPrice={liveMarket.startPrice}
              />

              {/* RIGHT — Bet panel, same height as chart */}
              <div
                className="rounded-2xl overflow-hidden flex flex-col"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div className="h-px bg-gradient-to-r from-transparent via-orange-500/30 to-transparent" />
                <div className="p-5 flex flex-col flex-1">
                  <p className="text-white/40 text-[11px] uppercase tracking-widest font-semibold mb-4" style={{ fontFamily: "var(--font-space-mono)" }}>
                    Place Bet
                  </p>

                  <AnimatePresence mode="wait">
                    {step === "input" && (
                      <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 flex-1">
                        {/* Direction buttons */}
                        <div className="grid grid-cols-2 gap-2">
                          {(["UP", "DOWN"] as const).map((dir) => {
                            const isUp = dir === "UP";
                            const selected = direction === dir;
                            const pct = isUp ? upPct : downPct;
                            return (
                              <button
                                key={dir}
                                onClick={() => connected && isOpen && !myBet ? setDirection(dir) : undefined}
                                disabled={!connected || !isOpen || !!myBet}
                                className={clsx(
                                  "flex flex-col items-center justify-center gap-1 py-4 rounded-xl font-bold text-sm transition-all duration-200",
                                  !connected || !isOpen || !!myBet ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:opacity-90"
                                )}
                                style={{
                                  background: selected
                                    ? isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"
                                    : isUp ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)",
                                  border: selected
                                    ? isUp ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(239,68,68,0.5)"
                                    : isUp ? "1px solid rgba(34,197,94,0.15)" : "1px solid rgba(239,68,68,0.15)",
                                  boxShadow: selected
                                    ? isUp ? "0 0 20px rgba(34,197,94,0.12)" : "0 0 20px rgba(239,68,68,0.12)"
                                    : "none",
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  {isUp ? <TrendingUp className={clsx("w-4 h-4", selected ? "text-green-400" : "text-green-400/50")} /> : <TrendingDown className={clsx("w-4 h-4", selected ? "text-red-400" : "text-red-400/50")} />}
                                  <span className={clsx("font-bold text-sm", selected ? (isUp ? "text-green-300" : "text-red-300") : "text-white/40")} style={{ fontFamily: "var(--font-syne)" }}>{dir}</span>
                                </div>
                                <span className={clsx("text-xl font-extrabold tabular-nums", isUp ? "text-green-300" : "text-red-400")} style={{ fontFamily: "var(--font-space-mono)" }}>
                                  {pct.toFixed(0)}%
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Amount input */}
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-white/30 text-[11px] uppercase tracking-widest font-medium">Amount</span>
                            <span className="text-white/25 text-xs" style={{ fontFamily: "var(--font-space-mono)" }}>
                              {connected ? `${appBalance.toFixed(5)} cBTC` : "—"}
                            </span>
                          </div>
                          <div className="relative rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                            <input
                              type="number"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder="0.0000"
                              step="0.001"
                              min="0"
                              max={appBalance}
                              disabled={!connected || !isOpen || !!myBet}
                              className="w-full bg-transparent text-white text-xl font-bold px-4 pt-3 pb-1 placeholder-white/10 outline-none disabled:opacity-40"
                              style={{ fontFamily: "var(--font-space-mono)" }}
                            />
                            <div className="flex items-center gap-1 px-4 pb-3">
                              <Bitcoin className="w-3 h-3 text-orange-400" />
                              <span className="text-orange-400/70 text-xs font-semibold">cBTC</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5 mt-2">
                            {FRACS.map(({ label, f }) => (
                              <button
                                key={label}
                                onClick={() => setAmount((appBalance * f).toFixed(5))}
                                disabled={!connected || !isOpen || !!myBet}
                                className="py-1.5 rounded-lg text-xs font-semibold transition-all border border-white/[0.06] hover:border-white/[0.14] bg-white/[0.02] hover:bg-white/[0.06] text-white/35 hover:text-white/70 disabled:opacity-30 disabled:cursor-not-allowed"
                                style={{ fontFamily: "var(--font-space-mono)" }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Payout estimate */}
                        {isValid && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="rounded-xl p-3.5 space-y-2"
                            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <div className="flex justify-between text-sm">
                              <span className="text-white/35">Est. payout</span>
                              <span className="text-white font-semibold" style={{ fontFamily: "var(--font-space-mono)" }}>{potentialPayout.toFixed(5)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-white/35">Profit</span>
                              <span className={clsx("font-bold", profit >= 0 ? "text-green-400" : "text-red-400")} style={{ fontFamily: "var(--font-space-mono)" }}>
                                {profit >= 0 ? "+" : ""}{profit.toFixed(5)}
                              </span>
                            </div>
                            <p className="text-white/15 text-[10px]">Estimate. Final payout depends on pool at close.</p>
                          </motion.div>
                        )}

                        {/* CTA — pushed to bottom */}
                        <div className="mt-auto">
                          {!connected ? (
                            <button
                              onClick={() => setConnectOpen(true)}
                              className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all hover:opacity-90 active:scale-[0.98]"
                              style={{ background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)", fontFamily: "var(--font-syne)" }}
                            >
                              <Lock className="w-4 h-4" /> Connect to Bet
                            </button>
                          ) : myBet ? (
                            <div className="w-full py-3 rounded-xl text-center text-white/30 text-sm font-medium" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "var(--font-syne)" }}>
                              Bet placed · waiting for close
                            </div>
                          ) : !isOpen ? (
                            <div className="w-full py-3 rounded-xl text-center text-white/25 text-sm" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                              Market closed
                            </div>
                          ) : (
                            <button
                              onClick={handleBet}
                              disabled={!isValid}
                              className={clsx(
                                "w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all active:scale-[0.98]",
                                isValid ? "hover:opacity-90" : "opacity-30 cursor-not-allowed"
                              )}
                              style={{
                                background: isValid
                                  ? direction === "UP"
                                    ? "linear-gradient(135deg, #16a34a, #22c55e)"
                                    : direction === "DOWN"
                                    ? "linear-gradient(135deg, #dc2626, #ef4444)"
                                    : "rgba(255,255,255,0.06)"
                                  : "rgba(255,255,255,0.04)",
                                fontFamily: "var(--font-syne)",
                              }}
                            >
                              {direction === "UP" ? <TrendingUp className="w-4 h-4" /> : direction === "DOWN" ? <TrendingDown className="w-4 h-4" /> : null}
                              {!direction ? "Select UP or DOWN" : !isValid ? "Enter amount" : `Bet ${direction} · ${parsed.toFixed(4)} cBTC`}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}

                    {step === "submitting" && (
                      <motion.div key="submitting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center gap-4 flex-1 py-8">
                        <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
                        <p className="text-white/50 text-sm" style={{ fontFamily: "var(--font-syne)" }}>Placing bet…</p>
                      </motion.div>
                    )}

                    {step === "success" && (
                      <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center gap-4 flex-1 py-8">
                        <motion.div
                          initial={{ scale: 0, rotate: -20 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: "spring", damping: 14, stiffness: 260, delay: 0.1 }}
                          className="w-16 h-16 rounded-2xl flex items-center justify-center"
                          style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}
                        >
                          <CheckCircle2 className="w-8 h-8 text-green-400" />
                        </motion.div>
                        <div className="text-center">
                          <p className="text-white font-bold text-lg" style={{ fontFamily: "var(--font-syne)" }}>Bet Placed!</p>
                          <p className="text-white/35 text-sm mt-1">{parsed.toFixed(4)} cBTC on {direction}</p>
                        </div>
                      </motion.div>
                    )}

                    {step === "error" && (
                      <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center gap-4 flex-1 py-8">
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                          <AlertCircle className="w-8 h-8 text-red-400" />
                        </div>
                        <div className="text-center">
                          <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Bet Failed</p>
                          <p className="text-white/35 text-sm mt-1 max-w-[240px] leading-relaxed">{betError}</p>
                        </div>
                        <button onClick={resetBet} className="px-5 py-2 rounded-xl border border-white/10 hover:border-white/20 text-white/50 hover:text-white text-sm transition-all">
                          Try Again
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* My bet — shown below chart+panel if placed */}
            {myBet && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-4 flex items-center justify-between"
                style={{
                  background: myBet.direction === "UP" ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
                  border: myBet.direction === "UP" ? "1px solid rgba(34,197,94,0.15)" : "1px solid rgba(239,68,68,0.15)",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: myBet.direction === "UP" ? "#22c55e" : "#ef4444" }} />
                  <span className="text-white/50 text-sm">Your position</span>
                  <span className={clsx("font-bold text-sm", myBet.direction === "UP" ? "text-green-400" : "text-red-400")}>{myBet.direction}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Bitcoin className="w-3.5 h-3.5 text-orange-400/60" />
                  <span className="text-white/60 text-sm font-bold" style={{ fontFamily: "var(--font-space-mono)" }}>{myBet.amount.toFixed(4)}</span>
                  <span className="text-white/20 text-xs">cBTC</span>
                </div>
              </motion.div>
            )}

          </motion.div>
        )}

        {/* ─── Settled rounds history ─── */}
        {settledMarkets.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-10"
          >
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm font-semibold mb-4 transition-colors"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Past Rounds ({settledMarkets.length})
            </button>

            <AnimatePresence>
              {historyOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2">
                    {settledMarkets.map((m: Market) => {
                      const priceChange = m.closePrice != null ? m.closePrice - m.startPrice : null;
                      const pct = priceChange != null && m.startPrice > 0
                        ? (priceChange / m.startPrice * 100).toFixed(3)
                        : null;
                      const myb = myBetMap[m.id];
                      const won = myb?.status === "WON";
                      const lost = myb?.status === "LOST";
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between px-5 py-3.5 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg"
                              style={{
                                background: m.direction === "UP" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                                color: m.direction === "UP" ? "#4ade80" : "#f87171",
                                border: `1px solid ${m.direction === "UP" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                              }}
                            >
                              {m.direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {m.direction} WON
                            </div>
                            {pct && (
                              <span className={clsx("text-xs font-semibold", priceChange! >= 0 ? "text-green-400" : "text-red-400")} style={{ fontFamily: "var(--font-space-mono)" }}>
                                {priceChange! >= 0 ? "+" : ""}{pct}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            {myb && (
                              <span className={clsx(
                                "text-xs font-bold px-2 py-0.5 rounded-lg",
                                won ? "text-green-400 bg-green-500/10" : lost ? "text-red-400 bg-red-500/10" : "text-white/30 bg-white/5"
                              )}>
                                {won ? "WON" : lost ? "LOST" : myb.status} · {myb.amount.toFixed(4)}
                              </span>
                            )}
                            <span className="text-white/20 text-xs" style={{ fontFamily: "var(--font-space-mono)" }}>
                              ${m.startPrice.toLocaleString()} → ${m.closePrice?.toLocaleString() ?? "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <WalletConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}
