"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Bitcoin,
  Wallet,
  ChevronDown,
  LogOut,
  ArrowDownToLine,
  LayoutDashboard,
  Zap,
  Loader2
} from "lucide-react";
import { fmt } from "@/lib/format";
import { useWalletStore } from "@/store/wallet-store";
import DepositModal from "@/components/wallet/DepositModal";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useLoopConnect } from "@/hooks/useLoopConnect";
import VerifyIdentityModal from "@/components/wallet/VerifyIdentityModal";

const NAV_LINKS = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" }
];

export default function Navbar() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { connected, partyId, walletType, appBalance, disconnect, connectTrigger } =
    useWalletStore();
  const { connect: handleConnectLoop, connecting, verifyOpen, handleSign, handleVerifyCancel } = useLoopConnect();
  const pathname = usePathname();

  // Other components call requestConnect() on the store instead of useLoopConnect directly.
  // This effect ensures the single modal-owning instance (Navbar) handles it.
  const prevTrigger = useRef(0);
  useEffect(() => {
    if (connectTrigger > prevTrigger.current) {
      prevTrigger.current = connectTrigger;
      if (!connected && !connecting) handleConnectLoop();
    }
  }, [connectTrigger, connected, connecting, handleConnectLoop]);

  const openDropdown = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setDropdownOpen(true);
  };

  const closeDropdown = () => setDropdownOpen(false);

  // Close on scroll/resize
  useEffect(() => {
    if (!dropdownOpen) return;
    const close = () => setDropdownOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [dropdownOpen]);

  const handleDisconnect = async () => {
    closeDropdown();
    try {
      if (walletType === "loop") {
        const { logoutLoop } = await import("@/lib/loop-client");
        await logoutLoop();
      } else if (walletType === "console") {
        const { disconnectConsoleWallet } =
          await import("@/lib/console-wallet");
        await disconnectConsoleWallet();
      }
    } catch {
      /* silent */
    }
    disconnect();
  };

  const shortId = partyId
    ? `${partyId.slice(0, 6)}...${partyId.slice(-4)}`
    : null;

  return (
    <>
      <nav className="fixed top-0 inset-x-0 h-16" style={{ zIndex: 400 }}>
        {/* Glass background — isolated so it doesn't trap dropdown stacking context */}
        <div className="absolute inset-0 bg-[#080811]/80 backdrop-blur-2xl border-b border-white/[0.05]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <span
              className="text-[22px] font-bold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              Punt
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
                  pathname === href
                    ? "text-white"
                    : "text-white/40 hover:text-white/70"
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
                {/* Balance chip — visible on all screen sizes */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#28cc95]/10 border border-[#28cc95]/20"
                >
                  <Bitcoin className="w-3.5 h-3.5 text-[#28cc95] shrink-0" />
                  <span
                    className="text-[#5dd9ab] text-sm font-medium tabular-nums"
                    style={{ fontFamily: "var(--font-space-mono)" }}
                  >
                    {fmt(appBalance)}
                  </span>
                  <span className="text-[#28cc95]/60 text-xs hidden sm:inline">CBTC</span>
                </motion.div>

                {/* Deposit */}
                <button
                  onClick={() => setDepositOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-white/[0.08] hover:border-[#28cc95]/30 bg-white/[0.03] hover:bg-[#28cc95]/[0.06] text-white/50 hover:text-[#5dd9ab] text-sm font-medium transition-all duration-200"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Deposit
                </button>

                {/* Wallet trigger */}
                <button
                  ref={triggerRef}
                  onClick={() =>
                    dropdownOpen ? closeDropdown() : openDropdown()
                  }
                  className="flex items-center gap-2 h-9 pl-2.5 pr-2 rounded-xl border border-white/[0.08] hover:border-white/[0.14] bg-white/[0.03] hover:bg-white/[0.05] transition-all duration-200"
                >
                  <div
                    className={clsx(
                      "w-5 h-5 rounded-md flex items-center justify-center",
                      walletType === "loop"
                        ? "bg-[#28cc95]/20"
                        : "bg-violet-500/20"
                    )}
                  >
                    <Wallet
                      className={clsx(
                        "w-3 h-3",
                        walletType === "loop"
                          ? "text-[#28cc95]"
                          : "text-violet-400"
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
              </>
            ) : (
              <button
                onClick={handleConnectLoop}
                disabled={connecting || verifyOpen}
                className="relative group h-9 px-4 rounded-xl text-sm font-semibold text-black transition-all duration-300 overflow-hidden disabled:opacity-60"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#28cc95] to-[#1fa876] group-hover:from-[#28cc95] group-hover:to-[#28cc95] transition-all duration-300" />
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ boxShadow: "0 0 20px rgba(40,204,149,0.4)" }}
                />
                <span className="relative flex items-center gap-1.5 text-black">
                  {connecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                  ) : (
                    <Wallet className="w-3.5 h-3.5 text-black" />
                  )}
                  {connecting ? "Connecting…" : "Connect Wallet"}
                </span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Dropdown — rendered OUTSIDE nav so backdrop-blur stacking context can't trap it */}
      {dropdownOpen && dropdownPos && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 998 }}
            onClick={closeDropdown}
          />
          {/* Dropdown panel */}
          <div
            className="fixed w-56 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
            style={{
              top: dropdownPos.top,
              right: dropdownPos.right,
              zIndex: 999,
              background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)",
              border: "1px solid rgba(255,255,255,0.10)"
            }}
          >
            <div className="h-px bg-gradient-to-r from-transparent via-[#28cc95]/40 to-transparent" />
            <div className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
              <p className="text-white/30 text-[11px] uppercase tracking-widest font-medium">
                Connected via
              </p>
              <p
                className="text-white/80 text-sm font-semibold mt-0.5 capitalize"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                {walletType} Wallet
              </p>
              <p
                className="text-white/25 text-[11px] mt-1 truncate"
                style={{ fontFamily: "var(--font-space-mono)" }}
              >
                {partyId?.slice(0, 22)}...
              </p>
            </div>
            {/*  <div className="p-1.5">
              <button
                onClick={() => { setDepositOpen(true); closeDropdown(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-white/50 hover:text-white text-sm font-medium transition-colors"
              >
                <ArrowDownToLine className="w-4 h-4" />
                Deposit CBTC
              </button>
              <Link
                href="/portfolio"
                onClick={closeDropdown}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-white/50 hover:text-white text-sm font-medium transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                Portfolio
              </Link>
            </div> */}
            <div className="p-1.5 border-t border-white/[0.05]">
              <button
                onClick={handleDisconnect}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/[0.08] text-white/30 hover:text-red-400 text-sm font-medium transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <VerifyIdentityModal open={verifyOpen} onSign={handleSign} onCancel={handleVerifyCancel} />
    </>
  );
}
