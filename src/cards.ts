// src/cards.ts
// Card catalogue + starter decks for Duelmasters.
//
// The game implements full Yu-Gi-Oh TCG-style rules (rulebook v10): Monsters
// with ATK/DEF/Level/Attribute/Type, Spells (Normal/Continuous/Equip/Field/
// Quick-Play/Ritual), Traps (Normal/Continuous/Counter), Tribute Summons,
// Special Summons (Fusion/Synchro/Xyz/Ritual/Link/Pendulum), an Extra Deck,
// chains with spell speed, and an 8000 LP win condition.
//
// The card flavour stays in the crypto/meme-chain universe — each of the 5
// chains maps to a YGO attribute:
//   BnB        → EARTH
//   Solana     → DARK
//   Avalanche  → FIRE
//   Ethereum   → LIGHT
//   XRP        → WATER

// ── Chains ───────────────────────────────────────────────────────────────────

export type Color = 'bnb' | 'sol' | 'avax' | 'eth' | 'xrp';

export const COLORS: Color[] = ['bnb', 'sol', 'avax', 'eth', 'xrp'];

export const COLOR_META: Record<
  Color,
  { name: string; hex: string; ink: string; template?: string; glyph?: string; attribute: Attribute }
> = {
  bnb:  { name: 'BnB',         hex: '#f3ba2f', ink: '#000', template: '/template-bnb.jpg',  glyph: 'BNB',  attribute: 'EARTH' },
  sol:  { name: 'Solana',      hex: '#9945ff', ink: '#fff', template: '/template-sol.png',  glyph: 'SOL',  attribute: 'DARK'  },
  avax: { name: 'Avalanche',   hex: '#e84142', ink: '#fff', template: '/template-avax.svg', glyph: 'AVAX', attribute: 'FIRE'  },
  eth:  { name: 'Ethereum',    hex: '#f5f5f5', ink: '#222', template: '/template-eth.png',  glyph: 'ETH',  attribute: 'LIGHT' },
  xrp:  { name: 'XRP',         hex: '#1a1a1a', ink: '#fff', template: '/template-xrp.png',  glyph: 'XRP',  attribute: 'WATER' },
};

// ── YGO taxonomy ─────────────────────────────────────────────────────────────

export type Attribute = 'LIGHT' | 'DARK' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';

export const ATTRIBUTES: Attribute[] = ['LIGHT', 'DARK', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];

export type MonsterRace =
  | 'Dragon' | 'Spellcaster' | 'Warrior' | 'Beast' | 'Beast-Warrior'
  | 'Machine' | 'Fiend' | 'Cyberse' | 'Plant' | 'Rock' | 'Aqua'
  | 'Reptile' | 'Sea Serpent' | 'Pyro' | 'Fairy' | 'Insect' | 'Thunder'
  | 'Wyrm' | 'Psychic' | 'Zombie';

export type CardType = 'monster' | 'spell' | 'trap';

export type MonsterSubtype =
  | 'normal' | 'effect' | 'fusion' | 'synchro' | 'xyz' | 'ritual' | 'pendulum' | 'link';

export type SpellSubtype =
  | 'normal' | 'continuous' | 'equip' | 'field' | 'quickplay' | 'ritual';

export type TrapSubtype = 'normal' | 'continuous' | 'counter';

/**
 * Generic effect identifiers — Game.ts implements each one. Many effects need
 * an optional target (target monster UID, target card UID, etc.).
 */
export type EffectId =
  // ── Monster effects ────────────────────────────────────────────────────────
  | 'mon_ignition_destroy_1_monster_tribute_self' // tribute self, destroy 1 monster
  | 'mon_ignition_destroy_1_spelltrap_discard1'   // discard 1, destroy 1 S/T
  | 'mon_trigger_on_summon_draw_1'                // when summoned, draw 1
  | 'mon_trigger_on_destroy_by_battle_burn_500'   // when destroyed by battle, burn 500
  | 'mon_flip_draw_2'                             // flip: draw 2
  | 'mon_flip_destroy_target_monster'             // flip: destroy 1 opponent monster
  | 'mon_continuous_pump_own_attribute_+300'      // boost own same-attribute monsters
  | 'mon_quick_negate_attack_discard1'            // quick effect: discard 1, negate 1 attack
  | 'mon_continuous_piercing'                     // inflict piercing battle damage
  | 'mon_continuous_direct_attack_if_only_monster'// can attack directly if it's your only monster
  // ── Normal Spell effects ───────────────────────────────────────────────────
  | 'sp_destroy_target_monster'      // destroy 1 monster on field
  | 'sp_destroy_target_spelltrap'    // destroy 1 spell/trap on field
  | 'sp_destroy_all_opp_monsters'    // destroy every opponent monster
  | 'sp_destroy_all_spelltrap'       // destroy every spell/trap on field
  | 'sp_draw_2'                      // draw 2 cards
  | 'sp_return_target_to_hand'       // bounce 1 monster on field
  | 'sp_mill_top_3_opp'              // opponent mills top 3
  | 'sp_burn_1000'                   // deal 1000 damage to opponent
  | 'sp_heal_2000'                   // gain 2000 LP
  | 'sp_special_summon_from_gy_lvl4' // SS 1 Level ≤4 monster from your GY
  | 'sp_polymerization'              // fusion summon (designate a fusion monster, send materials)
  | 'sp_ritual_summon'               // ritual summon helper (designate a ritual monster + tributes)
  // ── Continuous Spell effects ───────────────────────────────────────────────
  | 'sp_cont_pump_attribute_+300'    // your same-attribute monsters get +300 ATK
  | 'sp_cont_extra_draw_per_turn'    // draw 1 extra at standby
  | 'sp_cont_burn_300_each_endphase' // burn opp 300 at end phase
  // ── Equip Spell effects ────────────────────────────────────────────────────
  | 'sp_equip_atk_+700'              // equipped monster gains 700 ATK
  | 'sp_equip_def_+700'              // equipped monster gains 700 DEF
  | 'sp_equip_piercing_pump_+500'    // +500 ATK + piercing damage
  // ── Field Spell effects ────────────────────────────────────────────────────
  | 'sp_field_attribute_atk_+300_def_+300' // boost all monsters of an attribute
  // ── Quick-Play Spell effects ───────────────────────────────────────────────
  | 'sp_quick_pump_target_+1000_atk' // give 1 monster +1000 ATK until end of turn
  | 'sp_quick_negate_attack'         // negate 1 attack this turn
  | 'sp_quick_burn_500_per_card'     // burn 500 × number of S/T opp controls
  // ── Trap effects ───────────────────────────────────────────────────────────
  | 'tr_mirror_force'                // destroy all opp face-up Attack Position monsters
  | 'tr_negate_attack'               // negate 1 attack
  | 'tr_destroy_attacker'            // destroy the attacking monster
  | 'tr_trap_hole'                   // destroy a monster just summoned (ATK ≥ 1000)
  | 'tr_torrential_tribute'          // destroy all monsters on the field when a monster is summoned
  | 'tr_call_of_the_haunted'         // SS 1 monster from your GY (continuous trap)
  | 'tr_continuous_pump_+300'        // your monsters get +300 ATK while face-up
  | 'tr_counter_negate_spell'        // counter: negate + destroy 1 spell
  | 'tr_counter_negate_trap'         // counter: negate + destroy 1 trap
  | 'tr_counter_negate_summon'       // counter: negate a summon
  ;

// ── Card definitions ────────────────────────────────────────────────────────

export interface MonsterDef {
  id: string;
  name: string;
  type: 'monster';
  color: Color;
  attribute: Attribute;
  race: MonsterRace;
  subtype: MonsterSubtype;
  /** Level for non-Xyz/Link monsters (Pendulum has both Level and Scale). */
  level?: number;
  /** Rank for Xyz monsters. */
  rank?: number;
  /** Link rating for Link monsters. */
  linkRating?: number;
  atk: number;
  /** DEF — Link monsters have no DEF (omit). */
  def?: number;
  /** Tuner flag — required for Synchro materials. */
  isTuner?: boolean;
  /** For Fusion monsters: required materials (card IDs). */
  fusionMaterials?: string[];
  /** For Ritual monsters: the matching Ritual Spell card id and total level required as tributes. */
  ritualSpellId?: string;
  ritualLevelCost?: number;
  /** For Synchro monsters: total level required (1 must be Tuner). */
  synchroLevel?: number;
  /** For Xyz monsters: { level, count } describing material needs. */
  xyzMaterials?: { level: number; count: number };
  /** For Pendulum monsters: scale value (0–12). */
  pendulumScale?: number;
  /** Optional pendulum-zone effect when activated as a spell. */
  pendulumEffect?: EffectId;
  /** For Link monsters: arrow positions (8 cardinal). */
  linkArrows?: LinkArrow[];
  effects?: MonsterEffect[];
  text: string;
  flavor?: string;
  image?: string;
}

export interface MonsterEffect {
  timing: 'continuous' | 'ignition' | 'trigger' | 'flip' | 'quick';
  /** Optional explicit trigger window for 'trigger' timing. */
  trigger?: 'on_summon' | 'on_destroy_by_battle' | 'on_destroy' | 'on_flip' | 'standby' | 'end_phase';
  effect: EffectId;
  text: string;
}

export type LinkArrow = 'TL' | 'T' | 'TR' | 'L' | 'R' | 'BL' | 'B' | 'BR';

export interface SpellDef {
  id: string;
  name: string;
  type: 'spell';
  color: Color;
  subtype: SpellSubtype;
  effect: EffectId;
  /** For Ritual Spells: ids of the Ritual Monsters this spell can summon. */
  ritualMonsterIds?: string[];
  /** For Polymerization-style: ids of fusion monsters reachable via this card. */
  fusionMonsterIds?: string[];
  text: string;
  image?: string;
}

export interface TrapDef {
  id: string;
  name: string;
  type: 'trap';
  color: Color;
  subtype: TrapSubtype;
  effect: EffectId;
  text: string;
  image?: string;
}

export type CardDef = MonsterDef | SpellDef | TrapDef;

// Convenience type guards.
export const isMonster = (c: CardDef | undefined | null): c is MonsterDef => !!c && c.type === 'monster';
export const isSpell   = (c: CardDef | undefined | null): c is SpellDef   => !!c && c.type === 'spell';
export const isTrap    = (c: CardDef | undefined | null): c is TrapDef    => !!c && c.type === 'trap';
export const isExtraDeckMonster = (c: CardDef | undefined | null): boolean =>
  isMonster(c) && (c.subtype === 'fusion' || c.subtype === 'synchro' || c.subtype === 'xyz' || c.subtype === 'link');

/** How many tributes a Normal Summon of this level requires (0/1/2). */
export function tributesRequired(level: number): number {
  if (level <= 4) return 0;
  if (level <= 6) return 1;
  return 2;
}

// ── Image helpers ────────────────────────────────────────────────────────────

const cmc = (id: number) => `https://s2.coinmarketcap.com/static/img/coins/128x128/${id}.png`;
const emo = (cp: string) =>
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cp}.png`;

/** Image overrides keyed by card id. Cards without an entry render the chain glyph. */
const IMAGES: Record<string, string> = {
  // BnB monsters
  bnb_babydoge: '/cards/babydoge.png?v=1',
  bnb_broccoli: '/cards/broccoli.png?v=1',
  bnb_tut:      cmc(33687),
  bnb_tst:      '/cards/tst.png?v=1',
  bnb_banana:   '/cards/banana.jpg?v=1',
  bnb_mubarak:  '/cards/mubarak.png?v=1',
  bnb_cheems:   '/cards/cheems.png?v=1',
  bnb_floki:    cmc(10804),
  // BnB spells/traps/extra
  bnb_volume_bot: '/cards/volume_bot.png?v=1',
  bnb_launchpad:  '/cards/token_launchpad.png?v=1',
  bnb_sniper_bot: '/cards/sniper_bot.png?v=1',
  bnb_mm_algo:    '/cards/market_maker_algo.png?v=1',
  bnb_rugpull:    '/cards/rug_pull.png?v=1',
  bnb_airdrop:    '/cards/airdrop_farm.png?v=1',
  bnb_honeypot:   '/cards/honeypot.png?v=1',
  bnb_liquidity:  emo('1f4a7'),

  // Solana monsters
  sol_pnut:     '/cards/pnut.webp?v=2',
  sol_bonk:     '/cards/bonk.png?v=1',
  sol_popcat:   '/cards/popcat.png?v=1',
  sol_mew:      '/cards/mew.png?v=1',
  sol_bome:     '/cards/bome.png?v=3',
  sol_wif:      cmc(28752),
  sol_fartcoin: '/cards/fartcoin.png?v=1',
  sol_goat:     cmc(33440),
  // Solana spells/traps/extra
  sol_mev_bundler:    '/cards/mev-bundler.png?v=1',
  sol_ai_agent:       '/cards/ai-trading-agent.png?v=1',
  sol_amm_router:     '/cards/amm-router.png?v=1',
  sol_tg_suite:       '/cards/telegram-bot-suite.png?v=1',
  sol_snipe:          '/cards/snipe.png?v=1',
  sol_frontrun:       emo('1f3c3'),
  sol_tg_pump:        emo('1f4e2'),
  sol_validator:      emo('26a1'),

  // Avalanche monsters
  avax_coq:     '/cards/coq.png?v=1',
  avax_kimbo:   emo('1f415'),
  avax_nochill: emo('1f976'),
  avax_husky:   emo('1f43a'),
  avax_tech:    emo('1f4bb'),
  avax_gec:     emo('1f98e'),
  avax_meat:    emo('1f969'),
  avax_ket:     emo('1f408'),
  // Avalanche spells/traps/extra
  avax_subnet:    emo('1f3d4'),
  avax_validator: emo('2744'),
  avax_teleport:  emo('1f309'),
  avax_router:    emo('1f9ed'),
  avax_snowball:  emo('26c4'),
  avax_rush:      emo('1f3c2'),
  avax_finality:  emo('2705'),
  avax_icebound:  emo('1f512'),

  // Ethereum monsters
  eth_andy:     '/cards/andy.png?v=1',
  eth_apu:      '/cards/apu.webp?v=1',
  eth_wojak:    '/cards/wojak.png?v=2',
  eth_turbo:    '/cards/turbo.png?v=1',
  eth_mog:      '/cards/mog.png?v=2',
  eth_shib:     '/cards/shib.png?v=1',
  eth_brett:    '/cards/brett.png?v=1',
  eth_pepe:     '/cards/pepe.png?v=1',
  eth_sproto_gremlin: '/sproto-gremlin.png',
  // Ethereum spells/traps/extra
  eth_smart_contract: '/cards/smart_contract_suite.png?v=1',
  eth_dapp_eco:       emo('1f310'),
  eth_layer2:         '/cards/layer2_rollup.png?v=1',
  eth_yield:          emo('1fa99'),
  eth_fud_tweet:      emo('1f426'),
  eth_dca:            '/cards/dca_in.png?v=1',
  eth_exploit:        '/cards/exploit_disclosure.png?v=1',
  eth_shield:         emo('1f6e1'),

  // XRP monsters
  xrp_phnix:   '/cards/phnix.png?v=1',
  xrp_fuzzy:   '/cards/fuzzy.png?v=1',
  xrp_bert:    cmc(34121),
  xrp_xpm:     cmc(34030),
  xrp_xpunks:  '/cards/xpunks.png?v=1',
  xrp_oze:     cmc(34221),
  xrp_army:    cmc(33966),
  xrp_xmen:    '/cards/xmen.png?v=1',
  // XRP spells/traps/extra
  xrp_indexer:  emo('1f4d2'),
  xrp_amm_pool: emo('1f30a'),
  xrp_arb_bot:  emo('26a1'),
  xrp_algo:     emo('1f9ee'),
  xrp_doxx:     emo('1f50d'),
  xrp_whale:    emo('1f40b'),
  xrp_subpoena: emo('1f3db'),
  xrp_edge:     emo('2694'),
};

// ── Templated frame helper (for CardPreview / Board) ─────────────────────────

export function templateFor(def: CardDef): { url: string; glyph?: string } | undefined {
  if (def.type === 'spell') return { url: '/template-machine.jpg', glyph: 'SPELL' };
  if (def.type === 'trap')  return { url: '/template-machine.jpg', glyph: 'TRAP'  };
  const meta = COLOR_META[def.color];
  if (meta.template) return { url: meta.template, glyph: meta.glyph };
  return undefined;
}

// ── Builders ─────────────────────────────────────────────────────────────────

interface MonsterOpts {
  isTuner?: boolean;
  effects?: MonsterEffect[];
  flavor?: string;
}

/** Plain Normal Monster (vanilla, no effects, flavor only). */
function NM(
  id: string, color: Color, name: string, race: MonsterRace,
  level: number, atk: number, def: number, flavor: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'normal', level, atk, def, flavor,
    text: flavor,
  };
}

/** Effect Monster. Provide effects[] for ignition/trigger/flip/continuous/quick. */
function EM(
  id: string, color: Color, name: string, race: MonsterRace,
  level: number, atk: number, def: number, text: string, opts: MonsterOpts = {},
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'effect', level, atk, def, text,
    isTuner: opts.isTuner,
    effects: opts.effects,
    flavor: opts.flavor,
  };
}

/** Ritual Monster. Ritual cards reference a spell by ID and a level tribute cost. */
function RM(
  id: string, color: Color, name: string, race: MonsterRace,
  level: number, atk: number, def: number, ritualSpellId: string, ritualLevelCost: number, text: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'ritual', level, atk, def,
    ritualSpellId, ritualLevelCost,
    text,
  };
}

/** Fusion Monster. fusionMaterials = list of card IDs that must be sent. */
function FM(
  id: string, color: Color, name: string, race: MonsterRace,
  level: number, atk: number, def: number, materials: string[], text: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'fusion', level, atk, def,
    fusionMaterials: materials,
    text,
  };
}

/** Synchro Monster. synchroLevel = total level required, must include 1 Tuner. */
function SM(
  id: string, color: Color, name: string, race: MonsterRace,
  level: number, atk: number, def: number, text: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'synchro', level, atk, def, synchroLevel: level,
    text,
  };
}

/** Xyz Monster. xyzMaterials = { level, count }. */
function XM(
  id: string, color: Color, name: string, race: MonsterRace,
  rank: number, atk: number, def: number, requireLevel: number, requireCount: number, text: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'xyz', rank, atk, def,
    xyzMaterials: { level: requireLevel, count: requireCount },
    text,
  };
}

/** Link Monster. linkRating must match number of materials. */
function LM(
  id: string, color: Color, name: string, race: MonsterRace,
  linkRating: number, atk: number, arrows: LinkArrow[], text: string,
): MonsterDef {
  return {
    id, name, type: 'monster', color,
    attribute: COLOR_META[color].attribute,
    race, subtype: 'link', linkRating, atk,
    linkArrows: arrows,
    text,
  };
}

/** Spell builder. */
function SP(
  id: string, color: Color, name: string, subtype: SpellSubtype, effect: EffectId, text: string,
  extras: { ritualMonsterIds?: string[]; fusionMonsterIds?: string[] } = {},
): SpellDef {
  return { id, name, type: 'spell', color, subtype, effect, text, ...extras };
}

/** Trap builder. */
function TR(
  id: string, color: Color, name: string, subtype: TrapSubtype, effect: EffectId, text: string,
): TrapDef {
  return { id, name, type: 'trap', color, subtype, effect, text };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

export const CARDS: Record<string, CardDef> = {};

function reg(...cs: CardDef[]) {
  for (const c of cs) {
    const img = IMAGES[c.id];
    CARDS[c.id] = img ? { ...c, image: img } : c;
  }
}

// ── BnB (EARTH) — Beast/Plant tribe, balanced bodies with token synergy ─────
reg(
  NM('bnb_babydoge', 'bnb', 'BABYDOGE',    'Beast',         1,  300, 300, 'A zero-zero-zero token with a million holders.'),
  NM('bnb_broccoli', 'bnb', 'BROCCOLI',    'Plant',         2,  700, 500, "CZ's dog. Greens are bullish."),
  EM('bnb_tut',      'bnb', 'TUT',         'Beast',         2,  800, 800,
     'Trigger — When this card is Normal Summoned, draw 1 card.',
     { effects: [{ timing: 'trigger', trigger: 'on_summon', effect: 'mon_trigger_on_summon_draw_1',
                   text: 'When this card is Normal Summoned: draw 1 card.' }] }),
  EM('bnb_tst',      'bnb', 'TST',         'Beast',         3, 1200,  800,
     'Tuner — Used as a Synchro Material on the BnB chain.',
     { isTuner: true }),
  NM('bnb_banana',   'bnb', 'BANANA',      'Plant',         3, 1400, 1100, 'Slipped past every sell wall.'),
  EM('bnb_mubarak',  'bnb', 'MUBARAK',     'Warrior',       4, 1700, 1200,
     'Continuous — Your other EARTH monsters gain 300 ATK.',
     { effects: [{ timing: 'continuous', effect: 'mon_continuous_pump_own_attribute_+300',
                   text: 'Your other EARTH monsters gain 300 ATK.' }] }),
  NM('bnb_cheems',   'bnb', 'CHEEMS',      'Beast',         4, 1800, 1400, 'Bonk\'s older brother. Frens forever.'),
  EM('bnb_floki',    'bnb', 'FLOKI',       'Beast-Warrior', 6, 2400, 2000,
     'Tribute Summon (1 tribute). Ignition — Once per turn: tribute this monster; destroy 1 monster on the field.',
     { effects: [{ timing: 'ignition', effect: 'mon_ignition_destroy_1_monster_tribute_self',
                   text: 'Once per turn: tribute this monster; destroy 1 monster on the field.' }] }),

  // Spells
  SP('bnb_volume_bot', 'bnb', 'Volume Bot',       'continuous', 'sp_cont_pump_attribute_+300',
     'While face-up, your EARTH monsters gain 300 ATK.'),
  SP('bnb_launchpad',  'bnb', 'Token Launchpad',  'continuous', 'sp_cont_extra_draw_per_turn',
     'During each of your Standby Phases: draw 1 extra card.'),
  SP('bnb_airdrop',    'bnb', 'Airdrop Farm',     'normal',     'sp_draw_2',
     'Draw 2 cards.'),
  SP('bnb_rugpull',    'bnb', 'Rug Pull',         'normal',     'sp_destroy_target_monster',
     'Target 1 monster on the field; destroy it.'),
  SP('bnb_mm_algo',    'bnb', 'Market Maker Algo','equip',      'sp_equip_atk_+700',
     'Equipped monster gains 700 ATK.'),

  // Traps
  TR('bnb_honeypot',   'bnb', 'Honeypot',         'normal',     'tr_trap_hole',
     'When the opponent Normal or Special Summons a monster with 1000 or more ATK: destroy that monster.'),
  TR('bnb_sniper_bot', 'bnb', 'Sniper Bot',       'normal',     'tr_destroy_attacker',
     'When an opponent monster declares an attack: destroy that monster.'),
  TR('bnb_liquidity',  'bnb', 'Liquidity Injection','continuous','tr_continuous_pump_+300',
     'While face-up, your monsters gain 300 ATK.'),

  // Ritual pair
  SP('bnb_relaunch_ritual', 'bnb', 'Token Relaunch',   'ritual',     'sp_ritual_summon',
     'Ritual Summon — Tribute monsters whose total Levels equal or exceed 6 to summon "Phoenix Token Lord".',
     { ritualMonsterIds: ['bnb_phoenix_lord'] }),
  RM('bnb_phoenix_lord', 'bnb', 'Phoenix Token Lord', 'Pyro',         6, 2300, 2000, 'bnb_relaunch_ritual', 6,
     'Ritual Monster. Must first be Ritual Summoned with "Token Relaunch".'),

  // Extra Deck — Fusion
  SP('bnb_polymerization', 'bnb', 'Liquidity Merger', 'normal',       'sp_polymerization',
     'Fusion Summon — Send the listed Fusion Materials from your hand/field to the GY, then Special Summon the Fusion Monster.',
     { fusionMonsterIds: ['bnb_giga_meme'] }),
  FM('bnb_giga_meme', 'bnb', 'GIGA-MEME',           'Beast-Warrior', 7, 2700, 2300,
     ['bnb_cheems', 'bnb_floki'],
     'Fusion. "CHEEMS" + "FLOKI". A combined meme of mythic liquidity.'),
);

// ── Solana (DARK) — fast Spellcasters/Fiends, draw + removal ────────────────
reg(
  NM('sol_pnut',    'sol', 'PNUT',     'Beast',       1,  500, 400, 'Peanut the Squirrel. RIP.'),
  NM('sol_bonk',    'sol', 'BONK',     'Beast',       2,  400, 800, 'The OG Solana shiba.'),
  NM('sol_popcat',  'sol', 'POPCAT',   'Beast',       2,  900, 1200, 'Pop. Pop. Pop.'),
  EM('sol_mew',     'sol', 'MEW',      'Spellcaster', 3, 1300, 900,
     'Tuner.', { isTuner: true }),
  NM('sol_bome',    'sol', 'BOME',     'Spellcaster', 3, 1500, 1100, 'Book of Meme. Required reading.'),
  EM('sol_wif',     'sol', 'dogwifhat','Beast',       4, 1700, 1000,
     'Continuous — This card inflicts piercing battle damage.',
     { effects: [{ timing: 'continuous', effect: 'mon_continuous_piercing',
                   text: 'This monster inflicts piercing battle damage.' }] }),
  EM('sol_fartcoin','sol', 'FARTCOIN', 'Fiend',       5, 1900, 1600,
     'Trigger — When this card is destroyed by battle and sent to the GY: deal 500 damage to your opponent.',
     { effects: [{ timing: 'trigger', trigger: 'on_destroy_by_battle',
                   effect: 'mon_trigger_on_destroy_by_battle_burn_500',
                   text: 'When destroyed by battle: deal 500 damage to opponent.' }] }),
  EM('sol_goat',    'sol', 'GOAT',     'Fiend',       7, 2700, 1900,
     'Tribute Summon (2 tributes).'),

  // Spells
  SP('sol_snipe',         'sol', 'Snipe',           'quickplay', 'sp_quick_burn_500_per_card',
     'Quick-Play. Deal 500 damage to your opponent for each Spell/Trap they control.'),
  SP('sol_tg_pump',       'sol', 'Telegram Pump',   'quickplay', 'sp_quick_pump_target_+1000_atk',
     'Quick-Play. Target 1 face-up monster; it gains 1000 ATK until the end of this turn.'),
  SP('sol_ai_agent',      'sol', 'AI Trading Agent','continuous', 'sp_cont_pump_attribute_+300',
     'While face-up, your DARK monsters gain 300 ATK.'),
  SP('sol_amm_router',    'sol', 'AMM Router',      'field',     'sp_field_attribute_atk_+300_def_+300',
     'Field Spell. All DARK monsters on the field gain 300 ATK / 300 DEF.'),
  SP('sol_frontrun',      'sol', 'Frontrun',        'normal',    'sp_return_target_to_hand',
     'Target 1 monster on the field; return it to its owner\'s hand.'),

  // Traps
  TR('sol_mev_bundler',   'sol', 'MEV Bundler',     'counter',   'tr_counter_negate_spell',
     'Counter Trap. When the opponent activates a Normal Spell: negate the activation and destroy it.'),
  TR('sol_tg_suite',      'sol', 'Telegram Bot Suite','continuous','tr_continuous_pump_+300',
     'Continuous. While face-up, your monsters gain 300 ATK.'),
  TR('sol_validator',     'sol', 'Validator Boost', 'normal',    'tr_negate_attack',
     'Negate the activation of an attack from the opponent this Battle Phase.'),

  // Ritual pair
  SP('sol_oracle_ritual', 'sol', 'Oracle Summoning','ritual',    'sp_ritual_summon',
     'Ritual Summon — Tribute monsters whose total Levels equal or exceed 7 to Ritual Summon "Onchain Oracle".',
     { ritualMonsterIds: ['sol_oracle'] }),
  RM('sol_oracle',  'sol', 'Onchain Oracle', 'Spellcaster', 7, 2500, 2100, 'sol_oracle_ritual', 7,
     'Ritual. Must first be Ritual Summoned with "Oracle Summoning".'),

  // Extra Deck — Synchro
  SM('sol_validator_dragon', 'sol', 'Validator Dragon', 'Wyrm',  5, 2400, 2000,
     'Synchro. 1 Tuner + 1+ non-Tuner monsters with total Level 5.'),
);

// ── Avalanche (FIRE) — big bodies, removal traps ────────────────────────────
reg(
  NM('avax_coq',     'avax', 'COQ',     'Beast',         1,  500, 400, 'Coq Inu crows across the C-Chain.'),
  NM('avax_kimbo',   'avax', 'KIMBO',   'Beast',         2,  800, 800, 'A snow dog with a community bite.'),
  EM('avax_nochill', 'avax', 'NOCHILL', 'Pyro',          2,  500, 1500,
     'Flip — When this card is flipped face-up: draw 2 cards.',
     { effects: [{ timing: 'flip', effect: 'mon_flip_draw_2',
                   text: 'FLIP: Draw 2 cards.' }] }),
  NM('avax_husky',   'avax', 'HUSKY',   'Beast',         3, 1500, 1000, 'The old Avalanche sled dog still pulls.'),
  EM('avax_tech',    'avax', 'TECH',    'Machine',       3, 1300, 1100,
     'Tuner.', { isTuner: true }),
  NM('avax_gec',     'avax', 'GEC',     'Reptile',       4, 1600, 1600, 'Gecko sticks to the wall through every dip.'),
  EM('avax_meat',    'avax', 'MEAT',    'Beast-Warrior', 5, 2000, 1700,
     'Tribute Summon (1 tribute). Continuous — Inflicts piercing battle damage.',
     { effects: [{ timing: 'continuous', effect: 'mon_continuous_piercing',
                   text: 'Inflicts piercing battle damage.' }] }),
  EM('avax_ket',     'avax', 'KET',     'Pyro',          7, 2700, 2200,
     'Tribute Summon (2 tributes). Ignition — Once per turn, discard 1 card; destroy 1 Spell or Trap on the field.',
     { effects: [{ timing: 'ignition', effect: 'mon_ignition_destroy_1_spelltrap_discard1',
                   text: 'Once per turn: discard 1 card; destroy 1 Spell/Trap on the field.' }] }),

  // Spells
  SP('avax_subnet',       'avax', 'Subnet Factory',     'continuous', 'sp_cont_pump_attribute_+300',
     'While face-up, your FIRE monsters gain 300 ATK.'),
  SP('avax_rush',         'avax', 'Avalanche Rush',     'normal',     'sp_heal_2000',
     'Gain 2000 LP.'),
  SP('avax_snowball',     'avax', 'Snowball',           'normal',     'sp_destroy_target_monster',
     'Target 1 monster on the field; destroy it.'),
  SP('avax_router',       'avax', 'Trader Joe Router',  'normal',     'sp_special_summon_from_gy_lvl4',
     'Target 1 Level 4 or lower monster in your GY; Special Summon it.'),
  SP('avax_icebound',     'avax', 'Icebound Stake',     'equip',      'sp_equip_def_+700',
     'Equipped monster gains 700 DEF.'),

  // Traps
  TR('avax_teleport',     'avax', 'Teleporter Bridge',  'normal',     'tr_call_of_the_haunted',
     'Continuous-style: Special Summon 1 monster from your GY in face-up Attack Position.'),
  TR('avax_finality',     'avax', 'One-Block Finality', 'normal',     'tr_mirror_force',
     'When the opponent declares an attack: destroy all their face-up Attack Position monsters.'),
  TR('avax_validator_st', 'avax', 'Validator Set',      'continuous', 'tr_continuous_pump_+300',
     'Continuous. While face-up, your monsters gain 300 ATK.'),

  // Ritual pair
  SP('avax_volcano_ritual','avax','Volcano Awakening', 'ritual',     'sp_ritual_summon',
     'Ritual Summon — Tribute monsters whose total Levels equal or exceed 7 to Ritual Summon "Magma Validator".',
     { ritualMonsterIds: ['avax_magma_validator'] }),
  RM('avax_magma_validator','avax','Magma Validator',  'Pyro',         7, 2600, 2000, 'avax_volcano_ritual', 7,
     'Ritual. Must first be Ritual Summoned with "Volcano Awakening".'),

  // Extra Deck — Xyz
  XM('avax_xyz_phoenix', 'avax', 'Phoenix of the C-Chain', 'Pyro', 4, 2300, 1600, 4, 2,
     'Xyz. 2 Level 4 monsters. (Rank 4)'),
);

// ── Ethereum (LIGHT) — Warriors/Fairies/Cyberse, control + finishers ────────
reg(
  NM('eth_andy',    'eth', 'ANDY',     'Warrior',     1,  600, 600, 'Andy is happy. Andy is bullish.'),
  NM('eth_apu',     'eth', 'APU',      'Fairy',       2,  500, 1100, 'Apu the helper frog.'),
  NM('eth_wojak',   'eth', 'WOJAK',    'Warrior',     2,  800, 1100, 'Feels permabullish, man.'),
  EM('eth_turbo',   'eth', 'TURBO',    'Machine',     3, 1500,  400,
     'Tuner.', { isTuner: true }),
  EM('eth_mog',     'eth', 'MOG',      'Cyberse',     4, 1700, 1500,
     'Trigger — When summoned: draw 1 card.',
     { effects: [{ timing: 'trigger', trigger: 'on_summon', effect: 'mon_trigger_on_summon_draw_1',
                   text: 'When this monster is Normal Summoned: draw 1.' }] }),
  NM('eth_shib',    'eth', 'SHIB',     'Beast',       4, 1800, 1300, 'The Dogecoin killer that became a brand.'),
  EM('eth_brett',   'eth', 'BRETT',    'Spellcaster', 5, 2000, 1500,
     'Tribute Summon (1 tribute).'),
  EM('eth_pepe',    'eth', 'PEPE',     'Fairy',       6, 2200, 2200,
     'Tribute Summon (1 tribute). Continuous — Other LIGHT monsters you control gain 300 ATK.',
     { effects: [{ timing: 'continuous', effect: 'mon_continuous_pump_own_attribute_+300',
                   text: 'Other LIGHT monsters you control gain 300 ATK.' }] }),
  EM('eth_sproto_gremlin','eth','Sproto Gremlin','Fiend',4, 1500, 1500,
     'Trigger — When summoned: deal 500 damage to your opponent.',
     { effects: [{ timing: 'trigger', trigger: 'on_summon', effect: 'mon_trigger_on_destroy_by_battle_burn_500',
                   text: 'When Normal Summoned: deal 500 damage to your opponent.' }] }),

  // Spells
  SP('eth_smart_contract','eth', 'Smart Contract Suite','continuous','sp_cont_pump_attribute_+300',
     'While face-up, your LIGHT monsters gain 300 ATK.'),
  SP('eth_dapp_eco',     'eth', 'Dapp Ecosystem',  'field',     'sp_field_attribute_atk_+300_def_+300',
     'Field Spell. All LIGHT monsters on the field gain 300 ATK and 300 DEF.'),
  SP('eth_fud_tweet',    'eth', 'FUD Tweet',       'normal',    'sp_burn_1000',
     'Deal 1000 damage to your opponent.'),
  SP('eth_dca',          'eth', 'DCA In',          'normal',    'sp_heal_2000',
     'Gain 2000 LP.'),
  SP('eth_exploit',      'eth', 'Exploit Disclosure','normal',  'sp_destroy_target_spelltrap',
     'Target 1 Spell or Trap on the field; destroy it.'),

  // Traps
  TR('eth_layer2',       'eth', 'Layer 2 Rollup',  'continuous','tr_continuous_pump_+300',
     'Continuous. While face-up, your monsters gain 300 ATK.'),
  TR('eth_yield',        'eth', 'Yield Aggregator','normal',    'tr_call_of_the_haunted',
     'Special Summon 1 monster from your GY in face-up Attack Position.'),
  TR('eth_shield',       'eth', 'Smart Contract Shield','normal','tr_mirror_force',
     'When an opponent declares an attack: destroy all their face-up Attack Position monsters.'),

  // Ritual pair
  SP('eth_consensus_ritual','eth','Consensus Ritual','ritual',  'sp_ritual_summon',
     'Ritual Summon — Tribute monsters whose total Levels equal or exceed 8 to Ritual Summon "Beacon of Consensus".',
     { ritualMonsterIds: ['eth_consensus_beacon'] }),
  RM('eth_consensus_beacon','eth','Beacon of Consensus','Fairy',  8, 2800, 2400, 'eth_consensus_ritual', 8,
     'Ritual. Must first be Ritual Summoned with "Consensus Ritual".'),

  // Extra Deck — Link
  LM('eth_link_sequencer','eth', 'Sequencer Link', 'Cyberse',   2, 1600, ['L', 'R'],
     'Link 2. 2 LIGHT monsters. Adjacent zones are linked.'),
);

// ── XRP (WATER) — Aqua/Reptile, disruption + counters ────────────────────────
reg(
  NM('xrp_phnix',  'xrp', 'PHNIX',  'Pyro',         1,  400, 800, 'Rises from the ledger ashes.'),
  NM('xrp_fuzzy',  'xrp', 'FUZZY',  'Beast',        1,  600, 300, 'Looks cuddly. Bites hard.'),
  NM('xrp_bert',   'xrp', 'BERT',   'Aqua',         2,  900, 700, 'Bert never blinks.'),
  EM('xrp_xpm',    'xrp', 'XPM',    'Reptile',      2,  700, 700,
     'Tuner.', { isTuner: true }),
  NM('xrp_xpunks', 'xrp', 'XPUNKS', 'Warrior',      3, 1300, 1300, 'XRPL punk energy.'),
  EM('xrp_oze',    'xrp', 'OZE',    'Aqua',         3, 1500,  600,
     'Continuous — Can attack directly while you control no other monsters.',
     { effects: [{ timing: 'continuous', effect: 'mon_continuous_direct_attack_if_only_monster',
                   text: 'Can attack directly while it is your only monster.' }] }),
  EM('xrp_army',   'xrp', 'ARMY',   'Sea Serpent',  4, 1800, 1200,
     'Quick — Once per turn: discard 1 card; negate one attack this turn.',
     { effects: [{ timing: 'quick', effect: 'mon_quick_negate_attack_discard1',
                   text: 'Quick effect: discard 1 to negate 1 attack.' }] }),
  EM('xrp_xmen',   'xrp', 'XRP-MEN', 'Sea Serpent', 5, 2100, 1600,
     'Tribute Summon (1 tribute).'),

  // Spells
  SP('xrp_indexer',       'xrp', 'Indexer Daemon',  'continuous', 'sp_cont_pump_attribute_+300',
     'While face-up, your WATER monsters gain 300 ATK.'),
  SP('xrp_doxx',          'xrp', 'Doxx',            'normal',     'sp_destroy_target_monster',
     'Target 1 monster on the field; destroy it.'),
  SP('xrp_whale',         'xrp', 'Whale Dump',      'normal',     'sp_burn_1000',
     'Deal 1000 damage to your opponent.'),
  SP('xrp_subpoena',      'xrp', 'SEC Subpoena',    'normal',     'sp_mill_top_3_opp',
     'Your opponent sends the top 3 cards of their Deck to the GY.'),
  SP('xrp_edge',          'xrp', 'Validator Edge',  'equip',      'sp_equip_piercing_pump_+500',
     'Equipped monster gains 500 ATK and inflicts piercing battle damage.'),

  // Traps
  TR('xrp_amm_pool',      'xrp', 'AMM Pool',        'continuous', 'tr_continuous_pump_+300',
     'Continuous. While face-up, your monsters gain 300 ATK.'),
  TR('xrp_arb_bot',       'xrp', 'Arbitrage Bot',   'counter',    'tr_counter_negate_trap',
     'Counter Trap. When the opponent activates a Trap: negate the activation and destroy it.'),
  TR('xrp_algo',          'xrp', 'Trading Algorithm','normal',    'tr_torrential_tribute',
     'When a monster is summoned: destroy all monsters on the field.'),

  // Ritual pair
  SP('xrp_ledger_ritual', 'xrp', 'Ledger Apotheosis','ritual',    'sp_ritual_summon',
     'Ritual Summon — Tribute monsters whose total Levels equal or exceed 6 to Ritual Summon "Ledger Sovereign".',
     { ritualMonsterIds: ['xrp_ledger_sovereign'] }),
  RM('xrp_ledger_sovereign','xrp','Ledger Sovereign','Sea Serpent', 6, 2400, 1800, 'xrp_ledger_ritual', 6,
     'Ritual. Must first be Ritual Summoned with "Ledger Apotheosis".'),

  // Extra Deck — Synchro
  SM('xrp_synchro_kraken','xrp', 'Validator Kraken','Sea Serpent', 6, 2500, 2000,
     'Synchro. 1 Tuner + 1+ non-Tuner monsters with total Level 6.'),
);

// ── Starter decks ────────────────────────────────────────────────────────────
//
// Main Deck = 40 cards. We include 3 copies of each non-ritual monster +
// 2 copies of each Spell/Trap + 1 of each Ritual pair, padding out with
// extras to reach 40 exactly. Extra Deck = 3 copies of the chain's extra
// deck monster (well within the 0–15 range).

/** Yu-Gi-Oh deck rules. */
export const MAIN_DECK_MIN = 40;
export const MAIN_DECK_MAX = 60;
export const MAIN_DECK_SIZE = 40;     // back-compat with App.tsx imports
export const DECK_SIZE = 40;          // alias kept for old imports
export const EXTRA_DECK_SIZE_MAX = 15;
export const SIDE_DECK_SIZE_MAX = 15;
export const MAX_COPIES = 3;
export const MAX_COPIES_NONBASIC = 3; // alias kept for old imports

const isRitualSpell = (def: CardDef) => isSpell(def) && def.subtype === 'ritual';
const isRitualMonster = (def: CardDef) => isMonster(def) && def.subtype === 'ritual';

export function starterMainDeck(color: Color): string[] {
  const pool = Object.values(CARDS).filter(c => c.color === color && !isExtraDeckMonster(c));
  const monsters = pool.filter(isMonster).filter(m => !isRitualMonster(m));
  const spells   = pool.filter(isSpell).filter(s => !isRitualSpell(s));
  const traps    = pool.filter(isTrap);
  const ritualSpells   = pool.filter(isRitualSpell);
  const ritualMonsters = pool.filter(isRitualMonster);

  const deck: string[] = [];
  // 3 of every non-ritual monster (most common copy count for a starter deck)
  for (const m of monsters) for (let i = 0; i < 3; i++) deck.push(m.id);
  // 2 of every spell/trap
  for (const s of spells)   for (let i = 0; i < 2; i++) deck.push(s.id);
  for (const t of traps)    for (let i = 0; i < 2; i++) deck.push(t.id);
  // 1 of each ritual spell + 1 of each ritual monster
  for (const r of ritualSpells)   deck.push(r.id);
  for (const r of ritualMonsters) deck.push(r.id);

  // Pad up to 40 with extra copies of the lowest-level Normal Monster
  const filler = monsters.find(m => m.subtype === 'normal') ?? monsters[0];
  while (deck.length < MAIN_DECK_SIZE) deck.push(filler.id);
  // Or trim if we overshoot (shouldn't happen with current catalog, but safe)
  return deck.slice(0, MAIN_DECK_SIZE);
}

export function starterExtraDeck(color: Color): string[] {
  const extras = Object.values(CARDS).filter(c => c.color === color && isExtraDeckMonster(c));
  const deck: string[] = [];
  for (const m of extras) for (let i = 0; i < 3; i++) deck.push(m.id);
  return deck.slice(0, EXTRA_DECK_SIZE_MAX);
}

export const STARTER_DECKS: Record<Color, string[]> = {
  bnb:  starterMainDeck('bnb'),
  sol:  starterMainDeck('sol'),
  avax: starterMainDeck('avax'),
  eth:  starterMainDeck('eth'),
  xrp:  starterMainDeck('xrp'),
};

export const STARTER_EXTRA_DECKS: Record<Color, string[]> = {
  bnb:  starterExtraDeck('bnb'),
  sol:  starterExtraDeck('sol'),
  avax: starterExtraDeck('avax'),
  eth:  starterExtraDeck('eth'),
  xrp:  starterExtraDeck('xrp'),
};

export const DEFAULT_MATCHUP: [Color, Color] = ['sol', 'eth'];

// ── Deckbuilding ────────────────────────────────────────────────────────────

/** Every card a player can put in a custom deck (the standard pool). */
export const BUILDABLE_CARDS: CardDef[] = Object.values(CARDS);

/**
 * Back-compat helper. The old game had basic "nodes" that were unlimited;
 * YGO has no basics, so this always returns false.
 */
export function isBasicNode(_defId: string): boolean { return false; }

export type DeckIssue = { code: string; message: string };
export type DeckValidation = { ok: boolean; size: number; issues: DeckIssue[] };

/**
 * Validate a custom Main Deck.
 *  - size must be 40–60
 *  - max 3 copies of any card
 *  - all card IDs must be known
 *  - no Fusion/Synchro/Xyz/Link/Pendulum monsters in the Main Deck
 */
export function validateDeck(cards: string[], opts?: { requireSize?: boolean }): DeckValidation {
  const requireSize = opts?.requireSize ?? true;
  const issues: DeckIssue[] = [];
  const size = cards.length;
  if (requireSize && (size < MAIN_DECK_MIN || size > MAIN_DECK_MAX)) {
    issues.push({
      code: 'size',
      message: `Main Deck must be ${MAIN_DECK_MIN}–${MAIN_DECK_MAX} cards (currently ${size}).`,
    });
  }
  const counts: Record<string, number> = {};
  for (const id of cards) {
    const def = CARDS[id];
    if (!def) { issues.push({ code: 'unknown', message: `Unknown card id: ${id}` }); continue; }
    if (isExtraDeckMonster(def)) {
      issues.push({ code: 'extra_in_main', message: `${def.name} belongs in the Extra Deck.` });
    }
    counts[id] = (counts[id] ?? 0) + 1;
  }
  for (const [id, n] of Object.entries(counts)) {
    if (n > MAX_COPIES) {
      issues.push({
        code: 'copies',
        message: `Too many copies of ${CARDS[id].name} (${n}/${MAX_COPIES}).`,
      });
    }
  }
  return { ok: issues.length === 0, size, issues };
}

/** Validate an Extra Deck (0–15 cards, only Extra Deck monsters allowed). */
export function validateExtraDeck(cards: string[]): DeckValidation {
  const issues: DeckIssue[] = [];
  if (cards.length > EXTRA_DECK_SIZE_MAX) {
    issues.push({ code: 'extra_size', message: `Extra Deck max is ${EXTRA_DECK_SIZE_MAX} cards.` });
  }
  const counts: Record<string, number> = {};
  for (const id of cards) {
    const def = CARDS[id];
    if (!def) { issues.push({ code: 'unknown', message: `Unknown card id: ${id}` }); continue; }
    if (!isExtraDeckMonster(def)) {
      issues.push({ code: 'main_in_extra', message: `${def.name} cannot go in the Extra Deck.` });
    }
    counts[id] = (counts[id] ?? 0) + 1;
  }
  for (const [id, n] of Object.entries(counts)) {
    if (n > MAX_COPIES) {
      issues.push({ code: 'copies', message: `Too many copies of ${CARDS[id].name} (${n}/${MAX_COPIES}).` });
    }
  }
  return { ok: issues.length === 0, size: cards.length, issues };
}

/**
 * Pick a primary chain from a deck — used to set the player's theme colour
 * when they bring a custom deck. Counts every card by colour.
 */
export function derivePrimaryColor(cards: string[]): Color {
  const counts: Record<Color, number> = { bnb: 0, sol: 0, avax: 0, eth: 0, xrp: 0 };
  for (const id of cards) {
    const def = CARDS[id]; if (!def) continue;
    counts[def.color]++;
  }
  let best: Color = 'sol'; let bestN = -1;
  for (const c of COLORS) if (counts[c] > bestN) { best = c; bestN = counts[c]; }
  return best;
}
