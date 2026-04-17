"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Bitcoin,
  Lock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Users,
  RefreshCw
} from "lucide-react";

import { fmt, fmtSigned } from "@/lib/format";
import MarketTimer from "@/components/market/MarketTimer";
import PriceChart from "@/components/market/PriceChart";
import ToastContainer, { type ToastData } from "@/components/ui/Toast";
import { useMarketStore, type Market, type Bet } from "@/store/market-store";
import { useWalletStore } from "@/store/wallet-store";
import clsx from "clsx";

const FRACS = [
  { label: "25%", f: 0.25 },
  { label: "50%", f: 0.5 },
  { label: "75%", f: 0.75 },
  { label: "MAX", f: 1 }
];

const PLATFORM_FEE = 0.05; // 5% — must match server
const LOCK_BUFFER_MS = 5 * 60 * 1000; // 5 min lock before close — must match server
const MIN_BET = 0.0001; // must match server

type BetStep = "input" | "submitting" | "success" | "error";

export default function MarketsPage() {
  const { markets, myBets, setMarkets, setMyBets, setLoading, loading } =
    useMarketStore();
  const {
    connected,
    partyId,
    appBalance,
    setAppBalance,
    sessionToken,
    requestConnect
  } = useWalletStore();
  const connectLoop = requestConnect;
  const connectingLoop = false;
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);
  const priceDirTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bet panel state
  const [direction, setDirection] = useState<"UP" | "DOWN" | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<BetStep>("input");
  const [betError, setBetError] = useState<string | null>(null);
  const [timerExpired, setTimerExpired] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("historyOpen") === "1";
    }
    return false;
  });
  const [totalRoundCount, setTotalRoundCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const prevMyBetsRef = useRef<Bet[]>([]);
  const [poolFreshAt, setPoolFreshAt] = useState<number>(Date.now());
  const [historyPage, setHistoryPage] = useState(10); // how many settled markets to show
  const HISTORY_PAGE_SIZE = 10;

  const addToast = useCallback((toast: Omit<ToastData, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const [marketBets, setMarketBets] = useState<
    Array<{
      id: string;
      direction: string;
      amount: number;
      status: string;
      placedAt: string;
      maskedId: string;
    }>
  >([]);

  const liveMarket = markets.find((m: Market) => m.status === "OPEN") ?? null;
  const settledMarkets = markets.filter((m: Market) => m.status === "SETTLED");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const data = await res.json();
      const marketList = Array.isArray(data) ? data : (data.markets ?? []);
      setMarkets(marketList);
      if (typeof data.totalCount === "number")
        setTotalRoundCount(data.totalCount);

      // Fetch bets for the open market
      const open = marketList.find((m: Market) => m.status === "OPEN") ?? null;
      if (open) {
        const betsRes = await fetch(`/api/markets/${open.id}/bets`, {
          cache: "no-store"
        });
        if (betsRes.ok) {
          const betsData = await betsRes.json();
          // Response is { bets: [...], nextCursor }
          setMarketBets(
            Array.isArray(betsData) ? betsData : (betsData.bets ?? [])
          );
        }
      } else {
        setMarketBets([]); // clear when no live market
      }

      // Re-fetch user bets + balance after every market poll
      const { connected, sessionToken } = useWalletStore.getState();
      if (connected && sessionToken) {
        const authHeader = { Authorization: `Bearer ${sessionToken}` };
        const [userRes, betsRes] = await Promise.all([
          fetch("/api/users", { headers: authHeader, cache: "no-store" }),
          fetch("/api/bets", { headers: authHeader, cache: "no-store" })
        ]);
        if (userRes.ok) {
          const userData = await userRes.json();
          if (typeof userData.appBalance === "number") {
            useWalletStore.getState().setAppBalance(userData.appBalance);
          }
        }
        if (betsRes.ok) {
          const betsData = await betsRes.json();
          if (Array.isArray(betsData)) setMyBets(betsData);
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [setLoading, setMarkets, setMyBets]);

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
    } catch {
      /* silent */
    }
  }, []);

  const fetchBets = useCallback(async () => {
    const { sessionToken } = useWalletStore.getState();
    if (!sessionToken) return;
    try {
      const res = await fetch("/api/bets", {
        headers: { Authorization: `Bearer ${sessionToken}` },
        cache: "no-store"
      });
      const data = await res.json();
      setMyBets(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    }
  }, [setMyBets]);

  useEffect(() => {
    fetchMarkets();
    fetchPrice();
    // Only fetch user bets if already connected — avoids 401 spam on mount
    if (useWalletStore.getState().sessionToken) fetchBets();
    const marketsId = setInterval(fetchMarkets, 30_000);
    const priceId = setInterval(fetchPrice, 1_000);
    const betsId = setInterval(fetchBets, 30_000);
    return () => {
      clearInterval(marketsId);
      clearInterval(priceId);
      clearInterval(betsId);
    };
  }, [fetchMarkets, fetchPrice, fetchBets]);

  // Called by MarketTimer when the countdown hits zero
  const onTimerExpire = useCallback(() => {
    setTimerExpired(true);
    // Immediately trigger settle + new round — don't wait for 30s poll
    setTimeout(fetchMarkets, 2000); // 2s grace for backend to process
    setTimeout(fetchMarkets, 7000); // retry in case the first one raced
  }, [fetchMarkets]);

  // Reset bet form when market changes
  useEffect(() => {
    setDirection(null);
    setAmount("");
    setStep("input");
    setBetError(null);
    setTimerExpired(false);
  }, [liveMarket?.id]);

  // Track when pool data was last refreshed (markets poll every 30s)
  useEffect(() => {
    if (liveMarket) setPoolFreshAt(Date.now());
  }, [liveMarket?.totalUp, liveMarket?.totalDown]);

  // Detect win/loss/refund when a previously PENDING bet gets settled
  useEffect(() => {
    const prev = prevMyBetsRef.current;
    myBets.forEach((bet: Bet) => {
      const was = prev.find((b) => b.id === bet.id);
      if (was?.status === "PENDING" && bet.status !== "PENDING") {
        if (bet.status === "WON") {
          addToast({
            type: "win",
            title: "You won! 🎉",
            message: `+${fmt((bet.payout ?? 0) - bet.amount)} CBTC profit`
          });
        } else if (bet.status === "LOST") {
          addToast({
            type: "loss",
            title: "Round lost",
            message: `−${fmt(bet.amount)} CBTC`
          });
        } else if (bet.status === "REFUNDED") {
          addToast({
            type: "refund",
            title: "Bet refunded",
            message: `${fmt(bet.amount)} CBTC returned to your balance`
          });
        }
      }
    });
    prevMyBetsRef.current = myBets;
  }, [myBets, addToast]);

  // Tick every second so bettingLocked flips in real-time
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const myBetMap = myBets.reduce<Record<string, Bet>>((acc, b: Bet) => {
    acc[b.marketId] = b;
    return acc;
  }, {});

  // Bet logic
  const parsed = parseFloat(amount);
  const totalPool = liveMarket ? liveMarket.totalUp + liveMarket.totalDown : 0;
  const upPct = totalPool > 0 ? (liveMarket!.totalUp / totalPool) * 100 : 50;
  const downPct = 100 - upPct;

  // Betting locks 5 min before close (server enforces this too)
  const bettingLocked = liveMarket
    ? now >= new Date(liveMarket.closeAt).getTime() - LOCK_BUFFER_MS
    : false;

  const isBelowMin = parsed > 0 && parsed < MIN_BET;
  const isValid =
    direction !== null &&
    parsed >= MIN_BET &&
    parsed <= appBalance &&
    liveMarket !== null &&
    !bettingLocked;
  const potentialPool = totalPool + (isValid ? parsed : 0);
  const winningPool =
    direction === "UP"
      ? (liveMarket?.totalUp ?? 0) +
        (isValid && direction === "UP" ? parsed : 0)
      : (liveMarket?.totalDown ?? 0) +
        (isValid && direction === "DOWN" ? parsed : 0);
  const opposingPool =
    direction === "UP"
      ? (liveMarket?.totalDown ?? 0)
      : (liveMarket?.totalUp ?? 0);
  // No counterparty = everyone on one side, bet will be refunded at close
  const noCounterparty = isValid && opposingPool === 0;
  // Payout estimate includes 5% platform fee (deducted from pool before distribution)
  const adjustedPool = potentialPool * (1 - PLATFORM_FEE);
  const potentialPayout =
    winningPool > 0 && isValid && !noCounterparty
      ? (parsed / winningPool) * adjustedPool
      : 0;
  const profit = potentialPayout - (isValid && !noCounterparty ? parsed : 0);

  // Warn if odds data is >3min old while user has a valid bet ready
  const poolIsStale = isValid && (now - poolFreshAt) > 3 * 60 * 1000;

  const myBet = liveMarket ? myBetMap[liveMarket.id] : null;
  const isOpen = liveMarket?.status === "OPEN" && !timerExpired;

  const handleBet = async () => {
    if (!isValid || !sessionToken || !liveMarket || submitting) return;
    setSubmitting(true);
    setStep("submitting");
    setBetError(null);
    try {
      const res = await fetch(`/api/markets/${liveMarket.id}/bet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ direction, amount: parsed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bet failed");
      setAppBalance(data.appBalance);
      setStep("success");
      fetchBets();
      if (liveMarket) {
        fetch(`/api/markets/${liveMarket.id}/bets`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) setMarketBets(Array.isArray(d) ? d : (d.bets ?? []));
          })
          .catch(() => {});
      }
    } catch (err) {
      setBetError(err instanceof Error ? err.message : "Failed to place bet");
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  };

  const resetBet = () => {
    setDirection(null);
    setAmount("");
    setStep("input");
    setBetError(null);
  };

  return (
    <div className="min-h-screen">
      {/* BG orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-80 -left-40 w-[700px] h-[700px] rounded-full opacity-[0.04]"
          style={{
            background: "radial-gradient(circle, #28cc95 0%, transparent 70%)"
          }}
        />
        <div
          className="absolute -bottom-60 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.03]"
          style={{
            background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)"
          }}
        />
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
            <div className="w-1.5 h-1.5 rounded-full bg-[#28cc95] pulse-dot" />
            <span
              className="text-[#28cc95]/70 text-xs font-semibold uppercase tracking-widest"
              style={{ fontFamily: "var(--font-space-mono)" }}
            >
              Canton Network · BTC/USD · 15-min rounds
            </span>
          </div>

          {/* Live price chip */}
          <div
            className="flex items-center gap-2.5 px-4 py-2 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)"
            }}
          >
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
                    priceDir === "up"
                      ? "text-green-300"
                      : priceDir === "down"
                        ? "text-red-400"
                        : "text-amber-200"
                  )}
                  style={{ fontFamily: "var(--font-space-mono)" }}
                >
                  $
                  {btcPrice.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
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
                className={clsx(
                  "text-xs font-bold",
                  priceDir === "up" ? "text-green-400" : "text-red-400"
                )}
              >
                {priceDir === "up" ? "▲" : "▼"}
              </motion.span>
            )}
            <span
              className="text-white/20 text-[10px]"
              style={{ fontFamily: "var(--font-space-mono)" }}
            >
              · 1s
            </span>
          </div>
        </motion.div>

        {/* ─── Onboarding banner: connected but no balance ─── */}
        {connected && appBalance === 0 && !loading && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl mb-6"
            style={{
              background: "rgba(40,204,149,0.07)",
              border: "1px solid rgba(40,204,149,0.18)"
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(40,204,149,0.15)" }}
              >
                <Bitcoin className="w-4 h-4 text-[#28cc95]" />
              </div>
              <div className="min-w-0">
                <p
                  className="text-white/80 text-sm font-semibold"
                  style={{ fontFamily: "var(--font-syne)" }}
                >
                  Deposit CBTC to start betting
                </p>
                <p className="text-white/30 text-xs truncate">
                  Send CBTC to your app wallet · min bet is {MIN_BET} CBTC
                </p>
              </div>
            </div>
            <a
              href="/portfolio"
              className="shrink-0 px-4 py-2 rounded-xl font-bold text-xs text-black transition-all hover:opacity-90"
              style={{
                background: "linear-gradient(135deg, #28cc95, #1fa876)",
                fontFamily: "var(--font-syne)"
              }}
            >
              Deposit
            </a>
          </motion.div>
        )}

        {/* ─── Main Market Layout ─── */}
        {loading && markets.length === 0 ? (
          <div className="space-y-4">
            <div className="h-12 rounded-2xl skeleton w-2/3" />
            <div className="h-64 rounded-3xl skeleton" />
          </div>
        ) : !liveMarket ? (
          <div className="flex flex-col items-center justify-center py-40 text-center">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
              style={{
                background: "rgba(251,191,36,0.06)",
                border: "1px solid rgba(251,191,36,0.12)"
              }}
            >
              <RefreshCw
                className="w-9 h-9 text-amber-400/50 animate-spin"
                style={{ animationDuration: "2s" }}
              />
            </div>
            <p
              className="text-white/50 font-semibold"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              Settling round…
            </p>
            <p className="text-white/20 text-sm mt-1.5">
              Calculating results · next round starts in a few seconds
            </p>
            <div
              className="mt-6 max-w-xs text-left rounded-2xl px-4 py-3 space-y-1.5"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              <p className="text-white/20 text-[11px] uppercase tracking-widest font-semibold mb-2">
                How it works
              </p>
              {[
                "Settlement uses Binance BTC/USDT spot price at round close",
                "Winners share the pool minus 5% platform fee",
                "Price unchanged? Round is a DRAW — all bets fully refunded"
              ].map((line) => (
                <p
                  key={line}
                  className="text-white/25 text-xs flex items-start gap-2"
                >
                  <span className="text-[#28cc95]/40 mt-0.5">·</span>
                  {line}
                </p>
              ))}
            </div>
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
                    <span
                      className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                      style={{
                        background: "rgba(40,204,149,0.12)",
                        color: "#5dd9ab",
                        border: "1px solid rgba(40,204,149,0.2)"
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#28cc95] pulse-dot" />{" "}
                      LIVE
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                      style={{
                        background: "rgba(251,191,36,0.08)",
                        color: "#fbbf24",
                        border: "1px solid rgba(251,191,36,0.2)"
                      }}
                    >
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />{" "}
                      SETTLING
                    </span>
                  )}
                  <span
                    className="text-white/25 text-[11px]"
                    style={{ fontFamily: "var(--font-space-mono)" }}
                  >
                    Round #{totalRoundCount}
                  </span>
                </div>
                <h1
                  className="text-2xl sm:text-3xl font-extrabold text-white leading-snug"
                  style={{ fontFamily: "var(--font-syne)" }}
                >
                  {liveMarket.question}
                </h1>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/25 text-xs">Locked price</span>
                    <span
                      className="text-amber-300 font-bold text-xs"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      $
                      {liveMarket.startPrice.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </span>
                  </div>
                  <span className="text-white/10">·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/25 text-xs">Pool</span>
                    <span
                      className="text-white/60 text-xs font-bold"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      {fmt(totalPool)} CBTC
                    </span>
                  </div>
                  <span className="text-white/10">·</span>
                  <span className="text-white/25 text-xs">
                    Fee{" "}
                    <span
                      className="text-white/40 font-semibold"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      5%
                    </span>
                  </span>
                  <span className="text-white/10">·</span>
                  <span className="text-white/25 text-xs">
                    Min Bet &nbsp;
                    <span
                      className="text-white/40 font-semibold"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      {MIN_BET} CBTC
                    </span>
                  </span>
                </div>
              </div>

              {/* Timer */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <MarketTimer
                  closeAt={liveMarket.closeAt}
                  onExpire={onTimerExpire}
                />
                {/* <span className="text-white/20 text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-space-mono)" }}>remaining</span> */}
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
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.07)"
                }}
              >
                <div className="h-px bg-gradient-to-r from-transparent via-[#28cc95]/30 to-transparent" />
                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <p
                      className="text-white/40 text-[11px] uppercase tracking-widest font-semibold"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      {!isOpen ? "Round Result" : "Place Bet"}
                    </p>
                    {bettingLocked && isOpen && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg"
                        style={{
                          background: "rgba(251,191,36,0.1)",
                          color: "#fbbf24",
                          border: "1px solid rgba(251,191,36,0.2)"
                        }}
                      >
                        <Lock className="w-2.5 h-2.5" /> LOCKED
                      </span>
                    )}
                    {!isOpen && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg"
                        style={{
                          background: "rgba(251,191,36,0.08)",
                          color: "#fbbf24",
                          border: "1px solid rgba(251,191,36,0.15)"
                        }}
                      >
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />{" "}
                        SETTLING
                      </span>
                    )}
                  </div>

                  <AnimatePresence mode="wait">
                    {step === "input" && (
                      <motion.div
                        key="input"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col gap-4 flex-1"
                      >
                        {/* Direction buttons */}
                        <div className="grid grid-cols-2 gap-2">
                          {(["UP", "DOWN"] as const).map((dir) => {
                            const isUp = dir === "UP";
                            const selected = direction === dir;
                            const pct = isUp ? upPct : downPct;
                            return (
                              <button
                                key={dir}
                                onClick={() =>
                                  connected &&
                                  isOpen &&
                                  !myBet &&
                                  !bettingLocked
                                    ? setDirection(dir)
                                    : undefined
                                }
                                disabled={
                                  !connected ||
                                  !isOpen ||
                                  !!myBet ||
                                  bettingLocked
                                }
                                className={clsx(
                                  "flex flex-col items-center justify-center gap-1 py-4 rounded-xl font-bold text-sm transition-all duration-200",
                                  !connected || !isOpen || !!myBet
                                    ? "opacity-40 cursor-not-allowed"
                                    : "cursor-pointer hover:opacity-90"
                                )}
                                style={{
                                  background: selected
                                    ? isUp
                                      ? "rgba(34,197,94,0.15)"
                                      : "rgba(239,68,68,0.15)"
                                    : isUp
                                      ? "rgba(34,197,94,0.04)"
                                      : "rgba(239,68,68,0.04)",
                                  border: selected
                                    ? isUp
                                      ? "1px solid rgba(34,197,94,0.5)"
                                      : "1px solid rgba(239,68,68,0.5)"
                                    : isUp
                                      ? "1px solid rgba(34,197,94,0.15)"
                                      : "1px solid rgba(239,68,68,0.15)",
                                  boxShadow: selected
                                    ? isUp
                                      ? "0 0 20px rgba(34,197,94,0.12)"
                                      : "0 0 20px rgba(239,68,68,0.12)"
                                    : "none"
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  {isUp ? (
                                    <TrendingUp
                                      className={clsx(
                                        "w-4 h-4",
                                        selected
                                          ? "text-green-400"
                                          : "text-green-400/50"
                                      )}
                                    />
                                  ) : (
                                    <TrendingDown
                                      className={clsx(
                                        "w-4 h-4",
                                        selected
                                          ? "text-red-400"
                                          : "text-red-400/50"
                                      )}
                                    />
                                  )}
                                  <span
                                    className={clsx(
                                      "font-bold text-sm",
                                      selected
                                        ? isUp
                                          ? "text-green-300"
                                          : "text-red-300"
                                        : "text-white/40"
                                    )}
                                    style={{ fontFamily: "var(--font-syne)" }}
                                  >
                                    {dir}
                                  </span>
                                </div>
                                <span
                                  className={clsx(
                                    "text-xl font-extrabold tabular-nums",
                                    isUp ? "text-green-300" : "text-red-400"
                                  )}
                                  style={{
                                    fontFamily: "var(--font-space-mono)"
                                  }}
                                >
                                  {pct.toFixed(0)}%
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Amount input */}
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-white/30 text-[11px] uppercase tracking-widest font-medium">
                              Amount
                            </span>
                            {/*  <span
                              className="text-white/25 text-xs"
                              style={{ fontFamily: "var(--font-space-mono)" }}
                            >
                              {connected
                                ? `${fmt(appBalance)} CBTC`
                                : "—"}
                            </span> */}
                          </div>
                          <div
                            className="relative rounded-xl overflow-hidden"
                            style={{
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)"
                            }}
                          >
                            <input
                              type="number"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder="0.0000"
                              step="0.001"
                              min="0"
                              max={appBalance}
                              disabled={
                                !connected ||
                                !isOpen ||
                                !!myBet ||
                                bettingLocked
                              }
                              className="w-full bg-transparent text-white text-xl font-bold px-4 pt-3 pb-1 placeholder-white/10 outline-none disabled:opacity-40"
                              style={{ fontFamily: "var(--font-space-mono)" }}
                            />
                            <div className="flex items-center gap-1 px-4 pb-3">
                              <Bitcoin className="w-3 h-3 text-[#28cc95]" />
                              <span className="text-[#28cc95]/70 text-xs font-semibold">
                                CBTC
                              </span>
                            </div>
                          </div>
                          {/* Min bet warning — only shown when user types below min */}
                          {isBelowMin && (
                            <div className="mt-1.5 px-0.5">
                              <span
                                className="text-red-400/80 text-[11px]"
                                style={{ fontFamily: "var(--font-space-mono)" }}
                              >
                                Min bet is {MIN_BET} CBTC
                              </span>
                            </div>
                          )}

                          <div className="grid grid-cols-4 gap-1.5 mt-2">
                            {FRACS.map(({ label, f }) => (
                              <button
                                key={label}
                                onClick={() => setAmount(fmt(appBalance * f))}
                                disabled={
                                  !connected ||
                                  !isOpen ||
                                  !!myBet ||
                                  bettingLocked
                                }
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
                            style={{
                              background: "rgba(255,255,255,0.02)",
                              border: poolIsStale ? "1px solid rgba(251,191,36,0.25)" : "1px solid rgba(255,255,255,0.05)"
                            }}
                          >
                            <div className="flex justify-between text-sm">
                              <span className="text-white/35">Est. payout</span>
                              <span
                                className="text-white font-semibold"
                                style={{ fontFamily: "var(--font-space-mono)" }}
                              >
                                {noCounterparty
                                  ? fmt(parsed)
                                  : fmt(potentialPayout)}
                              </span>
                            </div>
                            {!noCounterparty && (
                              <div className="flex justify-between text-sm">
                                <span className="text-white/35">
                                  If correct
                                </span>
                                <span
                                  className={clsx(
                                    "font-bold",
                                    profit >= 0
                                      ? "text-green-400"
                                      : "text-red-400"
                                  )}
                                  style={{
                                    fontFamily: "var(--font-space-mono)"
                                  }}
                                >
                                  {fmtSigned(profit)}
                                </span>
                              </div>
                            )}
                            {poolIsStale && (
                              <p className="text-amber-400/70 text-[10px] flex items-center gap-1">
                                <span>⚠</span> Odds may have shifted — pool data is over 3 min old
                              </p>
                            )}
                          </motion.div>
                        )}

                        {/* CTA — pushed to bottom */}
                        <div className="mt-auto">
                          {!connected ? (
                            <button
                              onClick={connectLoop}
                              disabled={connectingLoop}
                              className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                              style={{
                                background:
                                  "linear-gradient(135deg, #28cc95 0%, #1fa876 100%)",
                                fontFamily: "var(--font-syne)"
                              }}
                            >
                              {connectingLoop ? (
                                <Loader2 className="w-4 h-4 animate-spin text-black" />
                              ) : (
                                <Lock className="w-4 h-4 text-black" />
                              )}
                              {connectingLoop
                                ? "Connecting…"
                                : "Connect to Bet"}
                            </button>
                          ) : myBet ? (
                            <div
                              className="w-full py-3 rounded-xl text-center text-white/30 text-sm font-medium"
                              style={{
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.06)",
                                fontFamily: "var(--font-syne)"
                              }}
                            >
                              Bet placed · waiting for close
                            </div>
                          ) : bettingLocked && isOpen ? (
                            <div
                              className="w-full py-3 rounded-xl text-center text-sm font-medium flex items-center justify-center gap-2"
                              style={{
                                background: "rgba(251,191,36,0.06)",
                                border: "1px solid rgba(251,191,36,0.15)",
                                color: "rgba(251,191,36,0.7)",
                                fontFamily: "var(--font-syne)"
                              }}
                            >
                              <Lock className="w-3.5 h-3.5" /> Betting locked ·
                              waiting for close
                            </div>
                          ) : !isOpen ? (
                            <div
                              className="w-full py-4 rounded-xl flex flex-col items-center justify-center gap-2.5"
                              style={{
                                background: "rgba(251,191,36,0.04)",
                                border: "1px solid rgba(251,191,36,0.12)"
                              }}
                            >
                              <RefreshCw className="w-5 h-5 text-amber-400/60 animate-spin" />
                              <p
                                className="text-amber-400/70 text-sm font-semibold"
                                style={{ fontFamily: "var(--font-syne)" }}
                              >
                                Settling round…
                              </p>
                              <p className="text-white/20 text-xs">
                                Next round starts shortly
                              </p>
                            </div>
                          ) : (
                            <button
                              onClick={handleBet}
                              disabled={!isValid || submitting}
                              className={clsx(
                                "w-full py-3.5 rounded-xl font-bold text-sm flex flex-col items-center justify-center gap-0.5 text-white transition-all active:scale-[0.98]",
                                isValid && !submitting
                                  ? "hover:opacity-90"
                                  : "opacity-30 cursor-not-allowed"
                              )}
                              style={{
                                background: isValid
                                  ? direction === "UP"
                                    ? "linear-gradient(135deg, #16a34a, #22c55e)"
                                    : direction === "DOWN"
                                      ? "linear-gradient(135deg, #dc2626, #ef4444)"
                                      : "rgba(255,255,255,0.06)"
                                  : "rgba(255,255,255,0.04)",
                                fontFamily: "var(--font-syne)"
                              }}
                            >
                              <span className="flex items-center gap-2">
                                {direction === "UP" ? (
                                  <TrendingUp className="w-4 h-4" />
                                ) : direction === "DOWN" ? (
                                  <TrendingDown className="w-4 h-4" />
                                ) : null}
                                {!direction
                                  ? "Select UP or DOWN"
                                  : !isValid
                                    ? "Enter amount"
                                    : `Bet ${direction} · ${fmt(parsed)} CBTC`}
                              </span>
                              {/*  {isValid && (
                                <span className="text-white/50 text-[10px] font-normal">
                                  {noCounterparty
                                    ? `est. payout: ${fmt(parsed)} CBTC`
                                    : `5% fee · gain if correct: ${fmtSigned(profit)}`}
                                </span>
                              )} */}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}

                    {step === "submitting" && (
                      <motion.div
                        key="submitting"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center gap-4 flex-1 py-8"
                      >
                        <Loader2 className="w-8 h-8 text-[#28cc95] animate-spin" />
                        <p
                          className="text-white/50 text-sm"
                          style={{ fontFamily: "var(--font-syne)" }}
                        >
                          Placing bet…
                        </p>
                      </motion.div>
                    )}

                    {step === "success" && (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center gap-4 flex-1 py-8"
                      >
                        <motion.div
                          initial={{ scale: 0, rotate: -20 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{
                            type: "spring",
                            damping: 14,
                            stiffness: 260,
                            delay: 0.1
                          }}
                          className="w-16 h-16 rounded-2xl flex items-center justify-center"
                          style={{
                            background: "rgba(34,197,94,0.1)",
                            border: "1px solid rgba(34,197,94,0.2)"
                          }}
                        >
                          <CheckCircle2 className="w-8 h-8 text-green-400" />
                        </motion.div>
                        <div className="text-center">
                          <p
                            className="text-white font-bold text-lg"
                            style={{ fontFamily: "var(--font-syne)" }}
                          >
                            Bet Placed!
                          </p>
                          <p className="text-white/35 text-sm mt-1">
                            {fmt(parsed)} CBTC on {direction}
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {step === "error" && (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center gap-4 flex-1 py-8"
                      >
                        <div
                          className="w-16 h-16 rounded-2xl flex items-center justify-center"
                          style={{
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.2)"
                          }}
                        >
                          <AlertCircle className="w-8 h-8 text-red-400" />
                        </div>
                        <div className="text-center">
                          <p
                            className="text-white font-semibold"
                            style={{ fontFamily: "var(--font-syne)" }}
                          >
                            Bet Failed
                          </p>
                          <p className="text-white/35 text-sm mt-1 max-w-[240px] leading-relaxed">
                            {betError}
                          </p>
                        </div>
                        <button
                          onClick={resetBet}
                          className="px-5 py-2 rounded-xl border border-white/10 hover:border-white/20 text-white/50 hover:text-white text-sm transition-all"
                        >
                          Try Again
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* My bet — shown below chart+panel if placed */}
            {myBet &&
              (() => {
                const myPool =
                  myBet.direction === "UP"
                    ? liveMarket.totalUp
                    : liveMarket.totalDown;
                const opposingMyPool =
                  myBet.direction === "UP"
                    ? liveMarket.totalDown
                    : liveMarket.totalUp;
                const myBetNoCounterparty = opposingMyPool === 0;
                const adjustedTotalPool = totalPool * (1 - PLATFORM_FEE);
                const estPayout =
                  myPool > 0 && !myBetNoCounterparty
                    ? (myBet.amount / myPool) * adjustedTotalPool
                    : myBet.amount;
                const estProfit = myBetNoCounterparty
                  ? 0
                  : estPayout - myBet.amount;
                const isUp = myBet.direction === "UP";
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl p-4"
                    style={{
                      background: isUp
                        ? "rgba(34,197,94,0.05)"
                        : "rgba(239,68,68,0.05)",
                      border: isUp
                        ? "1px solid rgba(34,197,94,0.15)"
                        : "1px solid rgba(239,68,68,0.15)"
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ background: isUp ? "#22c55e" : "#ef4444" }}
                        />
                        <span className="text-white/50 text-sm">
                          Your position
                        </span>
                        <span
                          className={clsx(
                            "font-bold text-sm",
                            isUp ? "text-green-400" : "text-red-400"
                          )}
                        >
                          {myBet.direction}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Bitcoin className="w-3.5 h-3.5 text-[#28cc95]/60" />
                        <span
                          className="text-white/60 text-sm font-bold"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {fmt(myBet.amount)}
                        </span>
                        <span className="text-white/20 text-xs">CBTC</span>
                      </div>
                    </div>
                    {/* Live payout estimate */}
                    <div className="mt-3 pt-3 border-t border-white/[0.05] grid grid-cols-2 gap-3">
                      <div>
                        <p
                          className="text-white/20 text-[10px] uppercase tracking-wider mb-0.5"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          Est. Payout
                        </p>
                        <p
                          className="text-white/70 text-sm font-bold"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {fmt(estPayout)}{" "}
                          <span className="text-white/20 font-normal text-xs">
                            CBTC
                          </span>
                        </p>
                      </div>
                      {!myBetNoCounterparty && (
                        <div>
                          <p
                            className="text-white/20 text-[10px] uppercase tracking-wider mb-0.5"
                            style={{ fontFamily: "var(--font-space-mono)" }}
                          >
                            Est. Gain
                          </p>
                          <p
                            className={clsx(
                              "text-sm font-bold",
                              estProfit >= 0 ? "text-green-400" : "text-red-400"
                            )}
                            style={{ fontFamily: "var(--font-space-mono)" }}
                          >
                            {fmtSigned(estProfit)}
                          </p>
                        </div>
                      )}
                    </div>
                    {/*  <p className="text-white/10 text-[10px] mt-2">
                      Live estimate after 5% fee · updates as more bets come in
                    </p> */}
                  </motion.div>
                );
              })()}

            {/* ─── Round Stats + Bettor List ─── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-5 rounded-2xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.07)"
              }}
            >
              <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-white/30" />
                    <span
                      className="text-white/40 text-[11px] uppercase tracking-widest font-semibold"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      Round Activity
                    </span>
                  </div>
                  <span
                    className="text-white/20 text-xs"
                    style={{ fontFamily: "var(--font-space-mono)" }}
                  >
                    {marketBets.length} bet{marketBets.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Pool distribution bar */}
                {totalPool > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="text-green-400 text-xs font-bold"
                        style={{ fontFamily: "var(--font-space-mono)" }}
                      >
                        ↑ {upPct.toFixed(0)}% UP
                      </span>
                      <span
                        className="text-red-400 text-xs font-bold"
                        style={{ fontFamily: "var(--font-space-mono)" }}
                      >
                        DOWN {downPct.toFixed(0)}% ↓
                      </span>
                    </div>
                    <div className="flex h-2 rounded-full overflow-hidden mb-4">
                      <div
                        className="bg-green-500/50 transition-all duration-700"
                        style={{ width: `${upPct}%` }}
                      />
                      <div
                        className="bg-red-500/50 transition-all duration-700"
                        style={{ width: `${downPct}%` }}
                      />
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div
                        className="rounded-xl p-3 text-center"
                        style={{
                          background: "rgba(34,197,94,0.05)",
                          border: "1px solid rgba(34,197,94,0.12)"
                        }}
                      >
                        <p
                          className="text-green-400/60 text-[10px] uppercase tracking-wider mb-1"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          UP Pool
                        </p>
                        <p
                          className="text-green-400 text-sm font-bold"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {fmt(liveMarket.totalUp)}
                        </p>
                        <p className="text-green-400/40 text-[10px]">CBTC</p>
                      </div>
                      <div
                        className="rounded-xl p-3 text-center"
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.07)"
                        }}
                      >
                        <p
                          className="text-white/30 text-[10px] uppercase tracking-wider mb-1"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          Total Pool
                        </p>
                        <p
                          className="text-white/70 text-sm font-bold"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {fmt(totalPool)}
                        </p>
                        <p className="text-white/20 text-[10px]">CBTC</p>
                      </div>
                      <div
                        className="rounded-xl p-3 text-center"
                        style={{
                          background: "rgba(239,68,68,0.05)",
                          border: "1px solid rgba(239,68,68,0.12)"
                        }}
                      >
                        <p
                          className="text-red-400/60 text-[10px] uppercase tracking-wider mb-1"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          DOWN Pool
                        </p>
                        <p
                          className="text-red-400 text-sm font-bold"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {fmt(liveMarket.totalDown)}
                        </p>
                        <p className="text-red-400/40 text-[10px]">CBTC</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mb-4 py-3 text-center">
                    <p className="text-white/15 text-sm">
                      No bets placed yet. Be the first!
                    </p>
                  </div>
                )}

                {/* Bettor list */}
                {marketBets.length > 0 && (
                  <div className="space-y-1.5">
                    <p
                      className="text-white/20 text-[10px] uppercase tracking-wider font-semibold mb-2.5"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      All Bettors
                    </p>
                    {marketBets.map((bet) => {
                      const isUp = bet.direction === "UP";
                      return (
                        <div
                          key={bet.id}
                          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
                          style={{
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.04)"
                          }}
                        >
                          {/* Masked address */}
                          <span
                            className="text-white/30 text-xs font-mono"
                            style={{ fontFamily: "var(--font-space-mono)" }}
                          >
                            {bet.maskedId}
                          </span>
                          <div className="flex items-center gap-3">
                            {/* Amount */}
                            <span className="text-white/40 text-xs font-semibold" style={{ fontFamily: "var(--font-space-mono)" }}>
                              {fmt(bet.amount)} CBTC
                            </span>
                            {/* Direction badge */}
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1"
                              style={{
                                background: isUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                                color: isUp ? "#4ade80" : "#f87171",
                                border: `1px solid ${isUp ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`
                              }}
                            >
                              {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                              {bet.direction}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
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
              onClick={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                sessionStorage.setItem("historyOpen", next ? "1" : "0");
              }}
              className="flex items-center gap-2 text-white/30 hover:text-white/60 text-sm font-semibold mb-4 transition-colors"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {historyOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              Past Rounds (
              {totalRoundCount > 0
                ? totalRoundCount - 1
                : settledMarkets.length}
              )
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
                    {settledMarkets.slice(0, historyPage).map((m: Market) => {
                      const priceChange =
                        m.closePrice != null
                          ? m.closePrice - m.startPrice
                          : null;
                      const pct =
                        priceChange != null && m.startPrice > 0
                          ? ((priceChange / m.startPrice) * 100).toFixed(3)
                          : null;
                      const myb = myBetMap[m.id];
                      const won = myb?.status === "WON";
                      const lost = myb?.status === "LOST";
                      const refunded = myb?.status === "REFUNDED";
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between px-5 py-3.5 rounded-xl"
                          style={{
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.05)"
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-lg"
                              style={{
                                background:
                                  m.direction === "UP"
                                    ? "rgba(34,197,94,0.1)"
                                    : m.direction === "DRAW"
                                      ? "rgba(255,255,255,0.06)"
                                      : "rgba(239,68,68,0.1)",
                                color:
                                  m.direction === "UP"
                                    ? "#4ade80"
                                    : m.direction === "DRAW"
                                      ? "rgba(255,255,255,0.5)"
                                      : "#f87171",
                                border: `1px solid ${m.direction === "UP" ? "rgba(34,197,94,0.2)" : m.direction === "DRAW" ? "rgba(255,255,255,0.1)" : "rgba(239,68,68,0.2)"}`
                              }}
                            >
                              {m.direction === "UP" ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : m.direction === "DOWN" ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : null}
                              {m.direction === "DRAW"
                                ? "DRAW — Refunded"
                                : `${m.direction} WON`}
                            </div>
                            {pct && (
                              <span
                                className={clsx(
                                  "text-xs font-semibold",
                                  priceChange! >= 0
                                    ? "text-green-400"
                                    : "text-red-400"
                                )}
                                style={{ fontFamily: "var(--font-space-mono)" }}
                              >
                                {priceChange! >= 0 ? "+" : ""}
                                {pct}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            {myb && (
                              <span
                                className={clsx(
                                  "text-xs font-bold px-2 py-0.5 rounded-lg",
                                  won
                                    ? "text-green-400 bg-green-500/10"
                                    : lost
                                      ? "text-red-400 bg-red-500/10"
                                      : refunded
                                        ? "text-amber-400 bg-amber-500/10"
                                        : "text-white/20 bg-white/5"
                                )}
                              >
                                {won
                                  ? `WON +${fmt(myb.payout ?? 0)}`
                                  : lost
                                    ? `LOST ${fmt(myb.amount)}`
                                    : refunded
                                      ? `REFUNDED ${fmt(myb.amount)}`
                                      : `${fmt(myb.amount)} CBTC`}
                              </span>
                            )}
                            <span
                              className="text-white/20 text-xs"
                              style={{ fontFamily: "var(--font-space-mono)" }}
                            >
                              ${m.startPrice.toLocaleString()} → $
                              {m.closePrice?.toLocaleString() ?? "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {settledMarkets.length > historyPage && (
                      <button
                        onClick={() => setHistoryPage((p) => p + HISTORY_PAGE_SIZE)}
                        className="w-full py-2.5 rounded-xl text-white/30 hover:text-white/60 text-sm font-semibold transition-colors text-center"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", fontFamily: "var(--font-syne)" }}
                      >
                        Show {Math.min(HISTORY_PAGE_SIZE, settledMarkets.length - historyPage)} more rounds
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Win/loss toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
