import { describe, expect, it } from 'vitest';
import {
  CARDS, COLORS, COLOR_META, STARTER_DECKS, STARTER_EXTRA_DECKS,
  validateDeck, validateExtraDeck, isMonster, isSpell, isTrap,
  tributesRequired, isExtraDeckMonster,
  MAIN_DECK_MIN, MAIN_DECK_MAX, EXTRA_DECK_SIZE_MAX, MAX_COPIES,
} from './cards';

describe('Chain registry', () => {
  it('exposes 5 chains with their YGO attribute mapping', () => {
    expect(COLORS).toEqual(['bnb', 'sol', 'avax', 'eth', 'xrp']);
    expect(COLOR_META.bnb.attribute).toBe('EARTH');
    expect(COLOR_META.sol.attribute).toBe('DARK');
    expect(COLOR_META.avax.attribute).toBe('FIRE');
    expect(COLOR_META.eth.attribute).toBe('LIGHT');
    expect(COLOR_META.xrp.attribute).toBe('WATER');
  });
});

describe('Card catalogue', () => {
  it('every card has a type and a color', () => {
    for (const def of Object.values(CARDS)) {
      expect(def.type).toMatch(/^(monster|spell|trap)$/);
      expect(COLORS).toContain(def.color);
    }
  });

  it('every monster has ATK and (when not a Link monster) DEF', () => {
    for (const def of Object.values(CARDS)) {
      if (!isMonster(def)) continue;
      expect(typeof def.atk).toBe('number');
      if (def.subtype !== 'link') expect(typeof def.def).toBe('number');
    }
  });

  it('every Main Deck monster has a Level 1-12', () => {
    for (const def of Object.values(CARDS)) {
      if (!isMonster(def)) continue;
      if (isExtraDeckMonster(def)) continue;
      expect(def.level).toBeGreaterThanOrEqual(1);
      expect(def.level).toBeLessThanOrEqual(12);
    }
  });

  it('every Extra Deck monster is a Fusion / Synchro / Xyz / Link', () => {
    for (const def of Object.values(CARDS)) {
      if (!isMonster(def)) continue;
      if (!isExtraDeckMonster(def)) continue;
      expect(['fusion', 'synchro', 'xyz', 'link']).toContain(def.subtype);
    }
  });

  it('Ritual Monsters reference a real Ritual Spell', () => {
    for (const def of Object.values(CARDS)) {
      if (!isMonster(def) || def.subtype !== 'ritual') continue;
      expect(def.ritualSpellId).toBeTruthy();
      const spell = CARDS[def.ritualSpellId!];
      expect(spell).toBeTruthy();
      expect(isSpell(spell) && spell.subtype === 'ritual').toBe(true);
    }
  });

  it('Spells have a valid subtype', () => {
    for (const def of Object.values(CARDS)) {
      if (!isSpell(def)) continue;
      expect(['normal', 'continuous', 'equip', 'field', 'quickplay', 'ritual']).toContain(def.subtype);
    }
  });

  it('Traps have a valid subtype', () => {
    for (const def of Object.values(CARDS)) {
      if (!isTrap(def)) continue;
      expect(['normal', 'continuous', 'counter']).toContain(def.subtype);
    }
  });
});

describe('Tribute Summon thresholds', () => {
  it('Levels 1-4 require 0 tributes', () => {
    for (let l = 1; l <= 4; l++) expect(tributesRequired(l)).toBe(0);
  });
  it('Levels 5-6 require 1 tribute', () => {
    expect(tributesRequired(5)).toBe(1);
    expect(tributesRequired(6)).toBe(1);
  });
  it('Levels 7+ require 2 tributes', () => {
    expect(tributesRequired(7)).toBe(2);
    expect(tributesRequired(10)).toBe(2);
  });
});

describe('Starter Main + Extra decks', () => {
  it('every starter Main Deck respects the YGO 40-60 card range', () => {
    for (const c of COLORS) {
      const deck = STARTER_DECKS[c];
      expect(deck.length).toBeGreaterThanOrEqual(MAIN_DECK_MIN);
      expect(deck.length).toBeLessThanOrEqual(MAIN_DECK_MAX);
    }
  });
  it('every starter Extra Deck is within 0-15 cards', () => {
    for (const c of COLORS) {
      const extra = STARTER_EXTRA_DECKS[c];
      expect(extra.length).toBeGreaterThanOrEqual(0);
      expect(extra.length).toBeLessThanOrEqual(EXTRA_DECK_SIZE_MAX);
    }
  });
  it('Extra Decks contain only Extra Deck monsters', () => {
    for (const c of COLORS) {
      for (const id of STARTER_EXTRA_DECKS[c]) {
        expect(isExtraDeckMonster(CARDS[id])).toBe(true);
      }
    }
  });
  it('every starter Main Deck card is a known card', () => {
    for (const c of COLORS) {
      for (const id of STARTER_DECKS[c]) expect(CARDS[id]).toBeTruthy();
    }
  });
  it('no Main Deck has more than 3 copies of any card', () => {
    for (const c of COLORS) {
      const counts: Record<string, number> = {};
      for (const id of STARTER_DECKS[c]) counts[id] = (counts[id] ?? 0) + 1;
      for (const [id, n] of Object.entries(counts)) {
        expect(n, `${id} in ${c}`).toBeLessThanOrEqual(MAX_COPIES);
      }
    }
  });
});

describe('validateDeck', () => {
  it('accepts a standard starter deck', () => {
    const v = validateDeck(STARTER_DECKS.eth);
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
  });
  it('rejects a deck that is too small', () => {
    const v = validateDeck([CARDS.bnb_babydoge.id]);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.code === 'size')).toBe(true);
  });
  it('rejects more than 3 copies of a card', () => {
    const deck: string[] = [];
    for (let i = 0; i < 4; i++) deck.push('bnb_floki');
    for (let i = 0; i < 36; i++) deck.push('bnb_babydoge');
    const v = validateDeck(deck);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.code === 'copies')).toBe(true);
  });
  it('rejects Extra Deck monsters in the Main Deck', () => {
    const deck = [...STARTER_DECKS.bnb];
    deck[0] = 'bnb_giga_meme';
    const v = validateDeck(deck);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.code === 'extra_in_main')).toBe(true);
  });
});

describe('validateExtraDeck', () => {
  it('accepts the starter extra deck', () => {
    const v = validateExtraDeck(STARTER_EXTRA_DECKS.bnb);
    expect(v.ok).toBe(true);
  });
  it('rejects Main Deck cards in the Extra Deck', () => {
    const v = validateExtraDeck(['bnb_babydoge']);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.code === 'main_in_extra')).toBe(true);
  });
  it('rejects over the 15-card cap', () => {
    const ed: string[] = [];
    for (let i = 0; i < 20; i++) ed.push('bnb_giga_meme');
    const v = validateExtraDeck(ed);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.code === 'extra_size')).toBe(true);
  });
});
