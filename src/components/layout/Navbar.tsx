"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bitcoin, Wallet, ChevronDown, LogOut, ArrowDownToLine, LayoutDashboard, Zap } from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import WalletConnectModal from "@/components/wallet/WalletConnectModal";
import DepositModal from "@/components/wallet/DepositModal";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV_LINKS = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
];

export default function Navbar() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { connected, partyId, walletType, appBalance, disconnect } = useWalletStore();

  const handleDisconnect = async () => {
    setDropdownOpen(false);
    try {
      if (walletType === "loop") {
        const { getLoop } = await import("@/lib/loop");
        const loop = await getLoop();
        loop?.logout();
      } else if (walletType === "console") {
        const { disconnectConsoleWallet } = await import("@/lib/console-wallet");
        await disconnectConsoleWallet();
      }
    } catch {
      // ignore SDK errors — still clear local state
    }
    disconnect();
  };
  const pathname = usePathname();

  const shortId = partyId
    ? `${partyId.slice(0, 6)}...${partyId.slice(-4)}`
    : null;

  return (
    <>
      <nav className="fixed top-0 inset-x-0 z-40 h-16">
        {/* Glass background */}
        <div className="absolute inset-0 bg-[#080811]/80 backdrop-blur-2xl border-b border-white/[0.05]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-orange-500 blur-md opacity-40 group-hover:opacity-60 transition-opacity" />
              <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg">
                <Zap className="w-4 h-4 text-white fill-white" />
              </div>
            </div>
            <span
              className="text-[22px] font-bold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              Bet<span className="text-orange-400">CC</span>
            </span>
          </Link>

          {/* Nav links */}
          <div className="hidden sm:flex items-center gap-1 flex-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "relative px-4 py-2 text-sm font-medium transition-colors",
                  pathname === href ? "text-white" : "text-white/40 hover:text-white/70"
                )}
              >
                {label}
                {pathname === href && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute inset-0 rounded-lg bg-white/[0.06]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </Link>
            ))}
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 shrink-0">
            {connected ? (
              <>
                {/* Balance chip */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl bg-orange-500/10 border border-orange-500/20"
                >
                  <Bitcoin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span
                    className="text-orange-300 text-sm font-medium tabular-nums"
                    style={{ fontFamily: "var(--font-space-mono)" }}
                  >
                    {appBalance.toFixed(5)}
                  </span>
                  <span className="text-orange-500/60 text-xs">cBTC</span>
                </motion.div>

                {/* Deposit */}
                <button
                  onClick={() => setDepositOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-white/[0.08] hover:border-orange-500/30 bg-white/[0.03] hover:bg-orange-500/[0.06] text-white/50 hover:text-orange-300 text-sm font-medium transition-all duration-200"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Deposit
                </button>

                {/* Wallet dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setDropdownOpen((v) => !v)}
                    className="flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-xl border border-white/[0.08] hover:border-white/[0.14] bg-white/[0.03] hover:bg-white/[0.05] transition-all duration-200"
                  >
                    <div
                      className={clsx(
                        "w-5 h-5 rounded-md flex items-center justify-center",
                        walletType === "loop"
                          ? "bg-orange-500/20"
                          : "bg-violet-500/20"
                      )}
                    >
                      <Wallet
                        className={clsx(
                          "w-3 h-3",
                          walletType === "loop" ? "text-orange-400" : "text-violet-400"
                        )}
                      />
                    </div>
                    <span
                      className="hidden sm:block text-white/50 text-xs"
                      style={{ fontFamily: "var(--font-space-mono)" }}
                    >
                      {shortId}
                    </span>
                    <ChevronDown
                      className={clsx(
                        "w-3.5 h-3.5 text-white/20 transition-transform duration-200",
                        dropdownOpen && "rotate-180"
                      )}
                    />
                  </button>

                  <AnimatePresence>
                    {dropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setDropdownOpen(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4, scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full mt-2 z-20 w-56 glass rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
                        >
                          {/* Header */}
                          <div className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
                            <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium">Connected via</p>
                            <p
                              className="text-white/80 text-sm font-semibold mt-0.5 capitalize"
                              style={{ fontFamily: "var(--font-syne)" }}
                            >
                              {walletType} Wallet
                            </p>
                            <p
                              className="text-white/25 text-[11px] mt-1"
                              style={{ fontFamily: "var(--font-space-mono)" }}
                            >
                              {partyId?.slice(0, 18)}...
                            </p>
                          </div>

                          <div className="p-1.5">
                            <button
                              onClick={() => { setDepositOpen(true); setDropdownOpen(false); }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-white/50 hover:text-white text-sm font-medium transition-colors"
                            >
                              <ArrowDownToLine className="w-4 h-4" />
                              Deposit cBTC
                            </button>
                            <Link
                              href="/portfolio"
                              onClick={() => setDropdownOpen(false)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-white/50 hover:text-white text-sm font-medium transition-colors"
                            >
                              <LayoutDashboard className="w-4 h-4" />
                              Portfolio
                            </Link>
                          </div>

                          <div className="p-1.5 border-t border-white/[0.05]">
                            <button
                              onClick={handleDisconnect}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/[0.08] text-white/30 hover:text-red-400 text-sm font-medium transition-colors"
                            >
                              <LogOut className="w-4 h-4" />
                              Disconnect
                            </button>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <button
                onClick={() => setConnectOpen(true)}
                className="relative group h-9 px-4 rounded-xl text-sm font-semibold text-white transition-all duration-300 overflow-hidden"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-orange-500 to-orange-600 group-hover:from-orange-400 group-hover:to-orange-500 transition-all duration-300" />
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: "0 0 20px rgba(249,115,22,0.4)" }} />
                <span className="relative flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  Connect Wallet
                </span>
              </button>
            )}
          </div>
        </div>
      </nav>

      <WalletConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </>
  );
}
