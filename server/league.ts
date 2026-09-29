import type { Fixture, LeagueTableRow, Manager } from '../src/types/football.js';
import { newId } from './security.js';

export function generateLeagueFixtures(managers: Manager[]): Fixture[] {
  const fixtures: Fixture[] = [];
  const teamIds = managers.map(m => m.id);
  const n = teamIds.length;
  if (n < 2) return [];

  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push('BYE');

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  const half = numTeams / 2;
  let matchday = 1;

  for (let round = 0; round < numRounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = teams[i];
      const away = teams[numTeams - 1 - i];
      if (home !== 'BYE' && away !== 'BYE') {
        const homeManager = managers.find(m => m.id === home)!;
        const awayManager = managers.find(m => m.id === away)!;
        fixtures.push({
          id: newId('fix'),
          matchday,
          homeManagerId: home,
          homeManagerName: homeManager.name,
          awayManagerId: away,
          awayManagerName: awayManager.name,
          played: false,
        });
      }
    }
    teams.splice(1, 0, teams.pop()!);
    matchday++;
  }

  const firstLegCount = fixtures.length;
  for (let i = 0; i < firstLegCount; i++) {
    const firstFix = fixtures[i];
    fixtures.push({
      id: newId('fix-rev'),
      matchday: firstFix.matchday + numRounds,
      homeManagerId: firstFix.awayManagerId,
      homeManagerName: firstFix.awayManagerName,
      awayManagerId: firstFix.homeManagerId,
      awayManagerName: firstFix.homeManagerName,
      played: false,
    });
  }
  return fixtures;
}

export function calculateInitialTable(managers: Manager[]): LeagueTableRow[] {
  return managers.map(m => ({
    managerId: m.id,
    managerName: m.name,
    isBot: m.isBot,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [],
  }));
}

export function updateLeagueTable(table: LeagueTableRow[], fixture: Fixture): LeagueTableRow[] {
  if (!fixture.played || fixture.homeScore === undefined || fixture.awayScore === undefined) return table;

  const newTable = table.map(row => {
    if (row.managerId === fixture.homeManagerId) {
      const isWin = fixture.homeScore! > fixture.awayScore!;
      const isDraw = fixture.homeScore! === fixture.awayScore!;
      const result: 'W' | 'D' | 'L' = isWin ? 'W' : (isDraw ? 'D' : 'L');
      return {
        ...row,
        played: row.played + 1,
        won: row.won + (isWin ? 1 : 0),
        drawn: row.drawn + (isDraw ? 1 : 0),
        lost: row.lost + (!isWin && !isDraw ? 1 : 0),
        goalsFor: row.goalsFor + fixture.homeScore!,
        goalsAgainst: row.goalsAgainst + fixture.awayScore!,
        goalDifference: row.goalDifference + (fixture.homeScore! - fixture.awayScore!),
        points: row.points + (isWin ? 3 : (isDraw ? 1 : 0)),
        form: [...row.form.slice(-4), result],
      };
    }
    if (row.managerId === fixture.awayManagerId) {
      const isWin = fixture.awayScore! > fixture.homeScore!;
      const isDraw = fixture.homeScore! === fixture.awayScore!;
      const result: 'W' | 'D' | 'L' = isWin ? 'W' : (isDraw ? 'D' : 'L');
      return {
        ...row,
        played: row.played + 1,
        won: row.won + (isWin ? 1 : 0),
        drawn: row.drawn + (isDraw ? 1 : 0),
        lost: row.lost + (!isWin && !isDraw ? 1 : 0),
        goalsFor: row.goalsFor + fixture.awayScore!,
        goalsAgainst: row.goalsAgainst + fixture.homeScore!,
        goalDifference: row.goalDifference + (fixture.awayScore! - fixture.homeScore!),
        points: row.points + (isWin ? 3 : (isDraw ? 1 : 0)),
        form: [...row.form.slice(-4), result],
      };
    }
    return row;
  });

  newTable.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
  return newTable;
}
