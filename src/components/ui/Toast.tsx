"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, RotateCcw, Info, X } from "lucide-react";

export type ToastType = "win" | "loss" | "refund" | "info" | "error";

export type ToastData = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
};

type Props = {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
};

const ICONS = {
  win:    <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />,
  loss:   <XCircle className="w-5 h-5 text-red-400 shrink-0" />,
  refund: <RotateCcw className="w-5 h-5 text-blue-400 shrink-0" />,
  info:   <Info className="w-5 h-5 text-[#28cc95] shrink-0" />,
  error:  <XCircle className="w-5 h-5 text-red-400 shrink-0" />,
};

const BORDERS = {
  win:    "rgba(34,197,94,0.25)",
  loss:   "rgba(239,68,68,0.25)",
  refund: "rgba(59,130,246,0.25)",
  info:   "rgba(40,204,149,0.25)",
  error:  "rgba(239,68,68,0.25)",
};

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95, transition: { duration: 0.2 } }}
      className="flex items-start gap-3 px-4 py-3.5 rounded-2xl w-80 max-w-[calc(100vw-2rem)] shadow-2xl shadow-black/50"
      style={{
        background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)",
        border: `1px solid ${BORDERS[toast.type]}`,
      }}
    >
      {ICONS[toast.type]}
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold" style={{ fontFamily: "var(--font-syne)" }}>
          {toast.title}
        </p>
        {toast.message && (
          <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{toast.message}</p>
        )}
      </div>
      <button onClick={onDismiss} className="text-white/20 hover:text-white/50 transition-colors shrink-0 mt-0.5">
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div className="fixed bottom-6 right-4 sm:right-6 z-[600] flex flex-col gap-2 items-end">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
