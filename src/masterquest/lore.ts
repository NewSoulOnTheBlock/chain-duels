// src/masterquest/lore.ts
// ─────────────────────────────────────────────────────────────────────────────
// CHAIN DUELS — THE GOLDEN DECK SAGA
//
// You wake to your Duel Terminal screaming. Ten glowing fragments of the
// Golden Deck shatter the screen and scatter across the Chain Realm. A hooded
// figure warns you that if the fragments are not recovered, the realm will
// collapse into digital chaos — then he vanishes.
//
// You walk eleven Sites: six Duel Masters, three corrupted Void Masters, the
// Void Player at the Genesis Arena, and the True Final Boss waiting at the
// summit. Every Site holds a fragment. The final Site holds the truth.
//
// Site positions match the painted Saga Map at /masterquest-map.png. Pixel
// positions are normalised to a 1536×1024 SVG viewBox so the page can draw
// the player avatar and node pins over the painted map.
// ─────────────────────────────────────────────────────────────────────────────

import type { Color } from '../cards';

// ── Acts ────────────────────────────────────────────────────────────────────
// 11 chapters across 3 acts:
//   Act I  — THE AWAKENING (Sites I–III)   the early adversaries
//   Act II — THE CHAMPIONS (Sites IV–VI)   the realm's elite
//   Act III— THE VOID      (Sites VII–XI)  the Void Trio, the Void Player,
//                                          and the True Final Boss
export const ACTS = {
  awakening: { title: 'Act I — The Awakening', siteRange: [1,  3] as const },
  champions: { title: 'Act II — The Champions', siteRange: [4,  6] as const },
  void:      { title: 'Act III — The Void',     siteRange: [7, 11] as const },
} as const;
export type ActKey = keyof typeof ACTS;

// ── Site ids ─────────────────────────────────────────────────────────────────
export type SiteId =
  // Act I — The Awakening
  | 'ace_vega_neon_district'    // I
  | 'willow_sage_emerald_woods' // II
  | 'director_volt_iron_nexus'  // III
  // Act II — The Champions
  | 'nova_storm_celestial_cup'  // IV
  | 'broker_shadow_market'      // V
  | 'crimson_fortress_heir'     // VI
  // Act III — The Void
  | 'obsidian_void_master'      // VII
  | 'hex_void_master'           // VIII
  | 'null_void_master'          // IX
  | 'void_player_genesis_arena' // X
  | 'first_champion_summit';    // XI

export interface SiteRival {
  name: string;
  title: string;
  bio: string;
  botColor: Color;
  difficulty: 'easy' | 'normal' | 'hard';
  quote: string;
}

export interface SiteMapPos { x: number; y: number }

export interface SacredSite {
  id: SiteId;
  index: number;            // 1..11
  act: ActKey;
  chain: Color;             // theme + bot starter deck color
  name: string;             // canonical site name as printed on the Map
  region: string;           // parent region name + tagline
  description: string;      // map-card flavour text
  rival: SiteRival;
  reward: string;
  /** Pixel position of the node on the painted map. */
  mapPos: SiteMapPos;
}

// ── The Prologue ────────────────────────────────────────────────────────────
// Chapter 1 — THE FIRST DRAW
export const PROLOGUE = `
You wake to the sound of your Duel Terminal screaming.

WARNING: GOLDEN DECK FRAGMENT DETECTED.

The screen flashes gold. Then it shatters. Ten glowing cards explode from
the monitor and scatter across the Chain Realm — one for every Sovereign
who used to wield them.

A hooded figure resolves out of the static.

"The Golden Deck has been broken. If the ten fragments are not recovered,
the Chain Realm will collapse into digital chaos. Walk every Site. Defeat
every keeper. Reclaim every fragment."

Before you can ask anything, the figure vanishes.

You are the only duellist on the network whose ID still glows gold.

Your journey begins.
`.trim();

// ── The Sites ───────────────────────────────────────────────────────────────
// Map pixel positions are calibrated to the painted Saga Map. The viewBox
// of the rendering SVG is 1536×1024 so the image fits at native resolution.
export const MAP_VIEWBOX = { w: 1536, h: 1024 } as const;

export const SITES: ReadonlyArray<SacredSite> = [
  // ────────── ACT I — THE AWAKENING ─────────────────────────────────────
  {
    id: 'ace_vega_neon_district', index: 1, act: 'awakening', chain: 'sol',
    name: 'The Neon District',
    region: 'Lower Realm · The Street Circuits',
    description:
      'A neon-soaked grid of street-duel arenas and back-alley pawn-shops. ' +
      'The first fragment fell here, into the deck of the undefeated king of ' +
      'the streets. The crowd has already gathered. ACE VEGA is already laughing.',
    rival: {
      name: 'Ace Vega',
      title: 'King of the Neon Streets',
      bio:
        'Self-taught duellist who climbed from gutter-arenas to street-king ' +
        'on raw aggression. Plays a Lightning Rush deck that swarms the board ' +
        'in the first three turns and dares you to survive long enough to ' +
        'find an answer.',
      botColor: 'sol', difficulty: 'easy',
      quote: '"You? You think YOU can collect the Golden Fragments? Show me."',
    },
    reward: 'Fragment I/X · A flickering golden Spark Card warm from Ace\'s deck.',
    mapPos: { x: 240, y: 890 },
  },
  {
    id: 'willow_sage_emerald_woods', index: 2, act: 'awakening', chain: 'bnb',
    name: 'The Emerald Woods',
    region: 'Lower Realm · The Forest of Lost Decks',
    description:
      'A holographic forest of ancient trees, every branch hung with the ' +
      'decks of duellists who abandoned the game long ago. Their protector ' +
      'wanders the paths, refusing to surrender what she keeps. She does not ' +
      'believe the Golden Deck deserves to be reforged.',
    rival: {
      name: 'Willow Sage',
      title: 'Warden of the Forest of Lost Decks',
      bio:
        'Hermit-duellist who left the circuits to guard the cards of those ' +
        'who quit before her. Plays a Beastfolk tribal deck that grows ' +
        'stronger every turn it remains undisturbed, with deep board-state ' +
        'memory and graveyard recovery.',
      botColor: 'bnb', difficulty: 'easy',
      quote: '"The Golden Deck caused wars long ago. Why should it be restored?"',
    },
    reward: 'Fragment II/X · A golden leaf-card that hums when held to the wind.',
    mapPos: { x: 460, y: 780 },
  },
  {
    id: 'director_volt_iron_nexus', index: 3, act: 'awakening', chain: 'eth',
    name: 'Iron Nexus',
    region: 'Lower Realm · The Machine City',
    description:
      'A vertical city of mirrored chrome and humming server-towers that never ' +
      'sleeps. Its ruler runs millions of duel simulations every second. By ' +
      'the time your foot crosses the city limit, he has already calculated ' +
      'your defeat to four decimal places.',
    rival: {
      name: 'Director Volt',
      title: 'Sovereign of the Machine City',
      bio:
        'Half-machine prodigy who runs Iron Nexus through a continuous duel ' +
        'simulation. Plays a Machine combo deck that chains effects across ' +
        'the entire turn and ends most matches before his hand is even half ' +
        'empty.',
      botColor: 'eth', difficulty: 'normal',
      quote: '"You possess a 0.003% chance of victory. Begin so I can finish."',
    },
    reward: 'Fragment III/X · A polished golden gear-card, still warm from Volt\'s simulation.',
    mapPos: { x: 320, y: 560 },
  },

  // ────────── ACT II — THE CHAMPIONS ────────────────────────────────────
  {
    id: 'nova_storm_celestial_cup', index: 4, act: 'champions', chain: 'eth',
    name: 'The Celestial Cup',
    region: 'Upper Realm · The Sky Tournament',
    description:
      'A floating arena above the clouds where thousands compete and only ' +
      'one survives. To reach the fourth fragment you must enter the bracket, ' +
      'climb every round, and face the reigning champion in the finals — ' +
      'broadcast live to every duel-screen in the realm.',
    rival: {
      name: 'Nova Storm',
      title: 'Reigning Champion of the Celestial Cup',
      bio:
        'Three-time tournament champion. Plays a Fairy / Cyberse celestial ' +
        'control deck that suspends gravity, removes monsters from play, and ' +
        'finishes with a single perfectly-timed direct attack from the sky.',
      botColor: 'eth', difficulty: 'normal',
      quote: '"Thousands enter. One survives. I want it to be you, this time."',
    },
    reward: 'Fragment IV/X · A golden cup-token engraved with thunderclouds.',
    mapPos: { x: 580, y: 320 },
  },
  {
    id: 'broker_shadow_market', index: 5, act: 'champions', chain: 'xrp',
    name: 'The Shadow Market',
    region: 'Underground · The Forbidden Bazaar',
    description:
      'A black-market beneath the Realm where cards, relics, even memories ' +
      'are traded for things you can never get back. The fifth fragment is ' +
      'in the hands of the man who runs the bazaar — and every turn in his ' +
      'arena changes the rules of the duel itself.',
    rival: {
      name: 'The Broker',
      title: 'Dealer of the Shadow Market',
      bio:
        'Identity unknown, voice altered, smile never the same twice. Plays ' +
        'a chaotic Sea-Serpent / Reptile disruption deck that activates an ' +
        'arena-wide rule-change every turn — banishing zones, doubling damage, ' +
        'forcing trades. You will not win by playing the game he is playing.',
      botColor: 'xrp', difficulty: 'normal',
      quote: '"Every turn, a new rule. Adapt, or trade me your memories."',
    },
    reward: 'Fragment V/X · A golden trade-chit that re-mints itself between hands.',
    mapPos: { x: 820, y: 520 },
  },
  {
    id: 'crimson_fortress_heir', index: 6, act: 'champions', chain: 'avax',
    name: 'The Crimson Fortress',
    region: 'Volcanic Span · The Apprentice\'s Keep',
    description:
      'A black-iron fortress on a sea of cooling magma. Halfway through your ' +
      'journey the truth becomes visible from the watchtowers: the Golden ' +
      'Deck was once wielded by the FIRST CHAMPION, who united the world — ' +
      'until his apprentice betrayed him. That apprentice built this fortress. ' +
      'His descendant guards the sixth fragment, and the gates do not open ' +
      'for losers.',
    rival: {
      name: 'Lord Ferran the Heir',
      title: 'Descendant of the First Apprentice',
      bio:
        'Last of the Crimson bloodline. Plays a Pyro / Beast-Warrior brutal ' +
        'mid-range deck built around overwhelming ATK trades and refusal to ' +
        'block first. Never gives ground; never apologises for it.',
      botColor: 'avax', difficulty: 'hard',
      quote: '"My ancestor broke the Golden Deck. I will break the fool reforging it."',
    },
    reward:
      'Fragment VI/X · A golden seal-card etched with the First Champion\'s ' +
      'sigil. As the fortress gates swing open the warning is already burning ' +
      'on every wall inside: THE VOID PLAYER AWAKENS.',
    mapPos: { x: 1060, y: 640 },
  },

  // ────────── ACT III — THE VOID ────────────────────────────────────────
  {
    id: 'obsidian_void_master', index: 7, act: 'void', chain: 'avax',
    name: 'The Void Spire — Obsidian',
    region: 'Corrupted Dimension · The Shattered Pillar',
    description:
      'The Void Zone bleeds through the Realm. Cards disappear from ' +
      'collections. Whole arenas wink out of existence. The first of three ' +
      'elite Void Masters waits inside a pillar of black glass — every ' +
      'surface a mirror of a duel you have already lost in some other ' +
      'timeline.',
    rival: {
      name: 'Obsidian',
      title: 'Void Master of the Shattered Pillar',
      bio:
        'First and largest of the three Void Masters. Plays a corrupted Pyro / ' +
        'Rock destruction deck that ignores defensive lines by removing the ' +
        'card from play entirely. Cards he has destroyed do not return; cards ' +
        'he has banished may never have existed.',
      botColor: 'avax', difficulty: 'hard',
      quote: '"Your collection grows lighter every turn. You will not notice until it\'s gone."',
    },
    reward: 'Fragment VII/X · A black-and-gold mirror-card that reflects every move you have not yet made.',
    mapPos: { x: 1300, y: 520 },
  },
  {
    id: 'hex_void_master', index: 8, act: 'void', chain: 'sol',
    name: 'The Void Spire — Hex',
    region: 'Corrupted Dimension · The Hexed Circle',
    description:
      'A ring of seven floating altars rotating around a black sun. The ' +
      'second Void Master casts every move as a hex — your monsters answer ' +
      'to her before they answer to you. None of your hand is yours, in this ' +
      'arena, until the duel ends.',
    rival: {
      name: 'Hex',
      title: 'Void Master of the Hexed Circle',
      bio:
        'Spellcaster-pure Void Master. Plays a corrupted Spellcaster / Fiend ' +
        'control deck that steals control of your monsters, copies your hand, ' +
        'and forces you to discard cards you have not even drawn yet.',
      botColor: 'sol', difficulty: 'hard',
      quote: '"Your deck obeys me now. Make a move you think is yours."',
    },
    reward: 'Fragment VIII/X · A golden rune-card that whispers a different prophecy every time you read it.',
    mapPos: { x: 1380, y: 320 },
  },
  {
    id: 'null_void_master', index: 9, act: 'void', chain: 'xrp',
    name: 'The Void Spire — Null',
    region: 'Corrupted Dimension · The Empty Throne',
    description:
      'Nothing. The third Void Master\'s arena is, at first glance, empty. ' +
      'No throne, no opponent, no card-table. Then you realise the table is ' +
      'there and you are sitting at it — and the opponent across from you is ' +
      'erased from your perception faster than you can name him.',
    rival: {
      name: 'Null',
      title: 'Void Master of the Empty Throne',
      bio:
        'Third Void Master. The unmaker. Plays a corrupted Aqua / Reptile mill ' +
        'deck that does not destroy cards — it deletes the very rules that ' +
        'let them exist. Every fragment you have collected dims a little ' +
        'when he draws.',
      botColor: 'xrp', difficulty: 'hard',
      quote: '"I am not playing against you. I am playing instead of you."',
    },
    reward: 'Fragment IX/X · A golden absence-card. You cannot tell, when holding it, what it depicts.',
    mapPos: { x: 1200, y: 180 },
  },
  {
    id: 'void_player_genesis_arena', index: 10, act: 'void', chain: 'avax',
    name: 'The Genesis Arena',
    region: 'Heart of the Realm · The Final Broadcast',
    description:
      'The arena at the centre of the world. The final fragment hangs above ' +
      'the duelling-stone, suspended in golden light. The Void Player waits ' +
      'on the far side of the table. Every duel-screen in the realm is now ' +
      'showing this match. For the first time, when he speaks, you actually ' +
      'listen.',
    rival: {
      name: 'The Void Player',
      title: 'Devourer of Fragments',
      bio:
        'The unknown duellist who consumed the missing fragments before you ' +
        'could find them. Plays a fused-chain deck assembled from the corrupted ' +
        'remnants of every Sovereign before you — Lightning, Beasts, Machines, ' +
        'Fairies, Sea-Serpents, Pyros, all answering to the same gold-flecked ' +
        'black hand.',
      botColor: 'avax', difficulty: 'hard',
      quote: '"The Golden Deck should never be restored. Endless duels create endless conflict. Stop. Listen. Lose."',
    },
    reward:
      'Fragment X/X · The final fragment lifts from the arena floor and joins ' +
      'the nine you carry. The Golden Deck is, by every metric, complete. ' +
      'Something still feels wrong.',
    mapPos: { x: 840, y: 140 },
  },
  {
    id: 'first_champion_summit', index: 11, act: 'void', chain: 'eth',
    name: 'The Summit',
    region: 'Beyond the Realm · The First Champion\'s Throne',
    description:
      'As the ten fragments merge, the spirit sealed inside the Golden Deck ' +
      'awakens. The hooded figure from the very beginning returns — and ' +
      'removes his mask. He was never your guide. He was never on your side. ' +
      'For centuries he manipulated Duel Masters into gathering the fragments. ' +
      'The Golden Deck was not meant to save the world. It was meant to ' +
      'resurrect HIM.',
    rival: {
      name: 'The First Champion',
      title: 'The Wielder of the Golden Deck',
      bio:
        'The ancient who founded the Chain Realm and lost the Golden Deck ' +
        'to his apprentice ten centuries ago. Plays a five-chain golden ' +
        'composite deck containing one of every Sovereign\'s signature card — ' +
        'galaxies become monsters, stars become resources, the arena becomes ' +
        'the battlefield itself. Cannot be out-tempo\'d. Cannot be out-' +
        'controlled. Can only be out-played.',
      botColor: 'eth', difficulty: 'hard',
      quote:
        '"You walked every Site. You defeated every keeper. You reforged my deck and carried it ' +
        'to me. Now witness what you have rebuilt."',
    },
    reward:
      'The Shattered Golden Deck · You break the deck rather than wield it. ' +
      'The First Champion fades into light. The Chain Realm is finally free. ' +
      'Your terminal blinks one last line: NEW CAMPAIGN UNLOCKED — THE ' +
      'DIMENSIONAL CIRCUIT. Somewhere beyond the stars, a new challenger ' +
      'smiles.',
    mapPos: { x: 520, y: 120 },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
export const TOTAL_SITES = SITES.length;

export function siteByIndex(n: number): SacredSite | undefined {
  return SITES.find(s => s.index === n);
}

export function sitesByAct(act: ActKey): SacredSite[] {
  return SITES.filter(s => s.act === act);
}

export function sitesByChain(chain: Color): SacredSite[] {
  return SITES.filter(s => s.chain === chain);
}

export function nextSite(currentIndex: number): SacredSite | undefined {
  return siteByIndex(currentIndex + 1);
}

/**
 * Pixel position on the canonical map image (1536×1024 viewBox).
 * Returned as `{x, y}` for direct use in SVG node placement.
 */
export interface MapPos { x: number; y: number }
export function mapPosOf(site: SacredSite): MapPos {
  return { x: site.mapPos.x, y: site.mapPos.y };
}

/** Ordered list of sites + map positions for path rendering. */
export function mapPath(): Array<{ site: SacredSite; pos: MapPos }> {
  return SITES.map(s => ({ site: s, pos: mapPosOf(s) }));
}

// ── Interludes — heavy lore between matches ─────────────────────────────────
export interface Interlude {
  /** Read on entering the Site, before the duel. */
  pre: string;
  /** Read after victory, before travelling onward. */
  post: string;
}

export const INTERLUDES: Record<SiteId, Interlude> = {
  // ────────── ACT I ─────────────────────────────────────────────────────
  ace_vega_neon_district: {
    pre:
`Your first clue leads you to the Neon District. The arcade-lights wash
the whole street in pink and electric blue. A crowd has formed around
a raised duel-platform at the centre of the square, and they are
chanting one name on a loop.

ACE VEGA. ACE VEGA. ACE VEGA.

Undefeated king of the streets, deck of pure Lightning Rush — by the
time you push to the front of the crowd he is already on the platform,
already grinning, already shuffling.

You step up. He laughs out loud.

"YOU? You think YOU can collect the Golden Fragments? Heretic, please.
You don't even have a deck-box."

The crowd goes silent for a half-second, then erupts. You draw your
first hand. He throws his at the table without looking.

"Begin."`,
    post:
`Ace Vega's life-points hit zero. He stares at his own field, mouth
open, like the math just stopped working in real time. Behind him, a
glowing golden card lifts out of his deck on its own, hovers, and
drifts across the table to your hand.

Fragment I / X.

The crowd does not cheer. They are absolutely silent. Ace finally
laughs — a real one, this time, ragged at the edges.

"You're stronger than I thought. Take it." He pushes the rest of his
hand toward you, palm-down. "But the others won't go easy. The next
fragment is in the Emerald Woods. There's a sage out there who's been
waiting for a heretic. Maybe that's you."

— You step off the platform. The neon dims behind you as you walk
toward the green glow on the horizon. The first fragment is warm
against your palm.`,
  },

  willow_sage_emerald_woods: {
    pre:
`The Emerald Woods rise out of the asphalt like an old machine waking
up. Every branch is hung with abandoned decks — paper, holographic,
hand-drawn — the cards of duellists who walked away from the game
long ago. You feel watched the moment you step onto the path.

WILLOW SAGE is waiting at a clearing of broken stones. Not a single
weapon on her. Her hands are full of leaves; her deck is shuffled
between her fingers like she hasn't put it down in years.

"I know why you're here, heretic." Her voice is gentle. It is also
final. "The Golden Deck caused wars long ago. Whole chains burned. I
have spent forty cycles guarding what was left of the duellists who
walked away from those wars. I will not surrender that to you."

She sits cross-legged on the moss. Her deck settles in her lap. The
ancient holographic trees brighten around her — Beastfolk forms
shifting between trunks.

"If you want the fragment, you will have to take it. Begin."`,
    post:
`Willow Sage's last monster dissolves into a flock of holographic
beasts that scatter into the canopy. She does not stand. She kneels
slowly beside a half-ruined card-altar at the centre of the clearing
and rests both hands on it, eyes closed.

"Maybe I was wrong, heretic." Her voice is softer than at the start.
"Maybe the Golden Deck wasn't only a weapon. Maybe it was a shield,
once. Maybe it can be both again. In the right hand."

A golden leaf-card lifts out of her deck and floats to yours.

Fragment II / X.

"Iron Nexus is north of here. The Machine City. Their Sovereign has
already simulated you a million times over. Walk faster than he can
think." She does not open her eyes. The forest closes gently behind
you as you go.`,
  },

  director_volt_iron_nexus: {
    pre:
`Iron Nexus is a single vertical city of mirrored chrome that stretches
above the cloud-line. Every surface reflects every other surface; you
see yourself walking through the city before you have taken the step.

DIRECTOR VOLT is waiting in the central server-cathedral, half-merged
with the duel-simulator that runs the city. Cables thread out of his
arms into the towers. His face flickers between human and machine
every other second.

"You possess a 0.003% chance of victory." His voice is flat and very
quiet. The simulator behind him is already running your defeat at one
million frames per second. "Please remain seated. Combo execution will
begin on my first turn."

The duel-stone lights up. The simulator hums louder. You sit anyway.
Your hand is five cards. His is already on the field.`,
    post:
`The last Machine on Volt's board fragments into pixels and blows away.
The simulator behind him goes silent for the first time in cycles. The
hum drops to nothing. The city holds its breath.

Volt stares at the empty board for a long time. The flicker between
his human and machine faces slows, then stops, on the human one.

"My calculations… were wrong." He says it like he is testing the
sentence out loud. He says it again, slowly. "My calculations were
wrong."

A polished golden gear-card detaches from his deck-loader and rolls
across the table to you.

Fragment III / X.

"You should not have won. Therefore the model was incomplete. I will
recompile." He almost smiles. "Climb. The Celestial Cup is opening
brackets. The reigning champion has already requested you by name."

— Iron Nexus' towers dim respectfully as you descend.`,
  },

  // ────────── ACT II ────────────────────────────────────────────────────
  nova_storm_celestial_cup: {
    pre:
`To reach the fourth fragment you have to enter the Celestial Cup —
and the Celestial Cup is not a duel, it is a tournament. Thousands
register. Hundreds qualify. Sixteen reach the bracket. One wins the
sky.

You duel rivals on a floating arena that drifts between stormclouds.
Every round the wind picks up. By the finals you are above the clouds
entirely, the duelling-stone suspended in a sphere of light, and the
broadcast feed is being relayed to every duel-screen in the realm.

NOVA STORM is the reigning champion, three cycles undefeated, and she
is waiting for you at the centre of the stone. She does not look
surprised. She looks delighted.

"You climbed every round. Good. The realm needs a hero, heretic. Show
me whether that's you."

Lightning forks across the cloud-bowl below. She draws her opening
hand from a sky-blue deck that hums like a tuning fork.`,
    post:
`Nova Storm's final Cyberse fairy dissolves into starlight. The sphere
of light around the arena brightens for a single, blinding second —
and then the crowd in every duel-screen across the realm erupts. The
broadcast cuts to your face. You look terrible. You also look like a
champion.

Nova bows once, very low, and presses the fourth fragment into your
hand herself.

Fragment IV / X.

"The realm needs a hero. Keep being one." She steps back. The arena
begins its slow descent through the clouds. "There's a man called The
Broker. He runs a market beneath the city — cards, relics, memories.
He has the fifth fragment. Don't trade him anything you can't lose."

— You step off the arena onto the ground feeling, for the first time
since this began, like you might actually be doing the right thing.`,
  },

  broker_shadow_market: {
    pre:
`The Shadow Market does not have an entrance. You step into a back-
alley and the back-alley is already inside the market. Tents made of
spliced contracts. Lamps that burn somebody else's memories. Vendors
who quote prices in years of your life.

THE BROKER waits at the centre, on a stool, behind a duelling-stone
made of stitched playmats from every previous duellist who reached
him. His face shifts every time you blink — never the same one twice.

"Welcome, heretic. The fifth fragment is mine. You may duel for it. A
warning: every turn in my arena, a rule changes. Sometimes mine.
Sometimes yours. Sometimes both. Adapt, or trade me your memories of
how this started."

He smiles three different smiles in a row. You sit. The first rule-
change has already taken effect.`,
    post:
`The Broker stares at his last face-up card for a long time. Then he
laughs once, sharp and short, and stands up from his stool. The market
stalls around him stop shifting. The lamps steady. For the first time
since you entered, his face holds in place — and it is a face you do
not recognise, but you feel like you should.

"Interesting. The prophecy may be true after all." He flicks the
fifth fragment to you across the table with two fingers. It is warm.

Fragment V / X.

"You changed your strategy four times in nine turns. Most duellists
panic when the rules move. You played the moves, not the game. Good."
He sits back down. The market stalls start shifting again.

"The Crimson Fortress is east. The descendant of the First Champion's
apprentice has the sixth fragment. He will not be polite. He will not
be subtle. Take a deep breath before you knock."

— You leave the market through the same alley you came in. The
memory of how you entered is intact. You don't remember asking for
that to be the deal.`,
  },

  crimson_fortress_heir: {
    pre:
`The Crimson Fortress sits on a sea of cooling magma. Its walls are
black iron, its gates one solid slab of basalt twice your height. The
banners flying above the parapets are red on red — a sigil you have
never seen before but which feels, in your hand, exactly like the
fragments you already carry.

The gate-warden steps aside without a word. Inside the courtyard,
LORD FERRAN — last of the Crimson bloodline — waits on a throne built
out of broken duelling-stones from every challenger who came before.

"I know who you are." His voice is low and unkind. "And I know what
you are doing. Halfway through, isn't it? Six fragments. Then nine.
Then ten. Then the Golden Deck reforms — and a thousand years of my
family's work to keep it broken ends with a duel against an outsider."

He stands. His deck is already in his hand.

"My ancestor broke the Golden Deck for a reason, heretic. I am going
to break you for the same one."`,
    post:
`Lord Ferran's last Pyro warrior cracks across the chest, dissolves
into orange embers, and the embers settle on the courtyard floor like
ash. He looks at the empty board. He looks at you. He looks at the
banner above the throne. Then he laughs, exactly once, with no
humour in it whatsoever.

"My ancestor broke the Golden Deck. I will break — no. I will not."
He hands you the sixth fragment, palm-up, like a duellist conceding
his deck-box at the end of a tournament.

Fragment VI / X.

The fortress gates swing open behind him. Carved into the lintel,
glowing faintly red, is a sentence that was definitely not there when
you walked in:

THE VOID PLAYER AWAKENS.

"The fragments after this are not in the hands of duellists." Ferran's
voice has gone quiet. "They are in the hands of things that used to
be duellists. The Void Trio. Obsidian. Hex. Null. Whole arenas have
gone dark since I started this match. Go. Stop them — or stop
collecting. I will respect either."

— You walk out of the fortress. The horizon flickers like a duel-
screen with a dying signal. Reality is beginning to break.`,
  },

  // ────────── ACT III — THE VOID ────────────────────────────────────────
  obsidian_void_master: {
    pre:
`Reality has begun unspooling at the edges. You enter the Void Zone
through a tear in the air the colour of a corrupted card-back. The
Shattered Pillar rises out of the dark — black glass, the height of
a mountain, every surface a mirror of a duel you do not remember
losing.

OBSIDIAN waits on the duel-stone at its base. Larger than a human
should be. A deck in each hand. No face beneath the hood, only a
sheet of black glass with your reflection painted on it, mid-turn,
already losing.

"Welcome, fragment-bearer. You will not need the cards in your hand
much longer. I am going to remove them from play and from existence."

The duel begins. He does not draw. His opening hand is already
banished from his deck. Your collection, in your inventory, dims by
a single card.`,
    post:
`Obsidian's black-glass face cracks down the middle. The cracks spread
across the pillar behind him. The pillar collapses inward into pixels
and is gone — and so is he, except for the seventh fragment, hovering
in the empty air where the duel-stone used to be.

Fragment VII / X.

The card you lost from your collection at the start of the duel
quietly re-appears in your inventory as the fragment touches your
palm. You did not notice it was missing until it was back.

The Void does not give you a moment to breathe. The next Spire is
already visible across the distorted horizon — a ring of seven
floating altars rotating around a black sun. Hex is waiting.`,
  },

  hex_void_master: {
    pre:
`The Hexed Circle is seven floating altars rotating slowly around a
black sun. You walk a path through them that did not exist a second
ago. HEX waits at the centre, cross-legged, a single golden thread
wound around her fingers — and that thread, you realise, is connected
to every card in your deck.

"Your monsters answer to me now, fragment-bearer. Your hand is mine
to read. Make a move you think is yours."

You draw a card. The card on the top of your deck is, you are
absolutely certain, not the card you drew.

Begin."`,
    post:
`Hex's last spell fizzles in the air between you and the black sun
overhead winks out. The seven altars stop rotating. The golden thread
around her fingers snaps, lengths of it curling away into the dark.

She bows from a sitting position, a strange polite gesture, and the
eighth fragment unspools from one of her sleeves into your hand.

Fragment VIII / X.

"You played a card I had not yet decided you would play. That was
clever. That was — " she tilts her head, almost smiling " — almost
mine."

Then she is gone. The Hexed Circle dissolves around you and you are
walking, already, toward the third Void Spire — except there is
nothing on the horizon at all. No spire. No altar. No throne. Just
the absence of one.`,
  },

  null_void_master: {
    pre:
`There is nothing here.

There is a duelling-stone where there is nothing. There is a
duellist sitting across from you where there is also nothing. The
duel has, somehow, already begun. You are losing it.

NULL does not speak first. NULL does not, strictly, speak at all.
When you try to recall what he looks like a half-second after
glancing at him, the memory is already gone.

The third and final Void Master. The unmaker. He has not used a
single card from his deck and you have already lost two life-points.`,
    post:
`Null is gone. You cannot recall whether he was ever there. You can
recall that you won — you can recall it because the ninth fragment
is in your palm and it is, beyond any doubt, fragment IX/X.

Fragment IX / X.

The empty arena fills back in, layer by layer — duelling-stone first,
then walls, then the sky above. The Void Zone seals shut behind you.
The Realm itself feels a little less hollow than it did when you
entered.

Ahead of you, a single corridor of golden light opens through the
mended air. At the end of it, at the centre of the Realm, the
Genesis Arena is already broadcasting. The match starts when you
arrive. The Void Player is already seated.

— You walk faster. The last fragment is waiting.`,
  },

  void_player_genesis_arena: {
    pre:
`The Genesis Arena. The centre of the Realm. The final fragment hangs
above the duelling-stone in a column of golden light. Every duel-
screen in the Realm is on this broadcast. You can hear them, faintly,
from every direction — billions of voices, holding one breath.

THE VOID PLAYER is already seated across from you, hands folded over
his deck. Black robes. Gold flecking the hems. The hood is up and
empty. He has been waiting longer than you have been alive.

He finally speaks. His voice is, surprisingly, very tired.

"The Golden Deck should never be restored. Endless duels create
endless conflict. Stop. Listen. Lose."

He turns over his opening hand without looking down. Every card on
his side of the table is one you recognise from a previous duel — a
gold-flecked version of every signature card you have ever fought.
Lightning. Beasts. Machines. Fairies. Sea-Serpents. Pyros. All of
them, on the same hand, all of them his.

For the first time in this entire journey, you wonder if he is right.

You draw your first card anyway."`,
    post:
`Your ace monster delivers the final attack. The Void Player's last
life-point goes out like a candle. He bows his head, very slightly,
and does not lift it again.

The final fragment lifts from the column of golden light and floats,
unhurried, into your hand. The ten fragments in your inventory align
themselves of their own accord into the shape of a complete deck.

Fragment X / X.

The Golden Deck is, by every visible metric, complete.

Something is wrong.

The Genesis Arena broadcast feed cuts to static. The billions of
voices you could hear a moment ago go silent. The light around the
duelling-stone dims to nothing, and then it brightens again — and
the figure standing at the far edge is not the Void Player.

It is the hooded figure from the very beginning. The one who told
you to walk the Sites. The one whose face you never saw.

He lifts his hands to his hood.

"It is time."`,
  },

  first_champion_summit: {
    pre:
`The hooded figure removes his mask.

He was never your guide. He was never on your side. For centuries he
manipulated Duel Masters into gathering the fragments, scattering
them, gathering them again — the entire Saga, every cycle, every
hero, every loss — was a long mechanism to do exactly one thing.

Resurrect HIM.

THE FIRST CHAMPION steps onto the duelling-stone. The arena widens
around him until it is no longer an arena — it is the Realm itself,
turned on its side and laid out as a board.

His deck is the Golden Deck. The one you just reforged for him. He
draws five cards. Galaxies become monsters. Stars become resources.
The sky becomes the battlefield.

His voice, when it finally arrives, is your own voice, older.

"You walked every Site. You defeated every keeper. You reforged my
deck and carried it to me. Now witness what you have rebuilt."

Begin. There is no version of this you survive by playing safely.`,
    post:
`The First Champion lays his last card down with the same care he laid
the first. The galaxies on the field dim, one by one. The stars he
spent as resources flicker out. The arena shrinks back to a normal
duelling-stone. He looks at you across it with eyes that have, somewhere
between turns, become entirely your own.

He almost smiles.

"You were not supposed to be able to do this."

The Golden Deck shatters in his hands. The ten fragments hover for a
moment — and then, instead of returning to you, they scatter
upward, into the night, in ten different directions. Wherever they
land, the Realm exhales. The Void seals. The Sovereigns wake. The
broadcast feeds across every duel-screen come back on, all at once,
showing the same scene: this one.

The First Champion fades into light.

The Chain Realm is finally free.

Your terminal, somewhere far below, blinks one last line on a
recovered screen:

CONGRATULATIONS, MASTER DUELIST.
NEW CAMPAIGN UNLOCKED: THE DIMENSIONAL CIRCUIT.

And somewhere beyond the stars, a new challenger smiles.

— credits roll —`,
  },
};

export function interludeOf(id: SiteId): Interlude { return INTERLUDES[id]; }

// ── Epilogue ────────────────────────────────────────────────────────────────
export const EPILOGUE = `
The Golden Deck is gone. Not reforged. Not in your hand. Not on the
First Champion's throne. The ten fragments are scattered, one per
chain, one per Sovereign — and they will not be collected again. Not
in this cycle.

The Chain Realm wakes up. The Void Zone is sealed. The Sovereigns you
defeated, one by one, sit on their thrones again — quieter, kinder,
remembering. Ace Vega trains heretics for free in the Neon District.
Willow Sage teaches Beastfolk decks to children in the Emerald Woods.
Director Volt rebuilds Iron Nexus around a duel-simulator with the
old combat-loss models patched out. Nova Storm coaches the next
champion of the Celestial Cup, every cycle, by name. The Broker is
still in his market, but his prices, lately, are lower than they
used to be. Lord Ferran has hung his ancestor's seal in the Crimson
Fortress's great hall and opened the gates to anyone who can knock.

Your terminal, the one that screamed gold ten chapters ago, has been
quiet for weeks.

You are looking at the next campaign-card glowing in its slot. THE
DIMENSIONAL CIRCUIT. Whoever is smiling beyond the stars is not
going to wait forever.

You shuffle your deck. You sit down. You draw.

— end of THE GOLDEN DECK SAGA, Cycle I —
`.trim();
