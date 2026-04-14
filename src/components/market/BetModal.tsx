"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown, Bitcoin, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import type { Market } from "@/store/market-store";
import clsx from "clsx";
import type { Variants } from "framer-motion";

type Props = {
  market: Market;
  open: boolean;
  onClose: () => void;
  onBetPlaced: (newBalance: number) => void;
};

type BetStep = "input" | "submitting" | "success" | "error";

const FRACS = [
  { label: "25%", f: 0.25 },
  { label: "½", f: 0.5 },
  { label: "75%", f: 0.75 },
  { label: "MAX", f: 1 },
];

const PLATFORM_FEE = 0.05; // 5% — must match server

const MODAL: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, damping: 28, stiffness: 350 } },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function BetModal({ market, open, onClose, onBetPlaced }: Props) {
  const [direction, setDirection] = useState<"UP" | "DOWN" | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<BetStep>("input");
  const [error, setError] = useState<string | null>(null);
  const { appBalance, connected, sessionToken } = useWalletStore();

  const reset = () => { setDirection(null); setAmount(""); setStep("input"); setError(null); };
  const handleClose = () => { reset(); onClose(); };

  const parsed = parseFloat(amount);
  const isValid = direction !== null && parsed > 0 && parsed <= appBalance;

  const totalPool = market.totalUp + market.totalDown;
  const potentialPool = totalPool + (isValid ? parsed : 0);
  const winningPool = direction === "UP"
    ? market.totalUp + (isValid && direction === "UP" ? parsed : 0)
    : market.totalDown + (isValid && direction === "DOWN" ? parsed : 0);
  const adjustedPool = potentialPool * (1 - PLATFORM_FEE);
  const potentialPayout = winningPool > 0 ? (parsed / winningPool) * adjustedPool : 0;
  const profit = potentialPayout - parsed;

  const handleBet = async () => {
    if (!isValid || !sessionToken) return;
    setStep("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/markets/${market.id}/bet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`,
        },
        // Never send partyId in body — server reads it from the JWT
        body: JSON.stringify({ direction, amount: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bet failed");
      onBetPlaced(data.appBalance);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place bet");
      setStep("error");
    }
  };

  const upSelected = direction === "UP";
  const downSelected = direction === "DOWN";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={handleClose} />

          <motion.div
            variants={MODAL} initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-[420px] rounded-3xl overflow-hidden shadow-2xl shadow-black/60"
            style={{ background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="h-px bg-gradient-to-r from-transparent via-[#28cc95]/40 to-transparent" />

            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>Place Bet</h2>
                <p className="text-white/35 text-sm mt-0.5 line-clamp-1 max-w-[280px]">{market.question}</p>
              </div>
              <button onClick={handleClose} className="w-8 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center text-white/40 hover:text-white transition-all ml-3 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                {step === "input" && (
                  <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                    {/* Direction */}
                    <div className="grid grid-cols-2 gap-3">
                      {(["UP", "DOWN"] as const).map((dir) => {
                        const isUp = dir === "UP";
                        const selected = direction === dir;
                        const poolAmt = isUp ? market.totalUp : market.totalDown;
                        const pct = totalPool > 0 ? ((poolAmt / totalPool) * 100).toFixed(0) : "50";
                        return (
                          <button
                            key={dir}
                            onClick={() => setDirection(dir)}
                            className="relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all duration-300 overflow-hidden"
                            style={{
                              background: selected
                                ? isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)"
                                : "rgba(255,255,255,0.02)",
                              border: selected
                                ? isUp ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(239,68,68,0.3)"
                                : "1px solid rgba(255,255,255,0.06)",
                              boxShadow: selected
                                ? isUp ? "0 0 20px rgba(34,197,94,0.08)" : "0 0 20px rgba(239,68,68,0.08)"
                                : "none",
                            }}
                          >
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center"
                              style={{
                                background: isUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                                border: `1px solid ${isUp ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                              }}
                            >
                              {isUp
                                ? <TrendingUp className={clsx("w-5 h-5", selected ? "text-green-400" : "text-white/25")} />
                                : <TrendingDown className={clsx("w-5 h-5", selected ? "text-red-400" : "text-white/25")} />
                              }
                            </div>
                            <div className="text-center">
                              <p className={clsx("font-bold text-sm", selected ? (isUp ? "text-green-400" : "text-red-400") : "text-white/40")} style={{ fontFamily: "var(--font-syne)" }}>{dir}</p>
                              <p className="text-white/25 text-[11px]" style={{ fontFamily: "var(--font-space-mono)" }}>{pct}% · {poolAmt.toFixed(3)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Amount */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium">Amount</p>
                        <p className="text-white/25 text-xs" style={{ fontFamily: "var(--font-space-mono)" }}>
                          Bal: {appBalance.toFixed(5)} CBTC
                        </p>
                      </div>
                      <div className="relative rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.000"
                          step="0.001"
                          min="0"
                          max={appBalance}
                          className="w-full bg-transparent text-white text-2xl font-bold px-4 pt-3.5 pb-2 placeholder-white/10 outline-none"
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        />
                        <div className="flex items-center gap-1.5 px-4 pb-3">
                          <Bitcoin className="w-3.5 h-3.5 text-[#28cc95]" />
                          <span className="text-[#28cc95]/80 text-xs font-semibold">CBTC</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 mt-2">
                        {FRACS.map(({ label, f }) => (
                          <button
                            key={label}
                            onClick={() => setAmount((appBalance * f).toFixed(5))}
                            className="py-1.5 rounded-xl text-xs font-semibold transition-all border border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.05] text-white/35 hover:text-white/60"
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
                        className="rounded-2xl p-4 space-y-2.5"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <p className="text-white/25 text-[10px] uppercase tracking-widest font-medium">Estimated Return</p>
                        <div className="flex justify-between">
                          <span className="text-white/40 text-sm">Payout</span>
                          <span className="text-white text-sm font-semibold" style={{ fontFamily: "var(--font-space-mono)" }}>{potentialPayout.toFixed(6)} CBTC</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-white/40 text-sm">Profit</span>
                          <span
                            className={clsx("text-sm font-bold", profit >= 0 ? "text-green-400" : "text-red-400")}
                            style={{ fontFamily: "var(--font-space-mono)" }}
                          >
                            {profit >= 0 ? "+" : ""}{profit.toFixed(6)}
                          </span>
                        </div>
                        <p className="text-white/15 text-[10px]">* Estimate after 5% platform fee. Final payout depends on pool at close.</p>
                      </motion.div>
                    )}

                    <button
                      onClick={handleBet}
                      disabled={!isValid || !connected || !sessionToken}
                      className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                      style={{
                        background: !isValid || !connected
                          ? "rgba(255,255,255,0.04)"
                          : upSelected
                          ? "linear-gradient(135deg, #16a34a, #22c55e)"
                          : downSelected
                          ? "linear-gradient(135deg, #dc2626, #ef4444)"
                          : "linear-gradient(135deg, #28cc95, #1fa876)",
                        fontFamily: "var(--font-syne)",
                      }}
                    >
                      {upSelected ? <TrendingUp className="w-4 h-4" /> : downSelected ? <TrendingDown className="w-4 h-4" /> : null}
                      {!connected ? "Connect Wallet First" : !direction ? "Select UP or DOWN" : !isValid ? "Enter Amount" : `Bet ${direction} — ${parsed.toFixed(6)} CBTC`}
                    </button>
                  </motion.div>
                )}

                {step === "submitting" && (
                  <motion.div key="submitting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-10">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl" style={{ background: "rgba(40,204,149,0.06)", border: "1px solid rgba(40,204,149,0.15)" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-[#28cc95] animate-spin" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Placing bet…</p>
                      <p className="text-white/35 text-sm mt-1">Deducting from app balance</p>
                    </div>
                  </motion.div>
                )}

                {step === "success" && (
                  <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <motion.div
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", damping: 14, stiffness: 260, delay: 0.1 }}
                      className="w-20 h-20 rounded-3xl flex items-center justify-center"
                      style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
                    >
                      <CheckCircle2 className="w-9 h-9 text-green-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>Bet Placed!</p>
                      <p className="text-white/40 text-sm mt-1">{parsed.toFixed(6)} CBTC on {direction}</p>
                    </div>
                    <button onClick={handleClose} className="px-8 py-2.5 rounded-xl font-semibold text-black text-sm" style={{ background: "linear-gradient(135deg, #28cc95, #1fa876)", fontFamily: "var(--font-syne)" }}>
                      Done
                    </button>
                  </motion.div>
                )}

                {step === "error" && (
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <AlertCircle className="w-9 h-9 text-red-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Bet Failed</p>
                      <p className="text-white/40 text-sm mt-1.5 max-w-[280px] leading-relaxed">{error}</p>
                    </div>
                    <button onClick={reset} className="px-6 py-2.5 rounded-xl border border-white/[0.1] hover:border-white/[0.18] text-white/60 hover:text-white text-sm font-medium transition-all">
                      Try Again
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
