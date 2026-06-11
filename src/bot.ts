// src/bot.ts
// Heuristic single-player bot for Duelmasters (YGO TCG ruleset).
//
// Three difficulties:
//   - 'easy'   — random legal move from enumerator
//   - 'normal' — priority list: summon largest castable → attack profitable
//                trades → set spells/traps → advance phases → end turn
//   - 'hard'   — same heuristic but more aggressive (face-attacks for lethal,
//                blocks even trades, tributes for big bombs)

import { Bot } from 'boardgame.io/ai';
import type { BotAction } from 'boardgame.io/dist/types/src/ai/bot';
import {
  CARDS, COLORS, isMonster, isSpell, isTrap, isExtraDeckMonster, tributesRequired,
  type CardDef, type MonsterDef,
} from './cards';

export type Difficulty = 'easy' | 'normal' | 'hard';

type AnyState = any;

function makeMove(type: string, args: any[], playerID: string): BotAction {
  return { type: 'MAKE_MOVE', payload: { type, args, playerID } } as any;
}

function noop(playerID: string): BotAction {
  return { type: 'MAKE_MOVE', payload: { type: '__bot_skip__', args: [], playerID } } as any;
}

// ── Enumerator: every legal move in the current state ──────────────────────
export function enumerateMoves(G: AnyState, ctx: any, playerID: string): BotAction[] {
  const out: BotAction[] = [];
  const phase = ctx.phase as string | undefined;

  if (phase === 'pick') {
    if (G.players?.[playerID]?.needsColorPick) {
      for (const c of COLORS) out.push(makeMove('chooseColor', [c], playerID));
    }
    return out;
  }
  if (phase === 'mulligan') {
    if (!G.mulligan?.done?.[playerID]) {
      out.push(makeMove('keepHand', [], playerID));
      out.push(makeMove('mulligan', [], playerID));
    }
    return out;
  }

  // Defender chain response window: pass (don't auto-chain to keep it simple).
  if (G.priorityResponse?.playerID === playerID) {
    out.push(makeMove('passChain', [], playerID));
    return out;
  }
  if (ctx.currentPlayer !== playerID) return out;

  const p = G.players?.[playerID];
  if (!p) return out;

  if (phase === 'main1' || phase === 'main2') {
    // Normal summons + sets
    for (let i = 0; i < p.hand.length; i++) {
      const def = CARDS[p.hand[i]];
      if (!def) continue;
      if (isMonster(def) && !isExtraDeckMonster(def) && def.subtype !== 'ritual') {
        const lvl = def.level ?? 0;
        if (lvl <= 4 && !p.hasNormalSummoned && p.monsterZones.some((z: any) => z === null)) {
          out.push(makeMove('normalSummon', [i, false, false], playerID));
        } else if (lvl >= 5 && !p.hasNormalSummoned) {
          const need = tributesRequired(lvl);
          const available = p.monsterZones.filter((z: any) => z).map((z: any) => z.uid);
          if (available.length >= need && p.monsterZones.some((z: any) => z === null || true)) {
            const picks = available.slice(0, need);
            out.push(makeMove('tributeSummon', [i, picks, false, false], playerID));
          }
        }
      }
      if ((isSpell(def) || isTrap(def)) && p.spellTrapZones.some((z: any) => z === null)) {
        out.push(makeMove('setSpellTrap', [i], playerID));
        if (isSpell(def) && def.subtype !== 'ritual') {
          out.push(makeMove('activateCard', [{ handIndex: i }], playerID));
        }
      }
    }
    out.push(makeMove('advancePhase', [], playerID));
  }

  if (phase === 'battle') {
    const opp = G.players[playerID === '0' ? '1' : '0'];
    const oppHas = opp.monsterZones.some((z: any) => z) || !!opp.extraMonsterZone;
    for (const z of [...p.monsterZones, p.extraMonsterZone]) {
      if (!z || z.position !== 'atk' || !z.faceUp || z.attackedThisTurn) continue;
      if (!oppHas) {
        out.push(makeMove('declareAttack', [z.uid, '__direct__'], playerID));
      } else {
        for (const t of [...opp.monsterZones, opp.extraMonsterZone]) {
          if (!t) continue;
          out.push(makeMove('declareAttack', [z.uid, t.uid], playerID));
        }
      }
    }
    out.push(makeMove('resolveAttack', [], playerID));
    out.push(makeMove('advancePhase', [], playerID));
  }

  if (phase === 'draw' || phase === 'standby' || phase === 'end') {
    out.push(makeMove('advancePhase', [], playerID));
  }

  return out;
}

// ── Card priorities ────────────────────────────────────────────────────────
function cardPriority(def: CardDef, diff: Difficulty): number {
  if (isMonster(def)) {
    let s = (def.atk ?? 0) / 100;
    if (diff === 'hard') s += (def.level ?? 0) * 2;
    return s;
  }
  if (isSpell(def)) {
    let s = 5;
    if (def.subtype === 'continuous') s += 3;
    if (def.subtype === 'normal') s += 2;
    if (def.subtype === 'field') s += 2;
    return s;
  }
  if (isTrap(def)) return 4;
  return 0;
}

export class MMTCGBot extends Bot {
  private difficulty: Difficulty;
  constructor(args: { difficulty?: Difficulty; enumerate?: any; seed?: string | number }) {
    super({ enumerate: args.enumerate ?? enumerateMoves, seed: args.seed });
    this.difficulty = args.difficulty ?? 'normal';
  }

  async play(state: AnyState, playerID: string): Promise<{ action: BotAction }> {
    const compute = (): { action: BotAction } | null => this._compute(state, playerID);
    const result = compute();
    if (!result) return { action: noop(playerID) };
    if (state.ctx.phase !== 'pick' && state.ctx.phase !== 'mulligan') {
      const jitter = 500 + Math.floor(Math.random() * 400);
      await new Promise(r => setTimeout(r, jitter));
    }
    return result;
  }

  private _compute(state: AnyState, playerID: string): { action: BotAction } | null {
    const { G, ctx } = state;

    if (ctx.phase === 'pick' && G.players?.[playerID]?.needsColorPick) {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      return { action: makeMove('chooseColor', [c], playerID) };
    }

    if (ctx.phase === 'mulligan' && !G.mulligan?.done?.[playerID]) {
      const p = G.players[playerID];
      const monsters = (p.hand ?? []).filter((id: string) => isMonster(CARDS[id])).length;
      const alreadyMulled = (G.mulligan?.counts?.[playerID] ?? 0) >= 1;
      if (alreadyMulled || monsters >= 2 || this.difficulty === 'easy') {
        return { action: makeMove('keepHand', [], playerID) };
      }
      return { action: makeMove('mulligan', [], playerID) };
    }

    // Defender response window: don't chain (simple bot).
    if (G.priorityResponse?.playerID === playerID) {
      return { action: makeMove('passChain', [], playerID) };
    }

    if (ctx.currentPlayer !== playerID) return { action: noop(playerID) };

    const p = G.players[playerID];
    const oppId = playerID === '0' ? '1' : '0';
    const opp = G.players[oppId];

    // Phase-based behaviour.
    if (ctx.phase === 'draw' || ctx.phase === 'standby') {
      return { action: makeMove('advancePhase', [], playerID) };
    }

    if (ctx.phase === 'main1' || ctx.phase === 'main2') {
      if (this.difficulty === 'easy') {
        const all = enumerateMoves(G, ctx, playerID);
        if (all.length === 0) return { action: makeMove('advancePhase', [], playerID) };
        return { action: all[Math.floor(Math.random() * all.length)] };
      }
      // 1. Tribute Summon a big monster if we can afford it
      const handMonsters = (p.hand as string[])
        .map((id, idx) => ({ idx, def: CARDS[id] }))
        .filter(x => isMonster(x.def) && !isExtraDeckMonster(x.def) && x.def.subtype !== 'ritual')
        .sort((a, b) => cardPriority(b.def, this.difficulty) - cardPriority(a.def, this.difficulty));
      if (!p.hasNormalSummoned) {
        for (const m of handMonsters) {
          const def = m.def as MonsterDef;
          const lvl = def.level ?? 0;
          const need = tributesRequired(lvl);
          if (need === 0 && p.monsterZones.some((z: any) => z === null)) {
            return { action: makeMove('normalSummon', [m.idx, false, false], playerID) };
          }
          if (need > 0) {
            const available = p.monsterZones.filter((z: any) => z).map((z: any) => z.uid);
            if (available.length >= need) {
              const picks = available.slice(0, need);
              return { action: makeMove('tributeSummon', [m.idx, picks, false, false], playerID) };
            }
          }
        }
      }
      // 2. Activate a spell if useful.
      for (let i = 0; i < p.hand.length; i++) {
        const def = CARDS[p.hand[i]];
        if (!def || !isSpell(def)) continue;
        if (def.subtype === 'ritual') continue;
        if (def.effect === 'sp_destroy_target_monster' && (opp.monsterZones.some((z: any) => z) || opp.extraMonsterZone)) {
          const target = [...opp.monsterZones, opp.extraMonsterZone].find((z: any) => z) as any;
          return { action: makeMove('activateCard', [{ handIndex: i }, target.uid], playerID) };
        }
        if (def.effect === 'sp_draw_2' || def.effect === 'sp_burn_1000' || def.effect === 'sp_heal_2000') {
          return { action: makeMove('activateCard', [{ handIndex: i }], playerID) };
        }
        if (def.subtype === 'continuous' || def.subtype === 'field') {
          return { action: makeMove('activateCard', [{ handIndex: i }], playerID) };
        }
      }
      // 3. Set traps face-down.
      for (let i = 0; i < p.hand.length; i++) {
        const def = CARDS[p.hand[i]];
        if (isTrap(def) && p.spellTrapZones.some((z: any) => z === null)) {
          return { action: makeMove('setSpellTrap', [i], playerID) };
        }
      }
      // 4. Advance to next phase.
      return { action: makeMove('advancePhase', [], playerID) };
    }

    if (ctx.phase === 'battle') {
      // Skip battle if first player on turn 1.
      if (!G.pastFirstTurn && playerID === G.firstPlayer) {
        return { action: makeMove('advancePhase', [], playerID) };
      }
      const oppHas = opp.monsterZones.some((z: any) => z) || !!opp.extraMonsterZone;
      const myAttackers = [...p.monsterZones, p.extraMonsterZone]
        .filter((z: any) => z && z.position === 'atk' && z.faceUp && !z.attackedThisTurn)
        .sort((a: any, b: any) => (CARDS[b.defId] as any).atk - (CARDS[a.defId] as any).atk);
      if (myAttackers.length === 0) {
        return { action: makeMove('advancePhase', [], playerID) };
      }
      const attacker = myAttackers[0] as any;
      const atk = (CARDS[attacker.defId] as any).atk;
      if (!oppHas) {
        return { action: makeMove('declareAttack', [attacker.uid, '__direct__'], playerID) };
      }
      // Find a profitable target.
      const targets = [...opp.monsterZones, opp.extraMonsterZone].filter((z: any) => z) as any[];
      let best: any = null;
      for (const t of targets) {
        const td = CARDS[t.defId] as any;
        const compareVal = t.position === 'atk' ? td.atk : (td.def ?? 0);
        if (atk > compareVal && (best == null || compareVal > (CARDS[best.defId] as any).atk)) best = t;
      }
      if (best) {
        return { action: makeMove('declareAttack', [attacker.uid, best.uid], playerID) };
      }
      if (this.difficulty === 'hard') {
        // Attack anyway if it would kill the opponent via direct (won't happen if oppHas)
        // Or attack a same-ATK monster for a trade
        const trade = targets.find((t: any) => {
          const td = CARDS[t.defId] as any;
          return t.position === 'atk' && td.atk === atk;
        });
        if (trade) return { action: makeMove('declareAttack', [attacker.uid, trade.uid], playerID) };
      }
      return { action: makeMove('advancePhase', [], playerID) };
    }

    // End phase or anything else.
    return { action: makeMove('advancePhase', [], playerID) };
  }
}
