import crypto from 'crypto';
import { WebSocket } from 'ws';
import type { GameRoom, Manager } from '../src/types/football.js';

export function sendSocketError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ERROR', message }));
  }
}

export function authorizeSocket(
  ws: WebSocket,
  roomCode: string,
  managerId: string | undefined,
  socketToRoom: Map<WebSocket, { roomCode: string; managerId: string }>,
  rooms: Map<string, GameRoom>,
) {
  const session = socketToRoom.get(ws);
  const normalizedCode = String(roomCode || '').toUpperCase();
  if (!session || session.roomCode !== normalizedCode) return null;
  if (managerId && session.managerId !== managerId) return null;
  const room = rooms.get(normalizedCode);
  if (!room) return null;
  return { room, session };
}

export function isRoomHost(room: GameRoom, managerId: string) {
  return room.hostId === managerId;
}

export function newId(prefix: string) {
  return prefix + '-' + crypto.randomUUID();
}

export function createReconnectToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashReconnectToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function setReconnectCredential(manager: Manager): string {
  const token = createReconnectToken();
  manager.reconnectTokenHash = hashReconnectToken(token);
  return token;
}

export function matchesReconnectCredential(manager: Manager, token: unknown): boolean {
  const supplied = String(token || '');
  if (!supplied || !manager.reconnectTokenHash) return false;
  const expected = Buffer.from(manager.reconnectTokenHash, 'hex');
  const actual = Buffer.from(hashReconnectToken(supplied), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function publicManagerRef(managerId: string): string {
  return 'p-' + crypto.createHash('sha256').update(managerId).digest('hex').slice(0, 12);
}

export function resolveManagerId(room: GameRoom | undefined, suppliedId: unknown): string | null {
  const value = String(suppliedId || '');
  if (!room || !value) return null;
  if (room.managers.some(m => m.id === value)) return value;
  const match = room.managers.find(m => publicManagerRef(m.id) === value);
  return match?.id || null;
}

export function sanitizeRoomForViewer(room: GameRoom, viewerManagerId?: string): GameRoom {
  const sanitized = JSON.parse(JSON.stringify(room)) as GameRoom;
  sanitized.serverNow = Date.now();
  const ref = (id: string | null | undefined) => {
    if (!id) return id;
    return id === viewerManagerId ? id : publicManagerRef(id);
  };

  sanitized.hostId = ref(sanitized.hostId) as string;
  sanitized.managers = sanitized.managers.map(m => {
    const { reconnectTokenHash: _reconnectTokenHash, ...publicManager } = m;
    return { ...publicManager, id: ref(m.id) as string };
  });
  sanitized.leagueTable = sanitized.leagueTable.map(row => ({ ...row, managerId: ref(row.managerId) as string }));
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
  }
  return sanitized;
}
