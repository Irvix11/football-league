import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_PLAYERS } from '../data/players';
import { simulateMatch } from './simulation';
import type { Manager, SquadPlayerEntry } from '../types/football';

function makeManager(id: string, name: string, offset: number, injured = false): Manager {
  const players = DEVELOPMENT_PLAYERS.slice(offset, offset + 11);
  const squad: SquadPlayerEntry[] = players.map((player, index) => ({
    player,
    isStarting: true,
    startingSlotIndex: index,
    assignedPosition: player.position,
    condition: {
      state: injured && index === 5 ? 'INJURED' : 'FIT',
      fatigue: 0,
      injuryMatchesLeft: injured && index === 5 ? 2 : 0,
      yellowCards: 0,
      redCards: 0,
      suspensionMatchesLeft: 0,
    },
  }));
  return {
    id,
    name,
    isHost: id === 'home',
    isBot: false,
    isReady: true,
    budget: 200,
    initialBudget: 200,
    formation: '4-3-3',
    tactics: {
      style: 'Balanced',
      mentality: 'Balanced',
      defensiveLine: 50,
      pressingIntensity: 50,
      attackWidth: 50,
      tempo: 50,
      risk: 50,
    },
    roles: {
      captainId: players[0]?.id || '',
      penaltyTakerId: players[1]?.id || '',
      freeKickTakerId: players[2]?.id || '',
      cornerTakerId: players[3]?.id || '',
    },
    squad,
    confirmedTeam: true,
    teamOverall: 80,
  };
}

function seconds(e: { minute: number; second?: number }) {
  return e.minute * 60 + (e.second || 0);
}

describe('simulation invariants', () => {
  it('is deterministic, monotonic, and structurally valid for 300 seeded matches', () => {
    for (let i = 0; i < 300; i++) {
      const knockout = i % 4 === 0;
      const homeInput = makeManager('home', 'Home', 0, i % 7 === 0);
      const awayInput = makeManager('away', 'Away', 11, i % 9 === 0);
      const home = structuredClone(homeInput);
      const away = structuredClone(awayInput);
      const result = simulateMatch(home, away, `test-${i}`, i + 1, 100000 + i, knockout, knockout ? 'Final' : undefined, knockout && i % 8 === 0);

      const events = result.events || [];
      expect(events[0]?.type).toBe('kickoff');
      expect(events.at(-1)?.type).toBe('fulltime');
      expect(events.filter(e => e.type === 'halftime')).toHaveLength(1);

      for (let j = 1; j < events.length; j++) {
        expect(seconds(events[j])).toBeGreaterThanOrEqual(seconds(events[j - 1]));
      }

      const openPlayGoals = events.filter(e => e.type === 'goal').length;
      expect(openPlayGoals).toBe((result.homeScore || 0) + (result.awayScore || 0));

      for (const team of [result.homeStats!, result.awayStats!]) {
        expect(team.shots).toBeGreaterThanOrEqual(team.shotsOnTarget);
        expect(team.shotsOnTarget).toBeGreaterThanOrEqual(0);
      }

      const playerGoals = (result.playerStats || []).reduce((sum, stat) => sum + stat.goals, 0);
      expect(playerGoals).toBe((result.homeScore || 0) + (result.awayScore || 0));

      let redCardsBeforeEvent = 0;
      for (const event of events) {
        const playerCoordinates = event.playerCoordinates || [];
        const expectedPlayers = 22 - redCardsBeforeEvent;
        expect(playerCoordinates).toHaveLength(expectedPlayers);
        if (event.type === 'red_card') {
          expect(playerCoordinates.some(player => player.id === event.playerId)).toBe(true);
        }
        expect(event.ballCoordinates.x).toBeGreaterThanOrEqual(0);
        expect(event.ballCoordinates.x).toBeLessThanOrEqual(100);
        expect(event.ballCoordinates.y).toBeGreaterThanOrEqual(0);
        expect(event.ballCoordinates.y).toBeLessThanOrEqual(100);
        for (const p of playerCoordinates) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(100);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(100);
        }
        if (event.type === 'red_card') redCardsBeforeEvent++;
      }

      const repeat = simulateMatch(structuredClone(homeInput), structuredClone(awayInput), `test-${i}`, i + 1, 100000 + i, knockout, knockout ? 'Final' : undefined, knockout && i % 8 === 0);
      expect(JSON.stringify(repeat)).toBe(JSON.stringify(result));
    }
  }, 120_000);

  it('keeps GK jersey number 1 even when the squad array is shuffled', () => {
    const home = makeManager('home', 'Home', 0);
    const away = makeManager('away', 'Away', 11);
    [home.squad[0], home.squad[1]] = [home.squad[1], home.squad[0]];
    const result = simulateMatch(home, away, 'shuffle', 1, 424242);
    const kickoff = (result.events || [])[0]!;
    const gk = home.squad.find(s => s.player.position === 'GK');
    const gkMarker = kickoff.playerCoordinates?.find(player => player.id === gk?.player.id);
    expect(kickoff.type).toBe('kickoff');
    expect(gkMarker?.number).toBe(gk ? 1 : gkMarker?.number);
  });

  it('does not throw for injured or suspended starters', () => {
    const home = makeManager('home', 'Home', 0, true);
    const away = makeManager('away', 'Away', 11);
    away.squad[4].condition.state = 'SUSPENDED';
    expect(() => simulateMatch(home, away, 'availability', 1, 7)).not.toThrow();
  });
  it('accepts seed 0 and produces byte-identical output', () => {
    const home = makeManager('home', 'Home', 0);
    const away = makeManager('away', 'Away', 11);
    const first = simulateMatch(structuredClone(home), structuredClone(away), 'zero-seed', 1, 0);
    const second = simulateMatch(structuredClone(home), structuredClone(away), 'zero-seed', 1, 0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps sent-off players out of later event actor ids', () => {
    const home = makeManager('home', 'Home', 0);
    const away = makeManager('away', 'Away', 11);
    const result = simulateMatch(home, away, 'red-card-invariant', 1, 987654321);
    const sentOff = new Set<string>();
    for (const event of (result.events || [])) {
      if (event.type === 'red_card' && event.playerId) sentOff.add(event.playerId);
      else if (event.playerId) expect(sentOff.has(event.playerId)).toBe(false);
    }
  });

  it('includes coordinates on every shootout kick', () => {
    const home = makeManager('home', 'Home', 0);
    const away = makeManager('away', 'Away', 11);
    const result = simulateMatch(home, away, 'forced-shootout', 1, 13579, true, 'Final', true);
    if (result.wentToPenalties) {
      const kicks = (result.events || []).filter(event => event.type === 'penalty_shootout_kick');
      expect(kicks.length).toBeGreaterThan(0);
      for (const kick of kicks) {
        expect(kick.playerCoordinates).toHaveLength(22);
        expect(Number.isFinite(kick.ballCoordinates.x)).toBe(true);
        expect(Number.isFinite(kick.ballCoordinates.y)).toBe(true);
      }
    }
  });

});
