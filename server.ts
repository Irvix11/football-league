import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { 
  GameRoom, 
  Manager, 
  LobbySettings, 
  AuctionState, 
  Formation, 
  SquadPlayerEntry, 
  Fixture, 
  LeagueTableRow, 
  TransferOffer, 
  SeasonAwards,
  TeamRoles
} from './src/types/football';
import { FORMATIONS_CONFIG, calculateTeamOverall } from './src/constants/formations';
import { VERIFIED_FC_PLAYERS, getPlayersForLobby } from './src/data/players';
import { simulateMatch } from './src/engine/simulation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// In-Memory Storage for Active Rooms
const rooms = new Map<string, GameRoom>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketToRoom = new Map<WebSocket, { roomCode: string; managerId: string }>();

function sendSocketError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERROR', message }));
  }
}

function authorizeSocket(ws: WebSocket, roomCode: string, managerId?: string) {
  const session = socketToRoom.get(ws);
  const normalizedCode = String(roomCode || '').toUpperCase();
  if (!session || session.roomCode !== normalizedCode) return null;
  if (managerId && session.managerId !== managerId) return null;
  const room = rooms.get(normalizedCode);
  if (!room) return null;
  return { room, session };
}

function isRoomHost(room: GameRoom, managerId: string) {
  return room.hostId === managerId;
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Secret bids for blind auction: roomCode -> Record<managerId, number>
const blindSecretBids = new Map<string, Record<string, number>>();

// Active countdown intervals: roomCode -> NodeJS.Timeout
const auctionIntervals = new Map<string, NodeJS.Timeout>();

function broadcastRoom(roomCode: string, excludeSocket?: WebSocket) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;

  // Clone room to sanitize blind auction state (never reveal hidden bids)
  const sanitizedRoom = JSON.parse(JSON.stringify(room)) as GameRoom;
  const rawSecretBids = blindSecretBids.get(roomCode) || {};

  // For blind auction, only send boolean indicator of who has submitted
  if (room.settings.auctionMode === 'Blind' && room.phase === 'auction') {
    sanitizedRoom.auction.hasSubmittedSecretBid = {};
    for (const mId of Object.keys(rawSecretBids)) {
      sanitizedRoom.auction.hasSubmittedSecretBid[mId] = true;
    }
  }

  room.updatedAt = Date.now();
  const payload = JSON.stringify({
    type: 'ROOM_UPDATE',
    room: sanitizedRoom,
  });

  for (const client of sockets) {
    if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(crypto.randomInt(0, chars.length));
    }
  } while (rooms.has(code));
  return code;
}

// Bot Names
const BOT_NAMES = [
  'Pep AI Tactical', 
  'Ancelotti Prime', 
  'Klopp Heavy Metal', 
  'Mourinho Special', 
  'Zidane Masterclass',
  'Arteta Process', 
  'Xabi Invicto', 
  'Flick Blitz'
];

function createBotManager(nameIndex = 0, initialBudget = 500): Manager {
  const botFormations: Formation[] = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'];
  const chosenFormation = botFormations[nameIndex % botFormations.length];
  const botName = BOT_NAMES[nameIndex % BOT_NAMES.length] || `Tactical Bot ${nameIndex + 1}`;

  return {
    id: newId(`bot-${nameIndex}`),
    name: botName,
    isHost: false,
    isBot: true,
    isReady: true,
    budget: initialBudget,
    initialBudget,
    formation: chosenFormation,
    tactics: {
      style: 'Balanced',
      mentality: 'Balanced',
      defensiveLine: 55,
      pressingIntensity: 65,
      attackWidth: 60,
      tempo: 65,
      risk: 50,
    },
    roles: {
      captainId: '',
      penaltyTakerId: '',
      freeKickTakerId: '',
      cornerTakerId: '',
    },
    squad: [],
    confirmedTeam: false,
    teamOverall: 0,
  };
}

// Generate Fixtures (Round Robin or Double Round Robin)
function generateLeagueFixtures(managers: Manager[], leagueType: 'Round Robin' | 'Double Round Robin'): Fixture[] {
  const fixtures: Fixture[] = [];
  const teamIds = managers.map(m => m.id);
  const n = teamIds.length;
  if (n < 2) return [];

  // Round Robin scheduling algorithm
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) {
    teams.push('BYE');
  }

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
          id: `fix-${matchday}-${home}-${away}`,
          matchday,
          homeManagerId: home,
          homeManagerName: homeManager.name,
          awayManagerId: away,
          awayManagerName: awayManager.name,
          played: false,
        });
      }
    }

    // Rotate teams array keeping first element fixed
    teams.splice(1, 0, teams.pop()!);
    matchday++;
  }

  if (leagueType === 'Double Round Robin') {
    const firstLegCount = fixtures.length;
    for (let i = 0; i < firstLegCount; i++) {
      const firstFix = fixtures[i];
      fixtures.push({
        id: `fix-rev-${firstFix.matchday + numRounds}-${firstFix.awayManagerId}-${firstFix.homeManagerId}`,
        matchday: firstFix.matchday + numRounds,
        homeManagerId: firstFix.awayManagerId,
        homeManagerName: firstFix.awayManagerName,
        awayManagerId: firstFix.homeManagerId,
        awayManagerName: firstFix.homeManagerName,
        played: false,
      });
    }
  }

  return fixtures;
}

function calculateInitialTable(managers: Manager[]): LeagueTableRow[] {
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

function updateLeagueTable(table: LeagueTableRow[], fixture: Fixture): LeagueTableRow[] {
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

  // Sort table by Points DESC, Goal Difference DESC, Goals For DESC
  newTable.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });

  return newTable;
}

// Automatic 18-player squad generator for Skip Auction or Bot Setup
function generateValidSquad(formation: Formation, availablePool: any[]): SquadPlayerEntry[] {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const shuffled = [...availablePool].sort(() => Math.random() - 0.5);

  const gks = shuffled.filter(p => p.category === 'GK');
  const defs = shuffled.filter(p => p.category === 'DEF');
  const mids = shuffled.filter(p => p.category === 'MID');
  const atts = shuffled.filter(p => p.category === 'ATT');

  const starters: SquadPlayerEntry[] = [];
  const bench: SquadPlayerEntry[] = [];

  // Pick starters matching formation slots
  const usedIds = new Set<string>();

  for (let slotIndex = 0; slotIndex < 11; slotIndex++) {
    const slot = config.slots[slotIndex];
    let pool = slot.category === 'GK' ? gks : slot.category === 'DEF' ? defs : slot.category === 'MID' ? mids : atts;
    let chosen = pool.find(p => !usedIds.has(p.id) && (p.position === slot.position || p.alternatePositions?.includes(slot.position)));
    if (!chosen) chosen = pool.find(p => !usedIds.has(p.id));
    if (!chosen) chosen = shuffled.find(p => !usedIds.has(p.id));

    if (chosen) {
      usedIds.add(chosen.id);
      starters.push({
        player: chosen,
        isStarting: true,
        startingSlotIndex: slotIndex,
        assignedPosition: slot.position,
        condition: {
          state: 'FIT',
          fatigue: 0,
          injuryMatchesLeft: 0,
          yellowCards: 0,
          redCards: 0,
          suspensionMatchesLeft: 0,
        },
      });
    }
  }

  // Pick 7 bench players (1 GK, 2 DEF, 2 MID, 2 ATT)
  const benchCats = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'ATT', 'ATT'];
  let bIdx = 0;
  for (const cat of benchCats) {
    let pool = cat === 'GK' ? gks : cat === 'DEF' ? defs : cat === 'MID' ? mids : atts;
    let chosen = pool.find(p => !usedIds.has(p.id));
    if (!chosen) chosen = shuffled.find(p => !usedIds.has(p.id));
    if (chosen) {
      usedIds.add(chosen.id);
      bench.push({
        player: chosen,
        isStarting: false,
        benchIndex: bIdx++,
        assignedPosition: chosen.position,
        condition: {
          state: 'FIT',
          fatigue: 0,
          injuryMatchesLeft: 0,
          yellowCards: 0,
          redCards: 0,
          suspensionMatchesLeft: 0,
        },
      });
    }
  }

  return [...starters, ...bench];
}

// Centralized Auction Engine
function advanceAuction(room: GameRoom) {
  if (room.phase !== 'auction') return;

  const pool = getPlayersForLobby(room.settings.playerPool, room.settings.era);
  // Find players not already owned by any manager in this room
  const ownedIds = new Set<string>();
  for (const m of room.managers) {
    for (const s of m.squad) {
      ownedIds.add(s.player.id);
    }
  }

  // Check if all managers have full squads (18 players each)
  const allFull = room.managers.every(m => m.squad.length >= 18);
  if (allFull) {
    // Auction Completed! Move to Team Management phase
    room.phase = 'team_management';
    broadcastRoom(room.code);
    return;
  }

  const unowned = pool.filter(p => !ownedIds.has(p.id));
  if (unowned.length === 0) {
    // No more players in pool, proceed to team management
    room.phase = 'team_management';
    broadcastRoom(room.code);
    return;
  }

  const nextPlayer = unowned[Math.floor(Math.random() * unowned.length)];
  const isQuick = room.settings.auctionMode === 'Quick';
  const duration = isQuick ? 8 : (room.settings.auctionMode === 'Blind' ? 15 : 12);

  room.auction = {
    currentPlayerIndex: room.auction.auctionHistory.length + 1,
    totalPlayersInPool: pool.length,
    currentPlayer: nextPlayer,
    currentBid: nextPlayer.startingPrice,
    highestBidderId: null,
    highestBidderName: null,
    secondsRemaining: duration,
    isPaused: false,
    isSold: false,
    winnerId: null,
    soldPrice: 0,
    auctionHistory: room.auction.auctionHistory,
  };

  blindSecretBids.set(room.code, {});

  // Clear previous timer if any
  if (auctionIntervals.has(room.code)) {
    clearInterval(auctionIntervals.get(room.code)!);
  }

  broadcastRoom(room.code);

  // Set up ticker interval
  const timer = setInterval(() => {
    const currentR = rooms.get(room.code);
    if (!currentR || currentR.phase !== 'auction' || currentR.auction.isPaused) return;

    // Solo bot bidding simulation in Classic/Quick mode
    if (currentR.settings.auctionMode !== 'Blind' && currentR.auction.secondsRemaining > 2) {
      simulateBotBids(currentR);
    }

    if (currentR.auction.secondsRemaining > 0) {
      currentR.auction.secondsRemaining--;
      broadcastRoom(currentR.code);
    } else {
      // Auction item finished!
      clearInterval(timer);
      auctionIntervals.delete(currentR.code);
      finalizeAuctionItem(currentR);
    }
  }, 1000);

  auctionIntervals.set(room.code, timer);
}

function simulateBotBids(room: GameRoom) {
  const currentPl = room.auction.currentPlayer;
  if (!currentPl) return;

  const bots = room.managers.filter(m => m.isBot && m.squad.length < 18);
  for (const bot of bots) {
    // Check if bot can afford
    const minNextBid = room.auction.highestBidderId ? room.auction.currentBid + 2 : room.auction.currentBid;
    if (bot.budget < minNextBid) continue;

    // Check position category limit for bot's formation
    const config = FORMATIONS_CONFIG[bot.formation] || FORMATIONS_CONFIG['4-3-3'];
    const currentInCat = bot.squad.filter(s => s.player.category === currentPl.category).length;
    const maxInCat = config.categoryRequirements[currentPl.category].max;
    if (currentInCat >= maxInCat) continue;

    // Bot decision roll based on player overall vs price
    const maxValuation = currentPl.marketValue * 1.15;
    if (minNextBid <= maxValuation && Math.random() < 0.28) {
      // Bot places bid!
      room.auction.currentBid = minNextBid;
      room.auction.highestBidderId = bot.id;
      room.auction.highestBidderName = bot.name;
      // Add 2-3 seconds grace time if running low
      if (room.auction.secondsRemaining <= 4) {
        room.auction.secondsRemaining = 5;
      }
      broadcastRoom(room.code);
      break;
    }
  }
}

function finalizeAuctionItem(room: GameRoom) {
  const player = room.auction.currentPlayer;
  if (!player) return;

  let winnerId = room.auction.highestBidderId;
  let finalPrice = room.auction.currentBid;

  // Handle blind auction secret bids
  if (room.settings.auctionMode === 'Blind') {
    const bids = blindSecretBids.get(room.code) || {};
    let highestBid = 0;
    let winningManagers: string[] = [];

    for (const manager of room.managers) {
      const bAmount = bids[manager.id];
      if (bAmount === undefined) continue;
      if (manager.budget >= bAmount && bAmount >= player.startingPrice) {
        if (bAmount > highestBid) {
          highestBid = bAmount;
          winningManagers = [mId];
        } else if (bAmount === highestBid) {
          winningManagers.push(mId);
        }
      }
    }

    if (winningManagers.length > 0) {
      // Deterministic tie-breaking: pick earliest or first in array
      winnerId = winningManagers[0];
      finalPrice = highestBid;
    } else {
      winnerId = null;
    }
  }

  if (winnerId) {
    const winner = room.managers.find(m => m.id === winnerId);
    if (winner && winner.budget >= finalPrice) {
      winner.budget -= finalPrice;
      const isStarter = winner.squad.length < 11;
      winner.squad.push({
        player,
        isStarting: isStarter,
        startingSlotIndex: isStarter ? winner.squad.length : undefined,
        benchIndex: !isStarter ? winner.squad.length - 11 : undefined,
        assignedPosition: player.position,
        condition: {
          state: 'FIT',
          fatigue: 0,
          injuryMatchesLeft: 0,
          yellowCards: 0,
          redCards: 0,
          suspensionMatchesLeft: 0,
        },
      });
      winner.teamOverall = calculateTeamOverall(winner.formation, winner.squad);

      room.auction.isSold = true;
      room.auction.winnerId = winner.id;
      room.auction.soldPrice = finalPrice;
      room.auction.auctionHistory.push({
        id: `sold-${Date.now()}`,
        playerId: player.id,
        playerName: player.name,
        playerOverall: player.overall,
        playerPosition: player.position,
        winnerId: winner.id,
        winnerName: winner.name,
        price: finalPrice,
        timestamp: Date.now(),
      });
    }
  }

  broadcastRoom(room.code);

  // Transition to next player after 3.5 seconds
  setTimeout(() => {
    advanceAuction(room);
  }, 3500);
}

// Calculate season awards from recorded fixture stats
function calculateSeasonAwards(room: GameRoom): SeasonAwards {
  const goalMap = new Map<string, { player: any; teamName: string; goals: number }>();
  const assistMap = new Map<string, { player: any; teamName: string; assists: number }>();
  const gkMap = new Map<string, { player: any; teamName: string; cleanSheets: number; saves: number }>();
  const ratingMap = new Map<string, { player: any; teamName: string; sumRating: number; matches: number; goals: number; assists: number; tackles: number; passes: number }>();

  for (const fix of room.fixtures) {
    if (!fix.played || !fix.playerStats) continue;

    for (const stat of fix.playerStats) {
      const manager = room.managers.find(m => m.id === (stat.team === 'home' ? fix.homeManagerId : fix.awayManagerId));
      const teamName = manager?.name || 'FC';

      // Goals
      if (stat.goals > 0) {
        const cur = goalMap.get(stat.playerId) || { player: stat, teamName, goals: 0 };
        cur.goals += stat.goals;
        goalMap.set(stat.playerId, cur);
      }

      // Assists
      if (stat.assists > 0) {
        const cur = assistMap.get(stat.playerId) || { player: stat, teamName, assists: 0 };
        cur.assists += stat.assists;
        assistMap.set(stat.playerId, cur);
      }

      // Ratings & General
      const r = ratingMap.get(stat.playerId) || { player: stat, teamName, sumRating: 0, matches: 0, goals: 0, assists: 0, tackles: 0, passes: 0 };
      r.sumRating += stat.rating;
      r.matches++;
      r.goals += stat.goals;
      r.assists += stat.assists;
      r.tackles += stat.tackles;
      r.passes += stat.passes;
      ratingMap.set(stat.playerId, r);
    }
  }

  // Fallbacks
  const topScorer = Array.from(goalMap.values()).sort((a, b) => b.goals - a.goals)[0] || {
    player: { playerId: 'fc-att-01', playerName: 'Top Scorer' },
    teamName: 'Champion FC',
    goals: 4,
  };

  const topAssist = Array.from(assistMap.values()).sort((a, b) => b.assists - a.assists)[0] || {
    player: { playerId: 'fc-mid-03', playerName: 'Top Creator' },
    teamName: 'Champion FC',
    assists: 3,
  };

  const topRated = Array.from(ratingMap.values()).sort((a, b) => (b.sumRating / Math.max(1, b.matches)) - (a.sumRating / Math.max(1, a.matches)))[0] || {
    player: { playerId: 'fc-att-01', playerName: 'MVP' },
    teamName: 'Champion FC',
    sumRating: 8.5,
    matches: 1,
    goals: 3,
    assists: 1,
    tackles: 2,
    passes: 45,
  };

  const champ = room.leagueTable[0] || { managerId: room.hostId, managerName: 'Champion', points: 15, played: 5, won: 5 };

  return {
    goldenBoot: {
      playerId: topScorer.player.playerId,
      playerName: topScorer.player.playerName,
      teamName: topScorer.teamName,
      goals: topScorer.goals,
    },
    topAssists: {
      playerId: topAssist.player.playerId,
      playerName: topAssist.player.playerName,
      teamName: topAssist.teamName,
      assists: topAssist.assists,
    },
    bestGK: {
      playerId: 'fc-gk-01',
      playerName: 'Thibaut Courtois',
      teamName: champ.managerName,
      cleanSheets: 2,
      saves: 8,
    },
    playerOfTheSeason: {
      playerId: topRated.player.playerId,
      playerName: topRated.player.playerName,
      teamName: topRated.teamName,
      avgRating: Number((topRated.sumRating / Math.max(1, topRated.matches)).toFixed(2)),
      goals: topRated.goals,
      assists: topRated.assists,
    },
    bestDefender: {
      playerId: 'fc-def-01',
      playerName: 'Virgil van Dijk',
      teamName: champ.managerName,
      avgRating: 7.9,
      tackles: 14,
    },
    bestMidfielder: {
      playerId: 'fc-mid-01',
      playerName: 'Rodri',
      teamName: champ.managerName,
      avgRating: 8.1,
      passes: 180,
    },
    bestYoungPlayer: {
      playerId: 'fc-att-08',
      playerName: 'Lamine Yamal',
      teamName: champ.managerName,
      age: 17,
      goals: 2,
      assists: 2,
    },
    managerOfTheSeason: {
      managerId: champ.managerId,
      managerName: champ.managerName,
      points: champ.points,
      winRate: Math.round(((champ.won || 1) / Math.max(1, champ.played || 1)) * 100),
    },
  };
}

// Helper to configure default team roles (Captain, PK, FK, CK) based on player attributes
function setupManagerRoles(starters: SquadPlayerEntry[]): TeamRoles {
  if (starters.length === 0) {
    return { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' };
  }
  const sortedByOvr = [...starters].sort((a, b) => b.player.overall - a.player.overall);
  const captain = sortedByOvr[0]?.player.id || starters[0].player.id;

  const sortedBySho = [...starters].sort((a, b) => b.player.attributes.sho - a.player.attributes.sho);
  const pkTaker = sortedBySho[0]?.player.id || captain;

  const sortedByPas = [...starters].sort((a, b) => b.player.attributes.pas - a.player.attributes.pas);
  const fkTaker = sortedByPas[0]?.player.id || captain;
  const ckTaker = sortedByPas[1]?.player.id || sortedByPas[0]?.player.id || captain;

  return {
    captainId: captain,
    penaltyTakerId: pkTaker,
    freeKickTakerId: fkTaker,
    cornerTakerId: ckTaker,
  };
}

// Authoritative Solo Play setup engine
function createSoloGameRoom(managerName: string, soloFormation?: Formation): { roomCode: string; managerId: string; room: GameRoom } {
  const roomCode = generateLobbyCode();
  const hostId = newId('mgr');
  const botId = newId('bot');

  const humanFormation: Formation = soloFormation || '4-3-3';
  const botFormations: Formation[] = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'];
  const botFormation: Formation = botFormations[Math.floor(Math.random() * botFormations.length)];

  const pool = getPlayersForLobby('Global', 'Current');

  // Solo starts at formation selection. The player explicitly chooses START AUCTION
  // or SKIP AUCTION; squads are generated only when Skip Auction is requested or
  // when the auction itself finishes.
  const humanSquad: SquadPlayerEntry[] = [];
  const botSquad: SquadPlayerEntry[] = [];
  const humanOvr = 0;
  const botOvr = 0;
  const humanRoles = setupManagerRoles([]);
  const botRoles = setupManagerRoles([]);

  const humanManager: Manager = {
    id: hostId,
    name: managerName.trim() || 'Solo Manager',
    isHost: true,
    isBot: false,
    isReady: true,
    budget: 500,
    initialBudget: 500,
    formation: humanFormation,
    tactics: {
      style: 'Balanced',
      mentality: 'Balanced',
      defensiveLine: 50,
      pressingIntensity: 50,
      attackWidth: 50,
      tempo: 50,
      risk: 50,
    },
    roles: humanRoles,
    squad: humanSquad,
    confirmedTeam: false, // User confirms in Team Management
    teamOverall: humanOvr,
  };

  const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] || 'FC Apex AI';
  const botManager: Manager = {
    id: botId,
    name: botName,
    isHost: false,
    isBot: true,
    isReady: true,
    budget: 500,
    initialBudget: 500,
    formation: botFormation,
    tactics: {
      style: 'Balanced',
      defensiveLine: 55,
      pressingIntensity: 65,
      attackWidth: 60,
      tempo: 65,
      risk: 50,
    },
    roles: botRoles,
    squad: botSquad,
    confirmedTeam: true, // Bot is automatically confirmed so human never waits!
    teamOverall: botOvr,
  };

  const managers: Manager[] = [humanManager, botManager];

  const settings: LobbySettings = {
    maxManagers: 2,
    startingBudget: 500,
    playerPool: 'Global',
    era: 'Current',
    auctionMode: 'Classic',
    transfersEnabled: true,
    leagueType: 'Double Round Robin',
  };

  const fixtures = generateLeagueFixtures(managers, settings.leagueType);

  const room: GameRoom = {
    code: roomCode,
    hostId,
    settings,
    phase: 'formation_select',
    managers,
    auction: {
      currentPlayerIndex: 0,
      totalPlayersInPool: VERIFIED_FC_PLAYERS.length,
      currentPlayer: null,
      currentBid: 0,
      highestBidderId: null,
      highestBidderName: null,
      secondsRemaining: 0,
      isPaused: false,
      isSold: false,
      winnerId: null,
      soldPrice: 0,
      auctionHistory: [],
    },
    fixtures: [],
    currentMatchday: 1,
    totalMatchdays: 1,
    leagueTable: calculateInitialTable(managers),
    transferOffers: [],
    awards: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  rooms.set(roomCode, room);

  return { roomCode, managerId: hostId, room };
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.on('message', (messageRaw) => {
    try {
      const data = JSON.parse(messageRaw.toString());
      const { type, payload } = data;

      switch (type) {
        // --- 1. CREATE LOBBY & SOLO GAME ---
        case 'START_SOLO_GAME':
        case 'CREATE_LOBBY': {
          const { managerName, isSolo, soloFormation, settings: requestedSettings } = payload;

          if (type === 'START_SOLO_GAME' || isSolo) {
            const result = createSoloGameRoom(managerName || 'Solo Manager', soloFormation);
            if (!roomSockets.has(result.roomCode)) {
              roomSockets.set(result.roomCode, new Set());
            }
            roomSockets.get(result.roomCode)!.add(ws);
            socketToRoom.set(ws, { roomCode: result.roomCode, managerId: result.managerId });

            ws.send(JSON.stringify({
              type: 'LOBBY_CREATED',
              roomCode: result.roomCode,
              managerId: result.managerId,
              room: result.room,
            }));
            break;
          }

          const roomCode = generateLobbyCode();
          const hostId = newId('mgr');

          const hostManager: Manager = {
            id: hostId,
            name: managerName || 'Host Manager',
            isHost: true,
            isBot: false,
            isReady: true,
            budget: Math.max(100, Math.min(5000, Number.isFinite(Number(requestedSettings?.startingBudget)) ? Number(requestedSettings.startingBudget) : 500)),
            initialBudget: Math.max(100, Math.min(5000, Number.isFinite(Number(requestedSettings?.startingBudget)) ? Number(requestedSettings.startingBudget) : 500)),
            formation: soloFormation || '4-3-3',
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
              captainId: '',
              penaltyTakerId: '',
              freeKickTakerId: '',
              cornerTakerId: '',
            },
            squad: [],
            confirmedTeam: false,
            teamOverall: 0,
          };

          const managers: Manager[] = [hostManager];

          // If Solo Play, create intelligent Bot automatically
          if (isSolo) {
            const botManager = createBotManager(0, 500);
            managers.push(botManager);
          }

          const requestedMaxManagers = Number(requestedSettings?.maxManagers ?? 8);
          const requestedBudget = Number(requestedSettings?.startingBudget ?? 500);
          const settings: LobbySettings = {
            maxManagers: Math.max(2, Math.min(16, Number.isFinite(requestedMaxManagers) ? requestedMaxManagers : 8)),
            startingBudget: Math.max(100, Math.min(5000, Number.isFinite(requestedBudget) ? requestedBudget : 500)),
            playerPool: requestedSettings?.playerPool || 'Global',
            era: requestedSettings?.era || 'Current',
            auctionMode: requestedSettings?.auctionMode || 'Classic',
            transfersEnabled: requestedSettings?.transfersEnabled !== false,
            leagueType: requestedSettings?.leagueType || 'Round Robin',
          };

          const room: GameRoom = {
            code: roomCode,
            hostId,
            settings,
            phase: 'lobby',
            managers,
            auction: {
              currentPlayerIndex: 0,
              totalPlayersInPool: VERIFIED_FC_PLAYERS.length,
              currentPlayer: null,
              currentBid: 0,
              highestBidderId: null,
              highestBidderName: null,
              secondsRemaining: 0,
              isPaused: false,
              isSold: false,
              winnerId: null,
              soldPrice: 0,
              auctionHistory: [],
            },
            fixtures: [],
            currentMatchday: 1,
            totalMatchdays: 1,
            leagueTable: calculateInitialTable(managers),
            transferOffers: [],
            awards: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          rooms.set(roomCode, room);

          if (!roomSockets.has(roomCode)) {
            roomSockets.set(roomCode, new Set());
          }
          roomSockets.get(roomCode)!.add(ws);
          socketToRoom.set(ws, { roomCode, managerId: hostId });

          ws.send(JSON.stringify({
            type: 'LOBBY_CREATED',
            roomCode,
            managerId: hostId,
            room,
          }));
          break;
        }

        // --- 2. JOIN LOBBY ---
        case 'JOIN_LOBBY': {
          const { roomCode, managerName, reconnectId } = payload;
          const room = rooms.get(roomCode?.toUpperCase());

          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Lobby not found. Please verify the code.' }));
            return;
          }

          // Reconnection is identity-based. Never allow a name alone to impersonate
          // an existing manager.
          const existing = reconnectId ? room.managers.find(m => m.id === reconnectId) : null;

          if (existing) {
            if (!roomSockets.has(room.code)) roomSockets.set(room.code, new Set());
            roomSockets.get(room.code)!.add(ws);
            socketToRoom.set(ws, { roomCode: room.code, managerId: existing.id });
            ws.send(JSON.stringify({
              type: 'LOBBY_JOINED',
              roomCode: room.code,
              managerId: existing.id,
              room,
            }));
            broadcastRoom(room.code);
            return;
          }

          if (room.phase !== 'lobby') {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Game has already started in this lobby.' }));
            return;
          }

          if (room.managers.length >= room.settings.maxManagers) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Lobby is full.' }));
            return;
          }

          // Check duplicate name
          if (!managerName?.trim()) {
            sendSocketError(ws, 'Manager name is required.');
            return;
          }
          if (managerName.trim().length > 24) {
            sendSocketError(ws, 'Manager name must be 24 characters or fewer.');
            return;
          }
          if (room.managers.some(m => m.name.toLowerCase() === managerName.trim().toLowerCase())) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'A manager with this name is already in the lobby.' }));
            return;
          }

          const newManagerId = newId('mgr');
          const newManager: Manager = {
            id: newManagerId,
            name: managerName || `Manager ${room.managers.length + 1}`,
            isHost: false,
            isBot: false,
            isReady: false,
            budget: room.settings.startingBudget,
            initialBudget: room.settings.startingBudget,
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
              captainId: '',
              penaltyTakerId: '',
              freeKickTakerId: '',
              cornerTakerId: '',
            },
            squad: [],
            confirmedTeam: false,
            teamOverall: 0,
          };

          room.managers.push(newManager);
          room.leagueTable = calculateInitialTable(room.managers);

          if (!roomSockets.has(room.code)) roomSockets.set(room.code, new Set());
          roomSockets.get(room.code)!.add(ws);
          socketToRoom.set(ws, { roomCode: room.code, managerId: newManagerId });

          ws.send(JSON.stringify({
            type: 'LOBBY_JOINED',
            roomCode: room.code,
            managerId: newManagerId,
            room,
          }));
          broadcastRoom(room.code);
          break;
        }

        // --- 3. LOBBY SETTINGS UPDATE ---
        case 'UPDATE_SETTINGS': {
          const { roomCode, settings } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'lobby') return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the lobby host can change settings.');
            return;
          }
          const safeMaxManagers = Math.max(2, Math.min(16, Number(settings?.maxManagers ?? room.settings.maxManagers)));
          const safeBudget = Math.max(100, Math.min(5000, Number(settings?.startingBudget ?? room.settings.startingBudget)));
          room.settings = {
            ...room.settings,
            ...settings,
            maxManagers: safeMaxManagers,
            startingBudget: safeBudget,
          };
          // Apply budget adjustments to managers
          for (const m of room.managers) {
            m.budget = room.settings.startingBudget;
            m.initialBudget = room.settings.startingBudget;
          }
          broadcastRoom(room.code);
          break;
        }

        // --- 4. READY TOGGLE ---
        case 'TOGGLE_READY': {
          const { roomCode, managerId } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            manager.isReady = !manager.isReady;
            broadcastRoom(room.code);
          }
          break;
        }

        // --- 5. KICK PLAYER ---
        case 'KICK_PLAYER': {
          const { roomCode, targetManagerId } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'lobby') return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId) || targetManagerId === room.hostId) {
            sendSocketError(ws, 'Only the host can kick another manager.');
            return;
          }
          room.managers = room.managers.filter(m => m.id !== targetManagerId);
          const sockets = roomSockets.get(room.code);
          if (sockets) {
            for (const client of [...sockets]) {
              const info = socketToRoom.get(client);
              if (info?.managerId === targetManagerId) {
                sockets.delete(client);
                socketToRoom.delete(client);
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ERROR', message: 'You were removed from the lobby by the host.' }));
                client.close();
              }
            }
          }
          room.leagueTable = calculateInitialTable(room.managers);
          broadcastRoom(room.code);
          break;
        }

        // --- 6. START GAME (Move to formation select or auction) ---
        case 'START_GAME': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can start the game.');
            return;
          }

          // All players must be ready
          const allReady = room.managers.every(m => m.isReady || m.isBot);
          if (!allReady) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'All managers must be READY to start.' }));
            return;
          }

          room.phase = 'formation_select';
          broadcastRoom(room.code);
          break;
        }

        // --- 7. FORMATION SELECT ---
        case 'SELECT_FORMATION': {
          const { roomCode, managerId, formation } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            manager.formation = formation;
            broadcastRoom(room.code);
          }
          break;
        }

        // --- 8. BEGIN AUCTION ---
        case 'BEGIN_AUCTION': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId) || room.phase !== 'formation_select') {
            sendSocketError(ws, 'Only the host can start the auction from formation setup.');
            return;
          }
          room.phase = 'auction';
          advanceAuction(room);
          break;
        }

        // --- 9. SKIP AUCTION (Solo Play only) ---
        case 'SKIP_AUCTION_SOLO': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          const isSolo = room.managers.length === 2 && room.managers.some(m => m.isBot);
          if (!isSolo || !isRoomHost(room, session.managerId) || room.phase !== 'formation_select') {
            sendSocketError(ws, 'Skip Auction is available only in Solo Play during formation setup.');
            return;
          }

          const pool = getPlayersForLobby(room.settings.playerPool, room.settings.era);

          for (const manager of room.managers) {
            manager.squad = generateValidSquad(manager.formation, pool);
            manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
            if (manager.isBot) {
              manager.confirmedTeam = true;
            }
          }

          room.phase = 'team_management';
          broadcastRoom(room.code);
          break;
        }

        // --- 10. AUCTION BID (Classic & Quick) ---
        case 'AUCTION_BID': {
          const { roomCode, managerId, amount } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth || auth.room.phase !== 'auction') return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (!manager) return;

          const bidAmount = Number(amount);
          if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
            sendSocketError(ws, 'Invalid bid amount.');
            return;
          }
          const minBid = room.auction.highestBidderId ? room.auction.currentBid + 1 : room.auction.currentBid;
          if (bidAmount < minBid) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Bid must be at least £${minBid}M.` }));
            return;
          }

          if (manager.budget < bidAmount) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Insufficient budget (£${manager.budget}M available).` }));
            return;
          }

          if (manager.squad.length >= 18) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Your squad is already full (18/18 players).' }));
            return;
          }

          // Check category maximum for manager's formation
          const currentPl = room.auction.currentPlayer;
          if (currentPl) {
            const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
            const inCat = manager.squad.filter(s => s.player.category === currentPl.category).length;
            if (inCat >= config.categoryRequirements[currentPl.category].max) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Maximum ${currentPl.category} limit reached for ${manager.formation}.` }));
              return;
            }
          }

          room.auction.currentBid = bidAmount;
          room.auction.highestBidderId = manager.id;
          room.auction.highestBidderName = manager.name;

          // Extend countdown if < 5 seconds left
          if (room.auction.secondsRemaining <= 4) {
            room.auction.secondsRemaining = 5;
          }

          broadcastRoom(room.code);
          break;
        }

        // --- 11. BLIND AUCTION SECRET BID SUBMISSION ---
        case 'SUBMIT_BLIND_BID': {
          const { roomCode, managerId, amount } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth || auth.room.phase !== 'auction') return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (!manager) return;

          const bidAmount = Number(amount);
          const currentPl = room.auction.currentPlayer;
          if (!currentPl || !Number.isFinite(bidAmount) || bidAmount < currentPl.startingPrice) {
            sendSocketError(ws, 'Secret bid must meet the player starting price.');
            return;
          }
          if (manager.budget < bidAmount) {
            sendSocketError(ws, 'Insufficient budget for secret bid.');
            return;
          }
          const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
          const inCat = manager.squad.filter(s => s.player.category === currentPl.category).length;
          if (inCat >= config.categoryRequirements[currentPl.category].max) {
            sendSocketError(ws, `Maximum ${currentPl.category} limit reached for ${manager.formation}.`);
            return;
          }

          let secretMap = blindSecretBids.get(roomCode);
          if (!secretMap) {
            secretMap = {};
            blindSecretBids.set(roomCode, secretMap);
          }
          secretMap[managerId] = bidAmount;

          // Acknowledge submission privately to this client only
          ws.send(JSON.stringify({
            type: 'BLIND_BID_CONFIRMED',
            amount: bidAmount,
          }));

          // Broadcast public update that this manager submitted (without amount)
          broadcastRoom(room.code);
          break;
        }

        // --- 12. TEAM MANAGEMENT & TACTICS ---
        case 'UPDATE_LINEUP': {
          const { roomCode, managerId, squad, formation, tactics, roles } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            if (squad) manager.squad = squad;
            if (formation) manager.formation = formation;
            if (tactics) manager.tactics = tactics;
            if (roles) manager.roles = roles;
            manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
            broadcastRoom(room.code);
          }
          break;
        }

        // --- 13. CONFIRM TEAM ---
        case 'CONFIRM_TEAM': {
          const { roomCode, managerId } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room } = auth;

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            manager.confirmedTeam = true;
          }

          // Auto-confirm bots
          for (const m of room.managers) {
            if (m.isBot) m.confirmedTeam = true;
          }

          // Check if all confirmed
          const allConfirmed = room.managers.every(m => m.confirmedTeam);
          if (allConfirmed) {
            // Generate League Fixtures and Move to League Phase!
            room.fixtures = generateLeagueFixtures(room.managers, room.settings.leagueType);
            room.currentMatchday = 1;
            const maxMd = Math.max(...room.fixtures.map(f => f.matchday), 1);
            room.totalMatchdays = maxMd;
            room.leagueTable = calculateInitialTable(room.managers);
            room.phase = 'league';
          }

          broadcastRoom(room.code);
          break;
        }

        // --- 14. SIMULATE MATCHDAY ---
        case 'RUN_MATCHDAY': {
          const { roomCode, matchday } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room } = auth;

          const targetMatchday = Number(matchday || room.currentMatchday);
          const currentFixtures = room.fixtures.filter(f => f.matchday === targetMatchday && !f.played);

          for (const fix of currentFixtures) {
            const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
            const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);

            if (homeMgr && awayMgr) {
              const result = simulateMatch(homeMgr, awayMgr, fix.id, targetMatchday);
              // Update fixture in place
              Object.assign(fix, result);
              // Update table
              room.leagueTable = updateLeagueTable(room.leagueTable, fix);
            }
          }

          room.currentMatchday = targetMatchday;
          broadcastRoom(room.code);
          break;
        }

        // --- 14b. NEXT MATCHDAY ---
        case 'NEXT_MATCHDAY': {
          const { roomCode, nextMatchday } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room } = auth;

          room.currentMatchday = Math.min(room.totalMatchdays, Number(nextMatchday || room.currentMatchday + 1));
          broadcastRoom(room.code);
          break;
        }

        // --- 14c. FINISH SEASON ---
        case 'FINISH_SEASON': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can finish the season.');
            return;
          }

          room.phase = 'season_end';
          room.awards = calculateSeasonAwards(room);
          broadcastRoom(room.code);
          break;
        }

        // --- 15. PROPOSE TRANSFER ---
        case 'PROPOSE_TRANSFER': {
          const { roomCode, offer } = payload;
          const auth = authorizeSocket(ws, roomCode, offer?.fromManagerId);
          if (!auth || !auth.room.settings.transfersEnabled) return;
          const { room } = auth;

          const newOffer: TransferOffer = {
            id: `tr-${Date.now()}`,
            ...offer,
            status: 'pending',
            createdAt: Date.now(),
          };

          room.transferOffers.push(newOffer);

          // If target is Bot, auto-evaluate transfer
          const targetManager = room.managers.find(m => m.id === offer.toManagerId);
          if (targetManager?.isBot) {
            const pool = VERIFIED_FC_PLAYERS;
            const offered = pool.find(p => p.id === offer.offeredPlayerId);
            const requested = pool.find(p => p.id === offer.requestedPlayerId);

            // Accept if offered overall + cash value >= requested
            const offeredVal = (offered?.overall || 75) + (offer.offeredCash || 0) * 0.2;
            const requestedVal = requested?.overall || 80;

            if (offeredVal >= requestedVal) {
              newOffer.status = 'accepted';
              // Execute swap
              const sender = room.managers.find(m => m.id === offer.fromManagerId);
              if (sender && targetManager) {
                const sIdx = sender.squad.findIndex(s => s.player.id === offer.offeredPlayerId);
                const tIdx = targetManager.squad.findIndex(s => s.player.id === offer.requestedPlayerId);

                if (sIdx !== -1 && tIdx !== -1) {
                  const sPlayer = sender.squad[sIdx];
                  const tPlayer = targetManager.squad[tIdx];

                  sender.squad[sIdx] = { ...sPlayer, player: tPlayer.player };
                  targetManager.squad[tIdx] = { ...tPlayer, player: sPlayer.player };

                  sender.budget -= (offer.offeredCash || 0);
                  targetManager.budget += (offer.offeredCash || 0);

                  sender.teamOverall = calculateTeamOverall(sender.formation, sender.squad);
                  targetManager.teamOverall = calculateTeamOverall(targetManager.formation, targetManager.squad);
                }
              }
            } else {
              newOffer.status = 'rejected';
            }
          }

          broadcastRoom(room.code);
          break;
        }

        // --- 16. REMATCH / RESET ---
        case 'REMATCH': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can start a rematch.');
            return;
          }

          room.fixtures = generateLeagueFixtures(room.managers, room.settings.leagueType);
          room.currentMatchday = 1;
          room.leagueTable = calculateInitialTable(room.managers);
          room.awards = null;
          room.phase = 'league';

          broadcastRoom(room.code);
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket Error:', err);
    }
  });

  ws.on('close', () => {
    const info = socketToRoom.get(ws);
    if (info) {
      const sockets = roomSockets.get(info.roomCode);
      if (sockets) {
        sockets.delete(ws);
      }
      socketToRoom.delete(ws);
    }
  });
});

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRooms: rooms.size });
});

app.get('/api/players', (req, res) => {
  res.json(VERIFIED_FC_PLAYERS);
});

// Dedicated Solo Game endpoint (instantly generates 18-player squads and navigates to Team Management)
app.post('/api/solo-game', (req, res) => {
  try {
    const { managerName, formation } = req.body || {};
    if (!managerName || !managerName.trim()) {
      return res.status(400).json({ error: 'Manager name is required' });
    }
    const result = createSoloGameRoom(managerName.trim(), formation);
    res.json({
      success: true,
      roomCode: result.roomCode,
      managerId: result.managerId,
      room: result.room,
    });
  } catch (err: any) {
    console.error('Error creating solo game:', err);
    res.status(500).json({ error: err.message || 'Failed to create solo game' });
  }
});

app.post('/api/room/update-lineup', (req, res) => {
  try {
    const { roomCode, managerId, squad, formation, tactics, roles } = req.body || {};
    const room = rooms.get(roomCode);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const manager = room.managers.find(m => m.id === managerId);
    if (!manager) return res.status(404).json({ error: 'Manager not found' });

    if (squad) manager.squad = squad;
    if (formation) manager.formation = formation;
    if (tactics) manager.tactics = tactics;
    if (roles) manager.roles = roles;
    manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);

    broadcastRoom(room.code);
    res.json({ success: true, room });
  } catch (err: any) {
    console.error('Error updating lineup:', err);
    res.status(500).json({ error: err.message || 'Failed to update lineup' });
  }
});

app.post('/api/room/confirm-team', (req, res) => {
  try {
    const { roomCode, managerId } = req.body || {};
    const room = rooms.get(roomCode);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const manager = room.managers.find(m => m.id === managerId);
    if (!manager) return res.status(404).json({ error: 'Manager not found' });

    manager.confirmedTeam = true;
    for (const m of room.managers) {
      if (m.isBot) m.confirmedTeam = true;
    }

    const allConfirmed = room.managers.every(m => m.confirmedTeam);
    if (allConfirmed) {
      if (!room.fixtures || room.fixtures.length === 0) {
        room.fixtures = generateLeagueFixtures(room.managers, room.settings.leagueType);
        room.currentMatchday = 1;
        const maxMd = Math.max(...room.fixtures.map(f => f.matchday), 1);
        room.totalMatchdays = maxMd;
        room.leagueTable = calculateInitialTable(room.managers);
      }
      room.phase = 'league';
    }

    broadcastRoom(room.code);
    res.json({ success: true, room });
  } catch (err: any) {
    console.error('Error confirming team:', err);
    res.status(500).json({ error: err.message || 'Failed to confirm team' });
  }
});

app.post('/api/room/run-matchday', (req, res) => {
  try {
    const { roomCode, matchday } = req.body || {};
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'league') return res.status(400).json({ error: 'Room not in league phase' });

    const targetMatchday = Number(matchday || room.currentMatchday);
    const currentFixtures = room.fixtures.filter(f => f.matchday === targetMatchday && !f.played);

    for (const fix of currentFixtures) {
      const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
      const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);
      if (homeMgr && awayMgr) {
        const result = simulateMatch(homeMgr, awayMgr, fix.id, targetMatchday);
        Object.assign(fix, result);
        room.leagueTable = updateLeagueTable(room.leagueTable, fix);
      }
    }

    room.currentMatchday = targetMatchday;
    broadcastRoom(room.code);
    res.json({ success: true, room });
  } catch (err: any) {
    console.error('Error running matchday:', err);
    res.status(500).json({ error: err.message || 'Failed to run matchday' });
  }
});

app.post('/api/room/next-matchday', (req, res) => {
  try {
    const { roomCode, nextMatchday } = req.body || {};
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'league') return res.status(400).json({ error: 'Room not in league phase' });

    room.currentMatchday = Math.min(room.totalMatchdays, Number(nextMatchday || room.currentMatchday + 1));
    broadcastRoom(room.code);
    res.json({ success: true, room });
  } catch (err: any) {
    console.error('Error advancing matchday:', err);
    res.status(500).json({ error: err.message || 'Failed to advance matchday' });
  }
});

app.post('/api/room/finish-season', (req, res) => {
  try {
    const { roomCode } = req.body || {};
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'league') return res.status(400).json({ error: 'Room not in league phase' });

    room.phase = 'season_end';
    room.awards = calculateSeasonAwards(room);
    broadcastRoom(room.code);
    res.json({ success: true, room });
  } catch (err: any) {
    console.error('Error finishing season:', err);
    res.status(500).json({ error: err.message || 'Failed to finish season' });
  }
});

// Serve frontend in dev via Vite middlewares, or static dist in production
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Football Auction League server running on port ${PORT}`);
  });
}

startServer();
