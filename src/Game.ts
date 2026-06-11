// src/Game.ts
// Duelmasters — Yu-Gi-Oh TCG-style rule engine on boardgame.io.
//
// Implements rulebook v10 mechanics:
//  - 8000 LP, 40-60 card Main Deck, 0-15 card Extra Deck, max 3 copies.
//  - 6 phases: Draw → Standby → Main1 → Battle → Main2 → End.
//  - Normal Summon/Set (once per turn), Tribute Summon (L5-6: 1, L7+: 2),
//    Flip Summon, and Special Summons (Fusion / Synchro / Xyz / Ritual / Link).
//  - 5 Main Monster Zones + 5 Spell/Trap Zones + 1 Field Zone + 1 Extra Monster
//    Zone per player.
//  - Battle: ATK vs ATK / ATK vs DEF / face-down flip / direct attack.
//  - Spell types: Normal / Continuous / Equip / Field / Quick-Play / Ritual.
//  - Trap types: Normal / Continuous / Counter. Traps must be set ≥ 1 turn.
//  - Chains with spell speed (1 / 2 / 3); resolution in reverse order.
//  - End Phase hand cap at 6.
//  - First player skips the Draw Phase on Turn 1 and cannot Battle on Turn 1.

import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE, PlayerView, Stage, ActivePlayers } from 'boardgame.io/core';
import {
  CARDS, COLORS, COLOR_META, STARTER_DECKS, STARTER_EXTRA_DECKS, DEFAULT_MATCHUP,
  derivePrimaryColor, validateDeck, tributesRequired,
  isMonster, isSpell, isTrap, isExtraDeckMonster,
  type Color, type CardDef, type MonsterDef, type SpellDef, type TrapDef, type EffectId,
} from './cards';

// ── Types ────────────────────────────────────────────────────────────────────

export type Position = 'atk' | 'def_up' | 'def_down';

export interface Instance {
  uid: string;
  defId: string;
  position: Position;
  /** For continuous spells/traps set face-down — flip when activated. */
  faceUp: boolean;
  /** ATK damage taken so far in this turn (cleared at end of turn). */
  damage: number;
  /** Has this monster attacked this turn? */
  attackedThisTurn: boolean;
  /** Has this monster changed battle position this turn (excluding the one it was summoned)? */
  positionChangedThisTurn: boolean;
  /** True until end of the turn this card was set/summoned — restricts position change + trap activation. */
  setThisTurn: boolean;
  /** Equip Spell targeting: this instance's UID. (For equip spells.) */
  equippedTo?: string;
  /** Materials beneath this monster (Xyz / Ritual / Fusion remember sources for some interactions). */
  materials?: string[];
  /** Per-turn flags for monster effects. */
  effectsUsed?: Record<string, boolean>;
  /** Has this monster been Special Summoned (vs Normal/Flip)? */
  specialSummoned?: boolean;
}

export type Zone =
  | 'monsterZones' | 'spellTrapZones'
  | 'fieldZone' | 'extraMonsterZone';

export const MONSTER_ZONES = 5;
export const SPELLTRAP_ZONES = 5;

export interface PlayerState {
  color: Color;
  profileName: string;
  lp: number;
  hand: string[];
  mainDeck: string[];
  extraDeck: string[];
  graveyard: string[];
  banished: string[];
  /** 5 main monster zones (null = empty). */
  monsterZones: Array<Instance | null>;
  /** 5 spell/trap zones (null = empty). */
  spellTrapZones: Array<Instance | null>;
  /** Single field zone (null = empty). */
  fieldZone: Instance | null;
  /** Single extra monster zone (null = empty). */
  extraMonsterZone: Instance | null;
  /** Per-turn flags. */
  hasNormalSummoned: boolean;
  hasDrawnForTurn: boolean;
  needsColorPick?: boolean;
}

export interface SecretState {
  mainDecks: Record<string, string[]>;
  extraDecks: Record<string, string[]>;
}

/** A single link on the chain stack. */
export interface ChainLink {
  /** Player who activated this link. */
  controller: string;
  /** Card UID being resolved (in S/T zone or hand). */
  sourceUid?: string;
  /** The card definition id of the activating card. */
  defId: string;
  /** The effect to resolve. */
  effect: EffectId;
  /** Spell speed of this link (1/2/3). */
  spellSpeed: 1 | 2 | 3;
  /** Resolved target UID (monster or S/T). For damage moves "__p0__" / "__p1__". */
  targetUid?: string;
  /** Whether this link is negated (a counter trap higher in the chain killed it). */
  negated?: boolean;
}

export type BattleStep =
  | { kind: 'idle' }
  /** Attacker has been chosen but a target has not yet been declared. */
  | { kind: 'choose_target'; attackerUid: string }
  /** Both attacker + target are chosen; chain window open before damage step. */
  | { kind: 'damage_window'; attackerUid: string; targetUid: string };

export interface GState {
  players: Record<string, PlayerState>;
  secret: SecretState;
  /** Active chain stack — bottom to top. Empty when no chain is being built. */
  chain: ChainLink[];
  /** Current battle step (only meaningful in the Battle Phase). */
  battle: BattleStep;
  log: string[];
  wager?: { kind: 'free' | 'master'; amount?: number; onchainId?: string; mode?: 'custodial' };
  ranked?: { seasonId: string; startedAt: number };
  mulligan: {
    counts: Record<string, number>;
    done: Record<string, boolean>;
    deadline: number;
  };
  turnDeadline?: number;
  /** Counter-trap window. When set, this player is given a single chance to chain
   *  before the topmost link resolves. */
  priorityResponse?: { playerID: string; allowedSpellSpeed: 1 | 2 | 3 };
  /** First-player-first-turn restrictions. */
  firstPlayer: string;
  /** True once the first turn has ended (allows the going-first player to battle thereafter). */
  pastFirstTurn: boolean;
}

// ── Mulligan tuning (back-compat with Board.tsx) ────────────────────────────

export const MULLIGAN_INITIAL_HAND = 5;
export const MULLIGAN_FLOOR = 3;
export const MULLIGAN_TIMEOUT_MS = 10_000;
export const TURN_TIMEOUT_MS = 90_000;
export function mulliganDrawCount(counts: number): number {
  return Math.max(MULLIGAN_FLOOR, MULLIGAN_INITIAL_HAND - Math.max(0, counts - 1));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 0;
function newUid(prefix = 'i'): string { _uid += 1; return `${prefix}${_uid}`; }

function emptyZones(n: number): Array<Instance | null> { return Array(n).fill(null); }

function mkInstance(defId: string, opts: Partial<Instance> = {}): Instance {
  return {
    uid: newUid('c'),
    defId,
    position: 'atk',
    faceUp: true,
    damage: 0,
    attackedThisTurn: false,
    positionChangedThisTurn: false,
    setThisTurn: false,
    ...opts,
  };
}

function emptyPlayer(color: Color, name: string): PlayerState {
  return {
    color, profileName: name,
    lp: 8000,
    hand: [], mainDeck: [], extraDeck: [],
    graveyard: [], banished: [],
    monsterZones: emptyZones(MONSTER_ZONES),
    spellTrapZones: emptyZones(SPELLTRAP_ZONES),
    fieldZone: null, extraMonsterZone: null,
    hasNormalSummoned: false, hasDrawnForTurn: false,
  };
}

function otherPlayer(ctx: { currentPlayer: string; playOrder: string[] }): string {
  return ctx.playOrder.find(p => p !== ctx.currentPlayer)!;
}

function drawCard(G: GState, pid: string, n = 1) {
  const p = G.players[pid];
  for (let i = 0; i < n; i++) {
    if (p.mainDeck.length === 0) {
      p.lp = 0;
      G.log.push(`Player ${pid} cannot draw and loses (deck-out).`);
      return;
    }
    p.hand.push(p.mainDeck.shift()!);
  }
}

function sendToGy(G: GState, pid: string, defId: string) {
  G.players[pid].graveyard.push(defId);
}

interface Located {
  ownerId: string;
  zone: Zone;
  index: number;
  inst: Instance;
}

function findOnField(G: GState, uid: string): Located | null {
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (let i = 0; i < p.monsterZones.length; i++) {
      const inst = p.monsterZones[i];
      if (inst && inst.uid === uid) return { ownerId: pid, zone: 'monsterZones', index: i, inst };
    }
    for (let i = 0; i < p.spellTrapZones.length; i++) {
      const inst = p.spellTrapZones[i];
      if (inst && inst.uid === uid) return { ownerId: pid, zone: 'spellTrapZones', index: i, inst };
    }
    if (p.fieldZone?.uid === uid) return { ownerId: pid, zone: 'fieldZone', index: 0, inst: p.fieldZone };
    if (p.extraMonsterZone?.uid === uid) return { ownerId: pid, zone: 'extraMonsterZone', index: 0, inst: p.extraMonsterZone };
  }
  return null;
}

function clearZone(p: PlayerState, zone: Zone, index: number) {
  if (zone === 'monsterZones')         p.monsterZones[index]   = null;
  else if (zone === 'spellTrapZones')  p.spellTrapZones[index] = null;
  else if (zone === 'fieldZone')       p.fieldZone             = null;
  else if (zone === 'extraMonsterZone')p.extraMonsterZone      = null;
}

function firstEmpty(arr: Array<Instance | null>): number {
  return arr.findIndex(x => x === null);
}

function countMonsters(p: PlayerState): number {
  return p.monsterZones.filter(Boolean).length + (p.extraMonsterZone ? 1 : 0);
}

/** Find an opponent's equip card that targets this UID, if any. */
function equipsOn(G: GState, monsterUid: string): Array<Located> {
  const out: Array<Located> = [];
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (let i = 0; i < p.spellTrapZones.length; i++) {
      const inst = p.spellTrapZones[i];
      if (inst?.equippedTo === monsterUid) out.push({ ownerId: pid, zone: 'spellTrapZones', index: i, inst });
    }
  }
  return out;
}

/** Compute effective ATK after equips, field spell, continuous spells/traps, and trigger effects. */
function effectiveAtk(G: GState, owner: string, inst: Instance): number {
  const def = CARDS[inst.defId];
  if (!isMonster(def)) return 0;
  let atk = def.atk ?? 0;

  for (const eq of equipsOn(G, inst.uid)) {
    const ed = CARDS[eq.inst.defId];
    if (isSpell(ed) && ed.subtype === 'equip') {
      if (ed.effect === 'sp_equip_atk_+700') atk += 700;
      if (ed.effect === 'sp_equip_piercing_pump_+500') atk += 500;
    }
  }

  // Active continuous spells/traps that pump matching attribute / all monsters.
  const me = G.players[owner];
  for (const c of [...me.spellTrapZones, me.fieldZone]) {
    if (!c?.faceUp) continue;
    const cd = CARDS[c.defId];
    if (isSpell(cd) && cd.subtype === 'continuous' && cd.effect === 'sp_cont_pump_attribute_+300') {
      if (cd.color && COLOR_META[cd.color].attribute === def.attribute && c.uid !== inst.uid) atk += 300;
    }
    if (isSpell(cd) && cd.subtype === 'field' && cd.effect === 'sp_field_attribute_atk_+300_def_+300') {
      if (cd.color && COLOR_META[cd.color].attribute === def.attribute) atk += 300;
    }
    if (isTrap(cd) && cd.subtype === 'continuous' && cd.effect === 'tr_continuous_pump_+300') {
      atk += 300;
    }
  }
  // Owner's monster zone neighbours with continuous-pump effect.
  for (const z of me.monsterZones) {
    if (!z || z.uid === inst.uid || !z.faceUp) continue;
    const zd = CARDS[z.defId];
    if (!isMonster(zd) || zd.subtype !== 'effect' || !zd.effects) continue;
    for (const e of zd.effects) {
      if (e.timing === 'continuous' && e.effect === 'mon_continuous_pump_own_attribute_+300'
          && zd.attribute === def.attribute) {
        atk += 300;
      }
    }
  }

  // Quick-play +1000 ATK marker
  if (inst.effectsUsed?.qp_pump_1000) atk += 1000;

  return atk;
}

function effectiveDef(G: GState, owner: string, inst: Instance): number {
  const def = CARDS[inst.defId];
  if (!isMonster(def)) return 0;
  let d = def.def ?? 0;
  for (const eq of equipsOn(G, inst.uid)) {
    const ed = CARDS[eq.inst.defId];
    if (isSpell(ed) && ed.subtype === 'equip' && ed.effect === 'sp_equip_def_+700') d += 700;
  }
  const me = G.players[owner];
  for (const c of [...me.spellTrapZones, me.fieldZone]) {
    if (!c?.faceUp) continue;
    const cd = CARDS[c.defId];
    if (isSpell(cd) && cd.subtype === 'field' && cd.effect === 'sp_field_attribute_atk_+300_def_+300'
        && cd.color && COLOR_META[cd.color].attribute === def.attribute) d += 300;
  }
  return d;
}

function isPiercer(G: GState, owner: string, inst: Instance): boolean {
  const def = CARDS[inst.defId];
  if (!isMonster(def)) return false;
  if (def.effects?.some(e => e.timing === 'continuous' && e.effect === 'mon_continuous_piercing')) return true;
  for (const eq of equipsOn(G, inst.uid)) {
    const ed = CARDS[eq.inst.defId];
    if (isSpell(ed) && ed.subtype === 'equip' && ed.effect === 'sp_equip_piercing_pump_+500') return true;
  }
  return false;
}

function destroyCard(G: GState, located: Located, reason = 'destroyed') {
  const p = G.players[located.ownerId];
  const inst = located.inst;
  const def = CARDS[inst.defId];
  clearZone(p, located.zone, located.index);

  // Trigger: monster destroyed by battle (handled by caller via reason='battle').
  if (isMonster(def) && reason === 'battle' && def.effects) {
    for (const e of def.effects) {
      if (e.timing === 'trigger' && e.trigger === 'on_destroy_by_battle') {
        const opp = otherPlayer({ currentPlayer: located.ownerId, playOrder: Object.keys(G.players) });
        runEffectImmediate(G, located.ownerId, opp, e.effect, undefined);
      }
    }
  }
  // Detach equips when the monster leaves.
  if (isMonster(def)) {
    for (const eq of equipsOn(G, inst.uid)) destroyCard(G, eq, 'effect');
  }
  // Send to GY if Main Deck card; if from Extra Deck Special Summon, also GY.
  sendToGy(G, located.ownerId, inst.defId);
  G.log.push(`${def?.name ?? inst.defId} is ${reason === 'battle' ? 'destroyed by battle' : 'destroyed'}.`);
}

function returnToHand(G: GState, located: Located) {
  const p = G.players[located.ownerId];
  const inst = located.inst;
  clearZone(p, located.zone, located.index);
  for (const eq of equipsOn(G, inst.uid)) destroyCard(G, eq, 'effect');
  p.hand.push(inst.defId);
  G.log.push(`${CARDS[inst.defId].name} is returned to hand.`);
}

// ── Effect engine ────────────────────────────────────────────────────────────

/** Resolve an effect immediately (used by triggers/flips that don't enter the chain). */
function runEffectImmediate(G: GState, controller: string, opponent: string,
                            effect: EffectId, targetUid?: string) {
  const me = G.players[controller];
  const opp = G.players[opponent];

  switch (effect) {
    case 'sp_draw_2':
    case 'mon_flip_draw_2':
      drawCard(G, controller, 2); break;
    case 'mon_trigger_on_summon_draw_1':
      drawCard(G, controller, 1); break;
    case 'sp_burn_1000':
      opp.lp = Math.max(0, opp.lp - 1000);
      G.log.push(`Player ${opponent} takes 1000 damage (LP=${opp.lp}).`); break;
    case 'mon_trigger_on_destroy_by_battle_burn_500':
      opp.lp = Math.max(0, opp.lp - 500);
      G.log.push(`Player ${opponent} takes 500 damage (LP=${opp.lp}).`); break;
    case 'sp_heal_2000':
      me.lp += 2000; G.log.push(`Player ${controller} gains 2000 LP (LP=${me.lp}).`); break;
    case 'sp_mill_top_3_opp': {
      for (let i = 0; i < 3 && opp.mainDeck.length > 0; i++) opp.graveyard.push(opp.mainDeck.shift()!);
      G.log.push(`Player ${opponent} sends 3 cards from the top of their Deck to the GY.`);
      break;
    }
    case 'sp_destroy_target_monster':
    case 'mon_flip_destroy_target_monster':
    case 'mon_ignition_destroy_1_monster_tribute_self':
    case 'sp_destroy_target_spelltrap':
    case 'tr_destroy_attacker':
    case 'tr_trap_hole': {
      if (!targetUid) break;
      const f = findOnField(G, targetUid);
      if (!f) break;
      destroyCard(G, f, 'effect');
      break;
    }
    case 'mon_ignition_destroy_1_spelltrap_discard1': {
      if (!targetUid) break;
      // discard 1 random card from hand
      if (me.hand.length > 0) { me.graveyard.push(me.hand.shift()!); }
      const f = findOnField(G, targetUid); if (f) destroyCard(G, f, 'effect');
      break;
    }
    case 'sp_destroy_all_opp_monsters':
    case 'tr_mirror_force': {
      for (let i = 0; i < opp.monsterZones.length; i++) {
        const m = opp.monsterZones[i];
        if (m && m.position === 'atk' && m.faceUp) {
          destroyCard(G, { ownerId: opponent, zone: 'monsterZones', index: i, inst: m }, 'effect');
        }
      }
      if (opp.extraMonsterZone?.position === 'atk' && opp.extraMonsterZone.faceUp) {
        destroyCard(G, { ownerId: opponent, zone: 'extraMonsterZone', index: 0, inst: opp.extraMonsterZone }, 'effect');
      }
      break;
    }
    case 'sp_destroy_all_spelltrap': {
      for (const pid of [controller, opponent]) {
        const p = G.players[pid];
        for (let i = 0; i < p.spellTrapZones.length; i++) {
          const c = p.spellTrapZones[i];
          if (c) destroyCard(G, { ownerId: pid, zone: 'spellTrapZones', index: i, inst: c }, 'effect');
        }
        if (p.fieldZone) destroyCard(G, { ownerId: pid, zone: 'fieldZone', index: 0, inst: p.fieldZone }, 'effect');
      }
      break;
    }
    case 'sp_return_target_to_hand': {
      if (!targetUid) break;
      const f = findOnField(G, targetUid);
      if (f) returnToHand(G, f);
      break;
    }
    case 'sp_special_summon_from_gy_lvl4': {
      // targetUid here is the defId string from controller's GY
      if (!targetUid) break;
      const defId = targetUid;
      const idx = me.graveyard.indexOf(defId);
      if (idx === -1) break;
      const def = CARDS[defId];
      if (!isMonster(def) || (def.level ?? 99) > 4 || isExtraDeckMonster(def)) break;
      const slot = firstEmpty(me.monsterZones);
      if (slot === -1) break;
      me.graveyard.splice(idx, 1);
      const inst = mkInstance(defId, { position: 'atk', faceUp: true, specialSummoned: true });
      me.monsterZones[slot] = inst;
      G.log.push(`Player ${controller} Special Summons ${def.name} from the GY.`);
      break;
    }
    case 'tr_call_of_the_haunted': {
      if (!targetUid) break;
      const defId = targetUid;
      const idx = me.graveyard.indexOf(defId);
      if (idx === -1) break;
      const def = CARDS[defId];
      if (!isMonster(def) || isExtraDeckMonster(def)) break;
      const slot = firstEmpty(me.monsterZones);
      if (slot === -1) break;
      me.graveyard.splice(idx, 1);
      me.monsterZones[slot] = mkInstance(defId, { position: 'atk', faceUp: true, specialSummoned: true });
      G.log.push(`Player ${controller} Special Summons ${def.name} via Call.`);
      break;
    }
    case 'sp_quick_pump_target_+1000_atk': {
      if (!targetUid) break;
      const f = findOnField(G, targetUid);
      if (f && f.zone === 'monsterZones') {
        f.inst.effectsUsed = { ...(f.inst.effectsUsed ?? {}), qp_pump_1000: true };
        G.log.push(`${CARDS[f.inst.defId].name} gains 1000 ATK this turn.`);
      }
      break;
    }
    case 'sp_quick_burn_500_per_card': {
      const n = opp.spellTrapZones.filter(Boolean).length + (opp.fieldZone ? 1 : 0);
      const amt = n * 500;
      opp.lp = Math.max(0, opp.lp - amt);
      G.log.push(`${amt} damage to Player ${opponent} (LP=${opp.lp}).`);
      break;
    }
    case 'sp_cont_burn_300_each_endphase':
      // handled at end-of-turn scan
      break;
    case 'sp_cont_extra_draw_per_turn':
    case 'sp_cont_pump_attribute_+300':
    case 'tr_continuous_pump_+300':
    case 'sp_field_attribute_atk_+300_def_+300':
    case 'sp_equip_atk_+700':
    case 'sp_equip_def_+700':
    case 'sp_equip_piercing_pump_+500':
      // Continuous — handled by effectiveAtk/effectiveDef. Nothing to do on activation.
      break;
    case 'mon_continuous_pump_own_attribute_+300':
    case 'mon_continuous_piercing':
    case 'mon_continuous_direct_attack_if_only_monster':
      // Continuous monster effects — handled at attack time / damage calc.
      break;
    case 'sp_polymerization':
    case 'sp_ritual_summon':
      // Handled by their dedicated moves below.
      break;
    case 'tr_negate_attack':
    case 'sp_quick_negate_attack':
    case 'mon_quick_negate_attack_discard1':
      // Marks battle as cancelled — only used in chain windows during battle.
      G.battle = { kind: 'idle' };
      G.log.push(`The attack is negated.`);
      break;
    case 'tr_torrential_tribute': {
      // Destroy all monsters
      for (const pid of [controller, opponent]) {
        const p = G.players[pid];
        for (let i = 0; i < p.monsterZones.length; i++) {
          const m = p.monsterZones[i];
          if (m) destroyCard(G, { ownerId: pid, zone: 'monsterZones', index: i, inst: m }, 'effect');
        }
        if (p.extraMonsterZone) destroyCard(G, { ownerId: pid, zone: 'extraMonsterZone', index: 0, inst: p.extraMonsterZone }, 'effect');
      }
      break;
    }
    case 'tr_counter_negate_spell':
    case 'tr_counter_negate_trap':
    case 'tr_counter_negate_summon': {
      // Mark the targeted chain link as negated.
      if (!targetUid) break;
      const link = G.chain.find(l => l.sourceUid === targetUid);
      if (link) {
        link.negated = true;
        G.log.push(`The activation of ${CARDS[link.defId].name} is negated.`);
      }
      break;
    }
    default:
      G.log.push(`Effect ${effect} resolved (no-op stub).`);
  }
}

/** Resolve one chain link (the top of the stack). */
function resolveTopChainLink(G: GState) {
  const link = G.chain.pop();
  if (!link) return;
  if (link.negated) {
    G.log.push(`${CARDS[link.defId].name}'s activation was negated.`);
    return;
  }
  const opp = otherPlayer({ currentPlayer: link.controller, playOrder: Object.keys(G.players) });
  runEffectImmediate(G, link.controller, opp, link.effect, link.targetUid);
}

/** Drain the whole chain stack from top to bottom. */
function resolveChain(G: GState) {
  while (G.chain.length > 0) resolveTopChainLink(G);
}

// ── Setup ────────────────────────────────────────────────────────────────────

interface SetupData {
  colors?: Array<Color | null | undefined>;
  names?: [string, string];
  decks?: Array<string[] | null | undefined>;
  extraDecks?: Array<string[] | null | undefined>;
  wager?: { kind: 'free' | 'master' | 'sol'; amount?: number; onchainId?: string };
  ranked?: boolean;
  seasonId?: string;
  mode?: string;
}

function setupGame(
  { ctx, random }: { ctx: { numPlayers: number }; random: any },
  setupData?: SetupData,
): GState {
  const colors = setupData?.colors ?? DEFAULT_MATCHUP;
  const names = setupData?.names ?? ['Player 0', 'Player 1'];
  const decksIn = setupData?.decks ?? [];
  const extraIn = setupData?.extraDecks ?? [];
  const players: Record<string, PlayerState> = {};
  const mainDecks: Record<string, string[]> = {};
  const extraDecks: Record<string, string[]> = {};

  for (let i = 0; i < ctx.numPlayers; i++) {
    const pid = String(i);
    const chosen = colors[i] as Color | null | undefined;
    const customDeck = decksIn[i];
    const validCustom =
      customDeck && Array.isArray(customDeck) && customDeck.length > 0 && validateDeck(customDeck).ok
        ? [...customDeck]
        : null;

    if (chosen || validCustom) {
      const deck = validCustom ?? [...STARTER_DECKS[chosen as Color]];
      const themeColor: Color = validCustom ? derivePrimaryColor(deck) : (chosen as Color);
      const shuffled = random!.Shuffle(deck);
      const extra = extraIn[i] && Array.isArray(extraIn[i]) && (extraIn[i]?.length ?? 0) > 0
        ? [...(extraIn[i] as string[])]
        : [...(STARTER_EXTRA_DECKS[themeColor] ?? [])];
      const p = emptyPlayer(themeColor, names[i] ?? `Player ${i}`);
      p.hand = shuffled.slice(0, 5);
      p.mainDeck = shuffled.slice(5);
      p.extraDeck = random!.Shuffle(extra);
      players[pid] = p;
      mainDecks[pid] = p.mainDeck;
      extraDecks[pid] = p.extraDeck;
    } else {
      const p = emptyPlayer(DEFAULT_MATCHUP[i % 2], names[i] ?? `Player ${i}`);
      p.needsColorPick = true;
      players[pid] = p;
      mainDecks[pid] = [];
      extraDecks[pid] = [];
    }
  }

  return {
    players,
    secret: { mainDecks, extraDecks },
    chain: [],
    battle: { kind: 'idle' },
    log: ['Duel start. Each player begins with 8000 LP.'],
    wager: setupData?.wager
      ? (setupData.wager.kind === 'master' || setupData.wager.kind === 'sol')
        ? { kind: 'master', amount: setupData.wager.amount, onchainId: setupData.wager.onchainId, mode: 'custodial' }
        : setupData.wager.kind === 'free'
          ? { kind: 'free' }
          : undefined
      : undefined,
    ranked: (setupData?.ranked || setupData?.mode === 'ranked') && setupData?.seasonId
      ? { seasonId: String(setupData.seasonId), startedAt: Date.now() }
      : undefined,
    mulligan: {
      counts: Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) => [String(i), 0])),
      done:   Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) => [String(i), false])),
      deadline: 0,
    },
    firstPlayer: '0',
    pastFirstTurn: false,
  };
}

function pickingPending(G: GState): boolean {
  return Object.values(G.players).some(p => p.needsColorPick);
}

// ── Color pick + mulligan moves ──────────────────────────────────────────────

const chooseColor: Move<GState> = ({ G, playerID, random }, color: Color, customDeck?: string[], extraDeck?: string[]) => {
  if (playerID == null) return INVALID_MOVE;
  const p = G.players[playerID];
  if (!p?.needsColorPick) return INVALID_MOVE;
  let deck: string[];
  let extra: string[];
  let finalColor: Color;
  if (customDeck && Array.isArray(customDeck) && customDeck.length > 0) {
    const v = validateDeck(customDeck);
    if (!v.ok) return INVALID_MOVE;
    deck = [...customDeck];
    finalColor = derivePrimaryColor(customDeck);
    extra = extraDeck && Array.isArray(extraDeck) ? [...extraDeck] : [...STARTER_EXTRA_DECKS[finalColor]];
  } else {
    if (!COLORS.includes(color)) return INVALID_MOVE;
    deck = [...STARTER_DECKS[color]];
    extra = [...STARTER_EXTRA_DECKS[color]];
    finalColor = color;
  }
  const shuffled = random!.Shuffle(deck);
  p.color = finalColor;
  p.hand = shuffled.slice(0, MULLIGAN_INITIAL_HAND);
  p.mainDeck = shuffled.slice(MULLIGAN_INITIAL_HAND);
  p.extraDeck = random!.Shuffle(extra);
  G.secret.mainDecks[playerID] = p.mainDeck;
  G.secret.extraDecks[playerID] = p.extraDeck;
  p.needsColorPick = false;
  G.log.push(customDeck
    ? `Player ${playerID} brought a custom deck (${finalColor.toUpperCase()} themed).`
    : `Player ${playerID} chose the ${finalColor.toUpperCase()} deck.`);
};

const keepHand: Move<GState> = ({ G, playerID }) => {
  if (playerID == null) return INVALID_MOVE;
  if (G.mulligan.done[playerID]) return INVALID_MOVE;
  G.mulligan.done[playerID] = true;
  G.log.push(`Player ${playerID} keeps their opening hand (${G.players[playerID].hand.length}).`);
};

const forceKeepOpponent: Move<GState> = ({ G }) => {
  if (!G.mulligan.deadline || Date.now() < G.mulligan.deadline) return INVALID_MOVE;
  let changed = false;
  for (const pid of Object.keys(G.mulligan.done)) {
    if (!G.mulligan.done[pid]) {
      G.mulligan.done[pid] = true;
      G.log.push(`Player ${pid} auto-kept their opening hand (mulligan timeout).`);
      changed = true;
    }
  }
  if (!changed) return INVALID_MOVE;
};

const mulligan: Move<GState> = ({ G, playerID, random }) => {
  if (playerID == null) return INVALID_MOVE;
  if (G.mulligan.done[playerID]) return INVALID_MOVE;
  const p = G.players[playerID];
  if (!p) return INVALID_MOVE;
  if (G.mulligan.counts[playerID] >= MULLIGAN_INITIAL_HAND - MULLIGAN_FLOOR + 1) return INVALID_MOVE;
  G.mulligan.counts[playerID] = (G.mulligan.counts[playerID] || 0) + 1;
  const combined = [...p.hand, ...p.mainDeck];
  const shuffled = random!.Shuffle(combined);
  const target = mulliganDrawCount(G.mulligan.counts[playerID]);
  const safeTarget = Math.min(target, shuffled.length);
  p.hand = shuffled.slice(0, safeTarget);
  p.mainDeck = shuffled.slice(safeTarget);
  G.secret.mainDecks[playerID] = p.mainDeck;
  G.log.push(`Player ${playerID} mulligans → new hand of ${p.hand.length} (mulligan #${G.mulligan.counts[playerID]}).`);
  G.mulligan.deadline = Date.now() + MULLIGAN_TIMEOUT_MS;
};

// ── Phase advance helpers ────────────────────────────────────────────────────

type PhaseName = 'draw' | 'standby' | 'main1' | 'battle' | 'main2' | 'end';

function currentPhase(ctx: any): PhaseName {
  return (ctx.phase as PhaseName) ?? 'main1';
}

// ── Summon moves ─────────────────────────────────────────────────────────────

/** Normal Summon / Set a Level ≤4 monster from hand. */
const normalSummon: Move<GState> = ({ G, ctx, playerID }, handIndex: number, faceDown = false, defensePosition = false) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  if (p.hasNormalSummoned) return INVALID_MOVE;
  const defId = p.hand[handIndex];
  if (!defId) return INVALID_MOVE;
  const def = CARDS[defId];
  if (!isMonster(def)) return INVALID_MOVE;
  if (isExtraDeckMonster(def)) return INVALID_MOVE;
  if (def.subtype === 'ritual') return INVALID_MOVE;
  const lvl = def.level ?? 0;
  if (lvl > 4) return INVALID_MOVE;
  const slot = firstEmpty(p.monsterZones);
  if (slot === -1) return INVALID_MOVE;

  p.hand.splice(handIndex, 1);
  const pos: Position = faceDown ? 'def_down' : (defensePosition ? 'def_up' : 'atk');
  const inst = mkInstance(defId, {
    position: pos, faceUp: !faceDown, setThisTurn: true,
  });
  p.monsterZones[slot] = inst;
  p.hasNormalSummoned = true;
  G.log.push(faceDown
    ? `Player ${playerID} Sets a monster face-down.`
    : `Player ${playerID} Normal Summons ${def.name} in ${pos === 'atk' ? 'Attack' : 'Defense'} Position.`);

  // Trigger: on-summon
  if (!faceDown && def.effects) {
    const opp = otherPlayer(ctx);
    for (const e of def.effects) {
      if (e.timing === 'trigger' && e.trigger === 'on_summon') {
        runEffectImmediate(G, playerID, opp, e.effect, undefined);
      }
    }
  }
};

/** Tribute Summon a Level 5+ monster, releasing the required tributes. */
const tributeSummon: Move<GState> = (
  { G, ctx, playerID }, handIndex: number, tributeUids: string[], defensePosition = false, faceDown = false,
) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  if (p.hasNormalSummoned) return INVALID_MOVE;
  const defId = p.hand[handIndex];
  if (!defId) return INVALID_MOVE;
  const def = CARDS[defId];
  if (!isMonster(def) || isExtraDeckMonster(def) || def.subtype === 'ritual') return INVALID_MOVE;
  const lvl = def.level ?? 0;
  const need = tributesRequired(lvl);
  if (need === 0 || tributeUids.length !== need) return INVALID_MOVE;

  // Verify tributes belong to controller.
  for (const uid of tributeUids) {
    const f = findOnField(G, uid);
    if (!f || f.ownerId !== playerID || (f.zone !== 'monsterZones' && f.zone !== 'extraMonsterZone')) return INVALID_MOVE;
  }
  // Pay tributes.
  for (const uid of tributeUids) {
    const f = findOnField(G, uid)!;
    clearZone(p, f.zone, f.index);
    sendToGy(G, playerID, f.inst.defId);
  }
  const slot = firstEmpty(p.monsterZones);
  if (slot === -1) return INVALID_MOVE;
  p.hand.splice(handIndex, 1);
  const pos: Position = faceDown ? 'def_down' : (defensePosition ? 'def_up' : 'atk');
  p.monsterZones[slot] = mkInstance(defId, { position: pos, faceUp: !faceDown, setThisTurn: true });
  p.hasNormalSummoned = true;
  G.log.push(`Player ${playerID} Tribute Summons ${def.name} (released ${need}).`);
  if (!faceDown && def.effects) {
    const opp = otherPlayer(ctx);
    for (const e of def.effects) {
      if (e.timing === 'trigger' && e.trigger === 'on_summon') {
        runEffectImmediate(G, playerID, opp, e.effect, undefined);
      }
    }
  }
};

/** Flip a face-down defense monster face-up in Attack Position (Flip Summon). */
const flipSummon: Move<GState> = ({ G, ctx, playerID }, monsterUid: string) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const f = findOnField(G, monsterUid);
  if (!f || f.ownerId !== playerID || f.zone !== 'monsterZones') return INVALID_MOVE;
  if (f.inst.position !== 'def_down' || f.inst.faceUp) return INVALID_MOVE;
  if (f.inst.setThisTurn) return INVALID_MOVE;
  f.inst.position = 'atk';
  f.inst.faceUp = true;
  G.log.push(`Player ${playerID} Flip Summons ${CARDS[f.inst.defId].name}.`);
  // Flip effect resolves
  const def = CARDS[f.inst.defId];
  if (isMonster(def) && def.effects) {
    const opp = otherPlayer(ctx);
    for (const e of def.effects) {
      if (e.timing === 'flip') runEffectImmediate(G, playerID, opp, e.effect, undefined);
    }
  }
};

/** Change a face-up monster's battle position. */
const changePosition: Move<GState> = ({ G, ctx, playerID }, monsterUid: string) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const f = findOnField(G, monsterUid);
  if (!f || f.ownerId !== playerID) return INVALID_MOVE;
  if (!f.inst.faceUp) return INVALID_MOVE;
  if (f.inst.setThisTurn) return INVALID_MOVE;
  if (f.inst.positionChangedThisTurn) return INVALID_MOVE;
  if (f.inst.attackedThisTurn) return INVALID_MOVE;
  f.inst.position = f.inst.position === 'atk' ? 'def_up' : 'atk';
  f.inst.positionChangedThisTurn = true;
  G.log.push(`${CARDS[f.inst.defId].name} switches to ${f.inst.position === 'atk' ? 'Attack' : 'Defense'} Position.`);
};

// ── Spell / Trap activation ──────────────────────────────────────────────────

/** Set a Spell or Trap face-down in the S/T zone. */
const setSpellTrap: Move<GState> = ({ G, ctx, playerID }, handIndex: number) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  const defId = p.hand[handIndex];
  if (!defId) return INVALID_MOVE;
  const def = CARDS[defId];
  if (!isSpell(def) && !isTrap(def)) return INVALID_MOVE;
  const slot = firstEmpty(p.spellTrapZones);
  if (slot === -1) return INVALID_MOVE;
  p.hand.splice(handIndex, 1);
  p.spellTrapZones[slot] = mkInstance(defId, { position: 'atk', faceUp: false, setThisTurn: true });
  G.log.push(`Player ${playerID} Sets a Spell/Trap.`);
};

/** Activate a Spell or Trap (either from hand, or face-down on field). */
const activateCard: Move<GState> = (
  { G, ctx, playerID }, source: { handIndex?: number; fieldUid?: string }, targetUid?: string,
) => {
  if (playerID == null) return INVALID_MOVE;
  const p = G.players[playerID];

  let def: CardDef | undefined;
  let fromHand = false;
  let sourceUid: string | undefined;
  let inPlace: Located | null = null;

  if (typeof source.handIndex === 'number') {
    if (ctx.currentPlayer !== playerID) return INVALID_MOVE;
    if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
    fromHand = true;
    const id = p.hand[source.handIndex];
    if (!id) return INVALID_MOVE;
    def = CARDS[id];
  } else if (source.fieldUid) {
    inPlace = findOnField(G, source.fieldUid);
    if (!inPlace || inPlace.ownerId !== playerID) return INVALID_MOVE;
    sourceUid = inPlace.inst.uid;
    def = CARDS[inPlace.inst.defId];
  } else return INVALID_MOVE;

  if (!def || (!isSpell(def) && !isTrap(def))) return INVALID_MOVE;

  // Spell speed rules:
  // - Normal Spells (speed 1) only on your own Main Phase, only from hand or just-set this turn.
  // - Quick-Play Spells (speed 2) from hand on your turn, OR from face-down field on either turn (not turn set).
  // - Normal Traps (speed 2) only from face-down field, not the turn they were set.
  // - Counter Traps (speed 3) only from face-down field, only in response to a chain link.
  // - Continuous/Equip/Field/Ritual Spells (speed 1) on your Main Phase.
  const isQuickPlay = isSpell(def) && def.subtype === 'quickplay';
  const isCounter = isTrap(def) && def.subtype === 'counter';

  if (isTrap(def) && fromHand) return INVALID_MOVE;
  if (isSpell(def) && !isQuickPlay && !fromHand && (!inPlace || inPlace.inst.setThisTurn))
    return INVALID_MOVE;
  if (isTrap(def) && inPlace?.inst.setThisTurn) return INVALID_MOVE;

  if (isSpell(def) && !isQuickPlay) {
    if (ctx.currentPlayer !== playerID) return INVALID_MOVE;
    if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  }
  if (isQuickPlay && fromHand) {
    if (ctx.currentPlayer !== playerID) return INVALID_MOVE;
  }

  // Counter traps must respond to the existing chain link's spell speed.
  let spellSpeed: 1 | 2 | 3 = 1;
  if (isQuickPlay || (isTrap(def) && def.subtype !== 'counter')) spellSpeed = 2;
  if (isCounter) spellSpeed = 3;
  if (G.chain.length > 0) {
    const top = G.chain[G.chain.length - 1];
    if (spellSpeed < top.spellSpeed) return INVALID_MOVE;
  }

  // Move the activating card to the field face-up if it came from hand.
  if (fromHand) {
    p.hand.splice(source.handIndex!, 1);
    if (isSpell(def) && def.subtype === 'normal') {
      // Normal spells activate then go to GY after resolution.
      sourceUid = newUid('c'); // placeholder UID for chain tracking
    } else if (isSpell(def) && (def.subtype === 'continuous' || def.subtype === 'equip' || def.subtype === 'ritual' || def.subtype === 'quickplay')) {
      const slot = firstEmpty(p.spellTrapZones);
      if (slot === -1) { p.hand.push(def.id); return INVALID_MOVE; }
      const inst = mkInstance(def.id, { position: 'atk', faceUp: true, equippedTo: (def.subtype === 'equip' ? targetUid : undefined) });
      p.spellTrapZones[slot] = inst;
      sourceUid = inst.uid;
    } else if (isSpell(def) && def.subtype === 'field') {
      if (p.fieldZone) {
        sendToGy(G, playerID, p.fieldZone.defId);
        p.fieldZone = null;
      }
      const inst = mkInstance(def.id, { position: 'atk', faceUp: true });
      p.fieldZone = inst;
      sourceUid = inst.uid;
    }
  } else if (inPlace) {
    // Flip the card face-up.
    inPlace.inst.faceUp = true;
  }

  G.chain.push({
    controller: playerID, sourceUid, defId: def.id, effect: def.effect, spellSpeed, targetUid,
  });
  G.log.push(`Player ${playerID} activates ${def.name}.`);

  // After pushing, give the opponent a chance to chain. If they decline (via passChain),
  // the chain resolves. We model this by setting priorityResponse.
  const opp = otherPlayer(ctx);
  G.priorityResponse = { playerID: opp, allowedSpellSpeed: spellSpeed === 3 ? 3 : 2 };
};

/** Opponent declines to chain — resolve the chain now (or pass back if they added a link). */
const passChain: Move<GState> = ({ G, playerID }) => {
  if (playerID == null) return INVALID_MOVE;
  if (!G.priorityResponse || G.priorityResponse.playerID !== playerID) return INVALID_MOVE;
  G.priorityResponse = undefined;
  resolveChain(G);
  // After resolution, send normal spells / used traps / non-counter normal traps to GY.
  // Continuous/equip/field stay on the field; Normal spells/traps go to GY.
  cleanUpAfterResolve(G);
};

function cleanUpAfterResolve(G: GState) {
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (let i = 0; i < p.spellTrapZones.length; i++) {
      const c = p.spellTrapZones[i];
      if (!c) continue;
      const def = CARDS[c.defId];
      if (!def) continue;
      if (isSpell(def) && def.subtype === 'normal') { p.spellTrapZones[i] = null; sendToGy(G, pid, def.id); }
      if (isSpell(def) && def.subtype === 'ritual') { p.spellTrapZones[i] = null; sendToGy(G, pid, def.id); }
      if (isSpell(def) && def.subtype === 'quickplay' && c.faceUp && c.position === 'atk') {
        // Quick-Play spells go to GY after their effect resolves.
        p.spellTrapZones[i] = null; sendToGy(G, pid, def.id);
      }
      if (isTrap(def) && (def.subtype === 'normal' || def.subtype === 'counter') && c.faceUp) {
        p.spellTrapZones[i] = null; sendToGy(G, pid, def.id);
      }
    }
  }
}

// ── Special Summons ──────────────────────────────────────────────────────────

/** Fusion Summon: send the listed materials from hand/field to the GY, then Special Summon. */
const fusionSummon: Move<GState> = (
  { G, ctx, playerID }, polymerizationHandIndex: number, fusionMonsterId: string,
  materials: Array<{ from: 'hand' | 'field'; handIndex?: number; fieldUid?: string }>,
) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  const polyDef = CARDS[p.hand[polymerizationHandIndex]];
  if (!polyDef || !isSpell(polyDef) || polyDef.effect !== 'sp_polymerization') return INVALID_MOVE;
  if (!polyDef.fusionMonsterIds?.includes(fusionMonsterId)) return INVALID_MOVE;
  if (!p.extraDeck.includes(fusionMonsterId)) return INVALID_MOVE;
  const fdef = CARDS[fusionMonsterId];
  if (!isMonster(fdef) || fdef.subtype !== 'fusion' || !fdef.fusionMaterials) return INVALID_MOVE;

  // Validate materials exactly match.
  const need = [...fdef.fusionMaterials];
  const matchedHand: number[] = [];
  const matchedField: string[] = [];
  for (const m of materials) {
    let provided: string | null = null;
    if (m.from === 'hand' && typeof m.handIndex === 'number') {
      provided = p.hand[m.handIndex] ?? null;
      if (provided) matchedHand.push(m.handIndex);
    } else if (m.from === 'field' && m.fieldUid) {
      const f = findOnField(G, m.fieldUid);
      if (!f || f.ownerId !== playerID || (f.zone !== 'monsterZones' && f.zone !== 'extraMonsterZone')) return INVALID_MOVE;
      provided = f.inst.defId;
      matchedField.push(m.fieldUid);
    }
    if (!provided) return INVALID_MOVE;
    const idx = need.indexOf(provided);
    if (idx === -1) return INVALID_MOVE;
    need.splice(idx, 1);
  }
  if (need.length > 0) return INVALID_MOVE;

  // Pay materials.
  const idxs = matchedHand.sort((a, b) => b - a);
  for (const i of idxs) { const d = p.hand.splice(i, 1)[0]; if (d) sendToGy(G, playerID, d); }
  for (const uid of matchedField) {
    const f = findOnField(G, uid)!;
    sendToGy(G, playerID, f.inst.defId);
    clearZone(p, f.zone, f.index);
  }
  // Discard polymerization (after grabbing it before splice updates indices).
  const polyIdx = p.hand.indexOf(polyDef.id);
  if (polyIdx >= 0) { p.hand.splice(polyIdx, 1); sendToGy(G, playerID, polyDef.id); }

  // Place fusion monster in the Extra Monster Zone (if free), else a Main Monster Zone.
  const inst = mkInstance(fusionMonsterId, { position: 'atk', faceUp: true, specialSummoned: true });
  if (!p.extraMonsterZone) p.extraMonsterZone = inst;
  else {
    const slot = firstEmpty(p.monsterZones);
    if (slot === -1) return INVALID_MOVE;
    p.monsterZones[slot] = inst;
  }
  p.extraDeck.splice(p.extraDeck.indexOf(fusionMonsterId), 1);
  G.log.push(`Player ${playerID} Fusion Summons ${fdef.name}.`);
};

/** Synchro Summon: send 1 Tuner + non-Tuners whose total Level = synchro level. */
const synchroSummon: Move<GState> = (
  { G, ctx, playerID }, synchroMonsterId: string, tunerUid: string, nonTunerUids: string[],
) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  if (!p.extraDeck.includes(synchroMonsterId)) return INVALID_MOVE;
  const sdef = CARDS[synchroMonsterId];
  if (!isMonster(sdef) || sdef.subtype !== 'synchro') return INVALID_MOVE;

  const tuner = findOnField(G, tunerUid);
  if (!tuner || tuner.ownerId !== playerID) return INVALID_MOVE;
  const td = CARDS[tuner.inst.defId];
  if (!isMonster(td) || !td.isTuner) return INVALID_MOVE;
  let total = td.level ?? 0;
  const nts: Located[] = [];
  for (const u of nonTunerUids) {
    const f = findOnField(G, u);
    if (!f || f.ownerId !== playerID) return INVALID_MOVE;
    const md = CARDS[f.inst.defId];
    if (!isMonster(md) || md.isTuner) return INVALID_MOVE;
    total += md.level ?? 0;
    nts.push(f);
  }
  if (total !== (sdef.synchroLevel ?? sdef.level ?? 0)) return INVALID_MOVE;

  // Pay materials.
  for (const f of [tuner, ...nts]) {
    sendToGy(G, playerID, f.inst.defId);
    clearZone(p, f.zone, f.index);
  }
  const inst = mkInstance(synchroMonsterId, { position: 'atk', faceUp: true, specialSummoned: true });
  if (!p.extraMonsterZone) p.extraMonsterZone = inst;
  else {
    const slot = firstEmpty(p.monsterZones);
    if (slot === -1) return INVALID_MOVE;
    p.monsterZones[slot] = inst;
  }
  p.extraDeck.splice(p.extraDeck.indexOf(synchroMonsterId), 1);
  G.log.push(`Player ${playerID} Synchro Summons ${sdef.name}.`);
};

/** Xyz Summon: stack N monsters of the required Level beneath an Xyz monster. */
const xyzSummon: Move<GState> = ({ G, ctx, playerID }, xyzMonsterId: string, materialUids: string[]) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  if (!p.extraDeck.includes(xyzMonsterId)) return INVALID_MOVE;
  const xdef = CARDS[xyzMonsterId];
  if (!isMonster(xdef) || xdef.subtype !== 'xyz' || !xdef.xyzMaterials) return INVALID_MOVE;
  const { level, count } = xdef.xyzMaterials;
  if (materialUids.length !== count) return INVALID_MOVE;
  const mats: Located[] = [];
  for (const u of materialUids) {
    const f = findOnField(G, u);
    if (!f || f.ownerId !== playerID) return INVALID_MOVE;
    const md = CARDS[f.inst.defId];
    if (!isMonster(md) || md.level !== level || isExtraDeckMonster(md)) return INVALID_MOVE;
    mats.push(f);
  }
  // Stack materials beneath the Xyz monster (we track them by defId only).
  const stackedDefIds = mats.map(m => m.inst.defId);
  for (const f of mats) clearZone(p, f.zone, f.index);
  const inst = mkInstance(xyzMonsterId, {
    position: 'atk', faceUp: true, specialSummoned: true, materials: stackedDefIds,
  });
  if (!p.extraMonsterZone) p.extraMonsterZone = inst;
  else {
    const slot = firstEmpty(p.monsterZones);
    if (slot === -1) return INVALID_MOVE;
    p.monsterZones[slot] = inst;
  }
  p.extraDeck.splice(p.extraDeck.indexOf(xyzMonsterId), 1);
  G.log.push(`Player ${playerID} Xyz Summons ${xdef.name} (Rank ${xdef.rank}).`);
};

/** Ritual Summon: requires the matching Ritual Spell + tributes from hand/field summing to ≥ required level. */
const ritualSummon: Move<GState> = (
  { G, ctx, playerID }, ritualSpellHandIndex: number, ritualMonsterId: string,
  tributes: Array<{ from: 'hand' | 'field'; handIndex?: number; fieldUid?: string }>,
) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  const rSpell = CARDS[p.hand[ritualSpellHandIndex]];
  if (!rSpell || !isSpell(rSpell) || rSpell.subtype !== 'ritual') return INVALID_MOVE;
  if (!rSpell.ritualMonsterIds?.includes(ritualMonsterId)) return INVALID_MOVE;
  const rdef = CARDS[ritualMonsterId];
  if (!isMonster(rdef) || rdef.subtype !== 'ritual') return INVALID_MOVE;
  // Ritual monster must be in hand.
  const ritIdx = p.hand.indexOf(ritualMonsterId);
  if (ritIdx === -1) return INVALID_MOVE;
  // Sum tribute levels.
  let total = 0;
  const handIdxs: number[] = [];
  const fieldUids: string[] = [];
  for (const t of tributes) {
    let lvl = 0;
    if (t.from === 'hand' && typeof t.handIndex === 'number') {
      const id = p.hand[t.handIndex];
      const d = CARDS[id]; if (!isMonster(d)) return INVALID_MOVE;
      lvl = d.level ?? 0;
      handIdxs.push(t.handIndex);
    } else if (t.from === 'field' && t.fieldUid) {
      const f = findOnField(G, t.fieldUid);
      if (!f || f.ownerId !== playerID) return INVALID_MOVE;
      const d = CARDS[f.inst.defId]; if (!isMonster(d)) return INVALID_MOVE;
      lvl = d.level ?? 0;
      fieldUids.push(t.fieldUid);
    } else return INVALID_MOVE;
    total += lvl;
  }
  if (total < (rdef.ritualLevelCost ?? rdef.level ?? 0)) return INVALID_MOVE;

  // Pay everything.
  for (const i of handIdxs.sort((a, b) => b - a)) { const d = p.hand.splice(i, 1)[0]; if (d) sendToGy(G, playerID, d); }
  for (const u of fieldUids) {
    const f = findOnField(G, u)!;
    sendToGy(G, playerID, f.inst.defId);
    clearZone(p, f.zone, f.index);
  }
  p.hand.splice(p.hand.indexOf(ritualMonsterId), 1);
  p.hand.splice(p.hand.indexOf(rSpell.id), 1);
  sendToGy(G, playerID, rSpell.id);

  const slot = firstEmpty(p.monsterZones);
  if (slot === -1) return INVALID_MOVE;
  p.monsterZones[slot] = mkInstance(ritualMonsterId, { position: 'atk', faceUp: true, specialSummoned: true });
  G.log.push(`Player ${playerID} Ritual Summons ${rdef.name}.`);
};

/** Link Summon: send Link-rating # of monsters to summon a Link from the Extra Deck. */
const linkSummon: Move<GState> = ({ G, ctx, playerID }, linkMonsterId: string, materialUids: string[]) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'main1' && currentPhase(ctx) !== 'main2') return INVALID_MOVE;
  const p = G.players[playerID];
  if (!p.extraDeck.includes(linkMonsterId)) return INVALID_MOVE;
  const ldef = CARDS[linkMonsterId];
  if (!isMonster(ldef) || ldef.subtype !== 'link') return INVALID_MOVE;
  if (materialUids.length !== (ldef.linkRating ?? 0)) return INVALID_MOVE;
  const mats: Located[] = [];
  for (const u of materialUids) {
    const f = findOnField(G, u);
    if (!f || f.ownerId !== playerID) return INVALID_MOVE;
    mats.push(f);
  }
  for (const f of mats) { sendToGy(G, playerID, f.inst.defId); clearZone(p, f.zone, f.index); }
  const inst = mkInstance(linkMonsterId, { position: 'atk', faceUp: true, specialSummoned: true });
  // Link monsters always go to Extra Monster Zone (or a Main Zone pointed at by an existing Link).
  if (!p.extraMonsterZone) p.extraMonsterZone = inst;
  else {
    const slot = firstEmpty(p.monsterZones);
    if (slot === -1) return INVALID_MOVE;
    p.monsterZones[slot] = inst;
  }
  p.extraDeck.splice(p.extraDeck.indexOf(linkMonsterId), 1);
  G.log.push(`Player ${playerID} Link Summons ${ldef.name} (Link ${ldef.linkRating}).`);
};

// ── Battle ───────────────────────────────────────────────────────────────────

/** Declare an attack with one of your monsters. */
const declareAttack: Move<GState> = ({ G, ctx, playerID }, attackerUid: string, targetUid: string | null) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (currentPhase(ctx) !== 'battle') return INVALID_MOVE;
  // First player on turn 1 cannot battle.
  if (!G.pastFirstTurn && playerID === G.firstPlayer) return INVALID_MOVE;

  const me = G.players[playerID];
  const opp = G.players[otherPlayer(ctx)];
  const att = findOnField(G, attackerUid);
  if (!att || att.ownerId !== playerID) return INVALID_MOVE;
  if (att.zone !== 'monsterZones' && att.zone !== 'extraMonsterZone') return INVALID_MOVE;
  if (att.inst.position !== 'atk' || !att.inst.faceUp) return INVALID_MOVE;
  if (att.inst.attackedThisTurn) return INVALID_MOVE;

  // Direct attack only allowed if opponent has no monsters (or attacker has special ability).
  const oppHasMonsters = opp.monsterZones.some(Boolean) || !!opp.extraMonsterZone;
  let target: Located | null = null;
  if (targetUid && targetUid !== '__direct__') {
    target = findOnField(G, targetUid);
    if (!target || target.ownerId === playerID) return INVALID_MOVE;
    if (target.zone !== 'monsterZones' && target.zone !== 'extraMonsterZone') return INVALID_MOVE;
  } else {
    if (oppHasMonsters) {
      // Check "can attack directly if alone" ability.
      const attDef = CARDS[att.inst.defId];
      const aloneOk = isMonster(attDef) && attDef.effects?.some(
        e => e.timing === 'continuous' && e.effect === 'mon_continuous_direct_attack_if_only_monster',
      );
      const isOnlyMonster = me.monsterZones.filter(Boolean).length + (me.extraMonsterZone ? 1 : 0) === 1;
      if (!(aloneOk && isOnlyMonster)) return INVALID_MOVE;
    }
  }

  att.inst.attackedThisTurn = true;
  G.battle = { kind: 'damage_window', attackerUid, targetUid: target?.inst.uid ?? '__direct__' };
  G.log.push(`Player ${playerID} declares an attack with ${CARDS[att.inst.defId].name}${target ? ` on ${CARDS[target.inst.defId].name}` : ' directly'}.`);

  // Hand priority to the defender for a chain window (Quick-Play / Trap response).
  G.priorityResponse = { playerID: otherPlayer(ctx), allowedSpellSpeed: 2 };
};

/** Defender (or attacker after the response window) confirms the attack resolves. */
const resolveAttack: Move<GState> = ({ G, ctx, playerID }) => {
  if (G.battle.kind !== 'damage_window') return INVALID_MOVE;
  if (playerID == null) return INVALID_MOVE;
  // Only the defender (priority holder) clicks resolve. If they already passed via passChain, we'd be idle.
  // We allow either side to confirm if no responses are pending.
  if (G.priorityResponse) return INVALID_MOVE;
  if (G.battle.kind !== 'damage_window') return INVALID_MOVE;

  const atkLoc = findOnField(G, G.battle.attackerUid);
  if (!atkLoc) { G.battle = { kind: 'idle' }; return; }
  const me = G.players[atkLoc.ownerId];
  const opp = G.players[otherPlayer({ currentPlayer: atkLoc.ownerId, playOrder: Object.keys(G.players) })];
  const oppId = otherPlayer({ currentPlayer: atkLoc.ownerId, playOrder: Object.keys(G.players) });
  const atkVal = effectiveAtk(G, atkLoc.ownerId, atkLoc.inst);

  if (G.battle.targetUid === '__direct__') {
    opp.lp = Math.max(0, opp.lp - atkVal);
    G.log.push(`Direct attack: Player ${oppId} loses ${atkVal} LP (LP=${opp.lp}).`);
    G.battle = { kind: 'idle' };
    return;
  }

  const tgt = findOnField(G, G.battle.targetUid);
  if (!tgt) { G.battle = { kind: 'idle' }; return; }
  // Flip face-down target if needed.
  if (!tgt.inst.faceUp) {
    tgt.inst.faceUp = true;
    G.log.push(`${CARDS[tgt.inst.defId].name} is flipped face-up.`);
    // Flip effect resolves
    const tdef = CARDS[tgt.inst.defId];
    if (isMonster(tdef) && tdef.effects) {
      for (const e of tdef.effects) {
        if (e.timing === 'flip') runEffectImmediate(G, tgt.ownerId, atkLoc.ownerId, e.effect, undefined);
      }
    }
  }

  if (tgt.inst.position === 'atk') {
    const defVal = effectiveAtk(G, tgt.ownerId, tgt.inst);
    if (atkVal > defVal) {
      const dmg = atkVal - defVal;
      opp.lp = Math.max(0, opp.lp - dmg);
      destroyCard(G, tgt, 'battle');
      G.log.push(`${oppId} takes ${dmg} damage (LP=${opp.lp}).`);
    } else if (atkVal < defVal) {
      const dmg = defVal - atkVal;
      me.lp = Math.max(0, me.lp - dmg);
      destroyCard(G, atkLoc, 'battle');
      G.log.push(`${atkLoc.ownerId} takes ${dmg} damage (LP=${me.lp}).`);
    } else {
      destroyCard(G, atkLoc, 'battle');
      destroyCard(G, tgt, 'battle');
      G.log.push(`Both monsters are destroyed.`);
    }
  } else {
    // Defense Position target — compare ATK vs DEF.
    const defVal = effectiveDef(G, tgt.ownerId, tgt.inst);
    if (atkVal > defVal) {
      destroyCard(G, tgt, 'battle');
      if (isPiercer(G, atkLoc.ownerId, atkLoc.inst)) {
        const dmg = atkVal - defVal;
        opp.lp = Math.max(0, opp.lp - dmg);
        G.log.push(`${oppId} takes ${dmg} piercing damage (LP=${opp.lp}).`);
      }
    } else if (atkVal < defVal) {
      const dmg = defVal - atkVal;
      me.lp = Math.max(0, me.lp - dmg);
      G.log.push(`${atkLoc.ownerId} takes ${dmg} damage (LP=${me.lp}).`);
    } else {
      // tie — neither destroyed
      G.log.push(`Tie in battle; no monster destroyed.`);
    }
  }
  G.battle = { kind: 'idle' };
};

// ── Phase / turn advance ─────────────────────────────────────────────────────

/** Move to the next phase. */
const advancePhase: Move<GState> = ({ G, ctx, playerID, events }) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  // Don't allow phase advance while a chain is active.
  if (G.chain.length > 0 || G.priorityResponse) return INVALID_MOVE;

  const phase = currentPhase(ctx);
  switch (phase) {
    case 'draw':    events!.endPhase(); break;
    case 'standby': events!.endPhase(); break;
    case 'main1':   events!.setPhase('battle'); break;
    case 'battle':  events!.setPhase('main2'); break;
    case 'main2':   events!.setPhase('end'); break;
    case 'end':     events!.endTurn(); break;
  }
};

/** Skip directly to end of turn (discard down to 6, end turn). */
const endTurnMove: Move<GState> = ({ G, ctx, playerID, events }) => {
  if (playerID == null || ctx.currentPlayer !== playerID) return INVALID_MOVE;
  if (G.chain.length > 0 || G.priorityResponse) return INVALID_MOVE;
  endOfTurnCleanup(G, ctx);
  events!.endTurn();
};

function endOfTurnCleanup(G: GState, ctx: any) {
  const p = G.players[ctx.currentPlayer];
  while (p.hand.length > 6) p.graveyard.push(p.hand.pop()!);
  // Reset per-turn flags.
  for (const z of [p.monsterZones, p.spellTrapZones]) {
    for (const c of z) if (c) {
      c.attackedThisTurn = false;
      c.positionChangedThisTurn = false;
      c.setThisTurn = false;
      if (c.effectsUsed) {
        delete c.effectsUsed.qp_pump_1000;
        delete c.effectsUsed.this_turn;
      }
    }
  }
  if (p.extraMonsterZone) {
    p.extraMonsterZone.attackedThisTurn = false;
    p.extraMonsterZone.positionChangedThisTurn = false;
    p.extraMonsterZone.setThisTurn = false;
  }
  // End-of-turn burn from continuous spells.
  const opp = G.players[otherPlayer(ctx)];
  for (const c of [...p.spellTrapZones, p.fieldZone]) {
    if (!c?.faceUp) continue;
    const def = CARDS[c.defId];
    if (isSpell(def) && def.subtype === 'continuous' && def.effect === 'sp_cont_burn_300_each_endphase') {
      opp.lp = Math.max(0, opp.lp - 300);
      G.log.push(`Player ${otherPlayer(ctx)} takes 300 damage (LP=${opp.lp}).`);
    }
  }
}

const forceEndTurn: Move<GState> = ({ G, ctx, events }) => {
  if (!G.turnDeadline || Date.now() < G.turnDeadline) return INVALID_MOVE;
  endOfTurnCleanup(G, ctx);
  G.chain = []; G.priorityResponse = undefined; G.battle = { kind: 'idle' };
  G.log.push(`Turn auto-ended for Player ${ctx.currentPlayer} (AFK / timeout).`);
  events!.endTurn();
};

// ── Game export ──────────────────────────────────────────────────────────────

export const ChainsTCG: Game<GState> = {
  name: 'duelmasters',
  minPlayers: 2,
  maxPlayers: 2,

  setup: (ctxLike, setupData?: SetupData) => setupGame(ctxLike, setupData),

  turn: {
    stages: {
      afk: { moves: { forceEndTurn } },
      // The chain-response stage lets the non-turn player chain in response to spells/traps/attacks.
      respond: {
        moves: { activateCard, passChain },
      },
    },
    onBegin: ({ G, ctx, events }) => {
      const p = G.players[ctx.currentPlayer];
      p.hasNormalSummoned = false;
      p.hasDrawnForTurn = false;
      for (const z of [p.monsterZones, p.spellTrapZones]) {
        for (const c of z) if (c) {
          c.attackedThisTurn = false;
          c.positionChangedThisTurn = false;
        }
      }
      if (p.extraMonsterZone) {
        p.extraMonsterZone.attackedThisTurn = false;
        p.extraMonsterZone.positionChangedThisTurn = false;
      }
      G.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
      if (ctx.phase === 'draw' || ctx.phase === 'standby' || ctx.phase === 'main1' || ctx.phase === 'battle' || ctx.phase === 'main2' || ctx.phase === 'end') {
        events!.setActivePlayers({ currentPlayer: Stage.NULL, others: 'afk', revert: false });
      }
      G.log.push(`— Turn ${ctx.turn}: Player ${ctx.currentPlayer} (${p.color}) —`);
    },
    onEnd: ({ G, ctx }) => {
      G.battle = { kind: 'idle' };
      G.chain = [];
      G.priorityResponse = undefined;
      if (ctx.currentPlayer === G.firstPlayer) G.pastFirstTurn = true;
      // Continuous-spell extra draw triggers next standby; handled in Standby phase onBegin.
    },
  },

  moves: {
    chooseColor, keepHand, mulligan, forceKeepOpponent,
    normalSummon, tributeSummon, flipSummon, changePosition,
    setSpellTrap, activateCard, passChain,
    fusionSummon, synchroSummon, xyzSummon, ritualSummon, linkSummon,
    declareAttack, resolveAttack,
    advancePhase, endTurnMove, forceEndTurn,
  },

  phases: {
    pick: {
      start: true,
      moves: { chooseColor },
      turn: { activePlayers: ActivePlayers.ALL },
      endIf: ({ G }) => !pickingPending(G),
      next: 'mulligan',
    },
    mulligan: {
      moves: { keepHand, mulligan, forceKeepOpponent },
      onBegin: ({ G }) => { G.mulligan.deadline = Date.now() + MULLIGAN_TIMEOUT_MS; },
      turn: { activePlayers: ActivePlayers.ALL },
      endIf: ({ G }) => Object.values(G.mulligan.done).every(Boolean),
      next: 'draw',
    },
    draw: {
      moves: { advancePhase, forceEndTurn },
      onBegin: ({ G, ctx }) => {
        // First-player turn-1 skips the draw.
        if (ctx.turn === 1 && ctx.currentPlayer === G.firstPlayer) return;
        drawCard(G, ctx.currentPlayer, 1);
        G.players[ctx.currentPlayer].hasDrawnForTurn = true;
      },
      next: 'standby',
    },
    standby: {
      moves: { activateCard, advancePhase, forceEndTurn },
      onBegin: ({ G, ctx }) => {
        const p = G.players[ctx.currentPlayer];
        // Continuous-spell "extra draw" triggers each standby.
        for (const c of [...p.spellTrapZones, p.fieldZone]) {
          if (!c?.faceUp) continue;
          const def = CARDS[c.defId];
          if (isSpell(def) && def.subtype === 'continuous' && def.effect === 'sp_cont_extra_draw_per_turn') {
            drawCard(G, ctx.currentPlayer, 1);
            G.log.push(`Standby Phase: ${def.name} grants an extra draw.`);
          }
        }
      },
      next: 'main1',
    },
    main1: {
      moves: {
        normalSummon, tributeSummon, flipSummon, changePosition,
        setSpellTrap, activateCard, passChain,
        fusionSummon, synchroSummon, xyzSummon, ritualSummon, linkSummon,
        advancePhase, endTurnMove, forceEndTurn,
      },
      next: 'battle',
    },
    battle: {
      moves: {
        declareAttack, resolveAttack, activateCard, passChain,
        advancePhase, endTurnMove, forceEndTurn,
      },
      next: 'main2',
    },
    main2: {
      moves: {
        normalSummon, tributeSummon, flipSummon, changePosition,
        setSpellTrap, activateCard, passChain,
        fusionSummon, synchroSummon, xyzSummon, ritualSummon, linkSummon,
        advancePhase, endTurnMove, forceEndTurn,
      },
      next: 'end',
    },
    end: {
      moves: { advancePhase, endTurnMove, forceEndTurn },
      onBegin: ({ G, ctx, events }) => {
        endOfTurnCleanup(G, ctx);
        events!.endTurn();
      },
    },
  },

  endIf: ({ G, ctx }) => {
    const losers = Object.entries(G.players).filter(([, p]) => p.lp <= 0).map(([pid]) => pid);
    if (losers.length === 0) return;
    if (losers.length === ctx.numPlayers) return { draw: true };
    const winner = ctx.playOrder.find(p => !losers.includes(p))!;
    return { winner };
  },

  playerView: ({ G, playerID }) => {
    const viewG: GState = JSON.parse(JSON.stringify(G));
    // Hide deck contents — only expose sizes.
    const mainCounts: Record<string, number> = {};
    const extraCounts: Record<string, number> = {};
    for (const pid of Object.keys(viewG.players)) {
      mainCounts[pid] = viewG.players[pid].mainDeck.length;
      extraCounts[pid] = viewG.players[pid].extraDeck.length;
      viewG.players[pid].mainDeck = [];
      // Each player can see their own extra deck.
      if (pid !== playerID) viewG.players[pid].extraDeck = [];
    }
    for (const pid of Object.keys(viewG.secret.mainDecks)) viewG.secret.mainDecks[pid] = [];
    for (const pid of Object.keys(viewG.secret.extraDecks)) viewG.secret.extraDecks[pid] = [];
    (viewG as any).deckCounts = mainCounts;
    (viewG as any).extraDeckCounts = extraCounts;
    // Hide opponent's hand.
    for (const pid of Object.keys(viewG.players)) {
      if (pid !== playerID) {
        const handLen = viewG.players[pid].hand.length;
        viewG.players[pid].hand = Array(handLen).fill('hidden');
      }
      // Hide face-down monsters' identities for opponents.
      if (pid !== playerID) {
        for (let i = 0; i < viewG.players[pid].monsterZones.length; i++) {
          const z = viewG.players[pid].monsterZones[i];
          if (z && !z.faceUp) z.defId = 'hidden';
        }
        for (let i = 0; i < viewG.players[pid].spellTrapZones.length; i++) {
          const z = viewG.players[pid].spellTrapZones[i];
          if (z && !z.faceUp) z.defId = 'hidden';
        }
      }
    }
    return viewG;
  },
};

export type { CardDef } from './cards';
export { CARDS, COLORS, COLOR_META, STARTER_DECKS, STARTER_EXTRA_DECKS } from './cards';

// PlayerView re-export kept for back-compat.
export { PlayerView };
