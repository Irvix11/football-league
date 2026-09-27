import type { GameRoom } from './src/types/football.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wcumaftqouolnuoxgryj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_BpPGMfqBjsdtskvRtp0IOQ_lgwG1dVQ';

function headers(extra: Record<string,string> = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function saveRoomSnapshot(room: GameRoom): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/game_room_snapshots?on_conflict=room_code`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({
        room_code: room.code,
        snapshot: room,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('[persistence] save room failed:', error);
  }
}

export async function loadRoomSnapshot(roomCode: string): Promise<GameRoom | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/game_room_snapshots?select=snapshot&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
      { headers: headers() }
    );
    if (!response.ok) return null;
    const rows = await response.json() as Array<{ snapshot?: GameRoom }>;
    return rows[0]?.snapshot || null;
  } catch (error) {
    console.error('[persistence] load room failed:', error);
    return null;
  }
}

export async function deleteRoomSnapshot(roomCode: string): Promise<void> {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/game_room_snapshots?room_code=eq.${encodeURIComponent(roomCode)}`,
      { method: 'DELETE', headers: headers() }
    );
  } catch (error) {
    console.error('[persistence] delete room failed:', error);
  }
}
