"use client";

/**
 * Browser-side Loop SDK singleton.
 * Exact same pattern as lastgwei/src/lib/loop-client.ts
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoopProvider = any;

type LoopInstance = typeof import("@fivenorth/loop-sdk")["loop"];

let _loop: LoopInstance | null = null;
let _initPromise: Promise<void> | null = null;

type AcceptCb = (provider: LoopProvider) => void;
type RejectCb = () => void;

let _pendingAccept: AcceptCb | null = null;
let _pendingReject: RejectCb | null = null;

export async function getLoop(): Promise<LoopInstance | null> {
  if (typeof window === "undefined") return null;

  if (_loop) return _loop;

  if (_initPromise) {
    await _initPromise;
    return _loop;
  }

  _initPromise = (async () => {
    const network = process.env.NEXT_PUBLIC_LOOP_NETWORK;
    if (!network || !["devnet", "mainnet", "local"].includes(network)) {
      throw new Error(
        `[loop-client] NEXT_PUBLIC_LOOP_NETWORK is "${network}" — must be "devnet", "mainnet", or "local". ` +
        `This variable is baked in at build time by Next.js. Set it in Railway BEFORE triggering a build.`
      );
    }
    const { loop } = await import("@fivenorth/loop-sdk");
    loop.init({
      appName: "Punt",
      network: network as "devnet" | "mainnet" | "local",
      onAccept: (provider) => {
        _pendingAccept?.(provider);
        _pendingAccept = null;
        _pendingReject = null;
      },
      onReject: () => {
        _pendingReject?.();
        _pendingAccept = null;
        _pendingReject = null;
      },
    });
    _loop = loop;
  })();

  await _initPromise;
  return _loop;
}

export async function connectLoop(): Promise<LoopProvider> {
  const loop = await getLoop();
  if (!loop) throw new Error("Loop SDK not available");

  return new Promise((resolve, reject) => {
    _pendingAccept = resolve;
    _pendingReject = () => reject(new Error("User rejected wallet connect"));
    loop.connect();
  });
}

export async function autoConnectLoop(): Promise<LoopProvider | null> {
  const loop = await getLoop();
  if (!loop) return null;

  return new Promise((resolve) => {
    _pendingAccept = resolve;
    _pendingReject = () => resolve(null);
    loop.autoConnect().catch(() => resolve(null));
  });
}

export async function logoutLoop(): Promise<void> {
  const loop = await getLoop();
  loop?.logout();
}
