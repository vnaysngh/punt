"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type WhitespaceData,
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
  const endMs   = Math.min(new Date(closeAt).getTime(), Date.now());

  // Use server-side proxy — avoids CSP blocking direct Binance calls from browser
  const res = await fetch(
    `/api/price/candles?startTime=${startMs}&endTime=${endMs}&limit=16`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export default function PriceChart({ openAt, closeAt, startPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Candlestick", Time, CandlestickData | WhitespaceData> | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const openSec  = Math.floor(new Date(openAt).getTime() / 1000);
  const closeSec = Math.floor(new Date(closeAt).getTime() / 1000);

  const load = useCallback(async () => {
    if (!seriesRef.current || !chartRef.current) return;

    const candles = await fetchCandles(openAt, closeAt);

    // Always seed a placeholder flat candle at startPrice for the opening minute
    // so the chart isn't blank while waiting for the first real candle to form.
    const openMinSec = openSec - (openSec % 60); // floor to minute boundary
    const placeholder: Candle = {
      time:  openMinSec as Time,
      open:  startPrice,
      high:  startPrice,
      low:   startPrice,
      close: startPrice,
    };

    // Merge: real candles override the placeholder if they exist for that time
    const candleMap = new Map<number, Candle>();
    candleMap.set(openMinSec, placeholder);
    for (const c of candles) {
      candleMap.set(c.time as number, c);
    }

    // Sort by time ascending — lightweight-charts requires it
    const merged = Array.from(candleMap.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );

    seriesRef.current.setData(merged);

    // Always show the full 15-min window regardless of how many candles are loaded.
    // This prevents a single candle at round start from ballooning to fill the chart.
    // We pad `to` by 60s so the last candle isn't flush against the right edge.
    chartRef.current.timeScale().setVisibleRange({
      from: openSec           as Time,
      to:   (closeSec + 60)   as Time,
    });
  }, [openAt, closeAt, openSec, closeSec, startPrice]);

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
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        barSpacing: 40, // fixed px per candle — prevents giant single-candle on round start
        minBarSpacing: 4,
      },
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

    const ro = new ResizeObserver(() => {
      chartRef.current?.applyOptions({ width: containerRef.current?.clientWidth ?? 0 });
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

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      className="w-full rounded-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
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

      <div ref={containerRef} className="w-full" />
    </div>
  );
}
