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
  Position,
  KnockoutRound,
  KnockoutStageState
} from './src/types/football.js';
import { getBidStep, getMinNextBid } from './src/constants/auction.js';
import { FORMATIONS_CONFIG, calculateTeamOverall, validateSquadFormation, calculatePositionFit, getFormationStarterCategoryCounts, getFormationSquadCategoryLimits } from './src/constants/formations.js';
import { DEVELOPMENT_PLAYERS, getPlayersForLobby } from './src/data/players.js';
import { simulateMatch } from './src/engine/simulation.js';
import { saveRoomSnapshot, loadRoomSnapshot, deleteRoomSnapshot, cleanupOldRoomSnapshots, persistenceQueues, persistenceTimers } from './server/persistence.js';
import { aiRequestWindows, soloRequestWindows, apiRequestWindows, wsConnectionCounts, MAX_WS_CONNECTIONS_PER_IP, allowRateLimit, checkAiRateLimit } from './server/rate-limit.js';
import {
  authorizeSocket,
  createReconnectToken,
  hashReconnectToken,
  isRoomHost,
  matchesReconnectCredential,
  newId,
  publicManagerRef,
  resolveManagerId,
  sanitizeRoomForViewer,
  sendSocketError,
  setReconnectCredential,
} from './server/security.js';
import {
  rooms,
  roomSockets,
  roomDisconnectedAt,
  socketToRoom,
  matchSimulationLocks,
  socketAlive,
} from './server/room-state.js';
import { allManagersReady, allFormationReady, auctionIntervals, clearPhaseReadyTimer, phaseReadyTimers, PHASE_READY_SECONDS } from './server/timers.js';
import { generateLeagueFixtures, calculateInitialTable, updateLeagueTable } from './server/league.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Only advertise HSTS when the public request actually arrived over HTTPS.
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (process.env.NODE_ENV === 'production' && forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const server = http.createServer(app);

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});
const configuredOrigins = (process.env.ALLOWED_WS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// The production frontend may be hosted separately from the realtime Node server.
// Keep explicit origins by default, while allowing additional deployments through
// ALLOWED_WS_ORIGINS on the backend.
const allowedWsOrigins = Array.from(new Set(configuredOrigins));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  const isAllowed = !origin || allowedWsOrigins.includes(origin);
  if (isAllowed) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(isAllowed ? 204 : 403);
  }
  next();
});
const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
  verifyClient: ({ origin, req }: { origin: string; secure: boolean; req: import('http').IncomingMessage }) => {
    // Non-browser clients (no Origin) are only allowed outside production.
    if (!origin) return process.env.NODE_ENV !== 'production';

    // Explicit allowlist (your Vercel URLs + ALLOWED_WS_ORIGINS).
    if (allowedWsOrigins.includes(origin)) return true;

    // Same-origin: works for local `npm start` and any host serving its own frontend.
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || ((req.socket as any).encrypted ? 'https' : 'http');
    return origin === `${protocol}://${req.headers.host}`;
  },
});

app.use(express.json({ limit: '128kb' }));
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';

async function callOpenRouter(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.');

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://footballleague.runs-on.dev',
      'X-Title': 'Football Auction League',
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.error?.message === 'string' ? data.error.message : `OpenRouter HTTP ${response.status}`;
    throw new Error(detail);
  }

  return data?.choices?.[0]?.message?.content || '';
}

app.get('/api/ai/status', (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENROUTER_API_KEY) });
});

const AI_SYSTEM_PROMPT =
  'You are a football auction assistant inside a fantasy football auction game. ' +
  'Only help with football, squads, formations, tactics and auction strategy. ' +
  'Politely refuse anything else.';

app.post('/api/ai/chat', async (req, res) => {
  try {
    if (!checkAiRateLimit(req, res)) return;

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length || messages.length > 20) {
      return res.status(400).json({ error: 'messages must contain between 1 and 20 items' });
    }

    // Clients can never set the system prompt. Anything that isn't "assistant" is treated as "user".
    const clientMessages = messages.map((m: any) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content || '').slice(0, 2000),
    }));

    const answer = await callOpenRouter([
      { role: 'system', content: AI_SYSTEM_PROMPT },
      ...clientMessages,
    ]);
    return res.json({ answer });
  } catch (error: any) {
    console.error('[openrouter]', error);
    // Don't leak upstream error details to the browser.
    return res.status(502).json({ error: 'AI request failed' });
  }
});


const roomEvictionTicker = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const sockets = roomSockets.get(code);
    if (sockets && sockets.size > 0) {
      roomDisconnectedAt.delete(code);
      continue;
    }
    const disconnectedAt = roomDisconnectedAt.get(code) || room.updatedAt || now;
    if (room.phase === 'season_end' && now - room.updatedAt > 24 * 60 * 60 * 1000) {
      rooms.delete(code);
      roomSockets.delete(code);
      roomDisconnectedAt.delete(code);
      blindSecretBids.delete(code);
      const auctionTimer = auctionIntervals.get(code);
      if (auctionTimer) clearInterval(auctionTimer);
      auctionIntervals.delete(code);
      clearPhaseReadyTimer(room);
      void deletePersistedRoomSnapshot(code).catch(error => console.error('[rooms] season snapshot eviction failed:', error));
    } else if (now - disconnectedAt > 30 * 60 * 1000) {
      rooms.delete(code);
      roomSockets.delete(code);
      roomDisconnectedAt.delete(code);
      blindSecretBids.delete(code);
      const auctionTimer = auctionIntervals.get(code);
      if (auctionTimer) clearInterval(auctionTimer);
      auctionIntervals.delete(code);
      clearPhaseReadyTimer(room);
      void deletePersistedRoomSnapshot(code).catch(error => console.error('[rooms] inactive room eviction failed:', error));
    }
  }
}, 5 * 60 * 1000).unref();

const websocketHeartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (socketAlive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    socketAlive.set(ws, false);
    ws.ping();
  }
}, 30_000).unref();

server.on('close', () => { clearInterval(websocketHeartbeat); clearInterval(roomEvictionTicker); });

// Remove abandoned persisted rooms periodically. Active rooms refresh their
// snapshot timestamp whenever authoritative state is broadcast.
setInterval(() => {
  cleanupOldRoomSnapshots().catch(() => undefined);
}, 10 * 60 * 1000).unref();
void cleanupOldRoomSnapshots().catch(error => console.error('[persistence] initial cleanup failed:', error));

import {
  SUPPORTED_FORMATIONS,
  SUPPORTED_PLAYER_POOLS,
  SUPPORTED_ERAS,
  SUPPORTED_AUCTION_MODES,
  SUPPORTED_LEAGUE_TYPES,
  SUPPORTED_COMPETITIONS,
  clampFiniteNumber,
  sanitizeManagerName,
  sanitizeLobbySettings,
  createBotManager,
} from './server/lobby.js';
// Secret bids for blind auction: roomCode -> Record<managerId, number>
const blindSecretBids = new Map<string, Record<string, number>>();


function allTeamsConfirmed(room: GameRoom) {
  return room.managers.length >= 2 && room.managers.every(m => m.confirmedTeam || m.isBot);
}

function enterFormationSelect(room: GameRoom) {
  clearPhaseReadyTimer(room);
  room.phase = 'formation_select';
  room.phaseReadyIds = room.managers.filter(m => m.isBot).map(m => m.id);
  room.managers.forEach(m => { m.confirmedTeam = false; });
  room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
  ensurePhaseReadyTicker(room);
}

function beginAuctionFromFormation(room: GameRoom) {
  clearPhaseReadyTimer(room);
  room.phaseReadyIds = room.managers.filter(m => m.isBot).map(m => m.id);
  room.phase = 'auction';
  advanceAuction(room);
}

function enterTeamManagement(room: GameRoom) {
  clearPhaseReadyTimer(room);
  room.phase = 'team_management';
  room.phaseReadyIds = room.managers.filter(m => m.isBot).map(m => m.id);
  room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
  ensurePhaseReadyTicker(room);
}

function enterLeague(room: GameRoom) {
  clearPhaseReadyTimer(room);
  room.fixtures = generateLeagueFixtures(room.managers);
  room.currentMatchday = 1;
  room.totalMatchdays = Math.max(...room.fixtures.map(f => f.matchday), 1);
  room.leagueTable = calculateInitialTable(room.managers);
  room.phase = 'league';
}

function ensurePhaseReadyTicker(room: GameRoom) {
  if (!room.phaseReadyDeadline) return;
  const timedPhase = ['lobby', 'formation_select', 'team_management'].includes(room.phase) ||
    (room.phase === 'league' && room.transferWindowOpen === true);
  if (!timedPhase) {
    clearPhaseReadyTimer(room);
    return;
  }
  if (phaseReadyTimers.has(room.code)) return;

  const delay = Math.max(0, room.phaseReadyDeadline - Date.now());
  const timer = setTimeout(() => {
    phaseReadyTimers.delete(room.code);
    try {
      const current = rooms.get(room.code);
      if (!current || !current.phaseReadyDeadline) return;
      if (Date.now() < current.phaseReadyDeadline) {
        ensurePhaseReadyTicker(current);
        return;
      }

      if (current.phase === 'lobby') {
        if (current.managers.length < 2) {
          current.phaseReadyDeadline = undefined;
          broadcastRoom(current.code);
          return;
        }
        // Timer is the safety net: managers who did not press READY are still
        // allowed into the game so a single AFK player cannot block everyone.
        current.managers.forEach(m => { if (!m.isBot) m.isReady = true; });
        enterFormationSelect(current);
        broadcastRoom(current.code);
        return;
      }

      if (current.phase === 'formation_select') {
        current.phaseReadyIds = current.managers.map(m => m.id);
        beginAuctionFromFormation(current);
        broadcastRoom(current.code);
        return;
      }

      if (current.phase === 'league' && current.transferWindowOpen) {
        current.transferWindowOpen = false;
        current.transferWindowReadyIds = [];
        current.transferWindowMatchday = undefined;
        current.phaseReadyDeadline = undefined;
        current.currentMatchday = Math.min(current.totalMatchdays, current.currentMatchday + 1);
        broadcastRoom(current.code);
        return;
      }

      if (current.phase === 'team_management') {
        const pool = getPlayersForLobby(current.settings.playerPool, current.settings.era);
        const owned = new Set(current.managers.flatMap(m => m.squad.map(s => s.player.id)));
        emergencyFillRemainingXI(current, pool.filter(p => !owned.has(p.id)));
        current.managers.forEach(manager => {
          if (manager.squad.length >= 11) {
            autoFillManagerLineup(manager);
            manager.confirmedTeam = true;
          }
        });
        if (allTeamsConfirmed(current)) enterLeague(current);
        else current.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
        broadcastRoom(current.code);
      }
    } catch (error) {
      console.error('[PHASE TIMER] auto-start failed:', error);
    }
  }, delay);

  phaseReadyTimers.set(room.code, timer);
}

// Persist room snapshots without turning the auction countdown into a database
// write storm. Broadcasts can be frequent; durable state only needs the latest
// snapshot a few times per second. The timer always captures the newest room state
// when it fires, so reconnects never overwrite a fresh snapshot with an older one.

function queueRoomSnapshot(room: GameRoom) {
  const code = room.code;
  if (persistenceTimers.has(code)) return;

  persistenceTimers.set(code, setTimeout(() => {
    persistenceTimers.delete(code);

    const latest = rooms.get(code);
    if (!latest) return;

    const snapshot = JSON.parse(JSON.stringify(latest)) as GameRoom;
    const previous = persistenceQueues.get(code) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => saveRoomSnapshot(snapshot))
      .catch((error) => {
        console.error('[persistence] queued room save failed:', error);
      });
    persistenceQueues.set(code, next);
  }, 350));
}


async function deletePersistedRoomSnapshot(code: string) {
  const pendingTimer = persistenceTimers.get(code);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    persistenceTimers.delete(code);
  }
  const pendingSave = persistenceQueues.get(code);
  persistenceQueues.delete(code);
  if (pendingSave) await pendingSave.catch(() => {});
  await deleteRoomSnapshot(code);
}

function publicManagerRef(managerId: string): string {
  // Opaque client-facing reference. Never expose the server's manager UUID/ID.
  return 'p-' + crypto.createHash('sha256').update(managerId).digest('hex').slice(0, 12);
}

function resolveManagerId(room: GameRoom | undefined, suppliedId: unknown): string | null {
  const value = String(suppliedId || '');
  if (!room || !value) return null;
  if (room.managers.some(m => m.id === value)) return value;
  const match = room.managers.find(m => publicManagerRef(m.id) === value);
  return match?.id || null;
}

function sanitizeRoomForViewer(room: GameRoom, viewerManagerId?: string): GameRoom {
  const sanitized = JSON.parse(JSON.stringify(room)) as GameRoom;
  sanitized.serverNow = Date.now();
  const ref = (id: string | null | undefined) => {
    if (!id) return id;
    return id === viewerManagerId ? id : publicManagerRef(id);
  };

  sanitized.hostId = ref(sanitized.hostId) as string;
  sanitized.managers = sanitized.managers.map(m => {
    const { reconnectTokenHash: _reconnectTokenHash, ...publicManager } = m;
    return {
      ...publicManager,
      id: ref(m.id) as string,
    };
  });
  sanitized.leagueTable = sanitized.leagueTable.map(row => ({
    ...row,
    managerId: ref(row.managerId) as string,
  }));
  sanitized.fixtures = sanitized.fixtures.map(f => {
    const { events: _events, ...fixtureWithoutEvents } = f;
    return {
      ...fixtureWithoutEvents,
      homeManagerId: ref(f.homeManagerId) as string,
      awayManagerId: ref(f.awayManagerId) as string,
      winnerManagerId: ref(f.winnerManagerId) as string | undefined,
    };
  });
  sanitized.phaseReadyIds = sanitized.phaseReadyIds?.map(id => ref(id) as string);
  sanitized.transferWindowReadyIds = sanitized.transferWindowReadyIds?.map(id => ref(id) as string);

  if (sanitized.auction) {
    sanitized.auction.highestBidderId = ref(sanitized.auction.highestBidderId) as string | null;
    sanitized.auction.winnerId = ref(sanitized.auction.winnerId) as string | null;
    sanitized.auction.forcedWinnerId = ref(sanitized.auction.forcedWinnerId) as string | null;
    sanitized.auction.auctionHistory = sanitized.auction.auctionHistory.map(item => ({
      ...item,
      winnerId: ref(item.winnerId) as string,
    }));
    if (sanitized.auction.hasSubmittedSecretBid) {
      sanitized.auction.hasSubmittedSecretBid = Object.fromEntries(
        Object.entries(sanitized.auction.hasSubmittedSecretBid).map(([id, value]) => [ref(id) as string, value])
      );
    }
  }

  if (sanitized.transferOffers) {
    sanitized.transferOffers = sanitized.transferOffers.map(offer => ({
      ...offer,
      fromManagerId: ref(offer.fromManagerId) as string,
      toManagerId: ref(offer.toManagerId) as string,
    }));
  }

  if (sanitized.knockoutStage) {
    sanitized.knockoutStage.championId = ref(sanitized.knockoutStage.championId) as string | undefined;
    sanitized.knockoutStage.rounds = sanitized.knockoutStage.rounds.map(round => ({
      ...round,
      fixtures: round.fixtures.map(f => ({
        ...f,
        homeManagerId: ref(f.homeManagerId) as string,
        awayManagerId: ref(f.awayManagerId) as string,
        winnerManagerId: ref(f.winnerManagerId) as string | undefined,
      })),
    }));
  }

  if (sanitized.awards) {
    const awards: any = sanitized.awards;
    for (const key of Object.keys(awards)) {
      if (awards[key] && typeof awards[key] === 'object' && 'managerId' in awards[key]) {
        awards[key].managerId = ref(awards[key].managerId) as string;
      }
    }
  }

  return sanitized;
}

function broadcastRoom(roomCode: string, excludeSocket?: WebSocket, persist = true) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const sockets = roomSockets.get(roomCode) || new Set<WebSocket>();
  room.updatedAt = Date.now();
  const rawSecretBids = blindSecretBids.get(roomCode) || {};

  // Completed seasons are intentionally ephemeral. They remain in memory for
  // currently connected clients so awards/results can be viewed, but are never
  // written back to durable storage.
  if (persist && room.phase !== 'season_end') queueRoomSnapshot(room);

  for (const client of sockets) {
    if (client === excludeSocket || client.readyState !== WebSocket.OPEN) continue;

    const viewerId = socketToRoom.get(client)?.managerId;
    const sanitizedRoom = sanitizeRoomForViewer(room, viewerId);

    // Blind auction privacy is applied after manager-ID sanitization so both
    // privacy boundaries are guaranteed for every individual recipient.
    if (room.settings.auctionMode === 'Blind' && room.phase === 'auction') {
      sanitizedRoom.auction.hasSubmittedSecretBid = {};
      for (const mId of Object.keys(rawSecretBids)) {
        sanitizedRoom.auction.hasSubmittedSecretBid[publicManagerRef(mId)] = true;
      }

      const sourcePlayer = room.auction.currentPlayer;
      if (sourcePlayer && !room.auction.isSold) {
        sanitizedRoom.auction.currentPlayer = {
          ...sourcePlayer,
          id: `blind-${sourcePlayer.id}`,
          name: 'Mystery Player',
          club: 'Unknown Club',
          league: 'Unknown League',
          nationality: 'Unknown',
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

    client.send(JSON.stringify({
      type: 'ROOM_UPDATE',
      room: sanitizedRoom,
    }));
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

// Generate Fixtures (Round Robin or Double Round Robin)
function removeManagerFromRoom(room: GameRoom, managerId: string) {
  room.managers = room.managers.filter(manager => manager.id !== managerId);
  room.phaseReadyIds = (room.phaseReadyIds || []).filter(id => id !== managerId);
  room.transferWindowReadyIds = (room.transferWindowReadyIds || []).filter(id => id !== managerId);
  const secretBids = blindSecretBids.get(room.code);
  if (secretBids) {
    delete secretBids[managerId];
    if (Object.keys(secretBids).length === 0) blindSecretBids.delete(room.code);
  }
  if (room.auction?.highestBidderId === managerId) {
    room.auction.highestBidderId = null;
    room.auction.highestBidderName = null;
    // The departed bidder no longer controls the current price. Reset to the
    // lot's starting price so the remaining managers can bid normally.
    room.auction.currentBid = room.auction.currentPlayer?.startingPrice || 0;
  }
  if (room.auction?.forcedWinnerId === managerId) {
    room.auction.forcedWinnerId = null;
    room.auction.forcedWinnerName = null;
    room.auction.forcedPurchasePrice = undefined;
    room.auction.isForcedPurchase = false;
  }
  room.leagueTable = room.leagueTable.filter(row => row.managerId !== managerId);

  // Drop unplayed fixtures involving the departed manager so nobody is
  // scheduled against a ghost. Played results are kept for the history.
  room.fixtures = (room.fixtures || []).filter(
    f => f.played || (f.homeManagerId !== managerId && f.awayManagerId !== managerId)
  );
  if (room.fixtures.length) {
    room.totalMatchdays = Math.max(...room.fixtures.map(f => f.matchday), 1);
  }
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

// A player is valued by how well he performs a role, not just by OVR.
// This is deliberately deterministic so auction strategy and match strategy
// use the same six-stat football logic.
function playerMetaScore(player: any, targetPosition: string): number {
  const a = player.attributes || {};
  const pos = String(targetPosition);
  if (pos === 'GK') return a.dri * 0.30 + a.sho * 0.20 + a.pas * 0.15 + a.def * 0.15 + a.phy * 0.20;

  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) {
    const wide = ['LB', 'RB', 'LWB', 'RWB'].includes(pos);
    return a.def * 0.45 + a.phy * 0.20 + a.pac * (wide ? 0.20 : 0.10) + a.pas * (wide ? 0.15 : 0.15) + a.dri * (wide ? 0.05 : 0.10);
  }

  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) {
    const attacking = ['CAM', 'LM', 'RM'].includes(pos);
    return a.pas * (attacking ? 0.32 : 0.42) +
      a.dri * 0.24 +
      a.phy * 0.14 +
      a.sho * (attacking ? 0.18 : 0.08) +
      a.pac * 0.08 +
      a.def * (attacking ? 0.04 : 0.04);
  }

  return a.sho * 0.42 + a.pac * 0.22 + a.dri * 0.23 + a.pas * 0.13;
}

function tacticalCompatibility(player: any, style: string, mentality: string): number {
  const a = player.attributes || {};
  let bonus = 0;
  if (style === 'Possession') bonus += (a.pas - 70) * 0.10 + (a.dri - 70) * 0.08;
  if (style === 'High Press') bonus += (a.pac - 70) * 0.10 + (a.phy - 70) * 0.08 + (a.def - 70) * 0.05;
  if (style === 'Counter Attack') bonus += (a.pac - 70) * 0.13 + (a.sho - 70) * 0.08;
  if (style === 'Low Block') bonus += (a.def - 70) * 0.13 + (a.phy - 70) * 0.10;
  if (style === 'Long Ball') bonus += (a.phy - 70) * 0.10 + (a.pac - 70) * 0.07 + (a.sho - 70) * 0.05;
  if (style === 'Aggressive') bonus += (a.sho - 70) * 0.08 + (a.pac - 70) * 0.06;

  if (mentality === 'Aggressive') bonus += (a.sho - 70) * 0.05 + (a.pac - 70) * 0.03;
  if (mentality === 'Defensive') bonus += (a.def - 70) * 0.05 + (a.phy - 70) * 0.03;
  return bonus;
}

function bestFormationPlayerValue(player: any, manager: Manager): { score: number; position: Position } {
  const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
  const candidates = config.slots.filter((slot: any) =>
    slot.category === player.category || (slot.category !== 'GK' && player.category !== 'GK')
  );
  const pool = candidates.length ? candidates : config.slots;
  let best: { score: number; position: Position } = { score: -Infinity, position: player.position as Position };

  for (const slot of pool) {
    const fit = calculatePositionFit(player.position, player.alternatePositions || [], slot.position);
    const meta = playerMetaScore(player, slot.position);
    const tactical = tacticalCompatibility(player, manager.tactics?.style || 'Balanced', manager.tactics?.mentality || 'Balanced');
    const score = meta * (0.72 + fit / 100 * 0.28) + tactical;
    if (score > best.score) best = { score, position: slot.position };
  }
  return best;
}

function autoFillManagerLineup(manager: Manager) {
  const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
  if (manager.squad.length < 11) return;

  const remaining = [...manager.squad];
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
    const chosen = [...pool].sort(
      (a, b) => playerSlotScore(b.player, slot) - playerSlotScore(a.player, slot) || b.player.overall - a.player.overall
    )[0];
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

  manager.squad = starters.sort((a, b) => (a.startingSlotIndex ?? 99) - (b.startingSlotIndex ?? 99)).slice(0, 11);
  manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
  manager.roles = setupManagerRoles(manager.squad);
}

function normalizeRoomToXI(room: GameRoom): boolean {
  let changed = false;

  for (const manager of room.managers) {
    if (manager.squad.length > 11) {
      // Migrate legacy 18-player saves by rebuilding the starting XI from the
      // existing owned players. This removes substitutes without inventing players.
      autoFillManagerLineup(manager);
      changed = true;
    } else if (manager.squad.length === 11) {
      const normalized = manager.squad.map(entry => ({
        ...entry,
        isStarting: true,
        benchIndex: undefined,
      }));
      if (normalized.some((entry, index) =>
        entry.isStarting !== manager.squad[index].isStarting ||
        entry.benchIndex !== manager.squad[index].benchIndex
      )) {
        manager.squad = normalized;
        manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
        manager.roles = setupManagerRoles(manager.squad);
        changed = true;
      }
    }
  }

  if (changed) {
    // Any pending offer involving a removed legacy substitute is no longer valid.
    room.transferOffers = room.transferOffers.map(offer => {
      if (offer.status !== 'pending') return offer;
      const sender = room.managers.find(m => m.id === offer.fromManagerId);
      const target = room.managers.find(m => m.id === offer.toManagerId);
      const stillOwned =
        sender?.squad.some(s => s.player.id === offer.offeredPlayerId) &&
        target?.squad.some(s => s.player.id === offer.requestedPlayerId);
      return stillOwned ? offer : { ...offer, status: 'cancelled' };
    });
    room.updatedAt = Date.now();
  }

  return changed;
}

// Unbiased Fisher–Yates shuffle.
function shuffleArray<T>(input: T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateValidSquad(formation: Formation, availablePool: any[]): SquadPlayerEntry[] {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const shuffled = shuffleArray(availablePool);
  const usedIds = new Set<string>();
  const squad: SquadPlayerEntry[] = [];

  // Fill exactly the formation's starting XI. There are no substitutes.
  for (const slot of config.slots) {
    const candidates = shuffled
      .filter(p => !usedIds.has(p.id) && (slot.category === 'GK' ? p.category === 'GK' : p.category !== 'GK'))
      .sort((a, b) => playerSlotScore(b, slot) - playerSlotScore(a, slot) || b.overall - a.overall);
    const chosen = candidates[0];
    if (!chosen) continue;
    usedIds.add(chosen.id);
    squad.push({
      player: chosen,
      isStarting: true,
      startingSlotIndex: slot.index,
      benchIndex: undefined,
      assignedPosition: slot.position,
      condition: createFitCondition(),
    });
  }

  return squad.slice(0, 11);
}

// Auction runs in four synchronized blocks: GK -> DEF -> MID -> ATT.
// Once every manager has the exact 11-player squad, the auction ends.
function getAuctionCategoryForStage(room: GameRoom): PositionCategory | null {
  const ordered: PositionCategory[] = ['GK', 'DEF', 'MID', 'ATT'];
  for (const category of ordered) {
    const needsCategory = room.managers.some(manager => {
      const required = getFormationStarterCategoryCounts(manager.formation)[category];
      const count = manager.squad.filter(entry => entry.player.category === category).length;
      return count < required;
    });
    if (needsCategory) return category;
  }
  return null;
}

// Centralized Auction Engine
function emergencyFillRemainingXI(room: GameRoom, unowned: any[]) {
  // Safety net: if the auction has no legally usable lots left, never leave the
  // room stuck in the auction forever. Fill only missing XI slots from the
  // remaining unowned pool, prioritising formation/position fit. This is an
  // emergency fallback; normal auctions still enforce category quotas and bids.
  const available = [...unowned];
  for (const manager of room.managers) {
    while (manager.squad.length < 11 && available.length > 0) {
      const config = FORMATIONS_CONFIG[manager.formation] || FORMATIONS_CONFIG['4-3-3'];
      const missingSlots = config.slots.filter((slot: any) =>
        !manager.squad.some(entry => entry.startingSlotIndex === slot.index)
      );
      const slot = missingSlots[0] || config.slots[manager.squad.length % config.slots.length];
      const chosen = [...available].sort((a, b) =>
        playerSlotScore(b, slot) - playerSlotScore(a, slot) || b.overall - a.overall
      )[0];
      if (!chosen) break;
      const idx = available.findIndex(p => p.id === chosen.id);
      if (idx >= 0) available.splice(idx, 1);
      manager.squad.push({
        player: chosen,
        isStarting: true,
        startingSlotIndex: slot.index,
        benchIndex: undefined,
        assignedPosition: slot.position,
        condition: createFitCondition(),
      });
      manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
    }
    if (manager.squad.length === 11) {
      manager.roles = setupManagerRoles(manager.squad);
    }
  }
}

function advanceAuction(room: GameRoom) {
  if (room.phase !== 'auction') return;

  const pool = getPlayersForLobby(room.settings.playerPool, room.settings.era);
  // Find players not already owned by any manager in this room.
  const ownedIds = new Set<string>();
  for (const m of room.managers) {
    for (const s of m.squad) ownedIds.add(s.player.id);
  }

  // Every manager must complete the exact 11-player XI.
  const allFull = room.managers.every(m => m.squad.length >= 11);
  if (allFull) {
    room.managers.forEach(autoFillManagerLineup);
    enterTeamManagement(room);
    broadcastRoom(room.code);
    return;
  }

  const unowned = pool.filter(p => !ownedIds.has(p.id));
  if (unowned.length === 0) {
    emergencyFillRemainingXI(room, unowned);
    room.managers.forEach(autoFillManagerLineup);
    enterTeamManagement(room);
    broadcastRoom(room.code);
    return;
  }

  // Auction order is a strict positional progression:
  // GK -> DEF -> MID -> ATT.
  // A category is not left until every manager has filled that category's
  // formation quota. Once only ONE manager is still missing that category,
  // the next suitable player is a forced purchase for that manager.
  const orderedCategories: PositionCategory[] = ['GK', 'DEF', 'MID', 'ATT'];
  const neededCategories = orderedCategories.filter(category =>
    room.managers.some(manager => {
      const required = getFormationStarterCategoryCounts(manager.formation)[category];
      const count = manager.squad.filter(entry => entry.player.category === category).length;
      return count < required;
    })
  );

  const starterStage = neededCategories.find(category =>
    unowned.some(p =>
      p.category === category &&
      room.managers.some(manager => {
        const required = getFormationSquadCategoryLimits(manager.formation)[category];
        const count = manager.squad.filter(entry => entry.player.category === category).length;
        return count < required && manager.budget >= p.startingPrice;
      })
    )
  ) || null;

  // Prefer players that can legally be bought by at least one manager in the
  // active positional stage. This prevents the auction from stalling on a lot
  // nobody can use or afford.
  const eligibleCandidates = unowned.filter(p =>
    room.managers.some(manager => {
      if (manager.squad.length >= 11 || manager.budget < p.startingPrice) return false;
      const limits = getFormationSquadCategoryLimits(manager.formation);
      const count = manager.squad.filter(entry => entry.player.category === p.category).length;
      return count < limits[p.category];
    })
  );

  const auctionCandidates = (starterStage
    ? eligibleCandidates.filter(p => p.category === starterStage)
    : eligibleCandidates);

  if (auctionCandidates.length === 0) {
    emergencyFillRemainingXI(room, unowned);
    room.managers.forEach(autoFillManagerLineup);
    enterTeamManagement(room);
    broadcastRoom(room.code);
    return;
  }

  // If exactly one manager is still missing the active category, choose a
  // player that manager can afford and mark the lot as a mandatory signing.
  // The client disables normal bidding and the server awards it at the
  // starting price when the short forced-purchase timer expires.
  const stageManagers = starterStage
    ? room.managers.filter(manager => {
        const required = getFormationStarterCategoryCounts(manager.formation)[starterStage];
        const count = manager.squad.filter(entry => entry.player.category === starterStage).length;
        return count < required && manager.squad.length < 11;
      })
    : [];

  const forcedManager = stageManagers.length === 1 ? stageManagers[0] : null;
  const forcedCandidates = forcedManager
    ? auctionCandidates.filter(player => forcedManager.budget >= Math.max(1, Number(player.marketValue) || 1))
    : [];

  const selectedPlayer = (forcedManager && forcedCandidates.length > 0
    ? forcedCandidates[Math.floor(Math.random() * forcedCandidates.length)]
    : auctionCandidates[Math.floor(Math.random() * auctionCandidates.length)]);
  // Auction lots always start at £1M. Keep legacy/imported player values from
  // leaking into the live auction after a reconnect or old room snapshot.
  const nextPlayer = {
    ...selectedPlayer,
    startingPrice: 1,
  };

  const forcedMarketPrice = Math.max(1, Number(nextPlayer.marketValue) || 1);
  const isForcedPurchase = Boolean(
    forcedManager &&
    nextPlayer.category === starterStage &&
    forcedManager.budget >= forcedMarketPrice
  );

  const isQuick = room.settings.auctionMode === 'Quick';
  const duration = isForcedPurchase
    ? 4
    : (isQuick ? 8 : (room.settings.auctionMode === 'Blind' ? 15 : 12));

  // Lot number must advance even when a player receives no bids.
  // Using auctionHistory.length caused the UI to repeat the same "Lot X"
  // after every NO VALID BIDS lot.
  const previousLot = Number.isFinite(Number(room.auction.currentPlayerIndex))
    ? Number(room.auction.currentPlayerIndex)
    : 0;

  room.auction = {
    currentPlayerIndex: previousLot + 1,
    totalPlayersInPool: pool.length,
    currentPlayer: nextPlayer,
    currentBid: nextPlayer.startingPrice,
    highestBidderId: null,
    highestBidderName: null,
    secondsRemaining: duration,
    auctionEndsAt: Date.now() + duration * 1000,
    isPaused: false,
    isSold: false,
    winnerId: null,
    soldPrice: 0,
    auctionHistory: room.auction.auctionHistory,
    blindClues: room.settings.auctionMode === 'Blind' ? createBlindAuctionClues(nextPlayer) : undefined,
    forcedWinnerId: isForcedPurchase ? forcedManager!.id : null,
    forcedWinnerName: isForcedPurchase ? forcedManager!.name : null,
    forcedPurchasePrice: isForcedPurchase ? forcedMarketPrice : undefined,
    isForcedPurchase,
  };

  blindSecretBids.set(room.code, {});

  if (auctionIntervals.has(room.code)) {
    clearInterval(auctionIntervals.get(room.code)!);
  }

  broadcastRoom(room.code);
  ensureAuctionTicker(room);
}

function ensureAuctionTicker(room: GameRoom) {
  if (room.phase !== 'auction' || room.auction.isSold || room.auction.isPaused) return;
  if (auctionIntervals.has(room.code)) return;

  // Backward compatibility for snapshots created before auctionEndsAt existed.
  if (!room.auction.auctionEndsAt) {
    room.auction.auctionEndsAt = Date.now() + Math.max(0, room.auction.secondsRemaining) * 1000;
  }

  let lastBroadcastRemaining = -1;

  const timer = setInterval(() => {
    const currentR = rooms.get(room.code);
    if (!currentR || currentR.phase !== 'auction' || currentR.auction.isSold) {
      clearInterval(timer);
      auctionIntervals.delete(room.code);
      return;
    }
    if (currentR.auction.isPaused) return;

    const deadline = currentR.auction.auctionEndsAt || Date.now();
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const remainingChanged = remaining !== currentR.auction.secondsRemaining;
    currentR.auction.secondsRemaining = remaining;

    // Bots participate in every auction mode. Blind-mode bots submit private
    // bids based on their hidden player valuation.
    if (remaining > 2) {
      if (currentR.settings.auctionMode === 'Blind') {
        simulateBotBlindBids(currentR);
      } else {
        simulateBotBids(currentR);
      }
    }

    if (remaining <= 0) {
      clearInterval(timer);
      auctionIntervals.delete(currentR.code);
      finalizeAuctionItem(currentR);
      return;
    }

    // The browser derives the live countdown from auctionEndsAt, so the server
    // only needs to broadcast once per displayed second. This dramatically
    // reduces WebSocket traffic and snapshot writes without changing timing.
    if (remainingChanged || lastBroadcastRemaining !== remaining) {
      lastBroadcastRemaining = remaining;
      broadcastRoom(currentR.code, undefined, false);
    }
  }, 250);

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

function simulateBotBlindBids(room: GameRoom) {
  const currentPl = room.auction.currentPlayer;
  if (!currentPl) return;

  const bids = blindSecretBids.get(room.code) || {};

  for (const bot of room.managers.filter(m => m.isBot && m.squad.length < 11)) {
    // One secret bid per lot. Repeated timer ticks must not overwrite it.
    if (bids[bot.id] !== undefined) continue;
    if (bot.budget < currentPl.startingPrice) continue;

    const limits = getFormationSquadCategoryLimits(bot.formation);
    const categoryCount = bot.squad.filter(s => s.player.category === currentPl.category).length;
    if (categoryCount >= limits[currentPl.category]) continue;

    // Blind auction uses the same meta model, but bots can privately inspect
    // the hidden player while humans only see the two clues.
    const meta = bestFormationPlayerValue(currentPl, bot);
    const roleFit = calculatePositionFit(currentPl.position, currentPl.alternatePositions || [], meta.position);
    const tacticalValue = tacticalCompatibility(
      currentPl,
      bot.tactics?.style || 'Balanced',
      bot.tactics?.mentality || 'Balanced'
    );
    // OVR/stats/role/tactics determine auction value. Market value is never used.
    const statAverage = Object.values(currentPl.attributes || {}).reduce((sum, value) => sum + Number(value || 0), 0) / 6;
    const ovrPremium = Math.max(0, currentPl.overall - 80) * 3;
    const statPremium = Math.max(0, statAverage - 70) * 0.45;
    const rolePremium = roleFit * 0.08;
    const valuation = Math.max(
      currentPl.startingPrice,
      Math.min(
        bot.budget,
        currentPl.startingPrice + ovrPremium + statPremium + rolePremium + tacticalValue
      )
    );

    // Different bots get slightly different risk appetites so Solo games don't
    // feel deterministic.
    const personality = 0.85 + ((bot.id.length * 17) % 31) / 100;
    const bid = Math.floor(Math.min(bot.budget, valuation * personality));

    if (bid >= currentPl.startingPrice && Math.random() < 0.42) {
      bids[bot.id] = bid;
    }
  }

  blindSecretBids.set(room.code, bids);

  const submitted = Object.keys(bids).length;
  if (submitted > 0) broadcastRoom(room.code);
}

function simulateBotBids(room: GameRoom) {
  const currentPl = room.auction.currentPlayer;
  if (!currentPl) return;

  const bots = room.managers.filter(m => m.isBot && m.squad.length < 11);
  for (const bot of bots) {
    // A bidder never needs to outbid itself. This also prevents bots from
    // unnecessarily draining their own budget near the end of a lot.
    if (room.auction.highestBidderId === bot.id) continue;

    // Check if bot can afford
    const bidStep = getBidStep(room.auction.currentBid);
    const minNextBid = getMinNextBid(room.auction.currentBid, Boolean(room.auction.highestBidderId));
    if (bot.budget < minNextBid) continue;

    // Formation slots are flexible, but category limits still protect the squad shape.
    const botLimits = getFormationSquadCategoryLimits(bot.formation);
    if (bot.squad.filter(s => s.player.category === currentPl.category).length >= botLimits[currentPl.category]) continue;

    // Meta valuation: the bot evaluates the player's best role in its formation,
    // then adjusts for its chosen tactical style/mentality. OVR is only a small
    // sanity signal instead of the main pricing mechanism.
    const meta = bestFormationPlayerValue(currentPl, bot);
    const roleFit = calculatePositionFit(currentPl.position, currentPl.alternatePositions || [], meta.position);
    const tacticalValue = Math.max(-12, Math.min(12,
      tacticalCompatibility(currentPl, bot.tactics?.style || 'Balanced', bot.tactics?.mentality || 'Balanced')
    ));
    // Blind auction uses the same OVR/stats/role model; no market-value multiplier.
    const statAverage = Object.values(currentPl.attributes || {}).reduce((sum, value) => sum + Number(value || 0), 0) / 6;
    const ovrPremium = Math.max(0, currentPl.overall - 80) * 3;
    const statPremium = Math.max(0, statAverage - 70) * 0.45;
    const maxValuation = Math.max(
      currentPl.startingPrice,
      Math.min(
        bot.budget,
        currentPl.startingPrice + ovrPremium + statPremium + meta.score * 0.08 + roleFit * 0.08 + tacticalValue
      )
    );

    // Scarcity matters: bots spend more aggressively when they still need a role.
    const targetNeed = Math.max(0, 11 - bot.squad.length);
    const scarcityMultiplier = 1 + Math.min(0.18, targetNeed * 0.015);
    const adjustedValuation = Math.min(bot.budget, maxValuation * scarcityMultiplier);

    if (minNextBid <= adjustedValuation && Math.random() < 0.34) {
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
  if (!player || room.auction.isSold) return;

  // Close the bidding window immediately. This makes finalization idempotent
  // and prevents a late client message from reopening/changing the auction.
  room.auction.isSold = true;

  // A forced positional lot has no bidding: the only remaining manager
  // who still needs this category must receive the player at the starting price.
  let winnerId = room.auction.isForcedPurchase
    ? room.auction.forcedWinnerId || null
    : room.auction.highestBidderId;
  let finalPrice = room.auction.isForcedPurchase
    ? Math.max(1, Number(player.marketValue) || 1)
    : room.auction.currentBid;

  // Handle blind auction secret bids. Forced lots bypass secret bidding because
  // the recipient is already determined by the positional quota.
  if (room.settings.auctionMode === 'Blind' && !room.auction.isForcedPurchase) {
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
    const winnerLimits = winner ? getFormationSquadCategoryLimits(winner.formation) : null;
    const winnerCategoryCount = winner
      ? winner.squad.filter(s => s.player.category === player.category).length
      : 0;
    if (
      winner &&
      winner.budget >= finalPrice &&
      winner.squad.length < 11 &&
      winnerLimits &&
      winnerCategoryCount < winnerLimits[player.category]
    ) {
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
    } else {
      // A stale/invalid winner can occur after reconnects or legacy-room
      // migration. Never expose a winner who did not actually receive the player.
      winnerId = null;
      room.auction.winnerId = null;
      room.auction.soldPrice = 0;
    }
  }

  broadcastRoom(room.code);

  // IMPORTANT: do not rely on a long-lived serverless timer to move the auction.
  // Vercel can suspend the function after the response, which previously left
  // rooms permanently stuck on the SOLD / NO VALID BIDS screen.
  const finishedPlayerId = player.id;
  setTimeout(() => {
    try {
      const currentRoom = rooms.get(room.code);
      if (!currentRoom || currentRoom.phase !== 'auction') return;

      // Never let an old finalization timer overwrite a newer auction lot.
      if (currentRoom.auction.currentPlayer?.id !== finishedPlayerId || !currentRoom.auction.isSold) {
        return;
      }

      if (currentRoom.managers.every(m => m.squad.length >= 11)) {
        currentRoom.managers.forEach(autoFillManagerLineup);
      }

      advanceAuction(currentRoom);
    } catch (error) {
      console.error('[AUCTION] Failed to advance after finalization:', error);

      // Last-resort recovery: fill remaining XI slots and leave the auction
      // instead of trapping every player on a dead SOLD screen.
      try {
        const currentRoom = rooms.get(room.code);
        if (!currentRoom || currentRoom.phase !== 'auction') return;
        const pool = getPlayersForLobby(currentRoom.settings.playerPool, currentRoom.settings.era);
        const owned = new Set(currentRoom.managers.flatMap(m => m.squad.map(s => s.player.id)));
        emergencyFillRemainingXI(currentRoom, pool.filter(p => !owned.has(p.id)));
        currentRoom.managers.forEach(autoFillManagerLineup);
        currentRoom.phase = 'team_management';
        currentRoom.phaseReadyIds = currentRoom.managers.filter(m => m.isBot).map(m => m.id);
        broadcastRoom(currentRoom.code);
      } catch (recoveryError) {
        console.error('[AUCTION] Emergency recovery failed:', recoveryError);
      }
    }
  }, 1200);
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
  matchday: number,
  initialSeeding = false
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
    const awayIndex = initialSeeding
      ? bracketSize - 1 - i
      : i * 2 + 1;
    const away = slots[awayIndex];
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
  const fixtures = buildKnockoutFixtures(qualifiers, firstRound, 1, true);
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
    // Keep the finished result available to currently connected clients, but
    // never retain completed games in durable storage.
    void deletePersistedRoomSnapshot(room.code).catch(error => console.error('[persistence] room deletion failed:', error));
    return;
  }

  const firstRound = qualifiers === 8 ? 'Quarter-Final' : qualifiers === 4 ? 'Semi-Final' : 'Final';
  const fixtures = buildKnockoutFixtures(ranked, firstRound, room.currentMatchday + 1, true);

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
  if (!SUPPORTED_FORMATIONS.has(formation)) return null;
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
  const currentTactics = manager.tactics || {
    style: 'Balanced',
    mentality: 'Balanced',
    defensiveLine: 50,
    pressingIntensity: 50,
    attackWidth: 50,
    tempo: 50,
    risk: 50,
  };
  const nextTactics = tactics ? {
    style: allowedStyles.has(tactics.style) ? tactics.style : currentTactics.style,
    mentality: allowedMentalities.has(tactics.mentality) ? tactics.mentality : currentTactics.mentality || 'Balanced',
    defensiveLine: clampFiniteNumber(tactics.defensiveLine, currentTactics.defensiveLine, 1, 100),
    pressingIntensity: clampFiniteNumber(tactics.pressingIntensity, currentTactics.pressingIntensity, 1, 100),
    attackWidth: clampFiniteNumber(tactics.attackWidth, currentTactics.attackWidth, 1, 100),
    tempo: clampFiniteNumber(tactics.tempo, currentTactics.tempo, 1, 100),
    risk: clampFiniteNumber(tactics.risk, currentTactics.risk, 1, 100),
  } : currentTactics;

  const starterIds = new Set(manager.squad.filter(s => s.isStarting).map(s => s.player.id));
  const outfieldStarterIds = new Set(
    manager.squad
      .filter(s => s.isStarting && s.player.category !== 'GK')
      .map(s => s.player.id)
  );
  const currentRoles = manager.roles || {
    captainId: '',
    penaltyTakerId: '',
    freeKickTakerId: '',
    cornerTakerId: '',
  };
  const nextRoles = roles ? {
    captainId: starterIds.has(roles.captainId) ? roles.captainId : currentRoles.captainId,
    // Goalkeepers are never valid penalty takers in the default role system.
    penaltyTakerId: outfieldStarterIds.has(roles.penaltyTakerId) ? roles.penaltyTakerId : currentRoles.penaltyTakerId,
    freeKickTakerId: outfieldStarterIds.has(roles.freeKickTakerId) ? roles.freeKickTakerId : currentRoles.freeKickTakerId,
    cornerTakerId: outfieldStarterIds.has(roles.cornerTakerId) ? roles.cornerTakerId : currentRoles.cornerTakerId,
  } : currentRoles;

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
  return room.phase === 'league' &&
    room.transferWindowOpen === true &&
    room.currentMatchday === (room.transferWindowMatchday || 0);
}

function getMidSeasonWindowMatchday(room: GameRoom): number {
  if (room.totalMatchdays <= 1) return 0;
  return Math.ceil(room.totalMatchdays / 2);
}

function openMidSeasonWindow(room: GameRoom) {
  const windowMatchday = getMidSeasonWindowMatchday(room);
  if (!windowMatchday || room.transferWindowOpen) return false;
  room.transferWindowOpen = true;
  room.transferWindowMatchday = windowMatchday;
  room.transferWindowReadyIds = room.managers.filter(m => m.isBot).map(m => m.id);
  room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
  ensurePhaseReadyTicker(room);
  room.updatedAt = Date.now();
  return true;
}

function maybeCloseMidSeasonWindow(room: GameRoom): boolean {
  if (!room.transferWindowOpen) return false;
  const humanIds = room.managers.filter(m => !m.isBot).map(m => m.id);
  const ready = new Set(room.transferWindowReadyIds || []);
  if (!humanIds.every(id => ready.has(id))) return false;
  room.transferWindowOpen = false;
  room.transferWindowReadyIds = [];
  room.transferWindowMatchday = undefined;
  clearPhaseReadyTimer(room);
  return true;
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
    name: sanitizeManagerName(managerName, 'Solo Manager'),
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
    competitionFormat: 'League',
  };

  const room: GameRoom = {
    code: roomCode,
    hostId,
    settings,
    phase: 'formation_select',
    isSolo: true,
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
    transferWindowOpen: false,
    transferWindowReadyIds: [],
    phaseReadyIds: managers.filter(m => m.isBot).map(m => m.id),
    awards: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  rooms.set(roomCode, room);
  void saveRoomSnapshot(room).catch(error => console.error('[persistence] room save failed:', error));

  return { roomCode, managerId: hostId, room };
}

function normalizeLegacyPlayerNames(room: GameRoom) {
  const normalize = (value: unknown) => {
    const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
    const quoted = raw.match(/"([^"]+)"/);
    return quoted?.[1]?.trim() || raw;
  };

  for (const manager of room.managers) {
    manager.name = sanitizeManagerName(manager.name, 'Manager');
    for (const entry of manager.squad) {
      entry.player.name = normalize(entry.player.name);
      entry.player.startingPrice = 1;
      if (!Number.isFinite(entry.player.marketValue) || entry.player.marketValue < 0) {
        entry.player.marketValue = 0;
      }
    }
  }

  if (room.auction.currentPlayer) {
    room.auction.currentPlayer.name = normalize(room.auction.currentPlayer.name);
    room.auction.currentPlayer.startingPrice = 1;
    room.auction.currentBid = Math.max(1, Number(room.auction.currentBid) || 1);
  }
}

function repairManagersForMatch(room: GameRoom) {
  normalizeLegacyPlayerNames(room);
  const pool = getPlayersForLobby(room.settings.playerPool, room.settings.era);
  let owned = new Set(room.managers.flatMap(m => m.squad.map(s => s.player.id)));

  // Only repair genuinely corrupted legacy/reconnect states. A valid custom XI is
  // never replaced, so tactical changes cannot mysteriously revert before a match.
  for (const manager of room.managers) {
    if (manager.squad.length < 11) {
      emergencyFillRemainingXI(room, pool.filter(p => !owned.has(p.id)));
      owned = new Set(room.managers.flatMap(m => m.squad.map(s => s.player.id)));
      break;
    }
  }

  for (const manager of room.managers) {
    const starters = manager.squad.filter(s => s.isStarting).length;
    const validation = manager.squad.length === 11
      ? validateSquadFormation(manager.formation, manager.squad)
      : { isValid: false };
    if (manager.squad.length === 11 && (!validation.isValid || starters !== 11)) {
      autoFillManagerLineup(manager);
    }
    manager.teamOverall = calculateTeamOverall(manager.formation, manager.squad);
  }
}

// WebSocket Connection Handler
wss.on('connection', (ws, request) => {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const clientIp = forwardedFor || request.socket.remoteAddress || 'unknown';
  const currentConnections = wsConnectionCounts.get(clientIp) || 0;
  if (currentConnections >= MAX_WS_CONNECTIONS_PER_IP) {
    ws.close(1013, 'Too many connections from this address');
    return;
  }
  wsConnectionCounts.set(clientIp, currentConnections + 1);
  const initialSocketRoom = socketToRoom.get(ws);
  if (initialSocketRoom) roomDisconnectedAt.delete(initialSocketRoom.roomCode);

  socketAlive.set(ws, true);
  ws.on('pong', () => socketAlive.set(ws, true));

  let messageWindowStartedAt = Date.now();
  let messageCount = 0;

  ws.on('message', async (messageRaw) => {
    const now = Date.now();
    if (now - messageWindowStartedAt >= 1000) {
      messageWindowStartedAt = now;
      messageCount = 0;
    }
    messageCount += 1;
    if (messageCount > 40) {
      sendSocketError(ws, 'Too many messages. Slow down.');
      return;
    }
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
            const soloManager = result.room.managers.find(m => m.id === result.managerId);
            const reconnectToken = soloManager ? setReconnectCredential(soloManager) : '';
            // Persist the credential hash before returning the session so refresh/recovery works.
            await saveRoomSnapshot(result.room);
            if (!roomSockets.has(result.roomCode)) {
              roomSockets.set(result.roomCode, new Set());
            }
            roomSockets.get(result.roomCode)!.add(ws);
            socketToRoom.set(ws, { roomCode: result.roomCode, managerId: result.managerId });
            ws.send(JSON.stringify({
              type: 'LOBBY_CREATED',
              roomCode: result.roomCode,
              managerId: result.managerId,
              reconnectToken,
              room: sanitizeRoomForViewer(result.room, result.managerId),
            }));
            break;
          }

          const roomCode = generateLobbyCode();
          const hostId = newId('mgr');
          const safeName = sanitizeManagerName(managerName, 'Host Manager');
          const settings = sanitizeLobbySettings(requestedSettings);

          const hostManager: Manager = {
            id: hostId,
            name: safeName,
            isHost: true,
            isBot: false,
            isReady: true,
            budget: settings.startingBudget,
            initialBudget: settings.startingBudget,
            formation: SUPPORTED_FORMATIONS.has(soloFormation as Formation) ? soloFormation as Formation : '4-3-3',
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

          const room: GameRoom = {
            code: roomCode,
            hostId,
            settings,
            phase: 'lobby',
            managers,
            auction: {
              currentPlayerIndex: 0,
              totalPlayersInPool: getPlayersForLobby(settings.playerPool, settings.era).length,
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
            phaseReadyIds: [],
            awards: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const hostReconnectToken = setReconnectCredential(hostManager);
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
            reconnectToken: hostReconnectToken,
            room: sanitizeRoomForViewer(room, hostId),
          }));
          break;
        }

        // --- 2. JOIN LOBBY ---
        case 'JOIN_LOBBY': {
          const { roomCode, managerName, reconnectId, reconnectToken } = payload;
          const normalizedRoomCode = roomCode?.toUpperCase();
          let room = rooms.get(normalizedRoomCode);
          if (!room && normalizedRoomCode) {
            room = await loadRoomSnapshot(normalizedRoomCode) || undefined;
            if (room) {
              normalizeLegacyPlayerNames(room);
              if (normalizeRoomToXI(room)) await saveRoomSnapshot(room);
              if (['lobby', 'formation_select', 'team_management'].includes(room.phase) && !room.phaseReadyDeadline && room.managers.length >= 2) {
                room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
                ensurePhaseReadyTicker(room);
              }
              rooms.set(normalizedRoomCode, room);
            }
          }

          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Lobby not found. Please verify the code.' }));
            return;
          }

          // Reconnection is identity-based. Never allow a name alone to impersonate
          // an existing manager.
          let existing = reconnectToken
            ? room.managers.find(m => matchesReconnectCredential(m, reconnectToken))
            : null;

          // Backward compatibility: some browsers may have a saved manager ID
          // from before reconnect tokens were introduced. The manager ID is not
          // shown publicly, and the supplied manager name must also match before
          // we migrate that session to a fresh cryptographic token.
          if (!existing && reconnectId) {
            const legacy = room.managers.find(m => m.id === reconnectId);
            const suppliedName = sanitizeManagerName(managerName, '');
            if (
              legacy &&
              suppliedName &&
              legacy.name.toLowerCase() === suppliedName.toLowerCase()
            ) {
              existing = legacy;
              setReconnectCredential(existing);
            }
          }

          if (existing) {
            const tokenForClient = reconnectToken && matchesReconnectCredential(existing, reconnectToken)
              ? reconnectToken
              : setReconnectCredential(existing);
            // A reconnect may land on a fresh Vercel Function instance. Resume
            // the in-memory ticker from the persisted absolute deadline.
            ensureAuctionTicker(room);
            ensurePhaseReadyTicker(room);
            if (!roomSockets.has(room.code)) roomSockets.set(room.code, new Set());
            roomSockets.get(room.code)!.add(ws);
            socketToRoom.set(ws, { roomCode: room.code, managerId: existing.id });
            ws.send(JSON.stringify({
              type: 'LOBBY_JOINED',
              roomCode: room.code,
              managerId: existing.id,
              reconnectToken: tokenForClient,
              room: sanitizeRoomForViewer(room, existing.id),
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
          const safeManagerName = sanitizeManagerName(managerName, '');
          if (!safeManagerName) {
            sendSocketError(ws, 'Manager name is required.');
            return;
          }
          if (room.managers.some(m => m.name.toLowerCase() === safeManagerName.toLowerCase())) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'A manager with this name is already in the lobby.' }));
            return;
          }

          const newManagerId = newId('mgr');
          const newManager: Manager = {
            id: newManagerId,
            name: safeManagerName,
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

          const newManagerReconnectToken = setReconnectCredential(newManager);
          room.managers.push(newManager);
          room.leagueTable = calculateInitialTable(room.managers);
          if (room.managers.length >= 2 && room.phase === 'lobby' && !room.phaseReadyDeadline) {
            room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
            ensurePhaseReadyTicker(room);
          }

          if (!roomSockets.has(room.code)) roomSockets.set(room.code, new Set());
          roomSockets.get(room.code)!.add(ws);
          socketToRoom.set(ws, { roomCode: room.code, managerId: newManagerId });

          await saveRoomSnapshot(room);
          ws.send(JSON.stringify({
            type: 'LOBBY_JOINED',
            roomCode: room.code,
            managerId: newManagerId,
            reconnectToken: newManagerReconnectToken,
            room: sanitizeRoomForViewer(room, newManagerId),
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
          const sanitizedSettings = sanitizeLobbySettings(settings, room.settings);
          room.settings = {
            ...sanitizedSettings,
            maxManagers: Math.max(room.managers.length, sanitizedSettings.maxManagers),
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
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (room.phase !== 'lobby') return;

          const manager = room.managers.find(m => m.id === session.managerId);
          if (manager) {
            manager.isReady = !manager.isReady;
            broadcastRoom(room.code);
          }
          break;
        }

        // --- 5. DELETE LOBBY (HOST ONLY) ---
        case 'DELETE_LOBBY': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) {
            sendSocketError(ws, 'Unauthorized lobby deletion.');
            return;
          }

          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can delete this lobby.');
            return;
          }

          const auctionTimer = auctionIntervals.get(room.code);
          if (auctionTimer) clearInterval(auctionTimer);
          auctionIntervals.delete(room.code);
          clearPhaseReadyTimer(room);
          blindSecretBids.delete(room.code);

          const sockets = roomSockets.get(room.code) || new Set<WebSocket>();
          rooms.delete(room.code);
          roomSockets.delete(room.code);

          for (const client of sockets) {
            socketToRoom.delete(client);
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'LOBBY_DELETED', message: 'Lobby deleted by host.' }));
              client.close();
            }
          }

          await deletePersistedRoomSnapshot(room.code);
          break;
        }

        // --- 5. KICK PLAYER ---
        case 'KICK_PLAYER': {
          const { roomCode, targetManagerId } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          const resolvedTargetId = resolveManagerId(room, targetManagerId);
          if (!resolvedTargetId || !isRoomHost(room, session.managerId) || resolvedTargetId === room.hostId) {
            sendSocketError(ws, 'Only the host can kick another manager.');
            return;
          }
          const target = resolvedTargetId ? room.managers.find(m => m.id === resolvedTargetId) : undefined;
          if (!target || target.isHost) {
            sendSocketError(ws, 'That manager cannot be kicked.');
            return;
          }

          // Host removal is allowed during every game phase. Clean the target out of
          // active auction/fixtures so the remaining room never references a kicked ID.
          if (room.auction?.highestBidderId === resolvedTargetId) {
            room.auction.highestBidderId = null;
            room.auction.highestBidderName = null;
            room.auction.currentBid = room.auction.currentPlayer?.startingPrice || 0;
          }

          if (room.phase === 'knockout' && room.knockoutStage) {
            for (const round of room.knockoutStage.rounds) {
              for (const fixture of round.fixtures) {
                if (fixture.played) continue;
                if (fixture.homeManagerId === resolvedTargetId && fixture.awayManagerId !== resolvedTargetId) {
                  fixture.played = true;
                  fixture.homeScore = 0;
                  fixture.awayScore = 3;
                  fixture.winnerManagerId = fixture.awayManagerId;
                } else if (fixture.awayManagerId === resolvedTargetId && fixture.homeManagerId !== resolvedTargetId) {
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
              f.played || (f.homeManagerId !== resolvedTargetId && f.awayManagerId !== resolvedTargetId)
            );
          }

          removeManagerFromRoom(room, resolvedTargetId);

          const sockets = roomSockets.get(room.code);
          if (sockets) {
            for (const client of [...sockets]) {
              const info = socketToRoom.get(client);
              if (info?.managerId === resolvedTargetId) {
                sockets.delete(client);
                socketToRoom.delete(client);
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'KICKED', message: 'You were removed from the game by the host.' }));
                  client.close();
                }
              }
            }
          }

          if (room.phase === 'lobby') {
            room.leagueTable = calculateInitialTable(room.managers);
          } else if (room.phase === 'league') {
            const existingRows = new Map(room.leagueTable.map(row => [row.managerId, row]));
            const freshRows = calculateInitialTable(room.managers);
            room.leagueTable = freshRows.map(row => existingRows.get(row.managerId) || row);
            room.leagueTable.sort((a, b) =>
              b.points - a.points ||
              b.goalDifference - a.goalDifference ||
              b.goalsFor - a.goalsFor ||
              a.managerName.localeCompare(b.managerName)
            );
          }
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

          if (room.managers.length < 2) {
            sendSocketError(ws, 'At least 2 managers are required. Use Solo Play for a one-manager game.');
            return;
          }

          // All players must be ready
          const allReady = room.managers.every(m => m.isReady || m.isBot);
          if (!allReady) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'All managers must be READY to start.' }));
            return;
          }

          enterFormationSelect(room);
          broadcastRoom(room.code);
          break;
        }

        // --- 7. FORMATION SELECT ---
        case 'SELECT_FORMATION': {
          const { roomCode, formation } = payload;
          // The socket session is the source of truth for identity. Do not trust
          // a stale managerId from the browser after a reconnect.
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (room.phase !== 'formation_select') return;

          const supportedFormations = Object.keys(FORMATIONS_CONFIG) as Formation[];
          if (!supportedFormations.includes(formation as Formation)) {
            sendSocketError(ws, 'That formation is not supported.');
            return;
          }

          const managerId = session.managerId;
          const manager = room.managers.find(m => m.id === session.managerId);
          if (manager) {
            manager.formation = formation as Formation;
            manager.confirmedTeam = false;
            manager.squad = [];
            manager.teamOverall = 0;
            room.phaseReadyIds = (room.phaseReadyIds || []).filter(id => id !== managerId);
            broadcastRoom(room.code);
          }
          break;
        }

        // --- 8. FORMATION READY / BEGIN AUCTION ---
        case 'FORMATION_READY': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'formation_select') return;
          const { room, session } = auth;
          const actorId = session.managerId;
          const manager = room.managers.find(m => m.id === actorId);
          if (!manager) return;
          const ready = new Set(room.phaseReadyIds || []);
          ready.add(actorId);
          room.phaseReadyIds = [...ready];
          if (allFormationReady(room)) {
            beginAuctionFromFormation(room);
          }
          broadcastRoom(room.code);
          break;
        }

        case 'BEGIN_AUCTION': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId) || room.phase !== 'formation_select') {
            sendSocketError(ws, 'Only the host can start the auction from formation setup.');
            return;
          }
          const allFormationReady = room.managers.every(m => m.isBot || (room.phaseReadyIds || []).includes(m.id));
          if (!allFormationReady) {
            sendSocketError(ws, 'Wait until every manager presses I\'M DONE with formation.');
            return;
          }

          const auctionPoolSize = getPlayersForLobby(room.settings.playerPool, room.settings.era).length;
          const requiredAuctionPlayers = room.managers.length * 11;
          if (auctionPoolSize < requiredAuctionPlayers) {
            sendSocketError(
              ws,
              `Not enough players in this pool for ${room.managers.length} managers (${auctionPoolSize} available, ${requiredAuctionPlayers} required). Choose Global or reduce the manager count.`
            );
            return;
          }

          beginAuctionFromFormation(room);
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
          enterTeamManagement(room);
          broadcastRoom(room.code);
          break;
        }

        // --- 10. AUCTION BID (Classic & Quick) ---
        case 'AUCTION_BID': {
          const { roomCode, amount } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'auction') return;
          const { room, session } = auth;
          const actorId = session.managerId;

          if (room.auction.isForcedPurchase) {
            const forcedId = room.auction.forcedWinnerId;
            if (forcedId === actorId) {
              sendSocketError(ws, 'This positional slot is a mandatory purchase. The player will be assigned automatically.');
            } else {
              sendSocketError(ws, `${room.auction.forcedWinnerName || 'Another manager'} must complete this positional slot before the auction continues.`);
            }
            return;
          }

          if ((room.phaseReadyIds || []).includes(actorId)) {
            sendSocketError(ws, 'You marked the auction done and cannot bid again.');
            return;
          }

          const manager = room.managers.find(m => m.id === actorId);
          if (!manager) return;
          if ((room.phaseReadyIds || []).includes(actorId)) {
            sendSocketError(ws, 'You marked the auction done and cannot bid again.');
            return;
          }

          const bidAmount = Number(amount);
          if (room.auction.isSold || !room.auction.currentPlayer || room.auction.secondsRemaining <= 0) {
            sendSocketError(ws, 'This auction has already closed.');
            return;
          }

          if (!Number.isFinite(bidAmount) || bidAmount < 1) {
            sendSocketError(ws, 'Bid must be at least £1M.');
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

          if (room.auction.highestBidderId === manager.id) {
            sendSocketError(ws, 'You are already the highest bidder.');
            return;
          }

          if (manager.squad.length >= 11) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Your 11-player squad is already full (11/11 players).' }));
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
          const bidStep = getBidStep(room.auction.currentBid);
          const minNextBid = getMinNextBid(room.auction.currentBid, Boolean(room.auction.highestBidderId));
          if (room.auction.highestBidderId && bidAmount < minNextBid) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Next bid must be at least £${minNextBid}M.` }));
            return;
          }

          room.auction.currentBid = bidAmount;
          room.auction.highestBidderId = manager.id;
          room.auction.highestBidderName = manager.name;

          // Extend countdown if < 5 seconds left
          if (room.auction.secondsRemaining <= 4) {
            room.auction.secondsRemaining = 5;
            room.auction.auctionEndsAt = Date.now() + 5000;
          }

          broadcastRoom(room.code);
          break;
        }

        // --- 11. BLIND AUCTION SECRET BID SUBMISSION ---
        case 'SUBMIT_BLIND_BID': {
          const { roomCode, amount } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'auction') return;
          const { room, session } = auth;
          const actorId = session.managerId;

          if (room.auction.isForcedPurchase) {
            const forcedId = room.auction.forcedWinnerId;
            if (forcedId === actorId) {
              sendSocketError(ws, 'This positional slot is a mandatory purchase. The player will be assigned automatically.');
            } else {
              sendSocketError(ws, `${room.auction.forcedWinnerName || 'Another manager'} must complete this positional slot before the auction continues.`);
            }
            return;
          }

          const manager = room.managers.find(m => m.id === actorId);
          if (!manager) return;

          if (room.auction.isSold || room.auction.secondsRemaining <= 0) {
            sendSocketError(ws, 'This auction has already closed.');
            return;
          }

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
            sendSocketError(ws, 'Your 11-player squad is already full (11/11 players).');
            return;
          }
          const blindLimits = getFormationSquadCategoryLimits(manager.formation);
          const blindCategoryCount = manager.squad.filter(s => s.player.category === currentPl.category).length;
          if (blindCategoryCount >= blindLimits[currentPl.category]) {
            sendSocketError(ws, `Your ${currentPl.category} quota is full for ${manager.formation}.`);
            return;
          }
          let secretMap = blindSecretBids.get(room.code);
          if (!secretMap) {
            secretMap = {};
            blindSecretBids.set(room.code, secretMap);
          }
          secretMap[actorId] = bidAmount;

          // Acknowledge submission privately to this client only
          ws.send(JSON.stringify({
            type: 'BLIND_BID_CONFIRMED',
            amount: bidAmount,
          }));

          // Broadcast public update that this manager submitted (without amount)
          broadcastRoom(room.code);
          break;
        }

        // --- 12. AUCTION READY / TEAM MANAGEMENT ---
        case 'AUCTION_READY': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'auction') return;
          const { room, session } = auth;
          const actorId = session.managerId;
          const manager = room.managers.find(m => m.id === actorId);
          if (!manager) return;
          const required = getFormationSquadCategoryLimits(manager.formation);
          const counts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
          for (const entry of manager.squad) counts[entry.player.category] += 1;
          const complete = manager.squad.length === 11 && (['GK','DEF','MID','ATT'] as PositionCategory[]).every(cat => counts[cat] >= getFormationStarterCategoryCounts(manager.formation)[cat]);
          if (!complete) {
            sendSocketError(ws, 'Finish your 11-player squad before pressing I\'M DONE.');
            return;
          }
          const ready = new Set(room.phaseReadyIds || []);
          ready.add(actorId);
          room.phaseReadyIds = [...ready];
          broadcastRoom(room.code);
          break;
        }

        // --- 13. TEAM MANAGEMENT & TACTICS ---
        case 'UPDATE_LINEUP': {
          const { roomCode, squad, formation, tactics, roles } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          if (!['team_management', 'league', 'knockout'].includes(room.phase)) return;

          const manager = room.managers.find(m => m.id === session.managerId);
          if (manager) {
            const nextFormation = formation || manager.formation;
            // Always run the authoritative validator, even when the client
            // only changes tactics/roles. Never accept raw tactic or role objects
            // without server-side validation.
            const sanitized = validateAndSanitizeLineupUpdate(
              manager,
              Array.isArray(squad) ? squad : manager.squad,
              nextFormation,
              tactics,
              roles
            );

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
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;

          const manager = room.managers.find(m => m.id === session.managerId);
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
            enterLeague(room);
          }

          broadcastRoom(room.code);
          break;
        }

        // --- KNOCKOUT MATCH ---
        case 'RUN_KNOCKOUT_MATCH': {
          try {
            const { roomCode, managerId, fixtureId } = payload;
            const auth = authorizeSocket(ws, roomCode, managerId);
            if (!auth || auth.room.phase !== 'knockout') {
              sendSocketError(ws, 'Knockout phase is not active for this manager session.');
              return;
            }
            const { room, session } = auth;
            const stage = room.knockoutStage;
            if (!stage) { sendSocketError(ws, 'Knockout stage is unavailable.'); return; }
            const round = stage.rounds[stage.rounds.length - 1];
            if (!round) { sendSocketError(ws, 'Knockout round is unavailable.'); return; }
            const fix = round.fixtures.find(f => f.id === fixtureId);
            if (!fix) { sendSocketError(ws, 'Fixture not found.'); return; }
            if (session.managerId !== fix.homeManagerId && session.managerId !== fix.awayManagerId && !isRoomHost(room, session.managerId)) {
              sendSocketError(ws, 'Only a fixture participant or the host can start this match.');
              return;
            }
            if (fix.played) { sendSocketError(ws, 'This knockout match has already been played.'); return; }

            const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
            const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);
            if (!homeMgr || !awayMgr) {
              sendSocketError(ws, 'Unable to load both teams for this fixture.');
              return;
            }

            const lockKey = `${room.code}:knockout:${fix.id}`;
            if (matchSimulationLocks.has(lockKey)) {
              sendSocketError(ws, 'This match is already being simulated. Please wait.');
              return;
            }
            matchSimulationLocks.add(lockKey);
            try {
              const result = simulateMatch(homeMgr, awayMgr, fix.id, fix.matchday, undefined, true, round.roundName);
              Object.assign(fix, result);
              room.fixtures = round.fixtures;
              await saveRoomSnapshot(room);
              broadcastRoom(room.code);
            } finally {
              matchSimulationLocks.delete(lockKey);
            }
          } catch (error: any) {
            console.error('[WS] RUN_KNOCKOUT_MATCH failed:', error);
            sendSocketError(ws, 'Failed to simulate knockout match. Please retry.');
          }
          break;
        }
        // Advance the bracket only after the 2D live match has reached full-time.
        case 'COMPLETE_KNOCKOUT_MATCH': {
          try {
            const { roomCode, managerId, fixtureId } = payload;
            const auth = authorizeSocket(ws, roomCode, managerId);
            if (!auth || auth.room.phase !== 'knockout') {
              sendSocketError(ws, 'Knockout phase is not active for this manager session.');
              return;
            }

            const { room, session } = auth;
            const stage = room.knockoutStage;
            if (!stage) {
              sendSocketError(ws, 'Knockout stage is unavailable.');
              return;
            }

            const round = stage.rounds[stage.rounds.length - 1];
            if (!round) {
              sendSocketError(ws, 'Knockout round is unavailable.');
              return;
            }

            const fix = round.fixtures.find(f => f.id === fixtureId);
            if (!fix) {
              sendSocketError(ws, 'Fixture not found.');
              return;
            }
            if (session.managerId !== fix.homeManagerId && session.managerId !== fix.awayManagerId && !isRoomHost(room, session.managerId)) {
              sendSocketError(ws, 'Only a fixture participant or the host can complete this match.');
              return;
            }
            if (!fix.played) {
              sendSocketError(ws, 'The live match has not reached full-time yet.');
              return;
            }
            if (!fix.winnerManagerId) {
              sendSocketError(ws, 'This match has no recorded winner yet.');
              return;
            }

            const currentRoundComplete = round.fixtures.length > 0 && round.fixtures.every(f => f.played);
            if (!currentRoundComplete) {
              sendSocketError(ws, 'The current knockout round is not complete yet.');
              return;
            }

            // Advance on the same authoritative WebSocket instance that owns the
            // completed fixture. This avoids stale cross-instance REST snapshots.
            advanceKnockoutRound(room);
            broadcastRoom(room.code);
          } catch (error: any) {
            console.error('[WS] COMPLETE_KNOCKOUT_MATCH failed:', error);
            sendSocketError(ws, 'Failed to continue the knockout round. Please retry.');
          }
          break;
        }

        // --- 14. SIMULATE MATCHDAY ---
        case 'RUN_MATCHDAY': {
          try {
            const { roomCode, matchday } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can run the matchday.');
            return;
          }

          if (room.transferWindowOpen) {
            sendSocketError(ws, 'Mid-season management window is open. Finish your squad review before playing the next match.');
            return;
          }

          const targetMatchday = Number(matchday || room.currentMatchday);
          if (!Number.isInteger(targetMatchday) || targetMatchday < 1 || targetMatchday > room.totalMatchdays) {
            sendSocketError(ws, 'Invalid matchday.');
            return;
          }
          if (targetMatchday !== room.currentMatchday) {
            sendSocketError(ws, 'Simulate the current matchday before advancing.');
            return;
          }

          if (room.liveFixtureId) {
            sendSocketError(ws, 'Finish the current live match before starting another.');
            return;
          }

          const currentFixtures = room.fixtures.filter(f => f.matchday === targetMatchday && !f.played);
          if (!currentFixtures.length) {
            sendSocketError(ws, 'This matchday is already complete.');
            return;
          }

          // Run exactly one fixture per action so its authoritative event
          // timeline can be watched in the 2D Live Match Engine.
          repairManagersForMatch(room);
          const fix = currentFixtures[0];
          const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
          const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);

          if (!homeMgr || !awayMgr) {
            sendSocketError(ws, 'Unable to load both teams for this fixture.');
            return;
          }

          const lockKey = `${room.code}:league:${fix.id}`;
          if (matchSimulationLocks.has(lockKey)) {
            sendSocketError(ws, 'This match is already being simulated. Please wait.');
            return;
          }
          matchSimulationLocks.add(lockKey);
          try {
            const result = simulateMatch(homeMgr, awayMgr, fix.id, targetMatchday, undefined, false, undefined, false);
            Object.assign(fix, result);
            fix.played = false;
            if (targetMatchday === 5) {
              const completedThroughFive = room.fixtures.filter(item => item.matchday <= 5).every(item => item.played);
              if (completedThroughFive) {
                console.info('[payload] room JSON bytes after matchday 5:', JSON.stringify(room).length);
                console.info('[payload] sanitized room JSON bytes after matchday 5:', JSON.stringify(sanitizeRoomForViewer(room, room.hostId)).length);
              }
            }
            room.liveFixtureId = fix.id;
            room.currentMatchday = targetMatchday;

            await saveRoomSnapshot(room);
            broadcastRoom(room.code);
          } finally {
            matchSimulationLocks.delete(lockKey);
          }
          break;
          } catch (error: any) {
            console.error('[WS] RUN_MATCHDAY failed:', error);
            sendSocketError(ws, 'Failed to simulate the match. Please retry.');
          }
          break;
        }

        // --- 14b. COMPLETE CURRENT LEAGUE MATCH ---
        case 'COMPLETE_LEAGUE_MATCH': {
          try {
            const { roomCode, fixtureId } = payload;
            const auth = authorizeSocket(ws, roomCode);
            if (!auth || auth.room.phase !== 'league') return;
            const { room, session } = auth;
            if (!isRoomHost(room, session.managerId)) {
              sendSocketError(ws, 'Only the host can complete the live match.');
              return;
            }
            if (!room.liveFixtureId || room.liveFixtureId !== fixtureId) {
              sendSocketError(ws, 'That match is not the current live fixture.');
              return;
            }
            const fix = room.fixtures.find(f => f.id === fixtureId);
            if (!fix || fix.matchday !== room.currentMatchday) {
              sendSocketError(ws, 'Invalid live fixture.');
              return;
            }
            if (!fix.played) {
              fix.played = true;
              room.leagueTable = updateLeagueTable(room.leagueTable, fix);
            }
            room.liveFixtureId = undefined;
            const leagueComplete = room.fixtures.length > 0 && room.fixtures.every(f => f.played);
            const midpointMatchday = getMidSeasonWindowMatchday(room);
            const midpointComplete = midpointMatchday > 0 &&
              room.fixtures.filter(f => f.matchday === midpointMatchday).every(f => f.played);
            if (midpointComplete && !leagueComplete) openMidSeasonWindow(room);
            if (leagueComplete) initializeLeaguePlayoffs(room);
            await saveRoomSnapshot(room);
            broadcastRoom(room.code);
          } catch (error) {
            console.error('[WS] COMPLETE_LEAGUE_MATCH failed:', error);
            sendSocketError(ws, 'Failed to complete the live match. Please retry.');
          }
          break;
        }

        // --- 14b. NEXT MATCHDAY ---
        case 'NEXT_MATCHDAY': {
          const { roomCode, nextMatchday } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth || auth.room.phase !== 'league') return;
          const { room, session } = auth;
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can advance the matchday.');
            return;
          }

          if (room.transferWindowOpen) {
            sendSocketError(ws, 'Finish the mid-season management window before continuing.');
            return;
          }

          const requestedNext = Number(nextMatchday || room.currentMatchday + 1);
          const currentPlayed = room.fixtures.filter(f => f.matchday === room.currentMatchday).every(f => f.played);
          if (!currentPlayed) {
            sendSocketError(ws, 'Finish the current matchday before proceeding.');
            return;
          }
          if (!Number.isInteger(requestedNext) || requestedNext !== room.currentMatchday + 1 || requestedNext > room.totalMatchdays) {
            sendSocketError(ws, 'Matchdays must advance one at a time.');
            return;
          }
          room.currentMatchday = requestedNext;
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

          // Season results are shown to currently connected players, but the
          // completed game is deliberately not persisted. There is no reason
          // to retain finished games and this also prevents stale rooms from
          // reappearing after a server restart.
          broadcastRoom(room.code, undefined, false);
          void deletePersistedRoomSnapshot(room.code).catch(error => console.error('[persistence] season snapshot deletion failed:', error));
          break;
        }

        // --- 15. TRANSFERS ---
        case 'PROPOSE_TRANSFER': {
          const { roomCode, offer } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          const suppliedToManagerId = resolveManagerId(room, offer?.toManagerId);
          const suppliedFromManagerId = session.managerId;

          if (!room.settings.transfersEnabled || !isTransferWindowOpen(room)) {
            sendSocketError(ws, 'Transfers are only available during the mid-season management window.');
            return;
          }

          const sender = room.managers.find(m => m.id === suppliedFromManagerId);
          const target = room.managers.find(m => m.id === suppliedToManagerId);
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
          const { room, session } = auth;
           const actorId = session.managerId;

          if (!room.settings.transfersEnabled || !isTransferWindowOpen(room)) {
            sendSocketError(ws, 'Transfers are only available during the mid-season management window.');
            return;
          }

          const offer = room.transferOffers.find(o => o.id === offerId && o.status === 'pending');
          if (!offer || offer.toManagerId !== actorId) {
            sendSocketError(ws, 'Transfer proposal not found or already resolved.');
            return;
          }

          offer.status = accept && executeTransferOffer(room, offer) ? 'accepted' : 'rejected';
          broadcastRoom(room.code);
          break;
        }

        // --- MID-SEASON MANAGEMENT WINDOW ---
        case 'CLOSE_TRANSFER_WINDOW': {
          const { roomCode } = payload;
          const auth = authorizeSocket(ws, roomCode);
          if (!auth) return;
          const { room, session } = auth;
          const actorId = session.managerId;

          if (!room.transferWindowOpen) {
            sendSocketError(ws, 'The mid-season management window is not open.');
            return;
          }

          const manager = room.managers.find(m => m.id === actorId);
          if (!manager) return;

          const readyIds = new Set(room.transferWindowReadyIds || []);
          readyIds.add(actorId);
          room.transferWindowReadyIds = [...readyIds];

          if (maybeCloseMidSeasonWindow(room)) {
            room.currentMatchday = Math.min(room.totalMatchdays, room.currentMatchday + 1);
          }

          broadcastRoom(room.code);
          break;
        }

        // --- LEAVE ROOM / MATCH ---
        case 'LEAVE_ROOM': {
          const { roomCode, managerId } = payload;
          const auth = authorizeSocket(ws, roomCode, managerId);
          if (!auth) return;
          const { room, session } = auth;
          const leavingId = session.managerId;
          const canLeaveActiveMatch = room.phase === 'formation_select' || room.phase === 'auction';
          const canLeaveLobby = room.phase === 'lobby';
          const canLeaveFinishedGame = room.phase === 'season_end';

          if (!canLeaveLobby && !canLeaveActiveMatch && !canLeaveFinishedGame) {
            sendSocketError(ws, 'You can only leave before the season starts, during the auction, or after the season ends.');
            return;
          }

          const wasHost = room.hostId === leavingId;
          const sockets = roomSockets.get(room.code);
          if (sockets) sockets.delete(ws);
          socketToRoom.delete(ws);

          // Remove the manager from the authoritative room state. During an active
          // auction this is important: leaving only on the client would leave a
          // ghost bidder in the server state and could block the auction stage.
          removeManagerFromRoom(room, leavingId);

          // If the host leaves before the league begins, promote another manager
          // so the remaining lobby/match is still controllable.
          if (wasHost && room.managers.length > 0) {
            const replacement = room.managers.find(m => !m.isBot) || room.managers[0];
            room.hostId = replacement.id;
            room.managers.forEach(m => { m.isHost = m.id === replacement.id; });
          }

          if (room.phase === 'lobby') {
            room.leagueTable = calculateInitialTable(room.managers);
          }

          room.updatedAt = Date.now();

          if (room.phase === 'season_end') {
            // Finished games are disposable. If the last viewer leaves, remove
            // the room from memory and make sure no stale snapshot survives.
            if (room.managers.length === 0) {
              rooms.delete(room.code);
              roomSockets.delete(room.code);
              blindSecretBids.delete(room.code);
              const auctionTimer = auctionIntervals.get(room.code);
              if (auctionTimer) clearInterval(auctionTimer);
              auctionIntervals.delete(room.code);
              clearPhaseReadyTimer(room);
              await deletePersistedRoomSnapshot(room.code);
            } else {
              broadcastRoom(room.code, undefined, false);
            }
          } else {
            await saveRoomSnapshot(room);
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
          if (room.phase !== 'season_end') {
            sendSocketError(ws, 'Rematch is only available after the season ends.');
            return;
          }
          if (!isRoomHost(room, session.managerId)) {
            sendSocketError(ws, 'Only the host can start a rematch.');
            return;
          }

          room.awards = null;
          room.fixtures = [];
          room.currentMatchday = 1;
          room.totalMatchdays = 1;
          room.leagueTable = calculateInitialTable(room.managers);
          room.knockoutStage = undefined;
          room.liveFixtureId = undefined;
          room.transferOffers = [];
          room.transferWindowOpen = false;
          room.transferWindowReadyIds = [];
          room.transferWindowMatchday = undefined;
          room.phaseReadyIds = room.managers.filter(m => m.isBot).map(m => m.id);
          room.managers.forEach(manager => {
            manager.squad = [];
            manager.budget = manager.initialBudget;
            manager.confirmedTeam = false;
            manager.isReady = manager.isBot;
            manager.tactics = {
              style: 'Balanced',
              mentality: 'Balanced',
              defensiveLine: 50,
              pressingIntensity: 50,
              attackWidth: 50,
              tempo: 50,
              risk: 50,
            };
            manager.roles = {
              captainId: '',
              penaltyTakerId: '',
              freeKickTakerId: '',
              cornerTakerId: '',
            };
            manager.teamOverall = 0;
          });
          room.auction = {
            currentPlayerIndex: 0,
            totalPlayersInPool: getPlayersForLobby(room.settings.playerPool, room.settings.era).length,
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
          };
          room.phase = 'lobby';
          room.phaseReadyDeadline = Date.now() + PHASE_READY_SECONDS * 1000;
          room.updatedAt = Date.now();
          ensurePhaseReadyTicker(room);
          await saveRoomSnapshot(room);
          broadcastRoom(room.code);
          break;
        }
      }
    } catch (err: any) {
      console.error('WebSocket Error:', err);
      sendSocketError(ws, 'The game server hit an unexpected error. Please retry.');
    }
  });

  ws.on('close', () => {
    const remainingConnections = (wsConnectionCounts.get(clientIp) || 1) - 1;
    if (remainingConnections <= 0) wsConnectionCounts.delete(clientIp);
    else wsConnectionCounts.set(clientIp, remainingConnections);

    const info = socketToRoom.get(ws);
    if (info) {
      const sockets = roomSockets.get(info.roomCode);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          const room = rooms.get(info.roomCode);
          // A completed game has no reason to remain in memory once nobody is
          // viewing it. Active lobbies remain available for reconnects.
          if (room?.phase === 'season_end') {
            rooms.delete(info.roomCode);
            roomSockets.delete(info.roomCode);
            blindSecretBids.delete(info.roomCode);
            const auctionTimer = auctionIntervals.get(info.roomCode);
            if (auctionTimer) clearInterval(auctionTimer);
            auctionIntervals.delete(info.roomCode);
            clearPhaseReadyTimer(room);
            void deletePersistedRoomSnapshot(info.roomCode).catch(error => console.error('[persistence] season-end cleanup failed:', error));
          }
        }
      }
      if (sockets && sockets.size === 0) roomDisconnectedAt.set(info.roomCode, Date.now());
      socketToRoom.delete(ws);
    }
  });
});

// REST simulation controls are the reliable fallback for production deployments.
// They also let the match start when the browser's WebSocket connection is temporarily
// unavailable. The mutation is still authoritative on the server and is persisted.
app.post('/api/room/:code/run-matchday', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const managerId = String(req.body?.managerId || '');
    const requestedMatchday = Number(req.body?.matchday);

    let room = rooms.get(code);
    if (!room) {
      room = await loadRoomSnapshot(code) || undefined;
      if (room) rooms.set(code, room);
    }
    if (!room) return res.status(404).json({ error: 'Lobby not found' });
    if (room.phase !== 'league') return res.status(409).json({ error: 'League is not active.' });
    if (!room.managers.some(m => m.id === managerId)) return res.status(403).json({ error: 'Manager session is invalid.' });
    if (!isRoomHost(room, managerId)) return res.status(403).json({ error: 'Only the host can run the matchday fallback.' });
    if (room.transferWindowOpen) return res.status(409).json({ error: 'Mid-season management window is open.' });

    const matchday = Number.isInteger(requestedMatchday) && requestedMatchday > 0
      ? requestedMatchday
      : room.currentMatchday;
    if (matchday !== room.currentMatchday || matchday < 1 || matchday > room.totalMatchdays) {
      return res.status(400).json({ error: 'Invalid matchday.' });
    }

    const fix = room.fixtures.find(f => f.matchday === matchday && !f.played);
    if (!fix) return res.status(409).json({ error: 'This matchday is already complete.' });

    repairManagersForMatch(room);
    const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
    const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);
    if (!homeMgr || !awayMgr) return res.status(409).json({ error: 'Unable to load both teams for this fixture.' });

    const lockKey = `${room.code}:league:${fix.id}`;
    if (matchSimulationLocks.has(lockKey)) {
      return res.status(409).json({ error: 'This match is already being simulated.' });
    }
    matchSimulationLocks.add(lockKey);
    try {
      const result = simulateMatch(homeMgr, awayMgr, fix.id, matchday, undefined, false, undefined, false);
      Object.assign(fix, result);
      room.leagueTable = updateLeagueTable(room.leagueTable, fix);

      const leagueComplete = room.fixtures.length > 0 && room.fixtures.every(f => f.played);
      const midpointMatchday = getMidSeasonWindowMatchday(room);
      const midpointComplete =
        midpointMatchday > 0 &&
        matchday === midpointMatchday &&
        room.fixtures.filter(f => f.matchday === midpointMatchday).every(f => f.played);

      if (midpointComplete && !leagueComplete) openMidSeasonWindow(room);
      if (leagueComplete) initializeLeaguePlayoffs(room);

      await saveRoomSnapshot(room);
      broadcastRoom(room.code);
      return res.json({ success: true, room: sanitizeRoomForViewer(room, managerId) });
    } finally {
      matchSimulationLocks.delete(lockKey);
    }
  } catch (error: any) {
    console.error('[REST] run-matchday failed:', error);
    return res.status(500).json({ error: 'Failed to simulate match.' });
  }
});

app.post('/api/room/:code/run-knockout-match', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const managerId = String(req.body?.managerId || '');
    const fixtureId = String(req.body?.fixtureId || '');

    let room = rooms.get(code);
    if (!room) {
      room = await loadRoomSnapshot(code) || undefined;
      if (room) rooms.set(code, room);
    }
    if (!room) return res.status(404).json({ error: 'Lobby not found' });
    if (room.phase !== 'knockout') return res.status(409).json({ error: 'Knockout phase is not active.' });
    if (!room.managers.some(m => m.id === managerId)) return res.status(403).json({ error: 'Manager session is invalid.' });

    const stage = room.knockoutStage;
    if (!stage) return res.status(409).json({ error: 'Knockout stage is unavailable.' });
    const round = stage.rounds[stage.rounds.length - 1];
    const fix = round?.fixtures.find(f => f.id === fixtureId);
    if (!fix) return res.status(404).json({ error: 'Fixture not found.' });
    if (fix.played) return res.status(409).json({ error: 'This match has already been played.', room: sanitizeRoomForViewer(room, managerId) });

    const homeMgr = room.managers.find(m => m.id === fix.homeManagerId);
    const awayMgr = room.managers.find(m => m.id === fix.awayManagerId);
    if (!homeMgr || !awayMgr) return res.status(409).json({ error: 'Unable to load both teams for this fixture.' });
    if (managerId !== fix.homeManagerId && managerId !== fix.awayManagerId && managerId !== room.hostId) {
      return res.status(403).json({ error: 'Only a fixture participant or the host can start this match.' });
    }

    const lockKey = `${room.code}:knockout:${fix.id}`;
    if (matchSimulationLocks.has(lockKey)) {
      return res.status(409).json({ error: 'This match is already being simulated.' });
    }
    matchSimulationLocks.add(lockKey);
    try {
      const result = simulateMatch(homeMgr, awayMgr, fix.id, fix.matchday, undefined, true, round.roundName);
      Object.assign(fix, result);
      room.fixtures = round.fixtures;

      // Keep the REST fallback durable just like the WebSocket path.
      await saveRoomSnapshot(room);
      broadcastRoom(room.code);
      return res.json({ success: true, room: sanitizeRoomForViewer(room, managerId) });
    } finally {
      matchSimulationLocks.delete(lockKey);
    }
  } catch (error: any) {
    console.error('[REST] run-knockout-match failed:', error);
    return res.status(500).json({ error: 'Failed to simulate knockout match.' });
  }
});
app.post('/api/room/:code/complete-knockout-match', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const managerId = String(req.body?.managerId || '');
    const fixtureId = String(req.body?.fixtureId || '');

    let room = rooms.get(code);
    if (!room) {
      room = await loadRoomSnapshot(code) || undefined;
      if (room) rooms.set(code, room);
    }
    if (!room) return res.status(404).json({ error: 'Lobby not found' });
    if (room.phase !== 'knockout') return res.status(409).json({ error: 'Knockout phase is not active.' });
    if (!room.managers.some(m => m.id === managerId)) return res.status(403).json({ error: 'Manager session is invalid.' });

    const stage = room.knockoutStage;
    if (!stage) return res.status(409).json({ error: 'Knockout stage is unavailable.' });
    const round = stage.rounds[stage.rounds.length - 1];
    const fix = round?.fixtures.find(f => f.id === fixtureId);
    if (!fix || !fix.played) return res.status(409).json({ error: 'Match is not complete yet.' });
    if (managerId !== fix.homeManagerId && managerId !== fix.awayManagerId && managerId !== room.hostId) {
      return res.status(403).json({ error: 'Only a fixture participant or the host can continue this round.' });
    }

    advanceKnockoutRound(room);
    await saveRoomSnapshot(room);
    broadcastRoom(room.code);
    return res.json({ success: true, room: sanitizeRoomForViewer(room, managerId) });
  } catch (error: any) {
    console.error('[REST] complete-knockout-match failed:', error);
    return res.status(500).json({ error: 'Failed to advance knockout round.' });
  }
});


// API Endpoints
app.get('/api/room/:code', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.params.code || '').toUpperCase();
  const authHeader = String(req.headers.authorization || '');
  const reconnectToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const viewerId = String(req.headers['x-manager-id'] || '');
  const legacyReconnectToken = process.env.NODE_ENV !== 'production' ? String(req.query?.reconnectToken || '') : '';
  const legacyViewerId = process.env.NODE_ENV !== 'production' ? String(req.query?.managerId || '') : '';
  const effectiveReconnectToken = reconnectToken || legacyReconnectToken;
  const effectiveViewerId = viewerId || legacyViewerId;
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowRateLimit(apiRequestWindows, clientKey, 120)) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  let room = rooms.get(code);
  if (!room) {
    room = await loadRoomSnapshot(code) || undefined;
    if (room) rooms.set(code, room);
  }
  if (!room) return res.status(404).json({ error: 'Lobby not found' });
  const viewer = room.managers.find(m =>
    (effectiveReconnectToken && matchesReconnectCredential(m, effectiveReconnectToken)) ||
    (!effectiveReconnectToken && effectiveViewerId && m.id === effectiveViewerId)
  );
  if (!viewer) return res.status(403).json({ error: 'Manager session is invalid.' });
  const since = Number(req.query?.since);
  if (Number.isFinite(since) && room.updatedAt <= since) {
    res.status(304).end();
    return;
  }

  // HTTP polling can be the first request after a serverless instance changes.
  // Resume absolute auction and phase-readiness clocks after a cold start.
  ensureAuctionTicker(room);
  ensurePhaseReadyTicker(room);
  // HTTP snapshots are public to anyone holding the six-character room code.
  // Never expose internal manager IDs through this endpoint.
  const snapshot = sanitizeRoomForViewer(room, viewer.id);
  if (snapshot.settings.auctionMode === 'Blind' && snapshot.phase === 'auction' && !snapshot.auction.isSold) {
    // Keep the REST snapshot behind the same privacy boundary as WebSocket
    // broadcasts: humans see exactly two clues, never the real identity/OVR.
    const sourcePlayer = snapshot.auction.currentPlayer;
    if (sourcePlayer) {
      snapshot.auction.currentPlayer = {
        ...sourcePlayer,
        id: `blind-${sourcePlayer.id}`,
        name: 'Mystery Player',
        club: 'Unknown Club',
        league: 'Unknown League',
        nationality: 'Unknown',
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
        blindClues: snapshot.auction.blindClues || [],
      } as any;
    }
    snapshot.auction.hasSubmittedSecretBid = undefined;
  }
  snapshot.serverNow = Date.now();
  return res.json(snapshot);
});

app.get('/api/room/:code/fixture/:fixtureId/events', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.params.code || '').toUpperCase();
  const fixtureId = String(req.params.fixtureId || '');
  const authHeader = String(req.headers.authorization || '');
  const reconnectToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const viewerId = String(req.headers['x-manager-id'] || '');
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowRateLimit(apiRequestWindows, clientKey, 120)) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });

  let room = rooms.get(code);
  if (!room) {
    room = await loadRoomSnapshot(code) || undefined;
    if (room) rooms.set(code, room);
  }
  if (!room) return res.status(404).json({ error: 'Lobby not found' });

  const viewer = room.managers.find(m =>
    (reconnectToken && matchesReconnectCredential(m, reconnectToken)) ||
    (!reconnectToken && viewerId && m.id === viewerId)
  );
  if (!viewer) return res.status(403).json({ error: 'Manager session is invalid.' });

  const fixture = room.fixtures.find(item => item.id === fixtureId);
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
  if (viewer.id !== fixture.homeManagerId && viewer.id !== fixture.awayManagerId && viewer.id !== room.hostId) {
    return res.status(403).json({ error: 'Only a fixture participant or the host can view match events.' });
  }

  return res.json({ fixtureId, events: fixture.events || [] });
});

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    rooms: rooms.size,
    websocketClients: wss.clients.size,
  });
});

app.get('/api/players', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowRateLimit(apiRequestWindows, clientKey, 60)) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  const requestedEra = String(req.query?.era || 'Current');
  const era = requestedEra === 'All-Time' ? 'All-Time' : 'Current';
  const validPools = new Set([
    'Global', 'Premier League', 'La Liga', 'Bundesliga', 'Serie A',
    'Brasileirão', 'Champions League', 'World Cup',
  ]);
  const requestedPool = String(req.query?.pool || 'Global');
  const pool = validPools.has(requestedPool) ? requestedPool as any : 'Global';
  res.json(getPlayersForLobby(pool, era));
});

// Dedicated Solo Game endpoint (instantly generates 11-player squads and navigates to Team Management)
app.post('/api/solo-game', (req, res) => {
  try {
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    if (!allowRateLimit(soloRequestWindows, clientKey, 10)) return res.status(429).json({ error: 'Too many solo games created. Try again later.' });
    const { managerName, formation } = req.body || {};
    if (!managerName || !managerName.trim()) {
      return res.status(400).json({ error: 'Manager name is required' });
    }
    const result = createSoloGameRoom(managerName.trim(), formation);
    res.json({
      success: true,
      roomCode: result.roomCode,
      managerId: result.managerId,
      room: sanitizeRoomForViewer(result.room, result.managerId),
    });
  } catch (err: any) {
    console.error('Error creating solo game:', err);
    res.status(500).json({ error: 'Failed to create solo game' });
  }
});


// Server-side AI endpoint. The API key never reaches the browser.
app.post('/api/ai/advice', async (req, res) => {
  try {
    if (!checkAiRateLimit(req, res)) return;
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const content = await callOpenRouter([
      { role: 'system', content: 'You are the tactical assistant for Football Auction League. Give concise, practical football-management advice. Do not invent player data that is not supplied by the user.' },
      { role: 'user', content: prompt },
    ]);
    if (!content) return res.status(502).json({ error: 'AI request failed' });
    return res.json({ content });
  } catch (error: any) {
    console.error('[AI] OpenRouter error:', error?.message || error);
    return res.status(502).json({ error: 'AI request failed' });
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

  // On the Oracle VM, Nginx is the only public entry point. Bind the
  // Node process to localhost by default so port 3000 cannot be reached
  // directly even if a cloud firewall rule is accidentally opened.
  const HOST = process.env.SERVER_HOST || '127.0.0.1';
  server.listen(PORT, HOST, () => {
    console.log(`Football Auction League server running on ${HOST}:${PORT}`);
  });
}

// The same Node process serves HTTP, static assets, and WebSocket upgrades.
export { app };
export default server;

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}; saving active rooms...`);

  for (const room of rooms.values()) {
    if (room.phase !== 'season_end') {
      await saveRoomSnapshot(room).catch(() => undefined);
    }
  }

  for (const timer of auctionIntervals.values()) clearInterval(timer);
  auctionIntervals.clear();
  for (const timer of phaseReadyTimers.values()) clearTimeout(timer);
  phaseReadyTimers.clear();

  for (const ws of wss.clients) {
    try { ws.close(1001, 'Server shutting down'); } catch {}
  }

  await new Promise<void>(resolve => {
    server.close(() => resolve());
    setTimeout(resolve, 8000).unref();
  });
}

if (!process.env.VERCEL) {
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM').catch(error => console.error('[shutdown] failed:', error)));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT').catch(error => console.error('[shutdown] failed:', error)));
  startServer();
}
