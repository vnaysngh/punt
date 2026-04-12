// Loop SDK wrapper — uses @fivenorth/loop-sdk npm package
// https://www.npmjs.com/package/@fivenorth/loop-sdk

export type { Provider as LoopProvider } from "@fivenorth/loop-sdk";

export async function getLoop() {
  if (typeof window === "undefined") return null;
  const { loop } = await import("@fivenorth/loop-sdk");
  return loop;
}
