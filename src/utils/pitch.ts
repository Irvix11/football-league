import type { LivePlayerPosition } from '../types/football.js';

const MIN_DIST = 6.0;
const PITCH_ASPECT = 1.54;

/**
 * Shared four-pass collision separation for the simulation and live UI.
 * Coordinates remain in the 0-100 pitch space and goalkeepers stay anchored.
 */
export function separatePlayerPositions(
  positions: LivePlayerPosition[],
  activePlayerId?: string,
): LivePlayerPosition[] {
  const resolved = positions.map(player => ({ ...player }));

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const first = resolved[i];
        const second = resolved[j];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        const scaledDy = dy * PITCH_ASPECT;
        if (Math.abs(dx) < 0.01 && Math.abs(scaledDy) < 0.01) {
          dx = (j % 2 === 0 ? 1 : -1) * 0.5;
          dy = (i % 2 === 0 ? 1 : -1) * 0.5;
        }

        const distance = Math.hypot(dx, dy * PITCH_ASPECT);
        if (distance >= MIN_DIST) continue;

        const overlap = (MIN_DIST - distance) / 2;
        const nx = dx / (distance || 0.001);
        const ny = dy / (distance || 0.001);
        const firstActive = first.id === activePlayerId || first.hasBall;
        const secondActive = second.id === activePlayerId || second.hasBall;

        if (firstActive && !secondActive) {
          second.x += nx * overlap * 2.2;
          second.y += ny * overlap * 2.2;
        } else if (secondActive && !firstActive) {
          first.x -= nx * overlap * 2.2;
          first.y -= ny * overlap * 2.2;
        } else {
          first.x -= nx * overlap * 1.05;
          first.y -= ny * overlap * 1.05;
          second.x += nx * overlap * 1.05;
          second.y += ny * overlap * 1.05;
        }

        first.x = Math.max(4, Math.min(96, first.x));
        first.y = Math.max(7, Math.min(93, first.y));
        second.x = Math.max(4, Math.min(96, second.x));
        second.y = Math.max(7, Math.min(93, second.y));
      }
    }
  }

  for (const player of resolved) {
    if (player.position !== 'GK' && player.category !== 'GK') continue;
    if (player.team === 'home') {
      player.x = Math.max(4.5, Math.min(13, player.x));
      player.y = Math.max(36, Math.min(64, player.y));
    } else {
      player.x = Math.max(87, Math.min(95.5, player.x));
      player.y = Math.max(36, Math.min(64, player.y));
    }
  }

  return resolved;
}
