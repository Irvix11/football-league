import type { Fixture, Manager } from '../src/types/football.js';

export function playoffQualifierCount(teamCount: number): 2 | 4 | 8 {
  if (teamCount >= 10) return 8;
  if (teamCount >= 6) return 4;
  return 2;
}

export function knockoutRoundForTeamCount(teamCount: number): 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Final' {
  const qualifiers = playoffQualifierCount(teamCount);
  if (qualifiers === 8) return 'Quarter-Final';
  if (qualifiers === 4) return 'Semi-Final';
  return 'Final';
}

export function nextKnockoutRound(round: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final') {
  if (round === 'Round of 16') return 'Quarter-Final';
  if (round === 'Quarter-Final') return 'Semi-Final';
  if (round === 'Semi-Final') return 'Third-Place';
  if (round === 'Third-Place') return 'Final';
  return null;
}

export function buildKnockoutFixtures(
  managers: Manager[],
  roundName: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final',
  matchday: number,
  initialSeeding = false,
): Fixture[] {
  const bracketSize = roundName === 'Round of 16' ? 16 : roundName === 'Quarter-Final' ? 8 : roundName === 'Semi-Final' ? 4 : 2;
  const slots: (Manager | null)[] = Array(bracketSize).fill(null);
  managers.slice(0, bracketSize).forEach((manager, index) => { slots[index] = manager; });
  const fixtures: Fixture[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const home = slots[i];
    const awayIndex = initialSeeding ? bracketSize - 1 - i : i * 2 + 1;
    const away = slots[awayIndex];
    if (!home && !away) continue;
    const id = 'ko-' + matchday + '-' + (i + 1) + '-' + crypto.randomUUID();
    if (home && away) {
      fixtures.push({ id, matchday, homeManagerId: home.id, homeManagerName: home.name, awayManagerId: away.id, awayManagerName: away.name, played: false, isKnockout: true, roundName });
    } else if (home || away) {
      const winner = home || away!;
      fixtures.push({ id, matchday, homeManagerId: winner.id, homeManagerName: winner.name, awayManagerId: winner.id, awayManagerName: winner.name, played: true, homeScore: 0, awayScore: 0, isKnockout: true, roundName, winnerManagerId: winner.id });
    }
  }
  return fixtures;
}