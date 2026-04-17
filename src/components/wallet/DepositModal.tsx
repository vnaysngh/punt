"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bitcoin, Loader2, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { fmt } from "@/lib/format";
import { useWalletStore } from "@/store/wallet-store";
import { submitConsoleTransfer } from "@/lib/console-wallet";
import { pay as loopPay } from "@/lib/loop-wallet";
import clsx from "clsx";
import type { Variants } from "framer-motion";

type Props = { open: boolean; onClose: () => void };
type Step = "input" | "confirming" | "success" | "error" | "timeout";

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
  // Preserved after a timeout so retry can re-poll without a second wallet transfer
  const pendingMemoRef = useRef<string | null>(null);
  const pendingCidRef = useRef<string | null>(null);
  const { partyId, walletType, setAppBalance, sessionToken } = useWalletStore();

  const reset = () => { setAmount(""); setStep("input"); setError(null); setTxId(null); pendingMemoRef.current = null; pendingCidRef.current = null; };
  const handleClose = () => { reset(); onClose(); };

  const parsed = parseFloat(amount);
  const isValid = parsed > 0 && !isNaN(parsed);

  const appPartyId = process.env.NEXT_PUBLIC_APP_PARTY_ID;
  const hasAppParty = !!appPartyId && appPartyId !== "your-app-party-id";

  const handleDeposit = async () => {
    if (!isValid || !partyId || !sessionToken) return;
    setStep("confirming");
    setError(null);

    try {
      // Require app party to be configured — no dev-mode balance minting in any env
      if (!hasAppParty || !appPartyId) {
        throw new Error("App wallet not configured. Set NEXT_PUBLIC_APP_PARTY_ID.");
      }

      // Unique memo per deposit — server uses this to find the TransferInstruction on-chain
      const memo = `PUNT-${partyId.slice(0, 8)}-${Date.now()}`;

      let transferInstructionCid: string | null = null;

      if (walletType === "loop") {
        const instrumentId = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ID;
        const instrumentAdmin = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ADMIN;
        const instrument = instrumentId && instrumentAdmin
          ? { instrument_id: instrumentId, instrument_admin: instrumentAdmin }
          : undefined;

        // Use pay() from loop-wallet — revalidates session, passes amount as string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await loopPay(appPartyId, String(parsed), memo, instrument);

        // Extract contractId from SDK result so server can fast-path match
        const events = result?.payload?.update_data?.value?.eventsById ?? {};
        for (const evt of Object.values(events)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cid = (evt as any)?.ExercisedTreeEvent?.value?.exerciseResult?.output?.value?.transferInstructionCid;
          if (cid) { transferInstructionCid = cid; break; }
        }

      } else if (walletType === "console") {
        const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await submitConsoleTransfer({
          from: partyId,
          to: appPartyId,
          token: "CBTC",
          amount: parsed,
          expireDate: expiry,
          memo,
        });
      }

      // Store memo + cid so a timeout retry can re-poll without re-triggering the wallet
      pendingMemoRef.current = memo;
      pendingCidRef.current = transferInstructionCid;

      // Tell server to find and accept the TransferInstruction on-chain
      // Server verifies: memo matches, senderPartyId === authenticated user, amount >= expected
      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ amount: parsed, memo, transferInstructionCid }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Deposit failed");
      }
      const data = await res.json();
      setAppBalance(data.appBalance);
      setTxId(memo);
      setStep("success");

    } catch (err) {
      console.error("[Deposit] failed:", err);
      const msg = err instanceof Error ? err.message : String(err) ?? "Deposit failed. Please try again.";
      // Distinguish timeout/not-found from hard errors so we can offer a retry
      if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("still pending")) {
        setStep("timeout");
      } else {
        setError(msg);
        setStep("error");
      }
    }
  };

  // Re-poll the server with the original memo — the wallet transfer already happened,
  // we just need to wait for the on-chain confirmation to appear.
  const handleRetry = async () => {
    if (!sessionToken || !pendingMemoRef.current) return;
    setStep("confirming");
    try {
      const res = await fetch("/api/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionToken}` },
        body: JSON.stringify({ amount: parsed, memo: pendingMemoRef.current, transferInstructionCid: pendingCidRef.current }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Deposit failed");
      }
      const data = await res.json();
      setAppBalance(data.appBalance);
      setTxId(pendingMemoRef.current);
      setStep("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deposit failed. Please try again.";
      if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("still pending")) {
        setStep("timeout");
      } else {
        setError(msg);
        setStep("error");
      }
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
            <div className="h-px bg-gradient-to-r from-transparent via-[#28cc95]/50 to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>Deposit CBTC</h2>
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
                      <div className="flex gap-2.5 p-3 rounded-2xl" style={{ background: "rgba(40,204,149,0.05)", border: "1px solid rgba(40,204,149,0.12)" }}>
                        <Info className="w-4 h-4 text-[#28cc95]/70 shrink-0 mt-0.5" />
                        <p className="text-[#5dd9ab]/60 text-xs leading-relaxed">
                          Dev mode — balance credited directly without a real chain transfer. Set <code className="font-mono">NEXT_PUBLIC_APP_PARTY_ID</code> to enable real CBTC transfers.
                        </p>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 p-3 rounded-2xl" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)" }}>
                        <Info className="w-4 h-4 text-blue-400/70 shrink-0 mt-0.5" />
                        <p className="text-blue-300/50 text-xs leading-relaxed">
                          CBTC will be transferred from your {walletType === "loop" ? "Loop" : "Console"} wallet to the Punt app wallet. Approve in your wallet when prompted.
                        </p>
                      </div>
                    )}

                    {/* Amount */}
                    <div>
                      <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium mb-2">Amount</p>
                      <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.00000"
                          step="0.001"
                          min="0"
                          className="w-full bg-transparent text-white text-3xl font-bold text-center px-4 pt-5 pb-2 placeholder-white/10"
                          style={{ fontFamily: "var(--font-space-mono)", outline: "none", boxShadow: "none", border: "none", WebkitAppearance: "none", MozAppearance: "textfield" }}
                        />
                        <div className="flex items-center justify-center gap-1.5 pb-4">
                          <Bitcoin className="w-3.5 h-3.5 text-[#28cc95]" />
                          <span className="text-[#28cc95] text-sm font-semibold">CBTC</span>
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
                              ? "bg-[#28cc95]/15 border-[#28cc95]/35 text-[#5dd9ab]"
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
                      className="w-full py-3.5 rounded-2xl font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{
                        background: isValid ? "linear-gradient(135deg, #28cc95, #1fa876)" : "rgba(255,255,255,0.05)",
                        color: isValid ? "black" : "white",
                        fontFamily: "var(--font-syne)",
                      }}
                    >
                      {isValid ? `Deposit ${fmt(parsed)} CBTC` : "Enter an amount"}
                    </button>
                  </motion.div>
                )}

                {/* ── Confirming ── */}
                {step === "confirming" && (
                  <motion.div key="confirming" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-10">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl" style={{ background: "rgba(40,204,149,0.06)", border: "1px solid rgba(40,204,149,0.15)" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-[#28cc95] animate-spin" />
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
                      <p className="text-white/40 text-sm mt-1">{fmt(parsed)} CBTC added to your balance</p>
                      {txId && (
                        <p className="text-white/15 text-[11px] mt-2" style={{ fontFamily: "var(--font-space-mono)" }}>
                          tx: {txId.slice(0, 24)}…
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="px-8 py-2.5 rounded-xl font-semibold text-black text-sm"
                      style={{ background: "linear-gradient(135deg, #28cc95, #1fa876)", fontFamily: "var(--font-syne)" }}
                    >
                      Start Betting
                    </button>
                  </motion.div>
                )}

                {/* ── Timeout (transfer not yet on-chain) ── */}
                {step === "timeout" && (
                  <motion.div key="timeout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)" }}>
                      <AlertCircle className="w-9 h-9 text-amber-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Transfer Still Pending</p>
                      <p className="text-white/40 text-sm mt-1.5 max-w-[280px] leading-relaxed">
                        The on-chain transfer wasn&apos;t confirmed within 30s. Your CBTC wasn&apos;t deducted — wait a moment and retry.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleRetry}
                        className="px-6 py-2.5 rounded-xl font-semibold text-black text-sm transition-all hover:opacity-90"
                        style={{ background: "linear-gradient(135deg, #28cc95, #1fa876)", fontFamily: "var(--font-syne)" }}
                      >
                        Retry Deposit
                      </button>
                      <button onClick={reset} className="px-5 py-2.5 rounded-xl border border-white/[0.1] hover:border-white/[0.18] text-white/50 hover:text-white text-sm font-medium transition-all">
                        Cancel
                      </button>
                    </div>
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
