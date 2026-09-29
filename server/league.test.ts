import { describe, expect, it } from 'vitest';
import { calculateInitialTable, generateLeagueFixtures, updateLeagueTable } from './league.js';
import type { Fixture, Manager } from '../src/types/football.js';

const managers = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: false } as Manager));

describe('league helpers', () => {
  it('creates a complete double round robin without self fixtures', () => {
    const fixtures = generateLeagueFixtures(managers);
    expect(fixtures).toHaveLength(12);
    expect(new Set(fixtures.map(f => f.matchday)).size).toBe(6);
    for (const fixture of fixtures) {
      expect(fixture.homeManagerId).not.toBe(fixture.awayManagerId);
    }
    for (const home of managers) {
      for (const away of managers) {
        if (home.id === away.id) continue;
        expect(fixtures.filter(f => f.homeManagerId === home.id && f.awayManagerId === away.id)).toHaveLength(1);
      }
    }
  });

  it('updates both teams and sorts by points, goal difference, then goals for', () => {
    const table = calculateInitialTable(managers);
    const fixture: Fixture = {
      id: 'f1', matchday: 1,
      homeManagerId: 'a', homeManagerName: 'A',
      awayManagerId: 'b', awayManagerName: 'B',
      played: true, homeScore: 3, awayScore: 1,
    };
    const updated = updateLeagueTable(table, fixture);
    expect(updated[0]?.managerId).toBe('a');
    expect(updated.find(r => r.managerId === 'a')).toMatchObject({ played: 1, won: 1, points: 3, goalsFor: 3, goalsAgainst: 1, goalDifference: 2 });
    expect(updated.find(r => r.managerId === 'b')).toMatchObject({ played: 1, lost: 1, points: 0, goalsFor: 1, goalsAgainst: 3, goalDifference: -2 });
  });
});
