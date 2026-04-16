"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import type { Variants } from "framer-motion";

type Props = {
  open: boolean;
  onSign: () => Promise<void>;
  onCancel: () => void;
};

const MODAL: Variants = {
  hidden:   { opacity: 0, scale: 0.94, y: 24 },
  visible:  { opacity: 1, scale: 1,    y: 0,  transition: { type: "spring", damping: 28, stiffness: 350 } },
  exit:     { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18 } },
};

export default function VerifyIdentityModal({ open, onSign, onCancel }: Props) {
  const [signing, setSigning] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSign = async () => {
    setSigning(true);
    setError(null);
    try {
      await onSign();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed. Please try again.");
      setSigning(false);
    }
  };

  const handleCancel = () => {
    if (signing) return;
    setError(null);
    onCancel();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: 500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
          />

          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 501 }}>
            <motion.div
              variants={MODAL}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative w-full max-w-sm rounded-3xl p-8 text-center"
              style={{
                background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close */}
              <button
                onClick={handleCancel}
                disabled={signing}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-all disabled:opacity-30"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
              <div
                className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
                style={{ background: "rgba(40,204,149,0.10)", border: "1px solid rgba(40,204,149,0.20)" }}
              >
                <ShieldCheck className="w-10 h-10 text-[#28cc95]" />
              </div>

              <h2
                className="text-xl font-extrabold text-white mb-2"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                Verify Identity
              </h2>
              <p className="text-white/40 text-sm leading-relaxed mb-8">
                Sign a verification message in your Loop wallet to create your account.
                This proves you control the wallet and costs no gas.
              </p>

              {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl mb-5 text-left"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <p className="text-red-300 text-xs">{error}</p>
                </div>
              )}

              <button
                onClick={handleSign}
                disabled={signing}
                className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 mb-3"
                style={{ background: "linear-gradient(135deg, #28cc95 0%, #1fa876 100%)", fontFamily: "var(--font-syne)" }}
              >
                {signing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Waiting for signature…</>
                ) : (
                  <><ShieldCheck className="w-4 h-4" /> Sign to Verify</>
                )}
              </button>

              <button
                onClick={handleCancel}
                disabled={signing}
                className="w-full py-2.5 text-white/30 hover:text-white/60 text-sm font-medium transition-colors disabled:opacity-30"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                Cancel
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
