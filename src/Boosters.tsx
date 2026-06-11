// src/Boosters.tsx
// $DUEL Pack storefront — buy 5-card NFT packs paid in $DUEL tokens.
//
// Flow:
//   1. Connect wallet (Phantom / Solflare / Backpack / Jupiter).
//   2. Click BUY PACK → server returns an unsigned SPL token transfer tx
//      (100,000 $DUEL → treasury ATA).
//   3. Wallet signs + broadcasts. Page POSTs the signature back; server
//      verifies the transfer landed, rolls 5 random cards, mints each as
//      a Metaplex Core NFT to the buyer's wallet, persists the pack row.
//   4. Page renders the 5 reveal cards and updates the player's owned list.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Connection, Transaction } from '@solana/web3.js';
import { CARDS, COLOR_META, isMonster, isSpell, isTrap, type CardDef } from './cards';
import { getProfileApi } from './profiles';
import {
  detectSolanaWallets, getSolanaWallet, type SolanaWalletKind,
} from './wallet';
import {
  getDuelPackSupply, buildDuelPackBuyIntent, confirmDuelPackPayment, getOwnedDuelPacks,
  type DuelPackSupply, type DuelPackRow, type DuelPackMintResult,
} from './duel-packs-api';
import { CardHover } from './CardPreview';

// Client-side RPC pool for the buyer's sendRawTransaction.
const CLIENT_RPC_POOL: string[] = [
  'https://solana-rpc.publicnode.com',
  'https://solana-mainnet.public.blastapi.io',
  'https://solana.drpc.org',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
];

async function broadcastWithFailover(rawTx: Uint8Array): Promise<{ sig: string; conn: Connection }> {
  const errors: string[] = [];
  for (const url of CLIENT_RPC_POOL) {
    try {
      const c = new Connection(url, 'confirmed');
      const sig = await c.sendRawTransaction(rawTx, { skipPreflight: false, maxRetries: 3 });
      return { sig, conn: c };
    } catch (e: any) {
      errors.push(`${url.replace(/^https?:\/\//, '')}: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }
  for (const url of CLIENT_RPC_POOL) {
    try {
      const c = new Connection(url, 'confirmed');
      const sig = await c.sendRawTransaction(rawTx, { skipPreflight: true, maxRetries: 3 });
      return { sig, conn: c };
    } catch (e: any) {
      errors.push(`${url.replace(/^https?:\/\//, '')} (np): ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }
  throw new Error(`Broadcast failed:\n${errors.join('\n')}`);
}

async function confirmSig(sig: string, blockhash: string, lastValidBlockHeight: number): Promise<void> {
  for (const url of CLIENT_RPC_POOL) {
    try {
      const c = new Connection(url, 'confirmed');
      await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return;
    } catch { /* try next */ }
  }
  // Best-effort: don't throw — the server will retry verification.
}

// ── UI ──────────────────────────────────────────────────────────────────────

const TOKENS = {
  bg:        '#06061a',
  card:      '#0c0c1e',
  border:    '#1f1f3a',
  gold:      '#facc15',
  goldDim:   '#8a6a16',
  purple:    '#9945ff',
  text:      '#e9eef7',
  muted:     '#7d8aa3',
  good:      '#4ade80',
  danger:    '#ff5d73',
};

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function BoostersPage({ myName, onBack }: { myName: string; onBack: () => void }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [supply, setSupply] = useState<DuelPackSupply | null>(null);
  const [supplyErr, setSupplyErr] = useState<string | null>(null);
  const [packs, setPacks] = useState<DuelPackRow[]>([]);
  const [reveal, setReveal] = useState<{ cardIds: string[]; mints: DuelPackMintResult[] } | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'buy' | 'confirm'>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the wallet stored on the player's profile (set at login).
  useEffect(() => {
    (async () => {
      try {
        const p = await getProfileApi(myName);
        const addr = p?.walletAddress ?? null;
        // Only Solana addresses can pay in $DUEL.
        if (addr && !addr.startsWith('0x')) setWalletAddress(addr);
      } catch { /* leave null; user must connect inline */ }
    })();
  }, [myName]);

  // Load supply config from the server.
  useEffect(() => {
    (async () => {
      try { setSupply(await getDuelPackSupply()); }
      catch (e: any) { setSupplyErr(String(e?.message ?? e)); }
    })();
  }, []);

  // Load owned packs whenever the wallet changes.
  const reloadOwned = useCallback(async () => {
    if (!walletAddress) { setPacks([]); return; }
    try {
      const r = await getOwnedDuelPacks(walletAddress);
      setPacks(r.packs);
    } catch (e: any) {
      console.warn('[boosters] failed to load owned packs', e);
    }
  }, [walletAddress]);
  useEffect(() => { reloadOwned(); }, [reloadOwned]);

  async function connectWallet(kind: SolanaWalletKind) {
    setError(null); setBusy('connect');
    try {
      const w = await getSolanaWallet(kind);
      const addr = await w.connect();
      setWalletAddress(addr);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(null); }
  }

  async function buyPack() {
    if (!walletAddress) { setError('Connect a Solana wallet first.'); return; }
    if (!supply) { setError('Supply not loaded yet.'); return; }
    if (supply.mode !== 'live') {
      setError('Duel packs are in preview mode — the server still needs DUEL_TOKEN_MINT + a treasury keypair to go live.');
      return;
    }
    setError(null); setReveal(null); setBusy('buy');
    try {
      const intent = await buildDuelPackBuyIntent(walletAddress);
      // Get the wallet adapter to sign + broadcast.
      const detected = detectSolanaWallets().find(d => d.installed);
      if (!detected) throw new Error('No installed Solana wallet detected.');
      const w = await getSolanaWallet(detected.kind);
      // The wallet adapter expects a Transaction object (not bytes).
      const tx = Transaction.from(Buffer.from(intent.txBase64, 'base64'));
      // Some wallets prefer signTransaction; fall back to signAndSendTransaction.
      let sig: string;
      if (typeof (w as any).signTransaction === 'function') {
        const signed = await (w as any).signTransaction(tx);
        const raw = signed.serialize();
        const r = await broadcastWithFailover(raw);
        sig = r.sig;
        await confirmSig(sig, intent.blockhash, intent.lastValidBlockHeight);
      } else if (typeof (w as any).signAndSendTransaction === 'function') {
        const r = await (w as any).signAndSendTransaction(tx);
        sig = r?.signature ?? r;
        await confirmSig(sig, intent.blockhash, intent.lastValidBlockHeight);
      } else {
        throw new Error('Wallet does not support signTransaction or signAndSendTransaction.');
      }

      setBusy('confirm');
      const result = await confirmDuelPackPayment(walletAddress, sig);
      setReveal({ cardIds: result.pack.cardIds, mints: result.mints });
      reloadOwned();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(null); }
  }

  return (
    <div style={{
      minHeight: '100vh', background: TOKENS.bg, color: TOKENS.text,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 20px',
        background: 'linear-gradient(180deg, rgba(6,6,26,0.95), rgba(6,6,26,0.7))',
        backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${TOKENS.border}`,
      }}>
        <button onClick={onBack}
          style={{
            background: 'transparent', color: TOKENS.text,
            border: `1px solid ${TOKENS.border}`, borderRadius: 8,
            padding: '6px 12px', cursor: 'pointer', fontWeight: 600,
          }}>← Back</button>
        <div style={{
          fontFamily: '"Cinzel", serif', fontSize: 18, fontWeight: 800, letterSpacing: 4,
          background: 'linear-gradient(180deg, #ffe28a 0%, #d4af37 55%, #8a6a16 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>$DUEL PACK STORE</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: TOKENS.muted }}>
          Signed in as <b style={{ color: TOKENS.text }}>{myName}</b>
        </div>
      </div>

      <div style={{
        maxWidth: 1080, margin: '0 auto',
        padding: '24px 20px 80px',
        display: 'grid', gap: 22,
        gridTemplateColumns: '1fr',
      }}>
        {/* Pack offer card */}
        <PackOfferCard
          supply={supply} supplyErr={supplyErr}
          walletAddress={walletAddress}
          onConnect={connectWallet}
          onBuy={buyPack}
          busy={busy}
          error={error}
        />

        {/* Reveal */}
        {reveal && <PackRevealStrip mints={reveal.mints} cardIds={reveal.cardIds} />}

        {/* Owned packs history */}
        <OwnedPacksList packs={packs} />
      </div>
    </div>
  );
}

// ── Pack offer ─────────────────────────────────────────────────────────────

function PackOfferCard({
  supply, supplyErr, walletAddress, onConnect, onBuy, busy, error,
}: {
  supply: DuelPackSupply | null;
  supplyErr: string | null;
  walletAddress: string | null;
  onConnect: (k: SolanaWalletKind) => void;
  onBuy: () => void;
  busy: null | 'connect' | 'buy' | 'confirm';
  error: string | null;
}) {
  const preview = supply?.mode === 'preview';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${TOKENS.card}, rgba(108,75,216,0.15))`,
      border: `1px solid ${TOKENS.gold}55`,
      borderRadius: 18, padding: 28,
      display: 'grid', gap: 22,
      gridTemplateColumns: 'minmax(200px, 320px) 1fr',
      alignItems: 'center',
      boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 60px ${TOKENS.gold}11`,
    }} className="pack-offer">
      <style>{`
        @media (max-width: 720px) {
          .pack-offer { grid-template-columns: 1fr !important; }
        }
        @keyframes packPulse {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-6px) rotate(-3deg); }
        }
      `}</style>

      {/* Pack art — actual Chain Duels booster art */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: 240, maxWidth: '100%',
          aspectRatio: '1294 / 1216',
          borderRadius: 14,
          boxShadow: `0 0 40px ${TOKENS.gold}55, 0 14px 38px rgba(0,0,0,0.7)`,
          position: 'relative', overflow: 'hidden',
          animation: 'packPulse 3.4s ease-in-out infinite',
          background: '#0a061d',
        }}>
          <img
            src="/pack-art.png"
            alt="Chain Duels booster pack"
            draggable={false}
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center',
              display: 'block', userSelect: 'none',
            }}
          />
          {/* Soft top-edge highlight to sell the foil sheen */}
          <div aria-hidden style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(circle at 32% 14%, rgba(255,255,255,0.22), transparent 55%)',
          }} />
        </div>
      </div>

      {/* Description + buy */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          fontSize: 11, color: TOKENS.gold, letterSpacing: 4, fontWeight: 800,
        }}>★ FEATURED PACK</div>
        <div style={{
          fontFamily: '"Cinzel", serif', fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: 1,
        }}>Chain Duels Genesis Pack</div>
        <div style={{ color: TOKENS.muted, fontSize: 13, lineHeight: 1.55 }}>
          Open 5 random cards from the entire catalogue — each minted directly to
          your Solana wallet as a Metaplex Core NFT. Common, Uncommon, Rare or
          Mythic — at least one Uncommon-or-better is guaranteed per pack.
        </div>

        {/* Price */}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6,
        }}>
          <div style={{
            fontSize: 36, fontWeight: 900, color: TOKENS.gold,
            textShadow: `0 0 18px ${TOKENS.gold}55`,
          }}>{supply ? fmtNumber(supply.priceUi) : '—'}</div>
          <div style={{
            fontSize: 14, fontWeight: 800, color: TOKENS.gold, letterSpacing: 2,
          }}>$DUEL</div>
        </div>

        {supplyErr && (
          <div style={{ color: TOKENS.danger, fontSize: 12 }}>{supplyErr}</div>
        )}
        {preview && (
          <div style={{
            padding: 10, background: 'rgba(250,204,21,0.1)', border: `1px solid ${TOKENS.gold}55`,
            borderRadius: 8, fontSize: 12, color: TOKENS.gold, lineHeight: 1.5,
          }}>
            <b>Preview mode.</b> The server still needs <code>DUEL_TOKEN_MINT</code>{' '}
            and a treasury keypair (<code>BOOSTER_TREASURY_KEYPAIR</code>) before
            packs can be bought on-chain.
          </div>
        )}
        {error && (
          <div style={{
            padding: 10, background: 'rgba(255,93,115,0.12)', border: `1px solid ${TOKENS.danger}55`,
            borderRadius: 8, fontSize: 12, color: '#ffb8c0', lineHeight: 1.5,
          }}>{error}</div>
        )}

        {/* Wallet + buy buttons */}
        {!walletAddress ? (
          <div>
            <div style={{ fontSize: 12, color: TOKENS.muted, marginBottom: 6 }}>
              Connect a Solana wallet to pay in $DUEL:
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['phantom', 'solflare', 'backpack', 'jupiter'] as SolanaWalletKind[]).map(k => {
                const detected = detectSolanaWallets().find(d => d.kind === k)?.installed;
                return (
                  <button key={k}
                    onClick={() => onConnect(k)}
                    disabled={!detected || busy === 'connect'}
                    style={{
                      padding: '8px 14px', borderRadius: 8, cursor: detected ? 'pointer' : 'not-allowed',
                      background: detected ? `linear-gradient(135deg, ${TOKENS.purple}, #4a1d8a)` : '#1a1a2e',
                      color: '#fff', border: 'none', fontWeight: 700, fontSize: 12,
                      textTransform: 'capitalize', letterSpacing: 1,
                      opacity: detected ? 1 : 0.5,
                    }}>{k}{!detected && ' (install)'}</button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              fontSize: 11, color: TOKENS.good, letterSpacing: 1, fontWeight: 700,
              background: 'rgba(74,222,128,0.1)', padding: '4px 10px', borderRadius: 999,
              border: `1px solid ${TOKENS.good}55`,
            }}>● {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}</div>
            <button
              onClick={onBuy}
              disabled={busy != null || preview}
              style={{
                padding: '12px 24px', borderRadius: 10, border: 'none',
                background: (busy != null || preview)
                  ? 'rgba(212,175,55,0.25)'
                  : 'linear-gradient(135deg, #D4AF37 0%, #F6D365 100%)',
                color: (busy != null || preview) ? '#7a7060' : '#050514',
                fontFamily: '"Cinzel", serif', fontWeight: 800, letterSpacing: 3,
                fontSize: 14, cursor: (busy != null || preview) ? 'not-allowed' : 'pointer',
                boxShadow: !(busy != null || preview) ? `0 0 24px ${TOKENS.gold}66, 0 8px 22px rgba(0,0,0,0.5)` : 'none',
              }}>
              {busy === 'buy' ? 'AWAITING SIGNATURE…' : busy === 'confirm' ? 'MINTING CARDS…' : '⚡ BUY PACK'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reveal ─────────────────────────────────────────────────────────────────

function PackRevealStrip({ mints, cardIds }: { mints: DuelPackMintResult[]; cardIds: string[] }) {
  return (
    <div style={{
      background: `radial-gradient(circle at 50% 0%, ${TOKENS.gold}22, transparent 60%), ${TOKENS.card}`,
      border: `1px solid ${TOKENS.gold}55`,
      borderRadius: 14, padding: 18,
      display: 'flex', flexDirection: 'column', gap: 12,
      boxShadow: `0 0 32px ${TOKENS.gold}22`,
    }}>
      <div style={{
        fontFamily: '"Cinzel", serif', fontSize: 14, color: TOKENS.gold,
        letterSpacing: 4, fontWeight: 800,
      }}>✨ YOUR PULL ✨</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
      }}>
        {cardIds.map((id, i) => {
          const def = CARDS[id];
          const mint = mints[i];
          if (!def) return null;
          return (
            <RevealCardTile key={i} def={def} mintAddress={mint?.mintAddress ?? ''} />
          );
        })}
      </div>
    </div>
  );
}

function RevealCardTile({ def, mintAddress }: { def: CardDef; mintAddress: string }) {
  const meta = COLOR_META[def.color];
  return (
    <CardHover defId={def.id}>
      <div style={{
        background: meta.hex, color: meta.ink,
        border: `1px solid ${TOKENS.gold}`,
        borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 0 18px ${meta.hex}88, 0 6px 18px rgba(0,0,0,0.6)`,
        cursor: 'help',
      }}>
        <div style={{
          padding: '4px 8px', fontSize: 11, fontWeight: 800,
          background: 'rgba(0,0,0,0.3)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{def.name}</div>
        <div style={{
          aspectRatio: '1.4', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.15)',
        }}>
          {def.image ? (
            <img src={def.image} alt={def.name}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ fontSize: 32, fontWeight: 900 }}>{meta.glyph}</div>
          )}
        </div>
        <div style={{
          padding: '4px 8px', fontSize: 10, background: 'rgba(0,0,0,0.6)', color: '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{statBadge(def)}</span>
          {mintAddress ? (
            <a href={`https://explorer.solana.com/address/${mintAddress}`}
              target="_blank" rel="noopener" style={{ color: TOKENS.gold, textDecoration: 'none' }}>
              ↗ NFT
            </a>
          ) : (
            <span style={{ color: TOKENS.danger }}>mint failed</span>
          )}
        </div>
      </div>
    </CardHover>
  );
}

function statBadge(def: CardDef): string {
  if (isMonster(def)) {
    if (def.subtype === 'link') return `L${def.linkRating} · ${def.atk}`;
    if (def.subtype === 'xyz')  return `R${def.rank} · ${def.atk}/${def.def ?? 0}`;
    return `★${def.level ?? 0} · ${def.atk}/${def.def ?? 0}`;
  }
  if (isSpell(def)) return `Spell · ${def.subtype}`;
  if (isTrap(def))  return `Trap · ${def.subtype}`;
  return '';
}

// ── Owned packs history ────────────────────────────────────────────────────

function OwnedPacksList({ packs }: { packs: DuelPackRow[] }) {
  if (packs.length === 0) {
    return (
      <div style={{
        background: TOKENS.card, border: `1px dashed ${TOKENS.border}`,
        borderRadius: 14, padding: 24, textAlign: 'center', color: TOKENS.muted, fontSize: 13,
      }}>
        No packs purchased yet. Buy your first pack above to start your collection.
      </div>
    );
  }
  return (
    <div style={{
      background: TOKENS.card, border: `1px solid ${TOKENS.border}`,
      borderRadius: 14, padding: 18,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 3, color: TOKENS.muted, fontWeight: 800,
        marginBottom: 12, textTransform: 'uppercase',
      }}>Your packs ({packs.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {packs.slice().reverse().map(p => (
          <PackHistoryRow key={p.packId} pack={p} />
        ))}
      </div>
    </div>
  );
}

function PackHistoryRow({ pack }: { pack: DuelPackRow }) {
  const date = new Date(pack.mintedAt).toLocaleString();
  return (
    <div style={{
      padding: 12, background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${TOKENS.border}`, borderRadius: 10,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>
          Pack #{pack.packId}
        </div>
        <div style={{ fontSize: 11, color: TOKENS.muted }}>{date}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {pack.cardIds.map((id, i) => {
          const def = CARDS[id]; if (!def) return null;
          const meta = COLOR_META[def.color];
          const mint = pack.mintAddresses[i];
          return (
            <CardHover key={i} defId={id}>
              <div style={{
                padding: '4px 10px', borderRadius: 999,
                background: meta.hex, color: meta.ink,
                fontSize: 11, fontWeight: 700,
                border: `1px solid ${TOKENS.border}`,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                cursor: 'help',
              }}>
                <span>{def.name}</span>
                {mint && (
                  <a href={`https://explorer.solana.com/address/${mint}`}
                    target="_blank" rel="noopener"
                    onClick={e => e.stopPropagation()}
                    style={{ color: meta.ink, fontSize: 10, opacity: 0.7, textDecoration: 'none' }}>↗</a>
                )}
              </div>
            </CardHover>
          );
        })}
      </div>
    </div>
  );
}
