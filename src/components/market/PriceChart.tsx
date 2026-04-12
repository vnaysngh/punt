"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";

type Candle = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Props = {
  openAt: string;
  closeAt: string;
  startPrice: number;
};

async function fetchCandles(openAt: string, closeAt: string): Promise<Candle[]> {
  const startMs = new Date(openAt).getTime();
  // Always fetch up to now — but clamp to closeAt so we don't get post-round candles
  const endMs = Math.min(new Date(closeAt).getTime(), Date.now());

  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const raw: unknown[][] = await res.json();

  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000) as Time,
    open:  parseFloat(k[1] as string),
    high:  parseFloat(k[2] as string),
    low:   parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
  }));
}

export default function PriceChart({ openAt, closeAt, startPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Candlestick", Time, CandlestickData> | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // The full 15-min window in unix seconds
  const openSec  = Math.floor(new Date(openAt).getTime() / 1000);
  const closeSec = Math.floor(new Date(closeAt).getTime() / 1000);

  const load = useCallback(async () => {
    const candles = await fetchCandles(openAt, closeAt);
    if (!seriesRef.current || !chartRef.current || candles.length === 0) return;

    seriesRef.current.setData(candles);

    // Always pin the visible range to the full 15-min window so candles
    // spread evenly regardless of how many have formed so far
    chartRef.current.timeScale().setVisibleRange({
      from: openSec as Time,
      to:   closeSec as Time,
    });
  }, [openAt, closeAt, openSec, closeSec]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.25)",
        fontFamily: "'Space Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255,255,255,0.15)",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: "#12121f",
        },
        horzLine: {
          color: "rgba(255,255,255,0.15)",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: "#12121f",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        textColor: "rgba(255,255,255,0.3)",
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
        // Lock both edges so the view never auto-pans away from our range
        fixLeftEdge: true,
        fixRightEdge: true,
        // Don't auto-scroll to the last bar — we control the range ourselves
        lockVisibleTimeRangeOnResize: true,
      },
      // Disable user scaling so the 15-min window stays locked
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:         "#22c55e",
      downColor:       "#ef4444",
      borderUpColor:   "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor:     "#22c55e",
      wickDownColor:   "#ef4444",
    });

    // Orange dashed line at the market open price
    series.createPriceLine({
      price: startPrice,
      color: "rgba(249,115,22,0.65)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "open",
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    // Resize observer
    const ro = new ResizeObserver(() => {
      const chart = chartRef.current;
      const container = containerRef.current;
      if (!chart || !container) return;
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(containerRef.current);

    load();
    pollRef.current = setInterval(load, 15_000);

    return () => {
      ro.disconnect();
      if (pollRef.current) clearInterval(pollRef.current);
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPrice, openSec, closeSec]);

  // Re-run load when the callback updates (openAt/closeAt change)
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      className="w-full rounded-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 pulse-dot" />
          <span
            className="text-white/40 text-[11px] uppercase tracking-widest font-semibold"
            style={{ fontFamily: "var(--font-space-mono)" }}
          >
            BTC/USD · 1m candles · 15-min window
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className="w-5 h-px"
              style={{ background: "rgba(249,115,22,0.7)", borderTop: "1px dashed rgba(249,115,22,0.7)" }}
            />
            <span className="text-white/25 text-[10px]" style={{ fontFamily: "var(--font-space-mono)" }}>
              open ${startPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px] bg-green-500" />
            <span className="text-white/20 text-[10px]">up</span>
            <span className="inline-block w-2 h-2 rounded-[2px] bg-red-500 ml-1" />
            <span className="text-white/20 text-[10px]">down</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
