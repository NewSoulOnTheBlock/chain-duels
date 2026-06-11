import { describe, it, expect } from 'vitest';
import { SITES, ACTS, TOTAL_SITES, INTERLUDES, sitesByAct, sitesByChain, MAP_VIEWBOX } from './lore';

describe('Chain Duels — Golden Deck Saga lore', () => {
  it('has exactly 11 sites (10 fragments + final boss)', () => {
    expect(TOTAL_SITES).toBe(11);
  });

  it('numbers sites 1..11 with no gaps or duplicates', () => {
    const idxs = SITES.map(s => s.index).sort((a, b) => a - b);
    expect(idxs).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  });

  it('uses unique site ids', () => {
    expect(new Set(SITES.map(s => s.id)).size).toBe(11);
  });

  it('uses unique rival names', () => {
    expect(new Set(SITES.map(s => s.rival.name)).size).toBe(11);
  });

  it('splits sites into 3 / 3 / 5 across the three acts', () => {
    expect(sitesByAct('awakening').length).toBe(3);
    expect(sitesByAct('champions').length).toBe(3);
    expect(sitesByAct('void').length).toBe(5);
  });

  it('places each act on the right index range', () => {
    for (const [key, meta] of Object.entries(ACTS)) {
      const range = sitesByAct(key as any).map(s => s.index);
      expect(Math.min(...range)).toBe(meta.siteRange[0]);
      expect(Math.max(...range)).toBe(meta.siteRange[1]);
    }
  });

  it('touches every chain at least once', () => {
    for (const c of ['bnb', 'sol', 'avax', 'eth', 'xrp'] as const) {
      expect(sitesByChain(c).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('escalates difficulty across acts (no easy in Act III)', () => {
    const actIII = sitesByAct('void');
    expect(actIII.every(s => s.rival.difficulty !== 'easy')).toBe(true);
  });

  it('has a pre and post interlude for every site', () => {
    for (const s of SITES) {
      const i = INTERLUDES[s.id];
      expect(i, `missing interlude for ${s.id}`).toBeDefined();
      expect(i.pre.length).toBeGreaterThan(80);
      expect(i.post.length).toBeGreaterThan(80);
    }
  });

  it('places every map node inside the map viewBox', () => {
    for (const s of SITES) {
      expect(s.mapPos.x).toBeGreaterThanOrEqual(0);
      expect(s.mapPos.x).toBeLessThanOrEqual(MAP_VIEWBOX.w);
      expect(s.mapPos.y).toBeGreaterThanOrEqual(0);
      expect(s.mapPos.y).toBeLessThanOrEqual(MAP_VIEWBOX.h);
    }
  });

  it('ends Act III with the First Champion at the summit', () => {
    const last = SITES.find(s => s.index === 11);
    expect(last?.id).toBe('first_champion_summit');
    expect(last?.rival.name).toBe('The First Champion');
  });
});
