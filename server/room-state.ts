import type { WebSocket } from 'ws';
import type { GameRoom } from '../src/types/football.js';

export const rooms = new Map<string, GameRoom>();
export const roomSockets = new Map<string, Set<WebSocket>>();
export const roomDisconnectedAt = new Map<string, number>();
export const socketToRoom = new Map<WebSocket, { roomCode: string; managerId: string }>();

// Prevent duplicate fixture simulations when clients send concurrent actions.
export const matchSimulationLocks = new Set<string>();

// WebSocket liveness is connection-local and does not belong in room state.
export const socketAlive = new WeakMap<WebSocket, boolean>();
