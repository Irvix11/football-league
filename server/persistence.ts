import type { GameRoom } from '../src/types/football.js';

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
        snapshot: room,
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
    const snapshot = rows[0]?.snapshot || null;

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
