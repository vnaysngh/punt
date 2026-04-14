// Loop SDK wrapper — uses @fivenorth/loop-sdk npm package
// https://www.npmjs.com/package/@fivenorth/loop-sdk

// Provider is not publicly re-exported by the SDK — define the shape we need locally
export type LoopProvider = {
  party_id: string;
  public_key: string;
  email?: string;
};

export async function getLoop() {
  if (typeof window === "undefined") return null;
  const { loop } = await import("@fivenorth/loop-sdk");
  return loop;
}
