import type { GameRoom } from '../src/types/football.js';

/** Active auction countdown intervals keyed by room code. */
export const auctionIntervals = new Map<string, NodeJS.Timeout>();

/** Phase readiness timers keyed by room code. */
export const phaseReadyTimers = new Map<string, NodeJS.Timeout>();

/** Maximum time an AFK manager can block a timed phase. */
export const PHASE_READY_SECONDS = 30;

export function clearPhaseReadyTimer(room: GameRoom) {
  const timer = phaseReadyTimers.get(room.code);
  if (timer) clearTimeout(timer);
  phaseReadyTimers.delete(room.code);
  room.phaseReadyDeadline = undefined;
}

export function allManagersReady(room: GameRoom) {
  return room.managers.length >= 2 && room.managers.every(m => m.isReady || m.isBot);
}

export function allFormationReady(room: GameRoom) {
  const ready = new Set(room.phaseReadyIds || []);
  return room.managers.length >= 2 && room.managers.every(m => m.isBot || ready.has(m.id));
}
