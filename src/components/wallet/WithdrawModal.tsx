"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bitcoin, Loader2, CheckCircle2, AlertCircle, ArrowUpFromLine } from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import clsx from "clsx";
import type { Variants } from "framer-motion";

type Props = { open: boolean; onClose: () => void };
type Step = "input" | "processing" | "success" | "error";

const MODAL: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, damping: 28, stiffness: 350 } },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function WithdrawModal({ open, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const { appBalance, setAppBalance, sessionToken } = useWalletStore();

  const reset = () => { setAmount(""); setStep("input"); setError(null); setTxId(null); };
  const handleClose = () => { reset(); onClose(); };

  const parsed = parseFloat(amount);
  const isValid = !isNaN(parsed) && parsed > 0 && parsed <= appBalance;

  const QUICK = [
    { label: "25%", f: 0.25 },
    { label: "50%", f: 0.5 },
    { label: "75%", f: 0.75 },
    { label: "MAX", f: 1 },
  ];

  const handleWithdraw = async () => {
    if (!isValid || !sessionToken) return;
    setStep("processing");
    setError(null);

    try {
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ amount: parsed }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Withdrawal failed");

      setAppBalance(data.appBalance);
      setTxId(data.txId ?? null);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed. Please try again.");
      setStep("error");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={handleClose}
          />

          <motion.div
            variants={MODAL} initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-[400px] rounded-3xl overflow-hidden shadow-2xl shadow-black/60"
            style={{ background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>Withdraw CBTC</h2>
                <p className="text-white/35 text-sm mt-0.5">Send to your connected wallet</p>
              </div>
              <button onClick={handleClose} className="w-8 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center text-white/40 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">

                {/* ── Input ── */}
                {step === "input" && (
                  <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

                    {/* Balance display */}
                    <div
                      className="flex items-center justify-between px-4 py-3 rounded-2xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <span className="text-white/35 text-xs uppercase tracking-widest font-medium">Available</span>
                      <div className="flex items-center gap-1.5">
                        <Bitcoin className="w-3.5 h-3.5 text-[#28cc95]" />
                        <span className="text-white font-bold text-sm" style={{ fontFamily: "var(--font-space-mono)" }}>
                          {appBalance.toFixed(5)} CBTC
                        </span>
                      </div>
                    </div>

                    {/* Amount input */}
                    <div>
                      <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium mb-2">Amount</p>
                      <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${parsed > appBalance ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.00000"
                          step="0.001"
                          min="0"
                          max={appBalance}
                          className="w-full bg-transparent text-white text-3xl font-bold text-center px-4 pt-5 pb-2 placeholder-white/10"
                          style={{ fontFamily: "var(--font-space-mono)", outline: "none", boxShadow: "none", border: "none", WebkitAppearance: "none", MozAppearance: "textfield" }}
                        />
                        <div className="flex items-center justify-center gap-1.5 pb-4">
                          <Bitcoin className="w-3.5 h-3.5 text-[#28cc95]" />
                          <span className="text-[#28cc95] text-sm font-semibold">CBTC</span>
                        </div>
                      </div>
                      {parsed > appBalance && (
                        <p className="text-red-400/70 text-xs mt-1.5 text-center">Exceeds available balance</p>
                      )}
                    </div>

                    {/* Quick amounts */}
                    <div className="grid grid-cols-4 gap-2">
                      {QUICK.map(({ label, f }) => {
                        const val = parseFloat((appBalance * f).toFixed(5));
                        return (
                          <button
                            key={label}
                            onClick={() => setAmount(val.toString())}
                            disabled={appBalance === 0}
                            className={clsx(
                              "py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border disabled:opacity-30 disabled:cursor-not-allowed",
                              parseFloat(amount) === val
                                ? "bg-violet-500/15 border-violet-500/35 text-violet-300"
                                : "bg-white/[0.03] border-white/[0.07] text-white/40 hover:text-white/70 hover:bg-white/[0.06] hover:border-white/[0.12]"
                            )}
                            style={{ fontFamily: "var(--font-space-mono)" }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={handleWithdraw}
                      disabled={!isValid}
                      className="w-full py-3.5 rounded-2xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{
                        background: isValid ? "linear-gradient(135deg, #8b5cf6, #6d28d9)" : "rgba(255,255,255,0.05)",
                        color: isValid ? "white" : "rgba(255,255,255,0.3)",
                        fontFamily: "var(--font-syne)",
                      }}
                    >
                      {isValid ? `Withdraw ${parsed.toFixed(5)} CBTC` : "Enter an amount"}
                    </button>
                  </motion.div>
                )}

                {/* ── Processing ── */}
                {step === "processing" && (
                  <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-10">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Processing withdrawal…</p>
                      <p className="text-white/35 text-sm mt-1">Sending CBTC to your wallet on-chain</p>
                    </div>
                  </motion.div>
                )}

                {/* ── Success ── */}
                {step === "success" && (
                  <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <motion.div
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", damping: 14, stiffness: 260, delay: 0.1 }}
                      className="w-20 h-20 rounded-3xl flex items-center justify-center"
                      style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}
                    >
                      <CheckCircle2 className="w-9 h-9 text-violet-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-white font-bold text-lg" style={{ fontFamily: "var(--font-syne)" }}>Withdrawal Sent!</p>
                      <p className="text-white/40 text-sm mt-1">{parsed.toFixed(5)} CBTC sent to your wallet</p>
                      {txId && (
                        <p className="text-white/15 text-[11px] mt-2" style={{ fontFamily: "var(--font-space-mono)" }}>
                          tx: {txId.slice(0, 24)}…
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="px-8 py-2.5 rounded-xl font-semibold text-white text-sm"
                      style={{ background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", fontFamily: "var(--font-syne)" }}
                    >
                      Done
                    </button>
                  </motion.div>
                )}

                {/* ── Error ── */}
                {step === "error" && (
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <AlertCircle className="w-9 h-9 text-red-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Withdrawal Failed</p>
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
