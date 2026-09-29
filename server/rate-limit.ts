import type { Request, Response } from 'express';

type RateWindow = { startedAt: number; count: number };

export const aiRequestWindows = new Map<string, RateWindow>();
export const soloRequestWindows = new Map<string, RateWindow>();
export const apiRequestWindows = new Map<string, RateWindow>();
export const wsConnectionCounts = new Map<string, number>();
export const MAX_WS_CONNECTIONS_PER_IP = 25;

export function allowRateLimit(
  map: Map<string, RateWindow>,
  key: string,
  max: number,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const current = map.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    map.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count++;
  return current.count <= max;
}

export function checkAiRateLimit(req: Request, res: Response): boolean {
  const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
  if (!allowRateLimit(aiRequestWindows, clientKey, 20)) {
    res.status(429).json({ error: 'AI request failed' });
    return false;
  }
  return true;
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const map of [aiRequestWindows, soloRequestWindows, apiRequestWindows]) {
    for (const [key, window] of map) {
      if (window.startedAt < cutoff) map.delete(key);
    }
  }
}, 60_000);
cleanupTimer.unref();
