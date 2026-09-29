import { describe, expect, it } from 'vitest';
import { buildKnockoutFixtures, knockoutRoundForTeamCount, nextKnockoutRound, playoffQualifierCount } from './knockout.js';
import type { Manager } from '../src/types/football.js';

const manager = (id: string) => ({ id, name: id.toUpperCase(), isBot: false } as Manager);

describe('knockout helpers', () => {
  it('uses the documented qualifier thresholds', () => {
    expect(playoffQualifierCount(2)).toBe(2);
    expect(playoffQualifierCount(5)).toBe(2);
    expect(playoffQualifierCount(6)).toBe(4);
    expect(playoffQualifierCount(9)).toBe(4);
    expect(playoffQualifierCount(10)).toBe(8);
    expect(knockoutRoundForTeamCount(16)).toBe('Quarter-Final');
  });

  it('advances rounds in bracket order', () => {
    expect(nextKnockoutRound('Quarter-Final')).toBe('Semi-Final');
    expect(nextKnockoutRound('Semi-Final')).toBe('Third-Place');
    expect(nextKnockoutRound('Third-Place')).toBe('Final');
    expect(nextKnockoutRound('Final')).toBeNull();
  });

  it('builds seeded fixtures and gives byes an immediate 0-0 win', () => {
    const fixtures = buildKnockoutFixtures([manager('a'), manager('b'), manager('c')], 'Semi-Final', 1, true);
    expect(fixtures).toHaveLength(2);
    expect(fixtures.filter(f => f.played)).toHaveLength(1);
    expect(fixtures.find(f => !f.played)?.homeManagerId).toBe('a');
  });
});
