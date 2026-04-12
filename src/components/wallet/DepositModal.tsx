"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bitcoin, Loader2, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import { submitConsoleTransfer } from "@/lib/console-wallet";
import clsx from "clsx";
import type { Variants } from "framer-motion";

type Props = { open: boolean; onClose: () => void };
type Step = "input" | "confirming" | "success" | "error";

const QUICK = [0.001, 0.005, 0.01, 0.05];

const MODAL: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, damping: 28, stiffness: 350 } },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function DepositModal({ open, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const { partyId, walletType, setAppBalance } = useWalletStore();

  const reset = () => { setAmount(""); setStep("input"); setError(null); setTxId(null); };
  const handleClose = () => { reset(); onClose(); };

  const parsed = parseFloat(amount);
  const isValid = parsed > 0 && !isNaN(parsed);

  const appPartyId = process.env.NEXT_PUBLIC_APP_PARTY_ID;
  const hasAppParty = !!appPartyId && appPartyId !== "your-app-party-id";

  const handleDeposit = async () => {
    if (!isValid || !partyId) return;
    setStep("confirming");
    setError(null);

    try {
      let submissionId: string | null = null;

      if (hasAppParty && appPartyId) {
        // ── Real on-chain transfer ──
        if (walletType === "loop") {
          // Use loop.wallet.transfer() — works even after refresh (no stored provider needed)
          const { getLoop } = await import("@/lib/loop");
          const loop = await getLoop();
          if (!loop) throw new Error("Loop SDK not available. Please refresh and reconnect.");

          const result = await loop.wallet.transfer(
            appPartyId,
            parsed,
            undefined, // use user's default instrument
            {
              requestedAt: new Date(),
              executeBefore: new Date(Date.now() + 10 * 60 * 1000),
              memo: "BetCC deposit",
            }
          );
          submissionId = (result as { submission_id?: string })?.submission_id ?? null;

        } else if (walletType === "console") {
          const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          submissionId = await submitConsoleTransfer({
            from: partyId,
            to: appPartyId,
            token: "cBTC",
            amount: parsed,
            expireDate: expiry,
            memo: "BetCC deposit",
          });
          if (!submissionId) throw new Error("Transfer rejected or failed in Console Wallet.");
        }
      }
      // If no appPartyId configured — dev mode, credit directly (no chain transfer)

      // Credit app balance in DB
      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId, amount: parsed, txId: submissionId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Deposit failed");
      }
      const data = await res.json();
      setAppBalance(data.appBalance);
      setTxId(submissionId);
      setStep("success");

    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed. Please try again.");
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
            <div className="h-px bg-gradient-to-r from-transparent via-orange-500/50 to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>Deposit cBTC</h2>
                <p className="text-white/35 text-sm mt-0.5">Fund your app wallet</p>
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

                    {!hasAppParty ? (
                      <div className="flex gap-2.5 p-3 rounded-2xl" style={{ background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.12)" }}>
                        <Info className="w-4 h-4 text-orange-400/70 shrink-0 mt-0.5" />
                        <p className="text-orange-300/60 text-xs leading-relaxed">
                          Dev mode — balance credited directly without a real chain transfer. Set <code className="font-mono">NEXT_PUBLIC_APP_PARTY_ID</code> to enable real cBTC transfers.
                        </p>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 p-3 rounded-2xl" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)" }}>
                        <Info className="w-4 h-4 text-blue-400/70 shrink-0 mt-0.5" />
                        <p className="text-blue-300/50 text-xs leading-relaxed">
                          cBTC will be transferred from your {walletType === "loop" ? "Loop" : "Console"} wallet to the BetCC app wallet. Approve in your wallet when prompted.
                        </p>
                      </div>
                    )}

                    {/* Amount */}
                    <div>
                      <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium mb-2">Amount</p>
                      <div className="rounded-2xl overflow-hidden [&:focus-within]:border-white/[0.08]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.00000"
                          step="0.001"
                          min="0"
                          className="w-full bg-transparent text-white text-3xl font-bold text-center px-4 pt-5 pb-2 placeholder-white/10 outline-none focus:outline-none focus:ring-0"
                          style={{ fontFamily: "var(--font-space-mono)", boxShadow: "none" }}
                        />
                        <div className="flex items-center justify-center gap-1.5 pb-4">
                          <Bitcoin className="w-3.5 h-3.5 text-orange-400" />
                          <span className="text-orange-400 text-sm font-semibold">cBTC</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick amounts */}
                    <div className="grid grid-cols-4 gap-2">
                      {QUICK.map((a) => (
                        <button
                          key={a}
                          onClick={() => setAmount(a.toString())}
                          className={clsx(
                            "py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 border",
                            parseFloat(amount) === a
                              ? "bg-orange-500/15 border-orange-500/35 text-orange-300"
                              : "bg-white/[0.03] border-white/[0.07] text-white/40 hover:text-white/70 hover:bg-white/[0.06] hover:border-white/[0.12]"
                          )}
                          style={{ fontFamily: "var(--font-space-mono)" }}
                        >
                          {a}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleDeposit}
                      disabled={!isValid}
                      className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{
                        background: isValid ? "linear-gradient(135deg, #f97316, #ea580c)" : "rgba(255,255,255,0.05)",
                        fontFamily: "var(--font-syne)",
                      }}
                    >
                      {isValid ? `Deposit ${parsed.toFixed(5)} cBTC` : "Enter an amount"}
                    </button>
                  </motion.div>
                )}

                {/* ── Confirming ── */}
                {step === "confirming" && (
                  <motion.div key="confirming" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-10">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>
                        {hasAppParty ? "Waiting for wallet approval…" : "Crediting balance…"}
                      </p>
                      <p className="text-white/35 text-sm mt-1">
                        {hasAppParty ? `Approve the transfer in your ${walletType === "loop" ? "Loop" : "Console"} wallet` : "Processing deposit"}
                      </p>
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
                      style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
                    >
                      <CheckCircle2 className="w-9 h-9 text-green-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-white font-bold text-lg" style={{ fontFamily: "var(--font-syne)" }}>Deposit Confirmed!</p>
                      <p className="text-white/40 text-sm mt-1">{parsed.toFixed(5)} cBTC added to your balance</p>
                      {txId && (
                        <p className="text-white/15 text-[11px] mt-2" style={{ fontFamily: "var(--font-space-mono)" }}>
                          tx: {txId.slice(0, 24)}…
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="px-8 py-2.5 rounded-xl font-semibold text-white text-sm"
                      style={{ background: "linear-gradient(135deg, #f97316, #ea580c)", fontFamily: "var(--font-syne)" }}
                    >
                      Start Betting
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
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Deposit Failed</p>
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
