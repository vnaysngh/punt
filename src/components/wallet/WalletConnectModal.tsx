"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Zap, AlertCircle, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import { useLoopConnect } from "@/hooks/useLoopConnect";
import { checkConsoleWalletAvailable, connectConsoleWallet } from "@/lib/console-wallet";
import type { Variants } from "framer-motion";

type Props = { open: boolean; onClose: () => void };
type Step = "select" | "connecting" | "connected" | "error";

const BACKDROP = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const MODAL: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, damping: 28, stiffness: 350 } },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function WalletConnectModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>("select");
  const [error, setError] = useState<string | null>(null);
  const { setConnected } = useWalletStore();
  const { connect: loopConnect } = useLoopConnect();

  const resetAndClose = () => { setStep("select"); setError(null); onClose(); };

  const handleLoopConnect = useCallback(async () => {
    setStep("connecting");
    setError(null);
    try {
      await loopConnect();
      // loopConnect sets the wallet store — check if we're now connected
      const { sessionToken } = useWalletStore.getState();
      if (!sessionToken) throw new Error("Connection rejected");
      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  }, [loopConnect]);

  const connectConsole = useCallback(async () => {
    setStep("connecting");
    setError(null);
    try {
      const available = await checkConsoleWalletAvailable();
      if (!available) throw new Error("Console Wallet extension not detected. Install it from the Chrome Web Store.");
      const result = await connectConsoleWallet();
      if (!result) throw new Error("Connection rejected.");
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId: result.partyId }),
      });
      if (!res.ok) throw new Error("Session creation failed");
      const { token, appBalance } = await res.json();
      setConnected({ walletType: "console", partyId: result.partyId, sessionToken: token });
      useWalletStore.getState().setAppBalance(appBalance ?? 0);
      setStep("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStep("error");
    }
  }, [setConnected]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            variants={BACKDROP}
            initial="hidden" animate="visible" exit="exit"
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={resetAndClose}
          />

          <motion.div
            variants={MODAL}
            initial="hidden" animate="visible" exit="exit"
            className="relative w-full max-w-[400px] rounded-3xl overflow-hidden shadow-2xl shadow-black/60"
            style={{ background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Top accent line */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#28cc95]/50 to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <div>
                <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-syne)" }}>
                  Connect Wallet
                </h2>
                <p className="text-white/35 text-sm mt-0.5">Canton Network · CBTC</p>
              </div>
              <button
                onClick={resetAndClose}
                className="w-8 h-8 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center text-white/40 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pb-6">
              <AnimatePresence mode="wait">
                {/* Select */}
                {step === "select" && (
                  <motion.div key="select" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-3">
                    {/* Loop */}
                    <button
                      onClick={handleLoopConnect}
                      className="group w-full relative flex items-center gap-4 p-4 rounded-2xl border border-white/[0.07] hover:border-[#28cc95]/30 bg-white/[0.02] hover:bg-[#28cc95]/[0.04] transition-all duration-300 text-left overflow-hidden"
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "radial-gradient(circle at 20% 50%, rgba(40,204,149,0.06) 0%, transparent 70%)" }} />
                      <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, rgba(40,204,149,0.2) 0%, rgba(31,168,118,0.1) 100%)", border: "1px solid rgba(40,204,149,0.2)" }}>
                        <Zap className="w-5 h-5 text-[#28cc95] fill-[#28cc95]/20" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold text-sm" style={{ fontFamily: "var(--font-syne)" }}>Loop Wallet</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: "rgba(40,204,149,0.15)", color: "rgba(40,204,149,0.9)", border: "1px solid rgba(40,204,149,0.2)" }}>
                            Recommended
                          </span>
                        </div>
                        <p className="text-white/35 text-xs mt-0.5">Scan QR with Loop mobile app</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-[#28cc95] group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
                    </button>

                    {/* Console */}
                    <button
                      onClick={connectConsole}
                      className="group w-full relative flex items-center gap-4 p-4 rounded-2xl border border-white/[0.07] hover:border-violet-500/30 bg-white/[0.02] hover:bg-violet-500/[0.04] transition-all duration-300 text-left overflow-hidden"
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: "radial-gradient(circle at 20% 50%, rgba(139,92,246,0.06) 0%, transparent 70%)" }} />
                      <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(109,40,217,0.1) 100%)", border: "1px solid rgba(139,92,246,0.2)" }}>
                        <Wallet className="w-5 h-5 text-violet-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-semibold text-sm block" style={{ fontFamily: "var(--font-syne)" }}>Console Wallet</span>
                        <p className="text-white/35 text-xs mt-0.5">Browser extension popup</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-violet-400 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
                    </button>

                    <p className="text-center text-white/20 text-xs pt-1">
                      Your funds stay in the app wallet — not your connected wallet
                    </p>
                  </motion.div>
                )}

                {/* Connecting */}
                {step === "connecting" && (
                  <motion.div key="connecting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-10">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl" style={{ background: "rgba(40,204,149,0.06)", border: "1px solid rgba(40,204,149,0.15)" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-[#28cc95] animate-spin" />
                      </div>
                      <div className="absolute -inset-3 rounded-full opacity-20 animate-ping" style={{ background: "radial-gradient(circle, rgba(40,204,149,0.3) 0%, transparent 70%)" }} />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Awaiting approval</p>
                      <p className="text-white/35 text-sm mt-1">Confirm the connection in your wallet</p>
                    </div>
                  </motion.div>
                )}

                {/* Connected */}
                {step === "connected" && (
                  <motion.div key="connected" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
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
                      <p className="text-white font-bold text-lg" style={{ fontFamily: "var(--font-syne)" }}>Wallet Connected</p>
                      <p className="text-white/35 text-sm mt-1">Deposit CBTC to start betting</p>
                    </div>
                    <button
                      onClick={resetAndClose}
                      className="px-8 py-2.5 rounded-xl font-semibold text-black text-sm transition-all"
                      style={{ background: "linear-gradient(135deg, #28cc95, #1fa876)", fontFamily: "var(--font-syne)" }}
                    >
                      Let&apos;s Go
                    </button>
                  </motion.div>
                )}

                {/* Error */}
                {step === "error" && (
                  <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5 py-8">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <AlertCircle className="w-9 h-9 text-red-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-semibold" style={{ fontFamily: "var(--font-syne)" }}>Connection Failed</p>
                      <p className="text-white/40 text-sm mt-1.5 max-w-[280px] leading-relaxed">{error}</p>
                    </div>
                    <button
                      onClick={() => { setStep("select"); setError(null); }}
                      className="px-6 py-2.5 rounded-xl border border-white/[0.1] hover:border-white/[0.18] text-white/60 hover:text-white text-sm font-medium transition-all"
                    >
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
