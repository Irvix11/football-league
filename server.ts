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
  TeamRoles,
  PositionCategory,
  KnockoutRound,
  KnockoutStageState
} from './src/types/football.js';
import { FORMATIONS_CONFIG, calculateTeamOverall, validateSquadFormation, calculatePositionFit, getFormationStarterCategoryCounts, getFormationSquadCategoryLimits } from './src/constants/formations.js';
import { DEVELOPMENT_PLAYERS, getPlayersForLobby } from './src/data/players.js';
import { simulateMatch } from './src/engine/simulation.js';
import { saveRoomSnapshot, loadRoomSnapshot, deleteRoomSnapshot } from './server/persistence.js';

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

  // Blind Auction privacy boundary: before reveal, send only two clues.
  if (room.settings.auctionMode === 'Blind' && room.phase === 'auction') {
    sanitizedRoom.auction.hasSubmittedSecretBid = {};
    for (const mId of Object.keys(rawSecretBids)) {
      sanitizedRoom.auction.hasSubmittedSecretBid[mId] = true;
    }

    const sourcePlayer = room.auction.currentPlayer;
    if (sourcePlayer && !room.auction.isSold) {
      const genericPosition = sourcePlayer.category === 'GK'
        ? 'GK'
        : sourcePlayer.category === 'DEF'
          ? 'CB'
          : sourcePlayer.category === 'MID'
            ? 'CM'
            : 'ST';

      sanitizedRoom.auction.currentPlayer = {
        ...sourcePlayer,
        id: `blind-${sourcePlayer.id}`,
        name: 'Mystery Player',
        club: 'Unknown Club',
        league: 'Unknown League',
        nationality: 'Unknown',
        // Category/position are neutralized too: blind auction clients should only
        // receive the two scouting attributes below, plus the normal auction price.
        position: 'ST',
        category: 'ATT',
        overall: 0,
        attributes: { pac: 0, sho: 0, pas: 0, dri: 0, def: 0, phy: 0 },
        age: 0,
        preferredFoot: 'Right',
        alternatePositions: [],
        marketValue: 0,
        valueSource: 'Blind Auction',
        valueVersion: 'hidden',
        updatedAt: '',
        blindClues: room.auction.blindClues || [],
      } as any;
    }
  }

  room.updatedAt = Date.now();
  void saveRoomSnapshot(room);
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

function removeManagerFromRoom(room: GameRoom, managerId: string) {
  room.managers = room.managers.filter(manager => manager.id !== managerId);
  const secretBids = blindSecretBids.get(room.code);
  if (secretBids) {
    delete secretBids[managerId];
    if (Object.keys(secretBids).length === 0) blindSecretBids.delete(room.code);
  }
  if (room.auction?.highestBidderId === managerId) {
    room.auction.highestBidderId = null;
    room.auction.highestBidderName = null;
  }
  room.leagueTable = room.leagueTable.filter(row => row.managerId !== managerId);
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

// Automatic 11-player XI generator for Skip Auction or Bot Setup
function createFitCondition(): SquadPlayerEntry['condition'] {
  return {
    state: 'FIT',
    fatigue: 0,
    injuryMatchesLeft: 0,
    yellowCards: 0,
    redCards: 0,
    suspensionMatchesLeft: 0,
  };
}

function playerSlotScore(player: any, slot: any): number {
  const fit = calculatePositionFit(player.position, player.alternatePositions || [], slot.position);
  const attributes = player.attributes || {};
  const relevant = slot.category === 'GK'
    ? (attributes.dri + attributes.def + attributes.phy) / 3
    : slot.category === 'DEF'
      ? (attributes.def * 0.55 + attributes.pas * 0.20 + attributes.phy * 0.15 + attributes.pac * 0.10)
      : slot.category === 'MID'
        ? (attributes.pas * 0.35 + attributes.dri * 0.25 + attributes.def * 0.15 + attributes.sho * 0.15 + attributes.pac * 0.10)
        : (attributes.sho * 0.40 + attributes.pac * 0.20 + attributes.dri * 0.25 + attributes.pas * 0.15);
  return player.overall * 0.55 + fit * 0.35 + relevant * 0.10;
}

function autoFillManagerLineup(manager: Manager) {
  const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
  if (manager.squad.length < 11) return;

  const allEntries = [...manager.squad];
  const remaining = [...allEntries];
  const starters: SquadPlayerEntry[] = [];

  const orderedSlots = [...config.slots].sort((a, b) => {
    if (a.category === 'GK') return -1;
    if (b.category === 'GK') return 1;
    const aSpecific = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(a.position);
    const bSpecific = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(b.position);
    return Number(bSpecific) - Number(aSpecific);
  });

  for (const slot of orderedSlots) {
    const candidates = remaining.filter(entry =>
      slot.category === 'GK' ? entry.player.category === 'GK' : entry.player.category !== 'GK'
    );
    const pool = candidates.length ? candidates : remaining;
    const chosen = [...pool]
      .sort((a, b) => playerSlotScore(b.player, slot) - playerSlotScore(a.player, slot) || b.player.overall - a.player.overall)[0];
    if (!chosen) continue;

    remaining.splice(remaining.findIndex(e => e.player.id === chosen.player.id), 1);
    starters.push({
      ...chosen,
      isStarting: true,
      startingSlotIndex: slot.index,
      benchIndex: undefined,
      assignedPosition: slot.position,
      condition: chosen.condition || createFitCondition(),
    });
  }

  // XI-only game: the best 11 players fill the formation. There are no
  // substitutes, so every auctioned player is part of the active squad.
  manager.squad = starters
    .sort((a, b) => (a.startingSlotIndex ?? 99) - (b.startingSlotIndex ?? 99))
    .slice(0, 11);
  manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
  manager.roles = setupManagerRoles(manager.squad.filter(s => s.isStarting));
}

function generateValidSquad(formation: Formation, availablePool: any[]): SquadPlayerEntry[] {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const shuffled = [...availablePool].sort(() => Math.random() - 0.5);
  const usedIds = new Set<string>();
  const squad: SquadPlayerEntry[] = [];

  // Build exactly the XI from the formation's category quotas. There are no
  // substitutes in the game.
  for (const slot of config.slots) {
    const candidates = shuffled
      .filter(p => !usedIds.has(p.id) && (slot.category === 'GK' ? p.category === 'GK' : p.category !== 'GK'))
      .sort((a, b) => playerSlotScore(b, slot) - playerSlotScore(a, slot) || b.overall - a.overall);
    const chosen = candidates[0] || shuffled.find(p => !usedIds.has(p.id) && (slot.category === 'GK' ? p.category === 'GK' : p.category !== 'GK'));
    if (!chosen) continue;
    usedIds.add(chosen.id);
    squad.push({
      player: chosen,
      isStarting: true,
      startingSlotIndex: slot.index,
      assignedPosition: slot.position,
      condition: createFitCondition(),
    });
  }

  const limits = getFormationSquadCategoryLimits(formation);
  const categoryCounts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const entry of squad) categoryCounts[entry.player.category] += 1;

  // The formation limits are exact XI quotas, so the auctioned squad is
  // already complete once all eleven formation categories are filled.
  return squad.slice(0, 11);
}

// Auction runs in four synchronized blocks: GK -> DEF -> MID -> ATT.
// Once every manager has the exact 11-player squad, the auction ends.
function getAuctionCategoryForStage(room: GameRoom): PositionCategory | null {
  const ordered: PositionCategory[] = ['GK', 'DEF', 'MID', 'ATT'];
  for (const category of ordered) {
    const needsCategory = room.managers.some(manager => {
      const required = getFormationSquadCategoryLimits(manager.formation)[category];
      const count = manager.squad.filter(entry => entry.player.category === category).length;
      return count < required;
    });
    if (needsCategory) return category;
  }
  return null;
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

  // Check if all managers have complete XI-only squads
  const allFull = room.managers.every(m => m.squad.length >= 11);
  if (allFull) {
    room.managers.forEach(autoFillManagerLineup);
    room.phase = 'team_management';
    broadcastRoom(room.code);
    return;
  }

  const unowned = pool.filter(p => !ownedIds.has(p.id));
  if (unowned.length === 0) {
    
    room.managers.forEach(autoFillManagerLineup);
    room.phase = 'team_management';
    broadcastRoom(room.code);
    return;
  }

  // Stage the auction so every manager completes the same positional block
  // before the next block begins: GK -> DEF -> MID -> ATT.
  const starterStage = getAuctionCategoryForStage(room);
  const eligibleByStage = starterStage
    ? unowned.filter(p => p.category === starterStage)
    : unowned.filter(p => (['GK', 'DEF', 'MID', 'ATT'] as PositionCategory[]).some(category => {
        const hasRoom = room.managers.some(manager => {
          const limits = getFormationSquadCategoryLimits(manager.formation);
          const count = manager.squad.filter(entry => entry.player.category === category).length;
          return count < limits[category];
        });
        return hasRoom && p.category === category;
      }));

  const auctionCandidates = eligibleByStage.length ? eligibleByStage : unowned;
  const nextPlayer = auctionCandidates[Math.floor(Math.random() * auctionCandidates.length)];
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
    blindClues: room.settings.auctionMode === 'Blind' ? createBlindAuctionClues(nextPlayer) : undefined,
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

function createBlindAuctionClues(player: any) {
  const keys = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'] as const;
  const seed = Array.from(String(player.id)).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const first = keys[seed % keys.length];
  const second = keys[(seed * 7 + 3) % keys.length];
  const secondKey = second === first ? keys[(keys.indexOf(first) + 1) % keys.length] : second;
  return [
    { key: first, value: Number(player.attributes?.[first] ?? 0) },
    { key: secondKey, value: Number(player.attributes?.[secondKey] ?? 0) },
  ];
}

function simulateBotBids(room: GameRoom) {
  const currentPl = room.auction.currentPlayer;
  if (!currentPl) return;

  const bots = room.managers.filter(m => m.isBot && m.squad.length < 11);
  for (const bot of bots) {
    // Check if bot can afford
    const minNextBid = room.auction.highestBidderId ? room.auction.currentBid + 2 : room.auction.currentBid;
    if (bot.budget < minNextBid) continue;

    // Formation slots are flexible; the bot may buy any outfield player.
    const botLimits = getFormationSquadCategoryLimits(bot.formation);
    if (bot.squad.filter(s => s.player.category === currentPl.category).length >= botLimits[currentPl.category]) continue;

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
          winningManagers = [manager.id];
        } else if (bAmount === highestBid) {
          winningManagers.push(manager.id);
        }
      }
    }

    if (winningManagers.length > 0) {
      // Deterministic tie-breaking: pick earliest manager in room order.
      winnerId = winningManagers[0];
      finalPrice = highestBid;
    } else {
      winnerId = null;
      // Use the existing SOLD/reveal state for a short "NO VALID BIDS" reveal.
      room.auction.isSold = true;
      room.auction.winnerId = null;
      room.auction.soldPrice = 0;
    }
  }

  if (winnerId) {
    const winner = room.managers.find(m => m.id === winnerId);
    if (winner && winner.budget >= finalPrice) {
      winner.budget -= finalPrice;
      winner.squad.push({
        player,
        isStarting: false,
        startingSlotIndex: undefined,
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
    if (room.managers.every(m => m.squad.length === 11)) {
      room.managers.forEach(autoFillManagerLineup);
    }
    advanceAuction(room);
  }, 3500);
}

// Calculate season awards from recorded fixture stats
function calculateSeasonAwards(room: GameRoom): SeasonAwards {
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
  const playerData = (id: string) => DEVELOPMENT_PLAYERS.find(p => p.id === id);

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

function playoffQualifierCount(teamCount: number): 2 | 4 | 8 {
  // League playoffs:
  // 2-5 teams -> top 2 straight to the Final
  // 6-9 teams -> top 4 to Semi-Finals
  // 10-16 teams -> top 8 to Quarter-Finals
  if (teamCount >= 10) return 8;
  if (teamCount >= 6) return 4;
  return 2;
}

function knockoutRoundForTeamCount(teamCount: number): 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Final' {
  const qualifiers = playoffQualifierCount(teamCount);
  if (qualifiers === 8) return 'Quarter-Final';
  if (qualifiers === 4) return 'Semi-Final';
  return 'Final';
}

function nextKnockoutRound(round: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final') {
  if (round === 'Round of 16') return 'Quarter-Final';
  if (round === 'Quarter-Final') return 'Semi-Final';
  if (round === 'Semi-Final') return 'Third-Place';
  if (round === 'Third-Place') return 'Final';
  return null;
}

function buildKnockoutFixtures(
  managers: Manager[],
  roundName: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final',
  matchday: number
): Fixture[] {
  // The input order is authoritative: league playoffs pass teams in league-table
  // order, and later rounds pass winners/losers in bracket order. Never reseed by OVR.
  const bracketSize = roundName === 'Round of 16' ? 16 : roundName === 'Quarter-Final' ? 8 : roundName === 'Semi-Final' ? 4 : 2;
  const slots: (Manager | null)[] = Array(bracketSize).fill(null);
  managers.slice(0, bracketSize).forEach((manager, index) => {
    slots[index] = manager;
  });

  const fixtures: Fixture[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const home = slots[i];
    const away = slots[bracketSize - 1 - i];
    if (!home && !away) continue;

    const id = `ko-${matchday}-${i + 1}-${crypto.randomUUID()}`;
    if (home && away) {
      fixtures.push({
        id,
        matchday,
        homeManagerId: home.id,
        homeManagerName: home.name,
        awayManagerId: away.id,
        awayManagerName: away.name,
        played: false,
        isKnockout: true,
        roundName,
      });
    } else if (home || away) {
      const winner = home || away!;
      fixtures.push({
        id,
        matchday,
        homeManagerId: winner.id,
        homeManagerName: winner.name,
        awayManagerId: winner.id,
        awayManagerName: winner.name,
        played: true,
        homeScore: 0,
        awayScore: 0,
        isKnockout: true,
        roundName,
        winnerManagerId: winner.id,
      });
    }
  }
  return fixtures;
}

function initializeKnockout(room: GameRoom) {
  // Used by explicitly selected non-league knockout formats.
  const seeded = [...room.managers].sort((a, b) => b.teamOverall - a.teamOverall || a.name.localeCompare(b.name));
  const qualifierCount = playoffQualifierCount(seeded.length);
  const firstRound = qualifierCount === 8 ? 'Quarter-Final' : qualifierCount === 4 ? 'Semi-Final' : 'Final';
  const qualifiers = seeded.slice(0, qualifierCount);
  const fixtures = buildKnockoutFixtures(qualifiers, firstRound, 1);
  const round: KnockoutRound = {
    roundName: firstRound,
    fixtures,
    isComplete: fixtures.every(f => f.played),
  };

  room.fixtures = fixtures;
  room.currentMatchday = 1;
  room.totalMatchdays = 1;
  room.leagueTable = calculateInitialTable(room.managers);
  room.knockoutStage = {
    currentRound: firstRound,
    rounds: [round],
  };
  room.phase = 'knockout';
}

function initializeLeaguePlayoffs(room: GameRoom) {
  const qualifiers = playoffQualifierCount(room.managers.length);
  const ranked = [...room.leagueTable]
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.managerName.localeCompare(b.managerName)
    )
    .slice(0, qualifiers)
    .map(row => room.managers.find(m => m.id === row.managerId))
    .filter(Boolean) as Manager[];

  if (ranked.length < 2) {
    room.phase = 'season_end';
    room.awards = calculateSeasonAwards(room);
    return;
  }

  const firstRound = qualifiers === 8 ? 'Quarter-Final' : qualifiers === 4 ? 'Semi-Final' : 'Final';
  const fixtures = buildKnockoutFixtures(ranked, firstRound, room.currentMatchday + 1);

  const round: KnockoutRound = {
    roundName: firstRound,
    fixtures,
    isComplete: fixtures.every(f => f.played),
  };

  room.knockoutStage = {
    currentRound: firstRound,
    rounds: [round],
  };
  room.fixtures = fixtures;
  room.currentMatchday += 1;
  room.totalMatchdays = room.currentMatchday;
  room.phase = 'knockout';
}

function advanceKnockoutRound(room: GameRoom) {
  const stage = room.knockoutStage;
  if (!stage) return;

  const currentRound = stage.rounds[stage.rounds.length - 1];
  currentRound.isComplete = currentRound.fixtures.every(f => f.played);
  if (!currentRound.isComplete) return;

  // A Final ends the season.
  if (currentRound.roundName === 'Final') {
    const champion = currentRound.fixtures
      .map(f => f.winnerManagerId)
      .filter(Boolean)
      .map(id => room.managers.find(m => m.id === id))
      .filter(Boolean)[0] as Manager | undefined;

    stage.championId = champion?.id;
    stage.championName = champion?.name;
    room.phase = 'season_end';
    room.awards = calculateSeasonAwards(room);
    return;
  }

  let nextManagers: Manager[] = [];

  if (currentRound.roundName === 'Semi-Final') {
    // Winners go to the Final; losers go to the Third-Place match.
    const winners = currentRound.fixtures
      .map(f => f.winnerManagerId)
      .filter(Boolean)
      .map(id => room.managers.find(m => m.id === id))
      .filter(Boolean) as Manager[];

    const losers = currentRound.fixtures
      .map(f => {
        const winnerId = f.winnerManagerId;
        const loserId = winnerId === f.homeManagerId ? f.awayManagerId : f.homeManagerId;
        return room.managers.find(m => m.id === loserId);
      })
      .filter(Boolean) as Manager[];

    const thirdFixtures = buildKnockoutFixtures(losers, 'Third-Place', currentRound.fixtures[0]?.matchday + 1 || room.currentMatchday + 1);
    stage.rounds.push({
      roundName: 'Third-Place',
      fixtures: thirdFixtures,
      isComplete: thirdFixtures.every(f => f.played),
    });
    stage.currentRound = 'Third-Place';
    room.fixtures = thirdFixtures;
    room.currentMatchday = (currentRound.fixtures[0]?.matchday || room.currentMatchday) + 1;
    room.totalMatchdays = room.currentMatchday;
    // Store finalists indirectly in the completed Semi-Final round; they will be
    // read when the Third-Place match finishes.
    void winners;
    return;
  }

  if (currentRound.roundName === 'Third-Place') {
    const semiRound = stage.rounds[stage.rounds.length - 2];
    const finalists = (semiRound?.fixtures || [])
      .map(f => f.winnerManagerId)
      .filter(Boolean)
      .map(id => room.managers.find(m => m.id === id))
      .filter(Boolean) as Manager[];

    const finalFixtures = buildKnockoutFixtures(finalists, 'Final', currentRound.fixtures[0]?.matchday + 1 || room.currentMatchday + 1);
    stage.rounds.push({
      roundName: 'Final',
      fixtures: finalFixtures,
      isComplete: finalFixtures.every(f => f.played),
    });
    stage.currentRound = 'Final';
    room.fixtures = finalFixtures;
    room.currentMatchday = (currentRound.fixtures[0]?.matchday || room.currentMatchday) + 1;
    room.totalMatchdays = room.currentMatchday;
    return;
  }

  nextManagers = currentRound.fixtures
    .map(f => f.winnerManagerId)
    .filter(Boolean)
    .map(id => room.managers.find(m => m.id === id))
    .filter(Boolean) as Manager[];

  const nextRoundName = nextKnockoutRound(currentRound.roundName);
  if (!nextRoundName) return;

  const nextMatchday = (currentRound.fixtures[0]?.matchday ?? room.currentMatchday) + 1;
  const nextFixtures = buildKnockoutFixtures(nextManagers, nextRoundName, nextMatchday);
  stage.rounds.push({
    roundName: nextRoundName,
    fixtures: nextFixtures,
    isComplete: nextFixtures.every(f => f.played),
  });
  stage.currentRound = nextRoundName;
  room.fixtures = nextFixtures;
  room.currentMatchday = nextMatchday;
  room.totalMatchdays = nextMatchday;
}

function validateAndSanitizeLineupUpdate(manager: Manager, incomingSquad: SquadPlayerEntry[], formation: Formation, tactics: any, roles: any) {
  if (!Array.isArray(incomingSquad) || incomingSquad.length !== manager.squad.length) return null;

  const existingById = new Map(manager.squad.map(entry => [entry.player.id, entry]));
  const incomingIds = incomingSquad.map(entry => entry?.player?.id);
  if (new Set(incomingIds).size !== existingById.size || incomingIds.some(id => !existingById.has(id))) {
    return null;
  }

  const sanitizedSquad = incomingSquad.map(entry => {
    const existing = existingById.get(entry.player.id)!;
    return {
      ...existing,
      isStarting: Boolean(entry.isStarting),
      startingSlotIndex: entry.isStarting ? entry.startingSlotIndex : undefined,
      assignedPosition: entry.assignedPosition || existing.assignedPosition,
      // Conditions are server-authoritative and cannot be cleared by the client.
      condition: existing.condition,
    };
  });

  if (!validateSquadFormation(formation, sanitizedSquad).isValid) return null;

  const allowedStyles = new Set(['Balanced', 'Possession', 'High Press', 'Counter Attack', 'Low Block', 'Long Ball', 'Aggressive']);
  const allowedMentalities = new Set(['Balanced', 'Defensive', 'Aggressive']);
  const nextTactics = tactics ? {
    style: allowedStyles.has(tactics.style) ? tactics.style : manager.tactics.style,
    mentality: allowedMentalities.has(tactics.mentality) ? tactics.mentality : manager.tactics.mentality || 'Balanced',
    defensiveLine: Math.max(1, Math.min(100, Number(tactics.defensiveLine ?? manager.tactics.defensiveLine))),
    pressingIntensity: Math.max(1, Math.min(100, Number(tactics.pressingIntensity ?? manager.tactics.pressingIntensity))),
    attackWidth: Math.max(1, Math.min(100, Number(tactics.attackWidth ?? manager.tactics.attackWidth))),
    tempo: Math.max(1, Math.min(100, Number(tactics.tempo ?? manager.tactics.tempo))),
    risk: Math.max(1, Math.min(100, Number(tactics.risk ?? manager.tactics.risk))),
  } : manager.tactics;

  const ownedIds = new Set(manager.squad.map(s => s.player.id));
  const nextRoles = roles ? {
    captainId: ownedIds.has(roles.captainId) ? roles.captainId : manager.roles.captainId,
    penaltyTakerId: ownedIds.has(roles.penaltyTakerId) ? roles.penaltyTakerId : manager.roles.penaltyTakerId,
    freeKickTakerId: ownedIds.has(roles.freeKickTakerId) ? roles.freeKickTakerId : manager.roles.freeKickTakerId,
    cornerTakerId: ownedIds.has(roles.cornerTakerId) ? roles.cornerTakerId : manager.roles.cornerTakerId,
  } : manager.roles;

  return { squad: sanitizedSquad, tactics: nextTactics, roles: nextRoles };
}

function executeTransferOffer(room: GameRoom, offer: TransferOffer): boolean {
  const sender = room.managers.find(m => m.id === offer.fromManagerId);
  const target = room.managers.find(m => m.id === offer.toManagerId);
  if (!sender || !target || sender.id === target.id) return false;
  if (!Number.isFinite(offer.offeredCash) || offer.offeredCash < 0 || offer.offeredCash > sender.budget) return false;

  const senderIndex = sender.squad.findIndex(s => s.player.id === offer.offeredPlayerId);
  const targetIndex = target.squad.findIndex(s => s.player.id === offer.requestedPlayerId);
  if (senderIndex < 0 || targetIndex < 0) return false;

  // Keep the operation atomic: validate both resulting squads before committing.
  const senderBefore = JSON.parse(JSON.stringify(sender.squad)) as SquadPlayerEntry[];
  const targetBefore = JSON.parse(JSON.stringify(target.squad)) as SquadPlayerEntry[];
  const senderBudgetBefore = sender.budget;
  const targetBudgetBefore = target.budget;
  const senderRolesBefore = sender.roles;
  const targetRolesBefore = target.roles;

  const senderPlayer = sender.squad[senderIndex].player;
  const targetPlayer = target.squad[targetIndex].player;

  sender.squad[senderIndex] = {
    ...sender.squad[senderIndex],
    player: targetPlayer,
    assignedPosition: sender.squad[senderIndex].isStarting
      ? (sender.squad[senderIndex].assignedPosition || targetPlayer.position)
      : (sender.squad[senderIndex].assignedPosition || targetPlayer.position),
  };
  target.squad[targetIndex] = {
    ...target.squad[targetIndex],
    player: senderPlayer,
    assignedPosition: target.squad[targetIndex].assignedPosition || senderPlayer.position,
  };

  // Never leave a goalkeeper assigned to an outfield role (or vice versa).
  for (const manager of [sender, target]) {
    manager.squad = manager.squad.map(entry => {
      if (entry.player.category === 'GK') return { ...entry, assignedPosition: 'GK' };
      if (!entry.assignedPosition || entry.assignedPosition === 'GK') {
        return { ...entry, assignedPosition: entry.player.position };
      }
      return entry;
    });
  }

  const senderValidation = validateSquadFormation(sender.formation, sender.squad);
  const targetValidation = validateSquadFormation(target.formation, target.squad);
  if (!senderValidation.isValid || !targetValidation.isValid) {
    sender.squad = senderBefore;
    target.squad = targetBefore;
    sender.budget = senderBudgetBefore;
    target.budget = targetBudgetBefore;
    sender.roles = senderRolesBefore;
    target.roles = targetRolesBefore;
    return false;
  }

  sender.budget -= offer.offeredCash;
  target.budget += offer.offeredCash;
  sender.teamOverall = calculateTeamOverall(sender.formation, sender.squad);
  target.teamOverall = calculateTeamOverall(target.formation, target.squad);
  sender.roles = setupManagerRoles(sender.squad.filter(s => s.isStarting));
  target.roles = setupManagerRoles(target.squad.filter(s => s.isStarting));
  return true;
}

function isTransferWindowOpen(room: GameRoom) {
  return room.phase === 'league' && room.currentMatchday > 0 && room.currentMatchday % 5 === 0;
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
      mentality: 'Balanced',
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
      totalPlayersInPool: DEVELOPMENT_PLAYERS.length,
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
  void saveRoomSnapshot(room);

  return { roomCode, managerId: hostId, room };
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.on('message', async (messageRaw) => {
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
            competitionFormat: requestedSettings?.competitionFormat === 'Knockout'
              ? 'Knockout'
              : requestedSettings?.competitionFormat === 'Champions Cup'
              ? 'Champions Cup'
              : 'League',
          };

          const room: GameRoom = {
            code: roomCode,
            hostId,
            settings,
            phase: 'lobby',
            managers,
            auction: {
              currentPlayerIndex: 0,
              totalPlayersInPool: DEVELOPMENT_PLAYERS.length,
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
          await saveRoomSnapshot(room);

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
          const normalizedRoomCode = roomCode?.toUpperCase();
          let room = rooms.get(normalizedRoomCode);
          if (!room && normalizedRoomCode) {
            room = await loadRoomSnapshot(normalizedRoomCode) || undefined;
            if (room) rooms.set(normalizedRoomCode, room);
          }

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
          if (room.phase !== 'lobby') return;

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
          if (!auth) return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId) || targetManagerId === room.hostId) {
            sendSocketError(ws, 'Only the host can kick another manager.');
            return;
          }
          const target = room.managers.find(m => m.id === targetManagerId);
          if (!target || target.isHost) {
            sendSocketError(ws, 'That manager cannot be kicked.');
            return;
          }

          // Host removal is allowed during every game phase. Clean the target out of
          // active auction/fixtures so the remaining room never references a kicked ID.
          if (room.auction?.highestBidderId === targetManagerId) {
            room.auction.highestBidderId = null;
            room.auction.highestBidderName = null;
            room.auction.currentBid = room.auction.currentPlayer?.startingPrice || 0;
          }

          if (room.phase === 'knockout' && room.knockoutStage) {
            for (const round of room.knockoutStage.rounds) {
              for (const fixture of round.fixtures) {
                if (fixture.played) continue;
                if (fixture.homeManagerId === targetManagerId && fixture.awayManagerId !== targetManagerId) {
                  fixture.played = true;
                  fixture.homeScore = 0;
                  fixture.awayScore = 3;
                  fixture.winnerManagerId = fixture.awayManagerId;
                } else if (fixture.awayManagerId === targetManagerId && fixture.homeManagerId !== targetManagerId) {
                  fixture.played = true;
                  fixture.homeScore = 3;
                  fixture.awayScore = 0;
                  fixture.winnerManagerId = fixture.homeManagerId;
                }
              }
              round.isComplete = round.fixtures.every(f => f.played);
            }
          } else {
            room.fixtures = room.fixtures.filter(f =>
              f.played || (f.homeManagerId !== targetManagerId && f.awayManagerId !== targetManagerId)
            );
          }

          removeManagerFromRoom(room, targetManagerId);

          const sockets = roomSockets.get(room.code);
          if (sockets) {
            for (const client of [...sockets]) {
              const info = socketToRoom.get(client);
              if (info?.managerId === targetManagerId) {
                sockets.delete(client);
                socketToRoom.delete(client);
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'KICKED', message: 'You were removed from the game by the host.' }));
                  client.close();
                }
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
          if (room.phase !== 'formation_select') return;

          const supportedFormations = Object.keys(FORMATIONS_CONFIG) as Formation[];
          if (!supportedFormations.includes(formation as Formation)) {
            sendSocketError(ws, 'That formation is not supported.');
            return;
          }

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            manager.formation = formation as Formation;
            // Formation selection happens before the squad exists, so changing it
            // never carries over stale positional validation from another formation.
            manager.confirmedTeam = false;
            manager.squad = [];
            manager.teamOverall = 0;
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
          const human = room.managers.find(m => !m.isBot);
          const bot = room.managers.find(m => m.isBot);

          if (human) {
            human.squad = generateValidSquad(human.formation, pool);
            human.teamOverall = calculateTeamOverall(human.formation, human.squad);
            human.roles = setupManagerRoles(human.squad.filter(s => s.isStarting));
          }

          if (bot) {
            const ownedByHuman = new Set((human?.squad || []).map(s => s.player.id));
            const botPool = pool.filter(p => !ownedByHuman.has(p.id));
            bot.squad = generateValidSquad(bot.formation, botPool.length >= 11 ? botPool : pool);
            bot.teamOverall = calculateTeamOverall(bot.formation, bot.squad);
            bot.roles = setupManagerRoles(bot.squad.filter(s => s.isStarting));
            bot.confirmedTeam = true;
          }

          room.managers.forEach(autoFillManagerLineup);
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

          if (manager.squad.length >= 11) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Your XI is already full (11/11 players).' }));
            return;
          }

          const auctionPlayer = room.auction.currentPlayer;
          if (!auctionPlayer) return;
          const limits = getFormationSquadCategoryLimits(manager.formation);
          const ownedCategoryCount = manager.squad.filter(s => s.player.category === auctionPlayer.category).length;
          if (ownedCategoryCount >= limits[auctionPlayer.category]) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Your ${auctionPlayer.category} quota is full for ${manager.formation}.` }));
            return;
          }

          // The increment is based on the current auction price, not the
          // submitted amount. This keeps client and server validation identical
          // around £100M/£250M thresholds.
          const bidStep = room.auction.currentBid >= 250 ? 10 : room.auction.currentBid >= 100 ? 5 : 2;
          if (room.auction.highestBidderId && bidAmount < room.auction.currentBid + bidStep) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Next bid must be at least £${room.auction.currentBid + bidStep}M.` }));
            return;
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
          if (manager.squad.length >= 11) {
            sendSocketError(ws, 'Your XI is already full (11/11 players).');
            return;
          }
          const blindLimits = getFormationSquadCategoryLimits(manager.formation);
          const blindCategoryCount = manager.squad.filter(s => s.player.category === currentPl.category).length;
          if (blindCategoryCount >= blindLimits[currentPl.category]) {
            sendSocketError(ws, `Your ${currentPl.category} quota is full for ${manager.formation}.`);
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
          if (!['team_management', 'league', 'knockout'].includes(room.phase)) return;

          const manager = room.managers.find(m => m.id === managerId);
          if (manager) {
            const nextFormation = formation || manager.formation;
            const sanitized = squad
              ? validateAndSanitizeLineupUpdate(manager, squad, nextFormation, tactics, roles)
              : {
                  squad: manager.squad,
                  tactics: tactics || manager.tactics,
                  roles: roles || manager.roles,
                };

            if (!sanitized) {
              sendSocketError(ws, 'Invalid lineup. You can only rearrange players you already own and must keep a valid formation.');
              return;
            }

            manager.squad = sanitized.squad;
            manager.formation = nextFormation;
            manager.tactics = sanitized.tactics;
            manager.roles = sanitized.roles;
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
            const validation = validateSquadFormation(manager.formation, manager.squad);
            const unavailableStarter = manager.squad.some(
              s => s.isStarting && (s.condition.state === 'SUSPENDED' || s.condition.state === 'INJURED')
            );
            if (!validation.isValid || manager.squad.length !== 11 || unavailableStarter) {
              sendSocketError(ws, unavailableStarter
                ? 'Your starting XI contains an unavailable player.'
                : 'Complete your 11-player squad and 11-player starting XI before confirming.');
              return;
            }
            manager.confirmedTeam = true;
          }

          // Auto-confirm bots
          for (const m of room.managers) {
            if (m.isBot) m.confirmedTeam = true;
          }

          // Check if all confirmed
          const allConfirmed = room.managers.every(m => m.confirmedTeam);
          if (allConfirmed) {
            if (room.settings.competitionFormat !== 'League') {
              initializeKnockout(room);
            } else {
              room.fixtures = generateLeagueFixtures(room.managers, 'Double Round Robin');
              room.currentMatchday = 1;
              const maxMd = Math.max(...room.fixtures.map(f => f.matchday), 1);
              room.totalMatchdays = maxMd;
              room.leagueTable = calculateInitialTable(room.managers);
              room.phase = 'league';
            }
          }

          broadcastRoom(room.code);
          break;
        }

        // --- KNOCKOUT MATCH ---
        case 'RUN_KNOCKOUT_MATCH': {
          const { roomCode, fixtureId } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'knockout') return;
          const { room } = auth;
          const stage = room.knockoutStage;
          if (!stage) return;
          const round = stage.rounds[stage.rounds.length - 1];
          const fix = round.fixtures.find(f => f.id === fixtureId);
          if (!fix || fix.played) return;

          const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
          const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);
          if (!homeMgr || !awayMgr) return;

          const result = simulateMatch(homeMgr, awayMgr, fix.id, fix.matchday, undefined, true, round.roundName);
          Object.assign(fix, result);
          room.fixtures = round.fixtures;
          // IMPORTANT: keep the room in the knockout phase while the client
          // plays the authoritative event timeline in LiveMatchEngine.
          // The bracket/season advances only after COMPLETE_KNOCKOUT_MATCH.
          broadcastRoom(room.code);
          break;
        }

        // Advance the bracket only after the 2D live match has reached full-time.
        case 'COMPLETE_KNOCKOUT_MATCH': {
          const { roomCode, fixtureId } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'knockout') return;
          const { room } = auth;
          const stage = room.knockoutStage;
          if (!stage) return;
          const round = stage.rounds[stage.rounds.length - 1];
          const fix = round.fixtures.find(f => f.id === fixtureId);
          if (!fix || !fix.played) return;

          // Idempotent: multiple viewers may reach full-time.
          advanceKnockoutRound(room);
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
          if (!Number.isInteger(targetMatchday) || targetMatchday < 1 || targetMatchday > room.totalMatchdays) {
            sendSocketError(ws, 'Invalid matchday.');
            return;
          }
          if (targetMatchday !== room.currentMatchday) {
            sendSocketError(ws, 'Simulate the current matchday before advancing.');
            return;
          }

          const currentFixtures = room.fixtures.filter(f => f.matchday === targetMatchday && !f.played);
          if (!currentFixtures.length) {
            sendSocketError(ws, 'This matchday is already complete.');
            return;
          }

          // Run exactly one fixture per action so its authoritative event
          // timeline can be watched in the 2D Live Match Engine.
          const fix = currentFixtures[0];
          const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
          const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);

          if (!homeMgr || !awayMgr) {
            sendSocketError(ws, 'Unable to load both teams for this fixture.');
            return;
          }

          const result = simulateMatch(homeMgr, awayMgr, fix.id, targetMatchday);
          Object.assign(fix, result);
          room.leagueTable = updateLeagueTable(room.leagueTable, fix);

          // The league is always a double round robin. Once the final league
          // fixture is completed, immediately build the correct playoff bracket:
          // 2-5 teams -> Final, 6-9 -> top 4 Semi-Finals, 10-16 -> top 8 Quarter-Finals.
          const leagueComplete = room.fixtures.length > 0 && room.fixtures.every(f => f.played);
          room.currentMatchday = targetMatchday;
          if (leagueComplete) {
            initializeLeaguePlayoffs(room);
          }

          broadcastRoom(room.code);
          break;
        }

        // --- 14b. NEXT MATCHDAY ---
        case 'NEXT_MATCHDAY': {
          const { roomCode, nextMatchday } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room } = auth;

          const requestedNext = Number(nextMatchday || room.currentMatchday + 1);
          const currentPlayed = room.fixtures.filter(f => f.matchday === room.currentMatchday).every(f => f.played);
          if (!currentPlayed) {
            sendSocketError(ws, 'Finish the current matchday before proceeding.');
            return;
          }
          room.currentMatchday = Math.min(room.totalMatchdays, Math.max(room.currentMatchday, requestedNext));
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

          const seasonComplete = room.currentMatchday >= room.totalMatchdays &&
            room.fixtures.filter(f => f.matchday === room.totalMatchdays).every(f => f.played);
          if (!seasonComplete) {
            sendSocketError(ws, 'Complete every matchday before viewing season awards.');
            return;
          }
          room.phase = 'season_end';
          room.awards = calculateSeasonAwards(room);
          broadcastRoom(room.code);
          break;
        }

        // --- 15. TRANSFERS ---
        case 'PROPOSE_TRANSFER': {
          const { roomCode, offer } = payload;
          const auth = authorizeSocket(ws, roomCode, offer?.fromManagerId);
          if (!auth) return;
          const { room } = auth;

          if (!room.settings.transfersEnabled || !isTransferWindowOpen(room)) {
            sendSocketError(ws, 'Transfers are only available every 5 matchdays.');
            return;
          }

          const sender = room.managers.find(m => m.id === offer.fromManagerId);
          const target = room.managers.find(m => m.id === offer.toManagerId);
          const offeredCash = Number(offer.offeredCash || 0);
          if (!sender || !target || sender.id === target.id) {
            sendSocketError(ws, 'Invalid transfer participants.');
            return;
          }
          if (!Number.isFinite(offeredCash) || offeredCash < 0 || offeredCash > sender.budget) {
            sendSocketError(ws, 'Invalid cash amount.');
            return;
          }

          const offeredEntry = sender.squad.find(s => s.player.id === offer.offeredPlayerId);
          const requestedEntry = target.squad.find(s => s.player.id === offer.requestedPlayerId);
          if (!offeredEntry || !requestedEntry) {
            sendSocketError(ws, 'You can only trade players currently owned by the two managers.');
            return;
          }

          const newOffer: TransferOffer = {
            id: newId('transfer'),
            fromManagerId: sender.id,
            fromManagerName: sender.name,
            toManagerId: target.id,
            toManagerName: target.name,
            offeredPlayerId: offeredEntry.player.id,
            offeredPlayerName: offeredEntry.player.name,
            requestedPlayerId: requestedEntry.player.id,
            requestedPlayerName: requestedEntry.player.name,
            offeredCash,
            matchday: room.currentMatchday,
            status: 'pending',
            createdAt: Date.now(),
          };

          if (target.isBot) {
            const offeredValue = offeredEntry.player.overall + offeredCash * 0.20;
            const requestedValue = requestedEntry.player.overall;
            newOffer.status = offeredValue >= requestedValue ? 'accepted' : 'rejected';
            if (newOffer.status === 'accepted') executeTransferOffer(room, newOffer);
            room.transferOffers.push(newOffer);
          } else {
            room.transferOffers.push(newOffer);
          }

          broadcastRoom(room.code);
          break;
        }

        case 'RESPOND_TRANSFER': {
          const { roomCode, managerId, offerId, accept } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room } = auth;

          if (!room.settings.transfersEnabled || !isTransferWindowOpen(room)) {
            sendSocketError(ws, 'Transfers are only available every 5 matchdays.');
            return;
          }

          const offer = room.transferOffers.find(o => o.id === offerId && o.status === 'pending');
          if (!offer || offer.toManagerId !== managerId) {
            sendSocketError(ws, 'Transfer proposal not found or already resolved.');
            return;
          }

          offer.status = accept && executeTransferOffer(room, offer) ? 'accepted' : 'rejected';
          broadcastRoom(room.code);
          break;
        }

        // --- LEAVE ROOM ---
        case 'LEAVE_ROOM': {
          const { roomCode, managerId } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room, session } = auth;
          const sockets = roomSockets.get(room.code);
          if (sockets) sockets.delete(ws);
          socketToRoom.delete(ws);

          if (session.managerId !== room.hostId && room.phase === 'lobby') {
            room.managers = room.managers.filter(m => m.id !== session.managerId);
            room.leagueTable = calculateInitialTable(room.managers);
            broadcastRoom(room.code);
          }
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

          room.awards = null;
          if (room.settings.competitionFormat !== 'League') {
            initializeKnockout(room);
          } else {
            room.fixtures = generateLeagueFixtures(room.managers, 'Double Round Robin');
            room.currentMatchday = 1;
            room.leagueTable = calculateInitialTable(room.managers);
            room.phase = 'league';
          }

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
app.get('/api/room/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  let room = rooms.get(code);
  if (!room) {
    room = await loadRoomSnapshot(code) || undefined;
    if (room) rooms.set(code, room);
  }
  if (!room) return res.status(404).json({ error: 'Lobby not found' });
  const snapshot = JSON.parse(JSON.stringify(room)) as GameRoom;
  if (snapshot.settings.auctionMode === 'Blind' && snapshot.phase === 'auction') {
    snapshot.auction.hasSubmittedSecretBid = undefined;
    snapshot.auction.currentPlayer = snapshot.auction.isSold ? snapshot.auction.currentPlayer : null;
  }
  return res.json(snapshot);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRooms: rooms.size });
});

app.get('/api/players', (req, res) => {
  res.json(DEVELOPMENT_PLAYERS);
});

// Dedicated Solo Game endpoint (instantly generates 11-player squads and navigates to Team Management)
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

// Vercel Node runtime captures this server and upgrades WebSocket connections.
export default server;

// Vercel's zero-config Node server runtime uses this root server.ts directly.
// The listener is also required for local development.
if (!process.env.VERCEL) {
  startServer();
}
