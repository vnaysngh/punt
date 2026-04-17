"use client";

import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Bitcoin, X, Info } from "lucide-react";
import type { Variants } from "framer-motion";
import { fmt, fmtSigned } from "@/lib/format";

type Props = {
  open: boolean;
  direction: "UP" | "DOWN";
  amount: number;
  potentialPayout: number;
  profit: number;
  fee: number;
  noCounterparty?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const MODAL: Variants = {
  hidden:  { opacity: 0, scale: 0.94, y: 24 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", damping: 28, stiffness: 350 } },
  exit:    { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function BetConfirmModal({ open, direction, amount, potentialPayout, profit, fee, noCounterparty, onConfirm, onCancel }: Props) {
  const isUp = direction === "UP";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: 500, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 501 }}>
            <motion.div
              variants={MODAL}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-3xl p-6"
              style={{
                background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-all"
              >
                <X className="w-4 h-4" />
              </button>

              <h2 className="text-lg font-extrabold text-white mb-5" style={{ fontFamily: "var(--font-syne)" }}>
                Confirm Bet
              </h2>

              {/* Direction badge */}
              <div
                className="flex items-center justify-center gap-2 py-4 rounded-2xl mb-4"
                style={{
                  background: isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                  border: `1px solid ${isUp ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                }}
              >
                {isUp
                  ? <TrendingUp className="w-6 h-6 text-green-400" />
                  : <TrendingDown className="w-6 h-6 text-red-400" />}
                <span
                  className={`text-2xl font-extrabold ${isUp ? "text-green-300" : "text-red-300"}`}
                  style={{ fontFamily: "var(--font-syne)" }}
                >
                  {direction}
                </span>
              </div>

              {/* Breakdown */}
              <div
                className="rounded-2xl overflow-hidden mb-4"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {[
                  { label: "Your bet", value: `${fmt(amount)} CBTC`, highlight: false },
                  ...(!noCounterparty ? [
                    { label: "Platform fee (5%)", value: `−${fmt(fee)} CBTC`, highlight: false },
                    { label: "Est. gain if correct", value: `${fmtSigned(profit)} CBTC`, highlight: true, green: true },
                  ] : []),
                  { label: "Est. payout", value: `${noCounterparty ? fmt(amount) : fmt(potentialPayout)} CBTC`, highlight: true },
                ].map(({ label, value, highlight, green }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                    <span className="text-white/40 text-sm">{label}</span>
                    <span
                      className={`text-sm font-semibold ${green ? "text-green-400" : highlight ? "text-white" : "text-white/60"}`}
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Info note */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Info className="w-3.5 h-3.5 text-white/20 shrink-0 mt-0.5" />
                <p className="text-white/25 text-[11px] leading-relaxed">
                  Payout estimate uses Binance spot price. Final result depends on pool at close. Draws are fully refunded.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 rounded-2xl text-white/40 hover:text-white/70 text-sm font-semibold transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", fontFamily: "var(--font-syne)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{
                    background: isUp ? "linear-gradient(135deg, #16a34a, #22c55e)" : "linear-gradient(135deg, #dc2626, #ef4444)",
                    color: "#fff",
                    fontFamily: "var(--font-syne)",
                  }}
                >
                  <Bitcoin className="w-4 h-4" />
                  Confirm {direction}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
