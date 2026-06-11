// src/duel-pack-mint.ts
// Server-side helpers for the $DUEL-paid 5-card pack mint flow.
//
// Flow (mirrors the Booster Pack ticket flow in booster-mint.ts, but for SPL
// token payments and per-card NFT minting):
//
//   1. POST /api/duel-packs/buy-intent   → server returns an unsigned tx
//       (createATAIfNeeded + spl-token transferChecked from buyer ATA →
//       treasury ATA for DUEL_PACK_PRICE × 10^DUEL_TOKEN_DECIMALS base units).
//   2. Client signs + broadcasts, then POST /api/duel-packs/confirm with the
//       signature. Server verifies the SPL token transfer landed (pre/post
//       balance delta on treasury's $DUEL ATA), then rolls 5 random cards
//       from the catalog and mints each as a Metaplex Core NFT to the buyer.
//
// The treasury keypair (BOOSTER_TREASURY_KEYPAIR — reused from booster-mint.ts)
// is the recipient of all $DUEL payments AND the mint authority for the
// resulting card NFTs. It pays the ~0.0015 SOL rent per NFT out of its
// own SOL balance.
//
// Required env to enable LIVE mode:
//   BOOSTER_TREASURY_KEYPAIR | CUSTODIAL_ESCROW_KEYPAIR  base58 [u8] JSON
//   DUEL_TOKEN_MINT          base58 SPL token mint of the $DUEL token
//
// Optional env:
//   DUEL_TOKEN_DECIMALS      defaults to 6
//   DUEL_PACK_PRICE          defaults to 100000 ($DUEL whole units, not lamports)
//   DUEL_PACK_SIZE           defaults to 5 (cards per pack)
//   DUEL_METADATA_BASE       defaults to public path /api/cards
//   VITE_SOLANA_RPC / SOLANA_RPC / HELIUS_API_KEY  RPC endpoint

import {
  Connection, Keypair, PublicKey, Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  generateSigner, keypairIdentity, publicKey as umiPublicKey,
} from '@metaplex-foundation/umi';
import { create, mplCore } from '@metaplex-foundation/mpl-core';
import { CARDS } from './cards';
import type { CardDef } from './cards';
import { isMonster } from './cards';

// ── Config ─────────────────────────────────────────────────────────────────

export const DUEL_TOKEN_DECIMALS = Number(process.env.DUEL_TOKEN_DECIMALS ?? 6);
export const DUEL_PACK_PRICE_UI = Number(process.env.DUEL_PACK_PRICE ?? 100_000);
/** Price in raw base units (price × 10^decimals). Use BigInt to avoid float drift. */
export const DUEL_PACK_PRICE_BASE = BigInt(DUEL_PACK_PRICE_UI) * (10n ** BigInt(DUEL_TOKEN_DECIMALS));
export const DUEL_PACK_SIZE = Number(process.env.DUEL_PACK_SIZE ?? 5);

const RPC_URL =
  process.env.VITE_SOLANA_RPC ||
  process.env.SOLANA_RPC ||
  (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : '') ||
  'https://solana-rpc.publicnode.com';

const RPC_POOL: string[] = Array.from(new Set([
  'https://solana-rpc.publicnode.com',
  'https://solana-mainnet.public.blastapi.io',
  'https://solana.drpc.org',
  'https://api.mainnet-beta.solana.com',
  RPC_URL,
]));

function conn(): Connection {
  return new Connection(RPC_POOL[0], 'confirmed');
}

// ── Treasury keypair (shared with booster-mint.ts) ─────────────────────────

let _treasury: Keypair | null | undefined;
export function duelTreasury(): Keypair | null {
  if (_treasury !== undefined) return _treasury;
  const raw = process.env.BOOSTER_TREASURY_KEYPAIR
    ?? process.env.CUSTODIAL_ESCROW_KEYPAIR;
  if (!raw) { _treasury = null; return null; }
  try {
    _treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    return _treasury;
  } catch {
    _treasury = null;
    return null;
  }
}

let _tokenMint: PublicKey | null | undefined;
export function duelTokenMint(): PublicKey | null {
  if (_tokenMint !== undefined) return _tokenMint;
  const m = process.env.DUEL_TOKEN_MINT;
  if (!m) { _tokenMint = null; return null; }
  try { _tokenMint = new PublicKey(m); return _tokenMint; }
  catch { _tokenMint = null; return null; }
}

export function duelPackEnabled(): boolean {
  return duelTreasury() !== null && duelTokenMint() !== null;
}

export function duelTreasuryPubkey(): string | null {
  const k = duelTreasury();
  return k ? k.publicKey.toBase58() : null;
}

export function duelTokenMintBase58(): string | null {
  const m = duelTokenMint();
  return m ? m.toBase58() : null;
}

// ── Step 1: build an unsigned SPL token payment transaction ─────────────────

export async function buildPackPaymentTx(buyerAddress: string): Promise<{
  txBase64: string;
  treasury: string;
  tokenMint: string;
  amountBase: string;     // BigInt as string for JSON
  decimals: number;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const t = duelTreasury();
  const mint = duelTokenMint();
  if (!t || !mint) throw new Error('Duel pack mint is not configured (need BOOSTER_TREASURY_KEYPAIR + DUEL_TOKEN_MINT)');

  const buyer = new PublicKey(buyerAddress);
  const buyerAta    = getAssociatedTokenAddressSync(mint, buyer);
  const treasuryAta = getAssociatedTokenAddressSync(mint, t.publicKey);

  const tx = new Transaction();
  tx.feePayer = buyer;

  // Create the treasury's ATA if it doesn't exist yet (buyer pays the rent
  // for that one-time setup; subsequent buyers won't pay this again).
  const c = conn();
  const treasuryAccountInfo = await c.getAccountInfo(treasuryAta);
  if (!treasuryAccountInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      buyer,                     // payer
      treasuryAta,               // ata
      t.publicKey,               // owner
      mint,                      // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  }

  tx.add(createTransferCheckedInstruction(
    buyerAta,
    mint,
    treasuryAta,
    buyer,
    DUEL_PACK_PRICE_BASE,
    DUEL_TOKEN_DECIMALS,
    [],
    TOKEN_PROGRAM_ID,
  ));

  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  return {
    txBase64: raw.toString('base64'),
    treasury: t.publicKey.toBase58(),
    tokenMint: mint.toBase58(),
    amountBase: DUEL_PACK_PRICE_BASE.toString(),
    decimals: DUEL_TOKEN_DECIMALS,
    blockhash,
    lastValidBlockHeight,
  };
}

// ── Step 2: verify the payment landed ──────────────────────────────────────

export type VerifiedPackPayment = {
  buyer: string;
  signature: string;
  amountBase: bigint;
  slot: number;
};

export async function verifyPackPayment(
  signature: string, claimedBuyer: string,
): Promise<VerifiedPackPayment> {
  const t = duelTreasury();
  const mint = duelTokenMint();
  if (!t || !mint) throw new Error('Duel pack mint is not configured');

  const treasuryAta = getAssociatedTokenAddressSync(mint, t.publicKey);
  const c = conn();

  // Wait up to 60s for the tx to finalize.
  const deadline = Date.now() + 60_000;
  let tx: any = null;
  while (Date.now() < deadline) {
    tx = await c.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!tx) throw new Error('tx not found on-chain (or timed out)');
  if (tx.meta?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(tx.meta.err)}`);

  // Walk SPL token pre/post balances to find the treasury ATA delta.
  const preBalances = tx.meta?.preTokenBalances ?? [];
  const postBalances = tx.meta?.postTokenBalances ?? [];
  const accountKeys: PublicKey[] = (tx.transaction.message.staticAccountKeys
    ?? tx.transaction.message.accountKeys
    ?? []).map((k: any) => (k instanceof PublicKey ? k : new PublicKey(k)));

  const mintBase58 = mint.toBase58();
  const treasuryBase58 = t.publicKey.toBase58();
  function balanceOf(list: any[]): bigint {
    for (const b of list) {
      const owner: string | undefined = b.owner;
      const acctKey = accountKeys[b.accountIndex];
      if (!acctKey) continue;
      if (acctKey.equals(treasuryAta) && b.mint === mintBase58 && owner === treasuryBase58) {
        return BigInt(b.uiTokenAmount?.amount ?? '0');
      }
    }
    return 0n;
  }
  const pre  = balanceOf(preBalances);
  const post = balanceOf(postBalances);
  const delta = post - pre;
  if (delta < DUEL_PACK_PRICE_BASE) {
    throw new Error(`underpaid: treasury received ${delta.toString()} base units, need ${DUEL_PACK_PRICE_BASE.toString()}`);
  }

  // Fee payer must be the claimed buyer.
  const buyerPk = new PublicKey(claimedBuyer);
  const feePayer = accountKeys[0];
  if (!feePayer || !feePayer.equals(buyerPk)) {
    throw new Error(`fee payer mismatch: claimed ${claimedBuyer}, actual ${feePayer?.toBase58()}`);
  }

  return {
    buyer: claimedBuyer,
    signature,
    amountBase: delta,
    slot: tx.slot ?? 0,
  };
}

// ── Step 3: roll 5 random cards from the catalog ───────────────────────────

/**
 * Pick `DUEL_PACK_SIZE` random card ids from the catalog, weighted by
 * (rough) rarity tiers derived from card type / level:
 *   - common   = monsters L1–3, all spells/traps (weight 60)
 *   - uncommon = monsters L4         (weight 30)
 *   - rare     = monsters L5–6       (weight 8)
 *   - mythic   = monsters L7+ or Extra Deck (weight 2)
 *
 * Returns 5 ids with at least one "uncommon-or-better" guaranteed to make
 * packs feel less swingy.
 */
export function rollPackCards(): string[] {
  const ids = Object.keys(CARDS);
  const common:   string[] = [];
  const uncommon: string[] = [];
  const rare:     string[] = [];
  const mythic:   string[] = [];
  for (const id of ids) {
    const c = CARDS[id]; if (!c) continue;
    const tier = rarityOf(c);
    if (tier === 'common')   common.push(id);
    else if (tier === 'uncommon') uncommon.push(id);
    else if (tier === 'rare') rare.push(id);
    else                     mythic.push(id);
  }
  function pickOne<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
  function pickWeighted(): string {
    const roll = Math.random() * 100;
    if (roll < 60 && common.length)   return pickOne(common);
    if (roll < 90 && uncommon.length) return pickOne(uncommon);
    if (roll < 98 && rare.length)     return pickOne(rare);
    if (mythic.length)                return pickOne(mythic);
    // Cascading fallbacks if a tier is empty.
    if (rare.length)     return pickOne(rare);
    if (uncommon.length) return pickOne(uncommon);
    return pickOne(common.length ? common : ids);
  }

  const out: string[] = [];
  for (let i = 0; i < DUEL_PACK_SIZE - 1; i++) out.push(pickWeighted());
  // Guarantee at least one uncommon-or-better. Reroll the last slot until it
  // qualifies (max a few tries to keep it bounded).
  for (let tries = 0; tries < 6; tries++) {
    const last = pickWeighted();
    if (rarityOf(CARDS[last]!) !== 'common') { out.push(last); return out; }
  }
  out.push(uncommon[0] ?? common[0] ?? ids[0]!);
  return out;
}

export function rarityOf(c: CardDef): 'common' | 'uncommon' | 'rare' | 'mythic' {
  if (isMonster(c)) {
    if (c.subtype === 'fusion' || c.subtype === 'synchro' || c.subtype === 'xyz' || c.subtype === 'link') return 'mythic';
    const lvl = c.level ?? 0;
    if (lvl >= 7) return 'mythic';
    if (lvl >= 5) return 'rare';
    if (lvl >= 4) return 'uncommon';
    return 'common';
  }
  return 'common';
}

// ── Step 4: mint card NFTs to the buyer ────────────────────────────────────

export type MintedPackCard = {
  cardId: string;
  mintAddress: string;
  signature: string;
};

/**
 * Mint each card in `cardIds` as a Metaplex Core asset to `ownerAddress`.
 * Returns one MintedPackCard per input id. On per-card failure, the error
 * is recorded as `mintAddress = ''` and the caller decides how to surface
 * partial pulls (we still record what succeeded so the user isn't charged
 * for an all-or-nothing wipe).
 */
export async function mintPackCards(
  ownerAddress: string, cardIds: string[], metadataBaseUrl: string,
): Promise<MintedPackCard[]> {
  const t = duelTreasury();
  if (!t) throw new Error('Treasury keypair not configured');
  const u = createUmi(RPC_POOL[0]).use(mplCore());
  const kp = u.eddsa.createKeypairFromSecretKey(t.secretKey);
  u.use(keypairIdentity(kp));

  const out: MintedPackCard[] = [];
  for (const cardId of cardIds) {
    const def = CARDS[cardId];
    if (!def) {
      out.push({ cardId, mintAddress: '', signature: '' });
      continue;
    }
    try {
      const asset = generateSigner(u);
      const name = def.name.length > 32 ? def.name.slice(0, 29) + '...' : def.name;
      const uri = `${metadataBaseUrl}/api/cards/${encodeURIComponent(cardId)}/metadata`;
      const res = await create(u, {
        asset,
        name,
        uri,
        owner: umiPublicKey(ownerAddress),
      }).sendAndConfirm(u, { confirm: { commitment: 'confirmed' } });
      out.push({
        cardId,
        mintAddress: asset.publicKey.toString(),
        signature: Buffer.from(res.signature).toString('base64'),
      });
    } catch (e: any) {
      console.warn(`[duel-pack-mint] failed to mint ${cardId}: ${e?.message ?? e}`);
      out.push({ cardId, mintAddress: '', signature: '' });
    }
  }
  return out;
}

// Suppress "unused" warnings for symbols re-exported for completeness.
void getAccount;
