import { loadRoomSnapshot } from '../../server/persistence.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = Array.isArray(req.query.code) ? req.query.code[0] : req.query.code;
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Lobby code is required' });

  const room = await loadRoomSnapshot(code);
  if (!room) return res.status(404).json({ error: 'Lobby not found' });

  const snapshot = JSON.parse(JSON.stringify(room));
  if (snapshot.settings?.auctionMode === 'Blind' && snapshot.phase === 'auction') {
    snapshot.auction.hasSubmittedSecretBid = undefined;
    snapshot.auction.currentPlayer = snapshot.auction.isSold ? snapshot.auction.currentPlayer : null;
  }

  return res.status(200).json(snapshot);
}
