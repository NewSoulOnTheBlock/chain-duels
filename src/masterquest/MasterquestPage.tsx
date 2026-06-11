// src/masterquest/MasterquestPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chain Duels — The Golden Deck Saga (single-player campaign UI).
//
// Renders the painted Saga Map with 11 chapter pins drawn over it. Each pin
// is a Site. Visited Sites glow; the current Site pulses; locked Sites are
// dim. Click the current Site → interlude modal (pre-fight lore + "BEGIN
// DUEL"). Click a cleared Site → re-read modal (post-fight lore). On duel
// victory → post-fight interlude + "TRAVEL ONWARD" → unlock next. After
// Site XI (The Summit) → EPILOGUE.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { SoloClient } from '../SoloClient';
import type { Color } from '../cards';
import { validateDeck, STARTER_DECKS, COLORS } from '../cards';
import { listDecksApi, type DeckEntry } from '../profiles';
import {
  PROLOGUE, ACTS, SITES, TOTAL_SITES, EPILOGUE, INTERLUDES,
  mapPosOf, MAP_VIEWBOX, type SacredSite, type SiteId, type Interlude,
} from './lore';
import {
  loadProgress, recordClear, markEpilogueSeen,
  isCleared, isUnlocked, currentSiteId, isQuestComplete,
  clearProgress, type Progress,
} from './progress';

// ── Chain → colour palette (matches the rest of the game) ──────────────────
const CHAIN_HEX: Record<Color, string> = {
  bnb:  '#f3ba2f', // yellow
  sol:  '#9945ff', // violet
  avax: '#2bd6a3', // green (Iron Order = Hyperliquid green in this campaign)
  eth:  '#e8eaf6', // white-ish
  xrp:  '#1f1f1f', // black
};

const CHAIN_LABEL: Record<Color, string> = {
  bnb:  'Yellow Court',
  sol:  'Violet Conclave',
  avax: 'Iron Order',
  eth:  'Pale Senate',
  xrp:  'Black Ledger',
};

const ACT_LABEL: Record<keyof typeof ACTS, string> = {
  awakening: 'Act I — Awakening',
  champions: 'Act II — Champions',
  void:      'Act III — The Void',
};

// ── Starter decks as synthetic DeckEntry rows ──────────────────────────────
// Saved deck ids on the server are positive ints. We reserve negative ids for
// the five chain-locked starter decks so they sort first and never collide
// with anything the server returns. Selecting one of these is the standard
// onboarding path for new players (who start with 0 owned cards and so
// cannot yet build a custom deck).
const STARTER_DECK_LABEL: Record<Color, string> = {
  bnb:  'BNB Starter',
  sol:  'Solana Starter',
  avax: 'Avalanche Starter',
  eth:  'Ethereum Starter',
  xrp:  'XRP Starter',
};
const STARTER_DECK_ID: Record<Color, number> = {
  bnb: -1, sol: -2, avax: -3, eth: -4, xrp: -5,
};
function buildStarterEntries(): DeckEntry[] {
  return COLORS.map<DeckEntry>(c => ({
    id: STARTER_DECK_ID[c],
    name: STARTER_DECK_LABEL[c],
    cards: STARTER_DECKS[c],
    isActive: false,
  }));
}
function isStarterId(id: number): boolean { return id < 0; }
function starterColorOfId(id: number): Color | null {
  for (const c of COLORS) if (STARTER_DECK_ID[c] === id) return c;
  return null;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function MasterquestPage({
  myName, onBack,
}: { myName: string; onBack: () => void }) {
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [openSiteId, setOpenSiteId] = useState<SiteId | null>(null);
  const [activeDuel, setActiveDuel] = useState<{ site: SacredSite; deckCards: string[] } | null>(null);
  const [postFight, setPostFight] = useState<{ site: SacredSite } | null>(null);
  const [showPrologue, setShowPrologue] = useState<boolean>(() => loadProgress().cleared.length === 0);
  const [showEpilogue, setShowEpilogue] = useState<boolean>(false);

  // ── Deck chooser ───────────────────────────────────────────────────────
  // Saga mode accepts either one of the 5 chain-locked starter decks (always
  // available, no collection required) or any custom 60-card deck the player
  // built in the Library. Starters appear first in the picker so new players
  // can jump straight into Site I without an empty-state.
  const [savedDecks, setSavedDecks] = useState<DeckEntry[]>([]);
  const [decksLoading, setDecksLoading] = useState<boolean>(true);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(
    () => STARTER_DECK_ID.bnb,  // default to the BNB starter so the duel buttons unlock immediately
  );

  // Merged list = 5 starters first, then any saved customs. Memoised so the
  // deck-chooser doesn't rebuild every render.
  const starterEntries = useMemo(() => buildStarterEntries(), []);
  const decks = useMemo<DeckEntry[]>(
    () => [...starterEntries, ...savedDecks],
    [starterEntries, savedDecks],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDecksLoading(true);
      try {
        const list = await listDecksApi(myName);
        if (cancelled) return;
        const legal = list.filter(d => validateDeck(d.cards).ok);
        setSavedDecks(legal);
        // If the player has a saved active deck, auto-select it on first load
        // so they don't have to re-pick on every page visit.
        const active = legal.find(d => d.isActive);
        if (active) setSelectedDeckId(active.id);
      } catch {
        if (!cancelled) setSavedDecks([]);
      } finally {
        if (!cancelled) setDecksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myName]);

  const selectedDeck = useMemo(
    () => decks.find(d => d.id === selectedDeckId) ?? null,
    [decks, selectedDeckId],
  );
  const canDuel = !!selectedDeck;

  const cur = currentSiteId(progress);
  const complete = isQuestComplete(progress);

  const openSite = useMemo(() => openSiteId ? SITES.find(s => s.id === openSiteId) ?? null : null, [openSiteId]);

  const handleSiteClick = useCallback((s: SacredSite) => {
    if (isCleared(s.id, progress) || isUnlocked(s.id, progress)) {
      setOpenSiteId(s.id);
    }
  }, [progress]);

  const handleBeginDuel = useCallback(() => {
    if (!openSite || !selectedDeck) return;
    setActiveDuel({ site: openSite, deckCards: selectedDeck.cards });
    setOpenSiteId(null);
  }, [openSite, selectedDeck]);

  const handleDuelEnd = useCallback((info: { win: boolean; turns: number }) => {
    if (!activeDuel) return;
    if (info.win) {
      const updated = recordClear(activeDuel.site.id);
      setProgress(updated);
      setPostFight({ site: activeDuel.site });
      setActiveDuel(null);
    }
    // On loss the player stays in the SoloClient screen; "Exit Solo" returns here.
  }, [activeDuel]);

  const handleTravelOnward = useCallback(() => {
    const site = postFight?.site;
    setPostFight(null);
    if (site && site.id === 'first_champion_summit') {
      markEpilogueSeen();
      setShowEpilogue(true);
    }
  }, [postFight]);

  const handleResetCampaign = useCallback(() => {
    if (typeof window !== 'undefined' && window.confirm('Erase Golden Deck Saga progress and start again from Site I?')) {
      clearProgress();
      setProgress(loadProgress());
      setShowPrologue(true);
    }
  }, []);

  // Active duel takes over the screen.
  if (activeDuel) {
    return (
      <SoloClient
          playerName={myName || 'Duelist'}
        difficulty={activeDuel.site.rival.difficulty}
        mode="casual"
        playerDeckColor="sol"
        customDeck={activeDuel.deckCards}
        botDeckColor={activeDuel.site.rival.botColor}
        matchLabel={`${activeDuel.site.rival.name} — ${activeDuel.site.rival.title}`}
        onExit={() => setActiveDuel(null)}
        onMatchEnd={handleDuelEnd}
      />
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto',
      background: 'radial-gradient(circle at 50% 45%, #1a0f3a 0%, #08051a 60%, #02010a 100%)',
      color: '#f5f3ff', fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 5,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px',
        background: 'linear-gradient(180deg, rgba(8,5,26,0.94) 0%, rgba(8,5,26,0.6) 100%)',
        borderBottom: '1px solid #2a1f55',
      }}>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
        <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 2 }}>
          ⚔  THE GOLDEN DECK SAGA
        </div>
        <button onClick={handleResetCampaign} style={{ ...btnSecondary, fontSize: 11, opacity: 0.6 }}>
          ↻ reset
        </button>
      </div>

      {/* Status bar */}
      <div style={{
        padding: '14px 24px', textAlign: 'center',
        background: 'rgba(108,75,216,0.08)',
      }}>
        <div style={{ fontSize: 13, letterSpacing: 1, opacity: 0.85 }}>
          {complete
            ? '✦ THE GOLDEN DECK HAS BEEN SHATTERED ✦'
            : `Fragments recovered: ${progress.cleared.length} / ${TOTAL_SITES}${cur ? ` · Next: ${SITES.find(s => s.id === cur)?.name}` : ''}`}
        </div>
        {complete && !showEpilogue && (
          <button onClick={() => setShowEpilogue(true)} style={{ ...btnPrimary, marginTop: 10 }}>
            ✦ Read the Epilogue
          </button>
        )}
      </div>

      {/* Deck chooser — Masterquest requires a custom (saved) deck */}
      <DeckChooser
        decks={decks}
        loading={decksLoading}
        selectedDeckId={selectedDeckId}
        onSelect={setSelectedDeckId}
      />

      {/* Map */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 16px 32px' }}>
        <div style={{ width: '100%', maxWidth: 1280 }}>
          <MapSvg progress={progress} onSiteClick={handleSiteClick} />
          <ActLegend />
        </div>
      </div>

      {/* Modals */}
      {showPrologue && <PrologueModal onClose={() => setShowPrologue(false)} />}
      {showEpilogue && <EpilogueModal onClose={() => setShowEpilogue(false)} />}
      {openSite && (
        <SiteModal
          site={openSite}
          cleared={isCleared(openSite.id, progress)}
          interlude={INTERLUDES[openSite.id]}
          selectedDeck={selectedDeck}
          canDuel={canDuel}
          onClose={() => setOpenSiteId(null)}
          onBeginDuel={handleBeginDuel}
        />
      )}
      {postFight && (
        <PostFightModal
          site={postFight.site}
          interlude={INTERLUDES[postFight.site.id]}
          onTravelOnward={handleTravelOnward}
        />
      )}
    </div>
  );
}

// ─── Map SVG ───────────────────────────────────────────────────────────────

function MapSvg({
  progress, onSiteClick,
}: { progress: Progress; onSiteClick: (s: SacredSite) => void }) {
  const positioned = SITES.map(s => ({ s, p: mapPosOf(s) }));
  const cur = currentSiteId(progress);
  const VW = MAP_VIEWBOX.w;
  const VH = MAP_VIEWBOX.h;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      style={{
        width: '100%', height: 'auto', display: 'block',
        borderRadius: 10, border: '1px solid #3a2f6a',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}
      aria-label="Chain Duels — Golden Deck Saga map"
    >
      {/* Painted Map of the Chain Realm (drawn first, everything else overlays) */}
      <image href="/masterquest-map.png?v=2" x={0} y={0} width={VW} height={VH}
        preserveAspectRatio="xMidYMid slice" />

      {/* Travel path: faint dashed line connecting consecutive sites in clear-order */}
      {positioned.slice(1).map(({ s, p }, i) => {
        const prev = positioned[i].p;
        const traversed = isCleared(s.id, progress) || s.id === cur;
        return (
          <line key={`path-${s.id}`}
            x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
            stroke={traversed ? '#ffe066' : '#cfc4ff'}
            strokeWidth={traversed ? 5 : 3}
            strokeOpacity={traversed ? 0.75 : 0.25}
            strokeDasharray={traversed ? '0' : '12,10'}
          />
        );
      })}

      {/* Site nodes — large enough to be tappable over the painted map */}
      {positioned.map(({ s, p }) => {
        const cleared = isCleared(s.id, progress);
        const unlocked = s.id === cur;
        const dim = !cleared && !unlocked;
        const fill = CHAIN_HEX[s.chain];
        const baseR = unlocked ? 36 : cleared ? 30 : 26;
        return (
          <g key={s.id}
            onClick={() => onSiteClick(s)}
            style={{ cursor: (cleared || unlocked) ? 'pointer' : 'not-allowed' }}>
            {/* Pulsing halo around the current site */}
            {unlocked && (
              <circle cx={p.x} cy={p.y} r={baseR + 18} fill={fill} opacity={0.22}>
                <animate attributeName="r"
                  values={`${baseR + 8};${baseR + 28};${baseR + 8}`}
                  dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity"
                  values="0.12;0.36;0.12"
                  dur="2.4s" repeatCount="indefinite" />
              </circle>
            )}
            {cleared && (
              <circle cx={p.x} cy={p.y} r={baseR + 10} fill={fill} opacity={0.28} />
            )}
            {/* Outer ring */}
            <circle cx={p.x} cy={p.y} r={baseR + 4}
              fill="#0a0716" stroke="#000" strokeWidth={2}
              opacity={dim ? 0.65 : 0.9} />
            {/* Inner colour disc */}
            <circle cx={p.x} cy={p.y} r={baseR}
              fill={dim ? '#1a1230' : fill}
              stroke={dim ? '#3a2f6a' : '#fff'}
              strokeWidth={3}
              opacity={dim ? 0.85 : 1} />
            {/* Numeric label */}
            <text x={p.x} y={p.y + 9} textAnchor="middle"
              fontSize={28} fontWeight={900}
              fontFamily="'Cinzel', serif"
              fill={dim ? '#7a6fa5' : (s.chain === 'eth' ? '#222' : '#fff')}
              pointerEvents="none">
              {toRoman(s.index)}
            </text>
            {/* Cleared checkmark */}
            {cleared && (
              <text x={p.x + baseR + 4} y={p.y - baseR + 4}
                fontSize={36} fill="#a5ffb0" fontWeight={900} pointerEvents="none">✓</text>
            )}
          </g>
        );
      })}

      {/* Sorendo avatar floating above the current site */}
      {cur && (() => {
        const here = positioned.find(({ s }) => s.id === cur);
        if (!here) return null;
        return (
          <g pointerEvents="none">
            <text x={here.p.x} y={here.p.y - 50} textAnchor="middle"
              fontSize={56} fill="#fff"
              style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.8))' }}>🧙</text>
          </g>
        );
      })()}
    </svg>
  );
}

function toRoman(n: number): string {
  const r: Record<number, string> = {
    1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V',
    6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
    11: 'XI',
  };
  return r[n] ?? String(n);
}

function ActLegend() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', flexWrap: 'wrap',
      padding: '14px 8px 0', gap: 18,
      fontSize: 11, opacity: 0.85, color: '#cfc4ff',
    }}>
      <div>{ACT_LABEL.awakening} — Sites I–III</div>
      <div>{ACT_LABEL.champions} — Sites IV–VI</div>
      <div>{ACT_LABEL.void} — Sites VII–XI</div>
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────

function modalShell(children: React.ReactNode, onClose?: () => void) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(2,1,10,0.86)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(160deg, #1a1230, #0a0716)',
        border: '1px solid #6c4bd8', borderRadius: 14,
        padding: 22, maxWidth: 640, width: '100%',
        color: '#f5f3ff', fontFamily: 'Inter, sans-serif',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>{children}</div>
    </div>
  );
}

function PrologueModal({ onClose }: { onClose: () => void }) {
  return modalShell(<>
    <div style={{ fontSize: 12, opacity: 0.6, letterSpacing: 2 }}>PROLOGUE · CHAPTER I</div>
    <h2 style={{ marginTop: 4, marginBottom: 14, fontSize: 22 }}>The First Draw</h2>
    <PreservedText text={PROLOGUE} />
    <div style={{ marginTop: 18, textAlign: 'right' }}>
      <button onClick={onClose} style={btnPrimary}>Begin the Saga →</button>
    </div>
  </>, onClose);
}

function EpilogueModal({ onClose }: { onClose: () => void }) {
  return modalShell(<>
    <div style={{ fontSize: 12, opacity: 0.6, letterSpacing: 2, color: '#ffe066' }}>EPILOGUE</div>
    <h2 style={{ marginTop: 4, marginBottom: 14, fontSize: 22 }}>The Shattered Golden Deck</h2>
    <PreservedText text={EPILOGUE} />
    <div style={{ marginTop: 18, textAlign: 'right' }}>
      <button onClick={onClose} style={btnPrimary}>Close</button>
    </div>
  </>, onClose);
}

function SiteModal({
  site, cleared, interlude, selectedDeck, canDuel, onClose, onBeginDuel,
}: {
  site: SacredSite; cleared: boolean; interlude: Interlude;
  selectedDeck: DeckEntry | null; canDuel: boolean;
  onClose: () => void; onBeginDuel: () => void;
}) {
  return modalShell(<>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 2 }}>
          SITE {site.index} / {TOTAL_SITES} · {ACT_LABEL[site.act]}
        </div>
        <h2 style={{ margin: '4px 0 6px', fontSize: 22 }}>{site.name}</h2>
        <ChainPill chain={site.chain} />
      </div>
      <div style={{ fontSize: 28, lineHeight: 1 }}>{cleared ? '✓' : '◇'}</div>
    </div>

    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, fontStyle: 'italic' }}>
      {site.region}
    </div>
    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, opacity: 0.92 }}>
      {site.description}
    </div>

    <h3 style={{ marginTop: 22, marginBottom: 8, fontSize: 16, color: '#ffd166' }}>
      The Approach
    </h3>
    <PreservedText text={interlude.pre} />

    <div style={{
      marginTop: 22, padding: 14,
      background: 'rgba(108,75,216,0.10)', borderRadius: 10,
      border: '1px solid #3a2f6a',
    }}>
      <div style={{ fontSize: 11, opacity: 0.65, letterSpacing: 1, marginBottom: 4 }}>YOUR RIVAL</div>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{site.rival.name}</div>
      <div style={{ fontSize: 12, opacity: 0.75, fontStyle: 'italic' }}>{site.rival.title}</div>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{site.rival.bio}</div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
        Difficulty: <b style={{ color: difficultyColor(site.rival.difficulty) }}>
          {site.rival.difficulty.toUpperCase()}
        </b>
        {' · '}Deck: <b style={{ color: CHAIN_HEX[site.rival.botColor] }}>{CHAIN_LABEL[site.rival.botColor]}</b>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, fontStyle: 'italic', opacity: 0.9 }}>
        “{site.rival.quote}”
      </div>
    </div>

    <div style={{ marginTop: 16, fontSize: 12, opacity: 0.8 }}>
      <b>Reward:</b> {site.reward}
    </div>

    {/* Selected-deck reminder + warning when no custom deck is selected */}
    <div style={{
      marginTop: 14, padding: 10,
      background: canDuel ? 'rgba(165,255,176,0.06)' : 'rgba(255,107,107,0.10)',
      border: `1px solid ${canDuel ? '#2c5d3a' : '#a83b3b'}`,
      borderRadius: 8, fontSize: 12,
    }}>
      {canDuel ? (
        <>
          <b style={{ color: '#a5ffb0' }}>Your deck:</b>{' '}
          {selectedDeck!.name || `Deck #${selectedDeck!.id}`}{' '}
          <span style={{ opacity: 0.7 }}>({selectedDeck!.cards.length} cards)</span>
        </>
      ) : (
        <>
          <b style={{ color: '#ff9a9a' }}>⚠ No deck selected.</b>{' '}
          Pick one of the 5 chain starter decks or a custom deck from the
          chooser above the map to unlock this duel.
        </>
      )}
    </div>

    <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <button onClick={onClose} style={btnSecondary}>Withdraw</button>
      {!cleared && (
        <button onClick={onBeginDuel}
          disabled={!canDuel}
          style={canDuel ? btnPrimary : btnDisabled}
          title={canDuel ? '' : 'Pick a custom deck first'}>
          ⚔  Begin Duel
        </button>
      )}
      {cleared && (
        <button onClick={onBeginDuel}
          disabled={!canDuel}
          style={canDuel ? btnPrimary : btnDisabled}
          title={canDuel ? '' : 'Pick a custom deck first'}>
          ↻  Re-Duel
        </button>
      )}
    </div>
  </>, onClose);
}

function PostFightModal({
  site, interlude, onTravelOnward,
}: { site: SacredSite; interlude: Interlude; onTravelOnward: () => void }) {
  return modalShell(<>
    <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 2, color: '#a5ffb0' }}>
      VICTORY · SITE {site.index} / {TOTAL_SITES}
    </div>
    <h2 style={{ marginTop: 4, marginBottom: 12, fontSize: 22 }}>{site.name}</h2>

    <PreservedText text={interlude.post} />

    <div style={{
      marginTop: 18, padding: 12,
      background: 'rgba(165,255,176,0.08)', borderRadius: 10,
      border: '1px solid #2c5d3a', fontSize: 13,
    }}>
      <b style={{ color: '#a5ffb0' }}>Reward earned:</b> {site.reward}
    </div>

    <div style={{ marginTop: 22, textAlign: 'right' }}>
      <button onClick={onTravelOnward} style={btnPrimary}>
        {site.id === 'first_champion_summit' ? '✦  Witness the Epilogue' : 'Travel Onward →'}
      </button>
    </div>
  </>);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function PreservedText({ text }: { text: string }) {
  // Render paragraph-by-paragraph (split on blank lines). Preserves the
  // hand-written line breaks in the lore source as <br/>s within paragraphs.
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return (
    <div>
      {paragraphs.map((para, i) => (
        <p key={i} style={{
          fontSize: 14, lineHeight: 1.6,
          margin: '10px 0', color: '#e8e3ff', whiteSpace: 'pre-wrap',
        }}>{para}</p>
      ))}
    </div>
  );
}

function ChainPill({ chain }: { chain: Color }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px', borderRadius: 999,
      fontSize: 11, fontWeight: 800,
      background: CHAIN_HEX[chain],
      color: chain === 'eth' ? '#222' : '#fff',
      border: '1px solid rgba(0,0,0,0.4)',
    }}>{CHAIN_LABEL[chain]}</span>
  );
}

function difficultyColor(d: 'easy' | 'normal' | 'hard'): string {
  return d === 'easy' ? '#a5ffb0' : d === 'normal' ? '#cfc4ff' : '#ff8a8a';
}

const btnPrimary: React.CSSProperties = {
  background: '#6c4bd8', color: '#fff',
  border: '1px solid #8a6bf0', borderRadius: 8,
  padding: '10px 18px', fontWeight: 800, fontSize: 13,
  cursor: 'pointer', letterSpacing: 0.5,
};

const btnSecondary: React.CSSProperties = {
  background: '#1a1230', color: '#cfc4ff',
  border: '1px solid #3a2f6a', borderRadius: 8,
  padding: '8px 14px', fontWeight: 700, fontSize: 12,
  cursor: 'pointer',
};

const btnDisabled: React.CSSProperties = {
  background: '#1a1230', color: '#6b5e94',
  border: '1px solid #2a2150', borderRadius: 8,
  padding: '10px 18px', fontWeight: 800, fontSize: 13,
  cursor: 'not-allowed', letterSpacing: 0.5,
  opacity: 0.55,
};

// ─── Deck chooser strip ────────────────────────────────────────────────────

function DeckChooser({
  decks, loading, selectedDeckId, onSelect,
}: {
  decks: DeckEntry[];
  loading: boolean;
  selectedDeckId: number | null;
  onSelect: (id: number | null) => void;
}) {
  return (
    <div style={{
      padding: '12px 20px',
      background: 'rgba(108,75,216,0.06)',
      borderBottom: '1px solid #2a1f55',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        flexWrap: 'wrap', maxWidth: 1280, margin: '0 auto',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.8, fontWeight: 700 }}>
          🃏 YOUR DECK
        </div>

        {loading && (
          <div style={{ fontSize: 12, opacity: 0.65 }}>loading saved decks…</div>
        )}

        {!loading && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {decks.map(d => {
                const active = selectedDeckId === d.id;
                const starterColor = starterColorOfId(d.id);
                const accent = starterColor ? CHAIN_HEX[starterColor] : '#8a6bf0';
                return (
                  <button key={d.id}
                    onClick={() => onSelect(d.id)}
                    style={{
                      background: active
                        ? (starterColor ? `${accent}` : '#6c4bd8')
                        : '#1a1230',
                      color: active
                        ? (starterColor && starterColor !== 'eth' ? '#fff' : (starterColor === 'eth' ? '#1a1230' : '#fff'))
                        : '#cfc4ff',
                      border: `2px solid ${active ? accent : '#3a2f6a'}`,
                      borderRadius: 8, padding: '8px 12px',
                      fontWeight: 700, fontSize: 12, cursor: 'pointer',
                      letterSpacing: 0.3,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}>
                    {starterColor && (
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: accent, boxShadow: `0 0 6px ${accent}88`,
                      }} />
                    )}
                    {d.name || `Deck #${d.id}`}{' '}
                    <span style={{ opacity: 0.65, fontWeight: 400 }}>
                      ({d.cards.length})
                    </span>
                    {starterColor && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: 1,
                        padding: '1px 5px', borderRadius: 3,
                        background: active ? 'rgba(0,0,0,0.25)' : `${accent}33`,
                        color: active ? '#fff' : accent,
                      }}>STARTER</span>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedDeckId == null && (
              <div style={{ fontSize: 11, color: '#ff9a9a' }}>
                ⚠ Select a deck above to unlock the duels.
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              Starter decks are free to play. Build a custom deck in the Library
              (Profile → Library) once you've opened a few packs.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
