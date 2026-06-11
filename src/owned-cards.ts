// src/owned-cards.ts
// Client-side helper: load the set of card defIds a player has minted into
// their wallet via $DUEL pack purchases. Used by DeckbuilderPanel to gate
// which cards the player can put in a custom deck.

import { useEffect, useState, useCallback } from 'react';
import { getOwnedDuelPacks } from './duel-packs-api';

export type OwnedCards = {
  /** Total NFTs minted per card defId. */
  counts: Record<string, number>;
  /** Most recent pack purchases (for UI showcase). */
  packs: Array<{ packId: number; cardIds: string[]; mintedAt: number; mintAddresses: string[] }>;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * React hook: fetches the player's owned cards (from $DUEL packs) by wallet.
 * Returns counts so the deckbuilder can clamp copies to what they actually own.
 *
 * If `walletAddress` is null/empty, returns the empty "no cards" state.
 */
export function useOwnedCards(walletAddress: string | null | undefined): OwnedCards {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [packs, setPacks]   = useState<OwnedCards['packs']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) { setCounts({}); setPacks([]); return; }
    setLoading(true); setError(null);
    try {
      const r = await getOwnedDuelPacks(walletAddress);
      setCounts(r.counts ?? {});
      setPacks((r.packs ?? []).map(p => ({
        packId: p.packId, cardIds: p.cardIds, mintedAt: p.mintedAt, mintAddresses: p.mintAddresses,
      })));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setLoading(false); }
  }, [walletAddress]);

  useEffect(() => { load(); }, [load]);

  return { counts, packs, loading, error, reload: load };
}

/** Sum of all owned card copies across the catalog (i.e. total NFTs). */
export function totalOwnedCount(counts: Record<string, number>): number {
  let n = 0;
  for (const k of Object.keys(counts)) n += counts[k] ?? 0;
  return n;
}
