import { DEVELOPMENT_PLAYERS } from '../src/data/players';
import { simulateMatch } from '../src/engine/simulation';
import type { Manager, Player, SquadPlayerEntry } from '../src/types/football';

let state = 0x5eed1234;
const rand = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];

function makeManager(id: string, name: string, players: Player[]): Manager {
  const gks = players.filter(p => p.position === 'GK');
  const outfield = players.filter(p => p.position !== 'GK');
  const selected: Player[] = [pick(gks)];
  const pool = [...outfield];
  while (selected.length < 11 && pool.length) {
    selected.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  const squad: SquadPlayerEntry[] = selected.map((player, index) => ({
    player,
    isStarting: true,
    startingSlotIndex: index,
    assignedPosition: player.position,
    condition: {
      state: 'FIT',
      fatigue: 0,
      injuryMatchesLeft: 0,
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
      captainId: selected[1]?.id || selected[0].id,
      penaltyTakerId: selected[10]?.id || selected[0].id,
      freeKickTakerId: selected[8]?.id || selected[0].id,
      cornerTakerId: selected[7]?.id || selected[0].id,
    },
    squad,
    confirmedTeam: true,
    teamOverall: 80,
  };
}

const gks = DEVELOPMENT_PLAYERS.filter(p => p.position === 'GK');
const outfield = DEVELOPMENT_PLAYERS.filter(p => p.position !== 'GK');
const averages = { goals: 0, shots: 0, onTarget: 0, homeWins: 0, draws: 0, awayWins: 0, yellows: 0, fouls: 0, reds: 0, possessionOutOfRange: 0 };
const matches = 5000;

for (let i = 0; i < matches; i++) {
  const pool = [...outfield];
  const base = [pick(gks)];
  const awayBase = [pick(gks.filter(p => p.id !== base[0].id))];
  while (base.length < 11) base.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  while (awayBase.length < 11) awayBase.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const home = makeManager('home', 'Home', base);
  const away = makeManager('away', 'Away', awayBase);
  const fixture = simulateMatch(home, away, `cal-${i}`, i + 1, 0x700000 + i, false);
  averages.goals += (fixture.homeScore || 0) + (fixture.awayScore || 0);
  const homeStats = fixture.homeStats!;
  const awayStats = fixture.awayStats!;
  averages.shots += homeStats.shots + awayStats.shots;
  averages.onTarget += homeStats.shotsOnTarget + awayStats.shotsOnTarget;
  averages.yellows += homeStats.yellowCards + awayStats.yellowCards;
  averages.fouls += homeStats.fouls + awayStats.fouls;
  averages.reds += homeStats.redCards + awayStats.redCards;
  if ((fixture.homeScore || 0) > (fixture.awayScore || 0)) averages.homeWins++;
  else if ((fixture.homeScore || 0) === (fixture.awayScore || 0)) averages.draws++;
  else averages.awayWins++;
  if (homeStats.possession < 35 || homeStats.possession > 65) averages.possessionOutOfRange++;
}

console.log(JSON.stringify({
  matches,
  goalsPerMatch: averages.goals / matches,
  shotsPerMatch: averages.shots / matches,
  shotsOnTargetPerMatch: averages.onTarget / matches,
  homeWinPct: averages.homeWins / matches * 100,
  drawPct: averages.draws / matches * 100,
  awayWinPct: averages.awayWins / matches * 100,
  yellowPerMatch: averages.yellows / matches,
  foulsPerMatch: averages.fouls / matches,
  redPerMatch: averages.reds / matches,
  possessionOutOfRangePct: averages.possessionOutOfRange / matches * 100,
}, null, 2));
