// src/duel-packs-api.ts
// HTTP client for the $DUEL-paid 5-card pack mint flow.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error ?? ''; } catch { /* noop */ }
    throw new Error(`${path}: ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  }
  return res.json() as Promise<T>;
}

export type DuelPackSupply = {
  priceUi: number;
  priceBase: string;       // BigInt as string
  decimals: number;
  packSize: number;
  treasury: string | null;
  tokenMint: string | null;
  mode: 'live' | 'preview';
};

export async function getDuelPackSupply(): Promise<DuelPackSupply> {
  return http<DuelPackSupply>('/api/duel-packs/supply');
}

export type DuelPackBuyIntent = {
  ok: true;
  txBase64: string;
  treasury: string;
  tokenMint: string;
  amountBase: string;
  decimals: number;
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function buildDuelPackBuyIntent(wallet: string): Promise<DuelPackBuyIntent> {
  return http<DuelPackBuyIntent>('/api/duel-packs/buy-intent', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  });
}

export type DuelPackRow = {
  packId: number;
  buyerWallet: string;
  paymentSig: string;
  pricePaid: string;
  cardIds: string[];
  mintAddresses: string[];
  mintedAt: number;
};

export type DuelPackMintResult = {
  cardId: string;
  mintAddress: string;
  signature: string;
};

export async function confirmDuelPackPayment(
  wallet: string, signature: string,
): Promise<{ ok: true; pack: DuelPackRow; mints: DuelPackMintResult[] }> {
  return http('/api/duel-packs/confirm', {
    method: 'POST',
    body: JSON.stringify({ wallet, signature }),
  });
}

export async function getOwnedDuelPacks(wallet: string): Promise<{
  wallet: string; packs: DuelPackRow[]; counts: Record<string, number>;
}> {
  return http(`/api/duel-packs/owned/${encodeURIComponent(wallet)}`);
}

/** Build the public metadata URL for a card NFT (handy for previews + tx prep). */
export function cardMetadataUrl(cardId: string): string {
  return `${API_BASE}/api/cards/${encodeURIComponent(cardId)}/metadata`;
}
