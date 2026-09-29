import type { GameRoom, SeasonAwards } from '../src/types/football.js';
import { getPlayersForLobby } from '../src/data/players.js';

export function calculateSeasonAwards(room: GameRoom): SeasonAwards {
  type Aggregate = {
    playerId: string;
    playerName: string;
    teamName: string;
    goals: number;
    assists: number;
    saves: number;
    tackles: number;
    passes: number;
    sumRating: number;
    matches: number;
    cleanSheets: number;
  };

  const aggregates = new Map<string, Aggregate>();

  for (const fix of room.fixtures) {
    if (!fix.played || !fix.playerStats) continue;

    for (const stat of fix.playerStats) {
      const managerId = stat.team === 'home' ? fix.homeManagerId : fix.awayManagerId;
      const manager = room.managers.find(m => m.id === managerId);
      const aggregate = aggregates.get(stat.playerId) || {
        playerId: stat.playerId,
        playerName: stat.playerName,
        teamName: manager?.name || 'FC',
        goals: 0,
        assists: 0,
        saves: 0,
        tackles: 0,
        passes: 0,
        sumRating: 0,
        matches: 0,
        cleanSheets: 0,
      };

      aggregate.goals += stat.goals;
      aggregate.assists += stat.assists;
      aggregate.saves += stat.saves;
      aggregate.tackles += stat.tackles;
      aggregate.passes += stat.passes;
      aggregate.sumRating += stat.rating;
      aggregate.matches += 1;

      if (stat.team === 'home' && (fix.awayScore ?? 0) === 0) aggregate.cleanSheets += 1;
      if (stat.team === 'away' && (fix.homeScore ?? 0) === 0) aggregate.cleanSheets += 1;

      aggregates.set(stat.playerId, aggregate);
    }
  }

  const all = Array.from(aggregates.values());
  // Use the same player source as the room. The previous lookup only searched
  // DEVELOPMENT_PLAYERS, so imported FC27 and All-Time players were invisible
  // to positional/age awards.
  const awardPlayers = getPlayersForLobby('Global', room.settings.era);
  const playerData = (id: string) => awardPlayers.find(p => p.id === id);

  const topScorer = [...all].sort((a, b) => b.goals - a.goals || b.sumRating - a.sumRating)[0] || {
    playerId: 'none', playerName: 'No scorer yet', teamName: '—', goals: 0, assists: 0, saves: 0, tackles: 0, passes: 0, sumRating: 0, matches: 0, cleanSheets: 0
  };
  const topAssist = [...all].sort((a, b) => b.assists - a.assists || b.sumRating - a.sumRating)[0] || topScorer;
  const topRated = [...all].sort((a, b) =>
    (b.sumRating / Math.max(1, b.matches)) - (a.sumRating / Math.max(1, a.matches))
  )[0] || topScorer;

  const bestGK = [...all]
    .filter(a => playerData(a.playerId)?.category === 'GK')
    .sort((a, b) => b.cleanSheets - a.cleanSheets || b.saves - a.saves || b.sumRating - a.sumRating)[0] || topScorer;

  const bestDefender = [...all]
    .filter(a => playerData(a.playerId)?.category === 'DEF')
    .sort((a, b) => (b.sumRating / Math.max(1, b.matches)) - (a.sumRating / Math.max(1, a.matches)) || b.tackles - a.tackles)[0] || topScorer;

  const bestMidfielder = [...all]
    .filter(a => playerData(a.playerId)?.category === 'MID')
    .sort((a, b) => (b.sumRating / Math.max(1, b.matches)) - (a.sumRating / Math.max(1, a.matches)) || b.passes - a.passes)[0] || topScorer;

  const bestYoung = [...all]
    .filter(a => {
      const p = playerData(a.playerId);
      return p && p.age <= 21;
    })
    .sort((a, b) => {
      const ar = a.sumRating / Math.max(1, a.matches);
      const br = b.sumRating / Math.max(1, b.matches);
      return br - ar || b.goals - a.goals || b.assists - a.assists;
    })[0] || topScorer;

  const championId = room.knockoutStage?.championId || room.leagueTable[0]?.managerId;
  const champion = championId ? room.managers.find(m => m.id === championId) : undefined;

  const played = room.leagueTable.find(r => r.managerId === championId)?.played || room.fixtures.filter(f =>
    f.played && (f.homeManagerId === championId || f.awayManagerId === championId)
  ).length;

  const won = room.leagueTable.find(r => r.managerId === championId)?.won || 0;

  return {
    goldenBoot: {
      playerId: topScorer.playerId,
      playerName: topScorer.playerName,
      teamName: topScorer.teamName,
      goals: topScorer.goals,
    },
    topAssists: {
      playerId: topAssist.playerId,
      playerName: topAssist.playerName,
      teamName: topAssist.teamName,
      assists: topAssist.assists,
    },
    bestGK: {
      playerId: bestGK.playerId,
      playerName: bestGK.playerName,
      teamName: bestGK.teamName,
      cleanSheets: bestGK.cleanSheets,
      saves: bestGK.saves,
    },
    playerOfTheSeason: {
      playerId: topRated.playerId,
      playerName: topRated.playerName,
      teamName: topRated.teamName,
      avgRating: Number((topRated.sumRating / Math.max(1, topRated.matches)).toFixed(2)),
      goals: topRated.goals,
      assists: topRated.assists,
    },
    bestDefender: {
      playerId: bestDefender.playerId,
      playerName: bestDefender.playerName,
      teamName: bestDefender.teamName,
      avgRating: Number((bestDefender.sumRating / Math.max(1, bestDefender.matches)).toFixed(2)),
      tackles: bestDefender.tackles,
    },
    bestMidfielder: {
      playerId: bestMidfielder.playerId,
      playerName: bestMidfielder.playerName,
      teamName: bestMidfielder.teamName,
      avgRating: Number((bestMidfielder.sumRating / Math.max(1, bestMidfielder.matches)).toFixed(2)),
      passes: bestMidfielder.passes,
    },
    bestYoungPlayer: {
      playerId: bestYoung.playerId,
      playerName: bestYoung.playerName,
      teamName: bestYoung.teamName,
      age: playerData(bestYoung.playerId)?.age || 0,
      goals: bestYoung.goals,
      assists: bestYoung.assists,
    },
    managerOfTheSeason: {
      managerId: champion?.id || room.hostId,
      managerName: champion?.name || 'Champion',
      points: room.leagueTable.find(r => r.managerId === champion?.id)?.points || (champion ? 1 : 0),
      winRate: Math.round((won / Math.max(1, played)) * 100),
    },
  };
}

