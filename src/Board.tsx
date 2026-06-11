// src/Board.tsx
// React UI for Duelmasters — Yu-Gi-Oh TCG-style playmat.
//
// Layout:
//   Opponent's row:  Hand · Field Spell · Spell/Trap Zones (5) · Extra Monster Zone · GY
//                    Monster Zones (5)
//   Battlefield gap (chain/battle state shown here)
//   My side:         Monster Zones (5)
//                    Spell/Trap Zones (5) · Field Spell · Extra Monster Zone · GY · Hand
//
// Implements LP, hand, phase advance buttons (Draw / Standby / Main1 / Battle /
// Main2 / End), summon dialogs (Normal/Tribute/Flip/Special), spell/trap
// activation, attack declaration, chain stack visualisation, and end-phase
// hand-cap UI.

import React, { useState, useMemo, useEffect } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import {
  CARDS, COLOR_META, isMonster, isSpell, isTrap, isExtraDeckMonster, tributesRequired,
  type CardDef, type Color, type MonsterDef,
} from './cards';
import type { GState, Instance, ChainLink, PlayerState } from './Game';
import {
  mulliganDrawCount, MULLIGAN_FLOOR, MULLIGAN_INITIAL_HAND,
} from './Game';
import { CardHover } from './CardPreview';

type Props = BoardProps<GState>;

// ── Layout constants ────────────────────────────────────────────────────────

const CARD_W = 84;
const CARD_H = 120;
const ZONE_GAP = 6;

// ── Helpers ─────────────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 720) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
  useEffect(() => {
    const onR = () => setM(window.innerWidth < breakpoint);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [breakpoint]);
  return m;
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

// ── Mini cards / zone slots ─────────────────────────────────────────────────

function MiniCard({ inst, faceDown = false, onClick, highlight, rotateDef = false }: {
  inst: Instance | null;
  faceDown?: boolean;
  onClick?: () => void;
  highlight?: 'attacker' | 'target' | 'selected' | null;
  rotateDef?: boolean;
}) {
  if (!inst) {
    return (
      <div style={{
        width: CARD_W, height: CARD_H,
        border: '1px dashed #444', borderRadius: 6,
        background: 'rgba(255,255,255,0.02)',
      }} />
    );
  }
  const isFaceDown = !inst.faceUp || faceDown || inst.defId === 'hidden';
  const def = !isFaceDown ? CARDS[inst.defId] : null;
  const meta = def ? COLOR_META[def.color] : null;
  const isDef = inst.position === 'def_up' || inst.position === 'def_down';
  const ringColor =
    highlight === 'attacker' ? '#ff5a4a' :
    highlight === 'target'   ? '#5af0ff' :
    highlight === 'selected' ? '#facc15' : null;

  const inner = (
    <div onClick={onClick}
      style={{
        width: CARD_W, height: CARD_H, cursor: onClick ? 'pointer' : 'default',
        background: isFaceDown ? '#1a1b2a' : meta?.hex ?? '#1a1b2a',
        color: meta?.ink ?? '#fff',
        border: '1px solid #000', borderRadius: 6,
        transform: (isDef || rotateDef) ? 'rotate(90deg)' : 'none',
        boxShadow: ringColor ? `0 0 0 2px ${ringColor}, 0 4px 12px rgba(0,0,0,0.6)` : '0 4px 12px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
        fontSize: 10,
      }}>
      {isFaceDown ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%', color: '#4a4a6a', fontWeight: 800, fontSize: 11,
        }}>
          ?
        </div>
      ) : def ? (
        <>
          <div style={{
            padding: '3px 4px', fontSize: 9, fontWeight: 800, lineHeight: 1.1,
            background: 'rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{def.name}</div>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.15)', position: 'relative',
          }}>
            {def.image ? (
              <img src={def.image} alt={def.name}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ fontSize: 18, fontWeight: 900, color: meta?.ink }}>{meta?.glyph}</div>
            )}
          </div>
          <div style={{
            padding: '2px 4px', fontSize: 9, background: 'rgba(0,0,0,0.6)', color: '#fff',
            textAlign: 'right',
          }}>{statBadge(def)}</div>
        </>
      ) : null}
    </div>
  );

  if (def) return <CardHover defId={inst.defId}>{inner}</CardHover>;
  return inner;
}

function ZoneRow({ instances, label, onClickZone }: {
  instances: Array<Instance | null>;
  label: string;
  onClickZone?: (index: number, inst: Instance | null) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ display: 'flex', gap: ZONE_GAP }}>
        {instances.map((inst, i) => (
          <div key={i} onClick={() => onClickZone?.(i, inst)}>
            <MiniCard inst={inst} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GraveyardSlot({ pile, label }: { pile: string[]; label: string }) {
  const top = pile[pile.length - 1];
  const def = top ? CARDS[top] : null;
  return (
    <div style={{ width: CARD_W, height: CARD_H, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 9, color: '#aaa', textAlign: 'center' }}>{label} ({pile.length})</div>
      <div style={{
        flex: 1, border: '1px dashed #555', borderRadius: 6,
        background: def ? COLOR_META[def.color].hex : 'rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 800,
      }}>
        {def ? def.name : '—'}
      </div>
    </div>
  );
}

// ── Hand bar ────────────────────────────────────────────────────────────────

function HandBar({
  hand, opponent = false, selected, onSelect,
}: {
  hand: string[];
  opponent?: boolean;
  selected?: number | null;
  onSelect?: (i: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 6, justifyContent: 'center',
      background: opponent ? 'rgba(255,80,80,0.05)' : 'rgba(80,200,255,0.05)',
      borderRadius: 6, minHeight: CARD_H + 12, flexWrap: 'wrap',
    }}>
      {hand.map((id, i) => {
        const def = id === 'hidden' ? null : CARDS[id];
        if (opponent || !def) {
          return (
            <div key={i} style={{
              width: CARD_W, height: CARD_H, background: '#1a1b2a',
              border: '1px solid #000', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444',
              fontSize: 20, fontWeight: 800,
            }}>?</div>
          );
        }
        const meta = COLOR_META[def.color];
        const isSel = selected === i;
        return (
          <CardHover key={i} defId={id}>
            <div onClick={() => onSelect?.(i)}
              style={{
                width: CARD_W, height: CARD_H, cursor: 'pointer',
                background: meta.hex, color: meta.ink,
                border: '1px solid #000', borderRadius: 6,
                boxShadow: isSel ? '0 0 0 3px #facc15, 0 4px 12px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.6)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden', fontSize: 10,
              }}>
              <div style={{
                padding: '3px 4px', fontSize: 9, fontWeight: 800, lineHeight: 1.1,
                background: 'rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{def.name}</div>
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.15)',
              }}>
                {def.image ? (
                  <img src={def.image} alt={def.name}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 900, color: meta.ink }}>{meta.glyph}</div>
                )}
              </div>
              <div style={{
                padding: '2px 4px', fontSize: 9, background: 'rgba(0,0,0,0.6)', color: '#fff', textAlign: 'right',
              }}>{statBadge(def)}</div>
            </div>
          </CardHover>
        );
      })}
    </div>
  );
}

// ── Playmat (image-backed YGO mat with positioned zone overlays) ───────────

const PLAYMAT_BG = '/playmat.jpg';
const PLAYMAT_ASPECT = 2000 / 1615;

// Slot grid percentages — calibrated to the playmat image's visible slots.
const COL = [2.5, 15.5, 28.5, 41.5, 54.5, 67.5, 80.5];
const COL_W = 11.5;
const ROW = { oppST: 2.5, oppMZ: 22, mid: 42, myMZ: 60, myST: 80 };
const ROW_H = 17;
// Extra Monster Zone slots sit between MZ columns 1-2 and 3-4 (centered).
const EMZ_L_LEFT = 31;
const EMZ_R_LEFT = 57;
const EMZ_W = 12;
// Banished slots — narrow tiles outside the 7-column grid on the middle row.
const BAN_W = 5;

function PlaymatSlot({
  top, left, width, height, label, children, onClick,
}: {
  top: number; left: number; width: number; height: number;
  label?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={label}
      style={{
        position: 'absolute',
        top: `${top}%`, left: `${left}%`,
        width: `${width}%`, height: `${height}%`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        padding: '3%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', height: '100%' }}>
        {children}
      </div>
    </div>
  );
}

function PlaymatCard({ inst, highlight, onClick }: {
  inst: Instance | null;
  highlight?: 'attacker' | 'target' | 'selected' | null;
  onClick?: () => void;
}) {
  if (!inst) {
    // Empty slot — fully transparent so the mat shows through.
    return (
      <div onClick={onClick} style={{
        width: '100%', height: '100%',
        cursor: onClick ? 'pointer' : 'default',
      }} />
    );
  }
  const isFaceDown = !inst.faceUp || inst.defId === 'hidden';
  const def = !isFaceDown ? CARDS[inst.defId] : null;
  const meta = def ? COLOR_META[def.color] : null;
  const isDef = inst.position === 'def_up' || inst.position === 'def_down';
  const ringColor =
    highlight === 'attacker' ? '#ff5a4a' :
    highlight === 'target'   ? '#5af0ff' :
    highlight === 'selected' ? '#facc15' : null;
  const card = (
    <div onClick={onClick}
      style={{
        width: '100%', height: '100%',
        background: isFaceDown ? '#0e0e22' : meta?.hex ?? '#1a1b2a',
        color: meta?.ink ?? '#fff',
        border: '1px solid #000', borderRadius: 6,
        transform: isDef ? 'rotate(90deg) scale(0.82)' : 'none',
        boxShadow: ringColor
          ? `0 0 0 2px ${ringColor}, 0 4px 14px rgba(0,0,0,0.85)`
          : '0 4px 14px rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 10,
      }}>
      {isFaceDown ? (
        <div style={{
          width: '100%', height: '100%',
          background: 'radial-gradient(circle, #2a2350 0%, #0e0e22 80%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#7a6cb0', fontSize: 18, fontWeight: 900,
        }}>?</div>
      ) : def ? (
        <>
          <div style={{
            padding: '3px 4px', fontSize: 9, fontWeight: 800, lineHeight: 1.1,
            background: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{def.name}</div>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.2)',
          }}>
            {def.image ? (
              <img src={def.image} alt={def.name}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ fontSize: 18, fontWeight: 900, color: meta?.ink }}>{meta?.glyph}</div>
            )}
          </div>
          <div style={{
            padding: '2px 4px', fontSize: 9, background: 'rgba(0,0,0,0.65)', color: '#fff',
            textAlign: 'right',
          }}>{statBadge(def)}</div>
        </>
      ) : null}
    </div>
  );
  if (def) return <CardHover defId={inst.defId}>{card}</CardHover>;
  return card;
}

function PileBadge({ count, label, accent = '#7aa6ff' }: {
  count: number; label: string; accent?: string;
}) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      background: 'rgba(0,0,0,0.45)', border: `1px solid ${accent}55`, borderRadius: 6,
      color: '#fff', fontWeight: 700, gap: 2,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: accent }}>{count}</div>
      <div style={{ fontSize: 9, color: '#ccc', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function YgoPlaymat({
  G, myId, oppId,
  selectedUid, attackerUid,
  onClickMonster, onClickSpellTrap,
}: {
  G: GState; myId: string; oppId: string;
  selectedUid: string | null; attackerUid: string | null;
  onClickMonster: (uid: string) => void;
  onClickSpellTrap: (uid: string) => void;
}) {
  const me = G.players[myId];
  const opp = G.players[oppId];

  function highlightOf(inst: Instance | null) {
    if (!inst) return null;
    if (attackerUid === inst.uid) return 'attacker' as const;
    if (selectedUid === inst.uid) return 'selected' as const;
    return null;
  }

  // Mirror opp's zone arrays so their "left" slot (from their POV) appears on
  // OUR right — matching the across-the-table convention shown by the mat.
  const oppMonsters = [...opp.monsterZones].reverse();
  const oppST       = [...opp.spellTrapZones].reverse();

  const oppDeck     = (G as any).deckCounts?.[oppId]      ?? opp.mainDeck.length;
  const oppExtra    = (G as any).extraDeckCounts?.[oppId] ?? opp.extraDeck.length;
  const myDeck      = (G as any).deckCounts?.[myId]       ?? me.mainDeck.length;
  const myExtra     = (G as any).extraDeckCounts?.[myId]  ?? me.extraDeck.length;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      aspectRatio: `${PLAYMAT_ASPECT}`,
      backgroundImage: `url(${PLAYMAT_BG})`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 10px 32px rgba(0,0,0,0.7)',
    }}>
      {/* ── Opponent Spell/Trap row ──────────────────────────────────────── */}
      <PlaymatSlot top={ROW.oppST} left={COL[0]} width={COL_W} height={ROW_H} label="Opponent Deck">
        <PileBadge count={oppDeck} label="Deck" accent="#ffa066" />
      </PlaymatSlot>
      {oppST.map((inst, i) => (
        <PlaymatSlot key={`opp-st-${i}`} top={ROW.oppST} left={COL[1 + i]} width={COL_W} height={ROW_H}>
          <PlaymatCard inst={inst} highlight={highlightOf(inst)}
            onClick={() => inst && onClickSpellTrap(inst.uid)} />
        </PlaymatSlot>
      ))}
      <PlaymatSlot top={ROW.oppST} left={COL[6]} width={COL_W} height={ROW_H} label="Opponent Extra Deck">
        <PileBadge count={oppExtra} label="Extra" accent="#c987ff" />
      </PlaymatSlot>

      {/* ── Opponent Monster row ─────────────────────────────────────────── */}
      <PlaymatSlot top={ROW.oppMZ} left={COL[0]} width={COL_W} height={ROW_H} label="Opponent Graveyard">
        <PileBadge count={opp.graveyard.length} label="GY" accent="#e2e2e2" />
      </PlaymatSlot>
      {oppMonsters.map((inst, i) => (
        <PlaymatSlot key={`opp-mz-${i}`} top={ROW.oppMZ} left={COL[1 + i]} width={COL_W} height={ROW_H}>
          <PlaymatCard inst={inst} highlight={highlightOf(inst)}
            onClick={() => inst && onClickMonster(inst.uid)} />
        </PlaymatSlot>
      ))}
      <PlaymatSlot top={ROW.oppMZ} left={COL[6]} width={COL_W} height={ROW_H} label="Opponent Field Spell">
        <PlaymatCard inst={opp.fieldZone} />
      </PlaymatSlot>

      {/* ── Middle row: Banished + 2 Extra Monster Zones ─────────────────── */}
      <PlaymatSlot top={ROW.mid + 1.5} left={0} width={BAN_W} height={ROW_H - 3} label="Opponent Banished">
        <PileBadge count={opp.banished.length} label="Banish" accent="#e2e2e2" />
      </PlaymatSlot>
      <PlaymatSlot top={ROW.mid} left={EMZ_L_LEFT} width={EMZ_W} height={ROW_H} label="Extra Monster Zone (L)">
        <PlaymatCard inst={opp.extraMonsterZone}
          highlight={highlightOf(opp.extraMonsterZone)}
          onClick={() => opp.extraMonsterZone && onClickMonster(opp.extraMonsterZone.uid)} />
      </PlaymatSlot>
      <PlaymatSlot top={ROW.mid} left={EMZ_R_LEFT} width={EMZ_W} height={ROW_H} label="Extra Monster Zone (R)">
        <PlaymatCard inst={me.extraMonsterZone}
          highlight={highlightOf(me.extraMonsterZone)}
          onClick={() => me.extraMonsterZone && onClickMonster(me.extraMonsterZone.uid)} />
      </PlaymatSlot>
      <PlaymatSlot top={ROW.mid + 1.5} left={100 - BAN_W} width={BAN_W} height={ROW_H - 3} label="My Banished">
        <PileBadge count={me.banished.length} label="Banish" accent="#e2e2e2" />
      </PlaymatSlot>

      {/* ── My Monster row ───────────────────────────────────────────────── */}
      <PlaymatSlot top={ROW.myMZ} left={COL[0]} width={COL_W} height={ROW_H} label="My Field Spell">
        <PlaymatCard inst={me.fieldZone} />
      </PlaymatSlot>
      {me.monsterZones.map((inst, i) => (
        <PlaymatSlot key={`my-mz-${i}`} top={ROW.myMZ} left={COL[1 + i]} width={COL_W} height={ROW_H}>
          <PlaymatCard inst={inst} highlight={highlightOf(inst)}
            onClick={() => inst && onClickMonster(inst.uid)} />
        </PlaymatSlot>
      ))}
      <PlaymatSlot top={ROW.myMZ} left={COL[6]} width={COL_W} height={ROW_H} label="My Graveyard">
        <PileBadge count={me.graveyard.length} label="GY" accent="#e2e2e2" />
      </PlaymatSlot>

      {/* ── My Spell/Trap row ────────────────────────────────────────────── */}
      <PlaymatSlot top={ROW.myST} left={COL[0]} width={COL_W} height={ROW_H} label="My Extra Deck">
        <PileBadge count={myExtra} label="Extra" accent="#c987ff" />
      </PlaymatSlot>
      {me.spellTrapZones.map((inst, i) => (
        <PlaymatSlot key={`my-st-${i}`} top={ROW.myST} left={COL[1 + i]} width={COL_W} height={ROW_H}>
          <PlaymatCard inst={inst} highlight={highlightOf(inst)}
            onClick={() => inst && onClickSpellTrap(inst.uid)} />
        </PlaymatSlot>
      ))}
      <PlaymatSlot top={ROW.myST} left={COL[6]} width={COL_W} height={ROW_H} label="My Deck">
        <PileBadge count={myDeck} label="Deck" accent="#ffa066" />
      </PlaymatSlot>
    </div>
  );
}

function PlayerBar({ player, isCurrent, side }: {
  player: PlayerState; isCurrent: boolean; side: 'opp' | 'me';
}) {
  const meta = COLOR_META[player.color];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px',
      marginBottom: side === 'opp' ? 6 : 0,
      marginTop: side === 'me' ? 6 : 0,
      background: isCurrent ? 'rgba(255,200,80,0.10)' : 'rgba(10,10,30,0.7)',
      border: isCurrent ? '1px solid #facc15' : '1px solid #2a2a4a',
      borderRadius: 6,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 11,
        background: meta.hex, color: meta.ink, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
      }}>{meta.glyph}</div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{player.profileName}</div>
      <div style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 20,
        color: player.lp <= 2000 ? '#ff7070' : '#4ade80' }}>
        LP {player.lp}
      </div>
    </div>
  );
}

// ── Player side ────────────────────────────────────────────────────────────

function PlayerSide({
  G, pid, isMe, isCurrent, onClickMonster, onClickSpellTrap, onClickField, selectedUid,
  attackerUid, attackTargetUid,
}: {
  G: GState; pid: string; isMe: boolean; isCurrent: boolean;
  onClickMonster?: (uid: string) => void;
  onClickSpellTrap?: (uid: string, index: number) => void;
  onClickField?: () => void;
  selectedUid?: string | null;
  attackerUid?: string | null;
  attackTargetUid?: string | null;
}) {
  const p = G.players[pid];
  const meta = COLOR_META[p.color];
  return (
    <div style={{
      padding: 8, borderRadius: 8,
      background: isCurrent ? 'rgba(255,200,80,0.06)' : 'rgba(255,255,255,0.02)',
      border: isCurrent ? '1px solid #facc15' : '1px solid #333',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 11,
          background: meta.hex, color: meta.ink, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
        }}>{meta.glyph}</div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{p.profileName}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: p.lp <= 2000 ? '#ff7070' : '#4ade80' }}>
            LP {p.lp}
          </div>
          <div style={{ fontSize: 10, color: '#888' }}>
            Hand {p.hand.length} · Deck {p.mainDeck.length || (G as any).deckCounts?.[pid] || 0}
            {' · '}Extra {(G as any).extraDeckCounts?.[pid] ?? p.extraDeck.length}
          </div>
        </div>
      </div>

      {/* Top row: Field zone, Spell/Trap zones, Extra Monster Zone, GY */}
      <div style={{ display: 'flex', gap: ZONE_GAP, alignItems: 'flex-end' }}>
        <div onClick={onClickField} style={{ cursor: onClickField ? 'pointer' : 'default' }}>
          <div style={{ fontSize: 9, color: '#aaa' }}>FIELD</div>
          <MiniCard inst={p.fieldZone} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#aaa' }}>SPELL / TRAP</div>
          <div style={{ display: 'flex', gap: ZONE_GAP }}>
            {p.spellTrapZones.map((inst, i) => (
              <div key={i} onClick={() => inst && onClickSpellTrap?.(inst.uid, i)}>
                <MiniCard inst={inst} highlight={inst && selectedUid === inst.uid ? 'selected' : null} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#aaa' }}>EXTRA MZ</div>
          <div onClick={() => p.extraMonsterZone && onClickMonster?.(p.extraMonsterZone.uid)}>
            <MiniCard inst={p.extraMonsterZone}
              highlight={
                p.extraMonsterZone && attackerUid === p.extraMonsterZone.uid ? 'attacker' :
                p.extraMonsterZone && attackTargetUid === p.extraMonsterZone.uid ? 'target' :
                p.extraMonsterZone && selectedUid === p.extraMonsterZone.uid ? 'selected' : null
              } />
          </div>
        </div>
        <GraveyardSlot pile={p.graveyard} label="GY" />
        <GraveyardSlot pile={p.banished} label="Banished" />
      </div>

      {/* Bottom row: 5 Main Monster zones */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 9, color: '#aaa' }}>MONSTER ZONES</div>
        <div style={{ display: 'flex', gap: ZONE_GAP }}>
          {p.monsterZones.map((inst, i) => (
            <div key={i} onClick={() => inst && onClickMonster?.(inst.uid)}>
              <MiniCard inst={inst}
                highlight={
                  inst && attackerUid === inst.uid ? 'attacker' :
                  inst && attackTargetUid === inst.uid ? 'target' :
                  inst && selectedUid === inst.uid ? 'selected' : null
                } />
            </div>
          ))}
        </div>
      </div>

      {/* Hand */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 9, color: '#aaa' }}>HAND</div>
        {isMe ? <span /* placeholder; rendered below by parent for click handling */ /> : (
          <HandBar hand={p.hand} opponent />
        )}
      </div>
    </div>
  );
}

// ── Chain stack panel ──────────────────────────────────────────────────────

function ChainStackPanel({ chain }: { chain: ChainLink[] }) {
  if (chain.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', right: 12, top: 80, width: 240,
      background: '#0c0c1e', border: '1px solid #6c4bd8', borderRadius: 8,
      padding: 10, zIndex: 50,
    }}>
      <div style={{ fontWeight: 800, color: '#facc15', fontSize: 12, marginBottom: 6 }}>
        Chain ({chain.length})
      </div>
      {chain.slice().reverse().map((link, i) => (
        <div key={i} style={{
          padding: 6, marginBottom: 4, borderRadius: 4,
          background: link.negated ? 'rgba(255,0,0,0.15)' : 'rgba(108,75,216,0.15)',
          border: '1px solid #6c4bd8', fontSize: 11,
        }}>
          <div style={{ fontWeight: 700 }}>
            #{chain.length - i} · SS{link.spellSpeed} · P{link.controller}
          </div>
          <div>{CARDS[link.defId]?.name ?? link.defId}</div>
          {link.negated && <div style={{ color: '#ff7070', fontSize: 10 }}>NEGATED</div>}
        </div>
      ))}
    </div>
  );
}

// ── Mulligan dialog ────────────────────────────────────────────────────────

function MulliganModal({ G, myId, moves }: { G: GState; myId: string; moves: any }) {
  const me = G.players[myId];
  if (G.mulligan.done[myId]) return null;
  const nextHandSize = mulliganDrawCount((G.mulligan.counts[myId] ?? 0) + 1);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#0a0a1e', border: '1px solid #6c4bd8', borderRadius: 12,
        padding: 24, maxWidth: 720,
      }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Opening Hand</div>
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 12 }}>
          Starting hand size is {MULLIGAN_INITIAL_HAND}. Next mulligan would draw {nextHandSize}
          (minimum {MULLIGAN_FLOOR}).
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {me.hand.map((id, i) => {
            const def = CARDS[id];
            const meta = def ? COLOR_META[def.color] : null;
            return (
              <CardHover key={i} defId={id}>
                <div style={{
                  width: CARD_W, height: CARD_H, background: meta?.hex ?? '#222',
                  border: '1px solid #000', borderRadius: 6, padding: 4, fontSize: 10,
                  color: meta?.ink ?? '#fff', overflow: 'hidden',
                }}>
                  <div style={{ fontWeight: 800 }}>{def?.name ?? '?'}</div>
                  <div style={{ fontSize: 9 }}>{def ? statBadge(def) : ''}</div>
                </div>
              </CardHover>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => moves.keepHand()}
            style={{ background: '#4ade80', color: '#000', border: 'none', padding: '10px 18px', fontWeight: 700, borderRadius: 6, cursor: 'pointer' }}>
            Keep
          </button>
          <button onClick={() => moves.mulligan()}
            disabled={(G.mulligan.counts[myId] ?? 0) >= MULLIGAN_INITIAL_HAND - MULLIGAN_FLOOR + 1}
            style={{ background: '#facc15', color: '#000', border: 'none', padding: '10px 18px', fontWeight: 700, borderRadius: 6, cursor: 'pointer' }}>
            Mulligan
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Phase advance bar ──────────────────────────────────────────────────────

function PhaseBar({ ctx, myId, moves, G }: { ctx: any; myId: string; moves: any; G: GState }) {
  const myTurn = ctx.currentPlayer === myId;
  const phases: Array<{ id: string; label: string }> = [
    { id: 'draw',    label: 'Draw' },
    { id: 'standby', label: 'Standby' },
    { id: 'main1',   label: 'Main 1' },
    { id: 'battle',  label: 'Battle' },
    { id: 'main2',   label: 'Main 2' },
    { id: 'end',     label: 'End' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center',
      padding: '8px 12px', background: '#0c0c1e', borderRadius: 8, margin: '8px 0',
      flexWrap: 'wrap',
    }}>
      {phases.map(p => (
        <div key={p.id} style={{
          padding: '4px 10px', borderRadius: 4,
          background: ctx.phase === p.id ? '#6c4bd8' : '#1a1a2e',
          color: '#fff', fontSize: 11, fontWeight: 700,
          opacity: ctx.phase === p.id ? 1 : 0.5,
        }}>{p.label}</div>
      ))}
      {myTurn && G.chain.length === 0 && !G.priorityResponse && (
        <>
          <button onClick={() => moves.advancePhase()}
            style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 700, borderRadius: 6, cursor: 'pointer' }}>
            Next Phase ▶
          </button>
          <button onClick={() => moves.endTurnMove()}
            style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '6px 14px', fontWeight: 700, borderRadius: 6, cursor: 'pointer' }}>
            End Turn
          </button>
        </>
      )}
      {G.priorityResponse?.playerID === myId && (
        <button onClick={() => moves.passChain()}
          style={{ background: '#facc15', color: '#000', border: 'none', padding: '6px 14px', fontWeight: 700, borderRadius: 6, cursor: 'pointer' }}>
          Pass · Resolve Chain
        </button>
      )}
    </div>
  );
}

// ── Hand action panel: shows actions for the selected hand card ────────────

function HandActionPanel({
  G, myId, ctx, moves, selectedHandIdx, onClose,
}: {
  G: GState; myId: string; ctx: any; moves: any; selectedHandIdx: number | null;
  onClose: () => void;
}) {
  if (selectedHandIdx == null) return null;
  const me = G.players[myId];
  const def = CARDS[me.hand[selectedHandIdx]];
  if (!def) return null;
  const isMyTurn = ctx.currentPlayer === myId;
  const isMainPhase = ctx.phase === 'main1' || ctx.phase === 'main2';

  // Action buttons depend on card type.
  const actions: Array<{ label: string; fn: () => void; disabled?: boolean; danger?: boolean }> = [];

  if (isMonster(def) && !isExtraDeckMonster(def) && def.subtype !== 'ritual' && isMyTurn && isMainPhase) {
    const lvl = def.level ?? 0;
    const need = tributesRequired(lvl);
    const canNormal = need === 0 && !me.hasNormalSummoned && me.monsterZones.some(z => z === null);
    actions.push({
      label: `Normal Summon (ATK)`, fn: () => { moves.normalSummon(selectedHandIdx, false, false); onClose(); },
      disabled: !canNormal,
    });
    actions.push({
      label: `Set (face-down DEF)`, fn: () => { moves.normalSummon(selectedHandIdx, true, true); onClose(); },
      disabled: !canNormal,
    });
    if (need > 0) {
      const available = me.monsterZones.filter(z => z) as Instance[];
      actions.push({
        label: `Tribute Summon (need ${need})`,
        fn: () => {
          const picks = available.slice(0, need).map(z => z.uid);
          moves.tributeSummon(selectedHandIdx, picks, false, false);
          onClose();
        },
        disabled: me.hasNormalSummoned || available.length < need || !me.monsterZones.some(z => z === null),
      });
    }
  }

  if ((isSpell(def) || isTrap(def)) && isMyTurn && isMainPhase) {
    if (isSpell(def) && def.subtype !== 'ritual') {
      const canActivate = me.spellTrapZones.some(z => z === null) || def.subtype === 'normal' || def.subtype === 'field';
      actions.push({
        label: `Activate ${def.subtype === 'normal' ? 'Spell' : `Spell (${def.subtype})`}`,
        fn: () => { moves.activateCard({ handIndex: selectedHandIdx }); onClose(); },
        disabled: !canActivate,
      });
    }
    actions.push({
      label: `Set (face-down)`,
      fn: () => { moves.setSpellTrap(selectedHandIdx); onClose(); },
      disabled: !me.spellTrapZones.some(z => z === null),
    });
  }

  if (isSpell(def) && def.subtype === 'quickplay' && !isMyTurn) {
    // Note: real YGO requires the card to be Set first to activate on opp's turn.
    // We surface a hint here.
    actions.push({
      label: `(Set this on your turn to use on opponent's turn)`,
      fn: () => {}, disabled: true,
    });
  }

  if (actions.length === 0) {
    return (
      <div style={{
        position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
        background: '#0a0a1e', border: '1px solid #6c4bd8', borderRadius: 8, padding: 14,
        zIndex: 100, maxWidth: 360,
      }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>{def.name}</div>
        <div style={{ fontSize: 12, color: '#aaa' }}>No legal action available right now.</div>
        <button onClick={onClose} style={{ marginTop: 8, background: '#333', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}>Close</button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
      background: '#0a0a1e', border: '1px solid #6c4bd8', borderRadius: 8, padding: 14,
      zIndex: 100, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontWeight: 800 }}>{def.name}</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>{def.text || statBadge(def)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {actions.map((a, i) => (
          <button key={i} onClick={a.fn} disabled={a.disabled}
            style={{
              background: a.disabled ? '#1a1a2e' : (a.danger ? '#dc2626' : '#6c4bd8'),
              color: a.disabled ? '#666' : '#fff',
              border: 'none', padding: '6px 12px', borderRadius: 4,
              fontSize: 11, fontWeight: 700, cursor: a.disabled ? 'not-allowed' : 'pointer',
            }}>{a.label}</button>
        ))}
        <button onClick={onClose}
          style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Monster action panel ───────────────────────────────────────────────────

function MonsterActionPanel({
  G, myId, ctx, moves, selectedUid, attackerUid, onClose, onPickAttacker, onPickTarget,
}: {
  G: GState; myId: string; ctx: any; moves: any;
  selectedUid: string | null; attackerUid: string | null;
  onClose: () => void;
  onPickAttacker: (uid: string) => void;
  onPickTarget: (uid: string | null) => void;
}) {
  if (!selectedUid) return null;
  const isMyTurn = ctx.currentPlayer === myId;
  // Find the instance.
  let found: { ownerId: string; inst: Instance } | null = null;
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (const z of [...p.monsterZones, p.extraMonsterZone]) {
      if (z?.uid === selectedUid) found = { ownerId: pid, inst: z };
    }
  }
  if (!found) return null;
  const inst = found.inst;
  const isMine = found.ownerId === myId;
  const def = inst.faceUp && inst.defId !== 'hidden' ? CARDS[inst.defId] : null;

  const actions: Array<{ label: string; fn: () => void; disabled?: boolean }> = [];

  if (isMine && isMyTurn) {
    if ((ctx.phase === 'main1' || ctx.phase === 'main2')) {
      if (!inst.faceUp && !inst.setThisTurn) {
        actions.push({ label: 'Flip Summon', fn: () => { moves.flipSummon(selectedUid); onClose(); } });
      }
      if (inst.faceUp && !inst.setThisTurn && !inst.positionChangedThisTurn && !inst.attackedThisTurn) {
        actions.push({ label: 'Change Position', fn: () => { moves.changePosition(selectedUid); onClose(); } });
      }
    }
    if (ctx.phase === 'battle' && inst.faceUp && inst.position === 'atk' && !inst.attackedThisTurn) {
      if (attackerUid === selectedUid) {
        // Already chosen as attacker; pick a target.
      } else {
        actions.push({ label: 'Attack with this', fn: () => { onPickAttacker(selectedUid); } });
      }
    }
  }

  if (!isMine && attackerUid && ctx.phase === 'battle') {
    actions.push({ label: 'Attack this target', fn: () => { onPickTarget(selectedUid); } });
  }

  if (actions.length === 0) {
    return (
      <div style={{
        position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
        background: '#0a0a1e', border: '1px solid #6c4bd8', borderRadius: 8, padding: 14,
        zIndex: 100, maxWidth: 360,
      }}>
        <div style={{ fontWeight: 800 }}>{def?.name ?? 'Face-down'}</div>
        <div style={{ fontSize: 12, color: '#aaa' }}>{def ? statBadge(def) : '—'}</div>
        <button onClick={onClose} style={{ marginTop: 8, background: '#333', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}>Close</button>
      </div>
    );
  }
  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
      background: '#0a0a1e', border: '1px solid #6c4bd8', borderRadius: 8, padding: 14,
      zIndex: 100, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontWeight: 800 }}>{def?.name ?? 'Face-down'}</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>{def?.text ?? ''}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {actions.map((a, i) => (
          <button key={i} onClick={a.fn} disabled={a.disabled}
            style={{
              background: '#6c4bd8', color: '#fff', border: 'none', padding: '6px 12px',
              borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{a.label}</button>
        ))}
        <button onClick={onClose}
          style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Action log ─────────────────────────────────────────────────────────────

function ActionLog({ log }: { log: string[] }) {
  return (
    <div style={{
      maxHeight: 160, overflowY: 'auto', padding: 8, background: '#0a0a1e',
      border: '1px solid #333', borderRadius: 6, fontSize: 11, lineHeight: 1.4, color: '#ccc',
    }}>
      {log.slice(-50).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

// ── Win modal ──────────────────────────────────────────────────────────────

function GameOverModal({ ctx, myId, G }: { ctx: any; myId: string; G: GState }) {
  if (!ctx.gameover) return null;
  const winner = ctx.gameover.winner;
  const draw = ctx.gameover.draw;
  const iWon = winner === myId;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0a0a1e', border: `2px solid ${iWon ? '#4ade80' : draw ? '#facc15' : '#dc2626'}`,
        borderRadius: 12, padding: 32, textAlign: 'center', maxWidth: 480,
      }}>
        <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 12, color: iWon ? '#4ade80' : draw ? '#facc15' : '#dc2626' }}>
          {draw ? 'Draw' : iWon ? 'Victory!' : 'Defeat'}
        </div>
        <div style={{ color: '#aaa', marginBottom: 8 }}>
          {draw ? 'Both Duelists reached 0 LP.' :
            iWon ? `You reduced ${G.players[winner === '0' ? '1' : '0'].profileName}'s LP to 0.` :
                  `${G.players[winner].profileName} reduced your LP to 0.`}
        </div>
      </div>
    </div>
  );
}

// ── Main board export ──────────────────────────────────────────────────────

export function ChainsBoard(props: Props) {
  const { G, ctx, moves, playerID } = props;
  const myId = playerID ?? '0';
  const oppId = myId === '0' ? '1' : '0';
  const mobile = useIsMobile();

  const [selectedHandIdx, setSelectedHandIdx] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [attackerUid, setAttackerUid] = useState<string | null>(null);

  const isMyTurn = ctx.currentPlayer === myId;
  const me = G.players[myId];
  const opp = G.players[oppId];

  // If our priority is requested, surface a banner.
  const responseRequired = G.priorityResponse?.playerID === myId;

  // Resolve attack: when a target is picked, declare it and then ask for resolve.
  function handlePickTarget(uid: string | null) {
    if (!attackerUid) return;
    moves.declareAttack(attackerUid, uid ?? '__direct__');
    setAttackerUid(null);
    setSelectedUid(null);
  }

  // Battle: direct attack button
  const canDirectAttack = useMemo(() => {
    if (!attackerUid) return false;
    const oppHasMonsters = opp.monsterZones.some(Boolean) || !!opp.extraMonsterZone;
    return !oppHasMonsters;
  }, [attackerUid, opp.monsterZones, opp.extraMonsterZone]);

  // Auto-resolve attack once damage_window opens with no priorityResponse.
  useEffect(() => {
    if (G.battle.kind === 'damage_window' && !G.priorityResponse) {
      const t = setTimeout(() => { try { moves.resolveAttack(); } catch { /* ignore */ } }, 400);
      return () => clearTimeout(t);
    }
  }, [G.battle.kind, G.priorityResponse, moves]);

  // Pre-game pick & mulligan UIs.
  if (ctx.phase === 'pick' && me.needsColorPick) {
    return <ColorPickScreen myId={myId} moves={moves} />;
  }
  if (ctx.phase === 'mulligan' && !G.mulligan.done[myId]) {
    return <MulliganModal G={G} myId={myId} moves={moves} />;
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#06061a', color: '#fff',
      padding: mobile ? 8 : 16, fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Opponent identity + LP */}
        <PlayerBar player={opp} isCurrent={ctx.currentPlayer === oppId} side="opp" />

        {/* Opponent hand (face-down) */}
        <HandBar hand={opp.hand} opponent />

        {/* Phase indicator */}
        <PhaseBar ctx={ctx} myId={myId} moves={moves} G={G} />

        {responseRequired && (
          <div style={{
            padding: '12px 16px', background: '#facc15', color: '#000', borderRadius: 8,
            fontWeight: 700, marginBottom: 8,
            display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center',
            flexWrap: 'wrap',
            boxShadow: '0 0 24px rgba(250,204,21,0.55)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 14, letterSpacing: 0.5 }}>
                ⏳ Your turn to respond
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                Activate a face-down trap / quick-play, or pass to resolve the chain.
              </span>
            </div>
            <button onClick={() => moves.passChain()}
              style={{
                background: '#000', color: '#facc15',
                border: '2px solid #000',
                padding: '10px 22px', fontWeight: 900,
                borderRadius: 6, cursor: 'pointer',
                fontSize: 14, letterSpacing: 1,
                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              }}>
              ⏭ PASS · RESOLVE CHAIN
            </button>
          </div>
        )}

        {attackerUid && (
          <div style={{
            padding: 10, background: '#dc2626', color: '#fff', borderRadius: 6,
            fontWeight: 700, textAlign: 'center', marginBottom: 8,
            display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center',
          }}>
            Pick a target for {CARDS[(findInst(G, attackerUid)?.defId) ?? '']?.name ?? 'attacker'}
            {canDirectAttack && (
              <button onClick={() => handlePickTarget(null)}
                style={{ background: '#fff', color: '#000', border: 'none', padding: '4px 12px', borderRadius: 4, fontWeight: 800, cursor: 'pointer' }}>
                Direct Attack
              </button>
            )}
            <button onClick={() => setAttackerUid(null)}
              style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}

        {/* The YGO playmat — both players' fields with image background */}
        <YgoPlaymat
          G={G} myId={myId} oppId={oppId}
          selectedUid={selectedUid} attackerUid={attackerUid}
          onClickMonster={(u) => {
            if (attackerUid) {
              if (u === attackerUid) { setAttackerUid(null); return; }
              // Picking an opponent monster while attacking = chosen target
              const inst = findInst(G, u);
              const ownerId = findOwner(G, u);
              if (inst && ownerId === oppId) { handlePickTarget(u); return; }
            }
            setSelectedUid(u === selectedUid ? null : u);
          }}
          onClickSpellTrap={(u) => setSelectedUid(u === selectedUid ? null : u)}
        />

        {/* My identity + LP */}
        <PlayerBar player={me} isCurrent={isMyTurn} side="me" />

        {/* My hand */}
        <HandBar hand={me.hand} selected={selectedHandIdx}
          onSelect={(i) => { setSelectedHandIdx(i === selectedHandIdx ? null : i); setSelectedUid(null); }} />

        {/* Action log */}
        <div style={{ marginTop: 8 }}>
          <ActionLog log={G.log} />
        </div>

        {/* Floating action panels */}
        <HandActionPanel G={G} myId={myId} ctx={ctx} moves={moves}
          selectedHandIdx={selectedHandIdx}
          onClose={() => setSelectedHandIdx(null)} />

        <MonsterActionPanel G={G} myId={myId} ctx={ctx} moves={moves}
          selectedUid={selectedUid}
          attackerUid={attackerUid}
          onClose={() => setSelectedUid(null)}
          onPickAttacker={(u) => { setAttackerUid(u); setSelectedUid(null); }}
          onPickTarget={(u) => handlePickTarget(u)}
        />

        <ChainStackPanel chain={G.chain} />
        <GameOverModal ctx={ctx} myId={myId} G={G} />
      </div>
    </div>
  );
}

function findInst(G: GState, uid: string): Instance | null {
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (const z of [...p.monsterZones, p.extraMonsterZone, ...p.spellTrapZones, p.fieldZone]) {
      if (z?.uid === uid) return z;
    }
  }
  return null;
}

function findOwner(G: GState, uid: string): string | null {
  for (const pid of Object.keys(G.players)) {
    const p = G.players[pid];
    for (const z of [...p.monsterZones, p.extraMonsterZone, ...p.spellTrapZones, p.fieldZone]) {
      if (z?.uid === uid) return pid;
    }
  }
  return null;
}

function ColorPickScreen({ myId, moves }: { myId: string; moves: any }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#06061a', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 720 }}>
        <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 16 }}>Choose Your Chain (Player {myId})</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {(['bnb','sol','avax','eth','xrp'] as Color[]).map(c => {
            const meta = COLOR_META[c];
            return (
              <button key={c} onClick={() => moves.chooseColor(c)}
                style={{
                  background: meta.hex, color: meta.ink, border: '2px solid #000',
                  borderRadius: 8, padding: 16, fontWeight: 800, fontSize: 14, cursor: 'pointer',
                }}>
                {meta.glyph} · {meta.name}
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.8 }}>{meta.attribute}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
