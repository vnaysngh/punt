// Console Wallet DApp SDK wrapper
// Lazy-imported to avoid SSR issues (SDK uses window.postMessage internally)

async function getSdk() {
  if (typeof window === "undefined") throw new Error("Console Wallet is only available in the browser.");
  const { consoleWallet } = await import("@console-wallet/dapp-sdk");
  return consoleWallet;
}

export async function checkConsoleWalletAvailable(): Promise<boolean> {
  try {
    const sdk = await getSdk();
    // Use status() directly — avoids the cached checkExtensionAvailability bug
    await sdk.status();
    return true;
  } catch {
    return false;
  }
}

export async function connectConsoleWallet(): Promise<{ partyId: string } | null> {
  const sdk = await getSdk();

  // connect() sends a postMessage to the extension which opens the popup
  const result = await sdk.connect({ name: "BetCC", icon: "" });
  if (!result?.isConnected) return null;

  const accounts = await sdk.getAccounts();
  const account = accounts?.[0];
  if (!account?.partyId) return null;

  return { partyId: account.partyId };
}

export async function disconnectConsoleWallet(): Promise<void> {
  try {
    const sdk = await getSdk();
    await sdk.disconnect();
  } catch { /* silent */ }
}

export async function submitConsoleTransfer(params: {
  from: string;
  to: string;
  token: string;
  amount: number;
  expireDate: string;
  memo?: string;
}): Promise<string | null> {
  const sdk = await getSdk();
  const result = await sdk.submitCommands({
    from: params.from,
    to: params.to,
    token: params.token,
    amount: params.amount.toString(),
    expireDate: params.expireDate,
    memo: params.memo,
  });
  return result?.status ? "submitted" : null;
}
