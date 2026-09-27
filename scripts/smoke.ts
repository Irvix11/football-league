import { DEVELOPMENT_PLAYERS } from '../src/data/players';
import { FORMATIONS_CONFIG, calculateTeamOverall } from '../src/constants/formations';
import { simulateMatch } from '../src/engine/simulation';
import { Manager, SquadPlayerEntry } from '../src/types/football';

const condition = () => ({
  state: 'FIT' as const,
  fatigue: 0,
  injuryMatchesLeft: 0,
  yellowCards: 0,
  redCards: 0,
  suspensionMatchesLeft: 0,
});

function buildManager(id: string, name: string): Manager {
  const formation = '4-3-3';
  const config = FORMATIONS_CONFIG[formation];
  const used = new Set<string>();
  const squad: SquadPlayerEntry[] = [];

  for (const slot of config.slots) {
    const player = DEVELOPMENT_PLAYERS.find(
      p => !used.has(p.id) && p.category === slot.category
    );
    if (!player) throw new Error(`Smoke test could not find player for ${slot.category}`);
    used.add(player.id);
    squad.push({
      player,
      isStarting: true,
      startingSlotIndex: slot.index,
      assignedPosition: slot.position,
      condition: condition(),
    });
  }



  const manager: Manager = {
    id,
    name,
    isHost: id === 'home',
    isBot: false,
    isReady: true,
    budget: 500,
    initialBudget: 500,
    formation,
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
      captainId: squad[0].player.id,
      penaltyTakerId: squad[10].player.id,
      freeKickTakerId: squad[5].player.id,
      cornerTakerId: squad[4].player.id,
    },
    squad,
    confirmedTeam: true,
    teamOverall: calculateTeamOverall(formation, squad),
  };

  return manager;
}

const home = buildManager('home', 'Home FC');
const away = buildManager('away', 'Away FC');

const leagueResult = simulateMatch(home, away, 'smoke-league', 1, 12345);
if (!leagueResult.played || !leagueResult.events?.length) throw new Error('League simulation produced no events');
if (leagueResult.events.some(e => !e.playerCoordinates || e.playerCoordinates.length !== 22)) {
  throw new Error('Live match events do not contain 22-player coordinates');
}

let foundKnockoutExtension = false;
for (let seed = 1; seed <= 2000 && !foundKnockoutExtension; seed++) {
  const result = simulateMatch(home, away, `smoke-ko-${seed}`, 1, seed, true, 'Final');
  if (result.wentToExtraTime) {
    foundKnockoutExtension = true;
    if (result.homeScore === result.awayScore && !result.wentToPenalties) {
      throw new Error('Knockout match stayed tied after extra time without penalties');
    }
  }
}

if (!foundKnockoutExtension) {
  console.warn('No tied knockout sample was found in 2000 deterministic seeds; basic knockout simulation still passed.');
}

console.log('Football Auction League smoke test passed.');
