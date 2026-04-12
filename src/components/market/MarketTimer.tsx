"use client";

import { useEffect, useState } from "react";
import { differenceInSeconds } from "date-fns";
import clsx from "clsx";

type Props = { closeAt: string; onExpire?: () => void; size?: "sm" | "md" };

export default function MarketTimer({ closeAt, onExpire, size = "md" }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, differenceInSeconds(new Date(closeAt), new Date()));
      setSecondsLeft(diff);
      if (diff === 0) onExpire?.();
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [closeAt, onExpire]);

  const total = 15 * 60;
  const progress = Math.min(1, secondsLeft / total);
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const urgency = secondsLeft < 60 ? "critical" : secondsLeft < 180 ? "warning" : "normal";

  const r = size === "sm" ? 16 : 22;
  const stroke = size === "sm" ? 2.5 : 3;
  const viewBox = size === "sm" ? 40 : 52;
  const cx = viewBox / 2;
  const dashArray = 2 * Math.PI * r;
  const dashOffset = dashArray * (1 - progress);

  const color =
    urgency === "critical" ? "#ef4444" :
    urgency === "warning"  ? "#f59e0b" :
    "#f97316";

  return (
    <div className={clsx("flex items-center gap-2", size === "sm" && "gap-1.5")}>
      <div className="relative shrink-0" style={{ width: viewBox, height: viewBox }}>
        <svg width={viewBox} height={viewBox} viewBox={`0 0 ${viewBox} ${viewBox}`} className="-rotate-90">
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
          <circle
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s ease", filter: `drop-shadow(0 0 6px ${color}60)` }}
          />
        </svg>
        {/* Dot indicator */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: size === "sm" ? 4 : 6,
            height: size === "sm" ? 4 : 6,
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>
      <div>
        <div
          className={clsx("font-bold tabular-nums leading-none", size === "sm" ? "text-sm" : "text-base")}
          style={{ fontFamily: "var(--font-space-mono)", color }}
        >
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
        {size === "md" && (
          <div className="text-white/25 text-[10px] mt-0.5 uppercase tracking-wider">left</div>
        )}
      </div>
    </div>
  );
}
