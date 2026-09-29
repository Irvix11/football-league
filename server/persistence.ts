import { gzipSync, gunzipSync } from 'node:zlib';
import type { GameRoom, MatchEvent } from '../src/types/football.js';

interface PersistedRoomSnapshot {
  room: GameRoom;
  fixtureEventsCompressed: string;
  /** Legacy uncompressed snapshots written before P1 compression. */
  fixtureEvents?: Record<string, MatchEvent[]>;
}

function toPersistedSnapshot(room: GameRoom): PersistedRoomSnapshot {
  const fixtureEvents: Record<string, MatchEvent[]> = {};
  const roomWithoutEvents = structuredClone(room);
  for (const fixture of roomWithoutEvents.fixtures || []) {
    if (fixture.events?.length) fixtureEvents[fixture.id] = fixture.events;
    delete fixture.events;
  }
  const fixtureEventsCompressed = gzipSync(Buffer.from(JSON.stringify(fixtureEvents), 'utf8')).toString('base64');
  return { room: roomWithoutEvents, fixtureEventsCompressed };
}

function fromPersistedSnapshot(snapshot: unknown): GameRoom | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const value = snapshot as Partial<PersistedRoomSnapshot> & Partial<GameRoom>;
  if (value.room && (value.fixtureEventsCompressed || value.fixtureEvents)) {
    const room = value.room as GameRoom;
    let fixtureEvents: Record<string, MatchEvent[]> = value.fixtureEvents || {};
    if (value.fixtureEventsCompressed) {
      try {
        fixtureEvents = JSON.parse(gunzipSync(Buffer.from(value.fixtureEventsCompressed, 'base64')).toString('utf8')) as Record<string, MatchEvent[]>;
      } catch (error) {
        console.error('[persistence] invalid compressed fixture events:', error);
        fixtureEvents = {};
      }
    }
    for (const fixture of room.fixtures || []) {
      const events = fixtureEvents[fixture.id];
      if (events?.length) fixture.events = events;
    }
    return room;
  }
  return snapshot as GameRoom;
}

export const persistenceQueues = new Map<string, Promise<void>>();
export const persistenceTimers = new Map<string, NodeJS.Timeout>();

const SUPABASE_URL = process.env.SUPABASE_URL || '';

// Persistence runs only on the trusted server. RLS is intentionally locked down
// for anon/authenticated clients, so this server must use a privileged secret key.
// Never fall back to a publishable/anon key for persistence.
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

function headers(extra: Record<string,string> = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function persistenceConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function saveRoomSnapshot(room: GameRoom): Promise<void> {
  if (!persistenceConfigured()) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/game_room_snapshots?on_conflict=room_code`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        room_code: room.code,
        snapshot: toPersistedSnapshot(room),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Supabase save failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
  } catch (error) {
    console.error('[persistence] save room failed:', error);
  }
}

export async function loadRoomSnapshot(roomCode: string): Promise<GameRoom | null> {
  if (!persistenceConfigured()) return null;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/game_room_snapshots?select=snapshot&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
      { headers: headers() }
    );
    if (!response.ok) {
      console.error(`[persistence] load room failed with HTTP ${response.status}`);
      return null;
    }
    const rows = await response.json() as Array<{ snapshot?: GameRoom }>;
    const snapshot = fromPersistedSnapshot(rows[0]?.snapshot || null);

    // Completed games are intentionally not recoverable. If an old server
    // instance left a finished season behind, remove it on the next access.
    if (snapshot?.phase === 'season_end') {
      await deleteRoomSnapshot(roomCode);
      return null;
    }

    return snapshot;
  } catch (error) {
    console.error('[persistence] load room failed:', error);
    return null;
  }
}

export async function cleanupOldRoomSnapshots(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  if (!persistenceConfigured()) return;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/game_room_snapshots?updated_at=lt.${encodeURIComponent(cutoff)}`,
      { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) }
    );
    if (!response.ok) {
      console.error(`[persistence] old room cleanup failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('[persistence] old room cleanup failed:', error);
  }
}

export async function deleteRoomSnapshot(roomCode: string): Promise<void> {
  if (!persistenceConfigured()) return;

  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/game_room_snapshots?room_code=eq.${encodeURIComponent(roomCode)}`,
      { method: 'DELETE', headers: headers() }
    );
  } catch (error) {
    console.error('[persistence] delete room failed:', error);
  }
}
