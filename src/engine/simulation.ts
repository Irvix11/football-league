import { Manager, Fixture, MatchEvent, TeamMatchStats, PlayerMatchStat, LivePlayerPosition, SquadPlayerEntry, PenaltyKickResult, Position, PositionCategory } from '../types/football.js';
import { FORMATIONS_CONFIG, calculateTeamOverall, getPositionCategory, calculatePositionFit } from '../constants/formations.js';

/**
 * Seeded PRNG (Mulberry32) for reproducible, deterministic match simulation.
 */
function average(values: number[], fallback = 70) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** GK-specific quality using the existing GK-mapped attributes:
 * pac=diving, sho=handling, pas=kicking, dri=reflexes, def=speed, phy=positioning.
 */
function goalkeeperQuality(player: SquadPlayerEntry): number {
  const a = player.player.attributes;
  return (
    a.pac * 0.20 +
    a.sho * 0.18 +
    a.pas * 0.10 +
    a.dri * 0.24 +
    a.def * 0.10 +
    a.phy * 0.18
  );
}

/** Penalty ability deliberately uses more than raw SHO so one stat cannot dominate. */
function penaltyAbility(player: SquadPlayerEntry): number {
  const a = player.player.attributes;
  return a.sho * 0.58 + a.pas * 0.16 + a.dri * 0.16 + a.phy * 0.10;
}

/** Approximate xG from the current 0-100 pitch coordinates.
 * Calibrated around real top-flight shot volume/conversion rather than flat goal rolls.
 */
function estimateShotXg(ballX: number, ballY: number, isHome: boolean, shooter: SquadPlayerEntry): number {
  const goalX = isHome ? 105 : 0;
  const pitchY = (ballY / 100) * 68;
  const distance = Math.hypot((goalX - (ballX / 100) * 105), pitchY - 34);
  const anglePenalty = Math.min(0.42, Math.abs(pitchY - 34) / 34 * 0.34);
  const locationXg = 0.010 + 0.65 * Math.exp(-distance / 6.5) * (1 - anglePenalty);
  const boxBonus = distance <= 16 ? 0.018 : 0;
  const shooterMultiplier = clamp(
    0.85 + (shooter.player.attributes.sho - 70) * 0.0025 + (shooter.player.attributes.dri - 70) * 0.001,
    0.85,
    1.15
  );
  return clamp((locationXg + boxBonus) * shooterMultiplier, 0.01, 0.45);
}

interface TeamPower {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeper: number;
  overall: number;
}

function calculateTeamPower(manager: Manager): TeamPower {
  const starters = manager.squad.filter(s => s.isStarting && s.condition.state !== 'SUSPENDED');
  // Use the manager's assigned position when determining the tactical unit.
  // This makes manual positional switches (e.g. CM -> CAM, LB -> LWB,
  // ST -> CF) affect the simulation rather than leaving players in their
  // database category forever.
  const entryCategory = (s: SquadPlayerEntry) =>
    getPositionCategory(s.assignedPosition || s.player.position);

  const attackPlayers = starters.filter(s => entryCategory(s) === 'ATT');
  const midfieldPlayers = starters.filter(s => entryCategory(s) === 'MID');
  const defensePlayers = starters.filter(s => entryCategory(s) === 'DEF');
  const goalkeeper = starters.find(s => entryCategory(s) === 'GK') || starters[0];

  const rolePerformance = (s: SquadPlayerEntry) => {
    const position = s.assignedPosition || s.player.position;
    const fit = calculatePositionFit(s.player.position, s.player.alternatePositions || [], position);
    const a = s.player.attributes;
    let raw = 0;

    if (getPositionCategory(position) === 'ATT') {
      raw = a.sho * 0.42 + a.pac * 0.22 + a.dri * 0.23 + a.pas * 0.13;
    } else if (getPositionCategory(position) === 'MID') {
      const attackingMid = ['CAM', 'LM', 'RM'].includes(position);
      raw = a.pas * (attackingMid ? 0.32 : 0.42) +
        a.dri * 0.24 + a.phy * 0.14 +
        a.sho * (attackingMid ? 0.18 : 0.08) +
        a.pac * 0.08 + a.def * 0.04;
    } else if (getPositionCategory(position) === 'DEF') {
      const wideDefender = ['LB', 'RB', 'LWB', 'RWB'].includes(position);
      raw = a.def * 0.45 + a.phy * 0.20 +
        a.pac * (wideDefender ? 0.20 : 0.10) +
        a.pas * 0.15 + a.dri * (wideDefender ? 0.05 : 0.10);
    } else {
      raw = a.dri * 0.30 + a.sho * 0.20 + a.pas * 0.15 +
        a.def * 0.15 + a.phy * 0.20;
    }

    const conditionMultiplier = s.condition.state === 'INJURED' || s.condition.state === 'SUSPENDED' ? 0.85 : 1;
    return raw * (0.70 + fit * 0.003) * conditionMultiplier;
  };

  const attack = average(attackPlayers.map(rolePerformance), manager.teamOverall || 70);
  const midfield = average(midfieldPlayers.map(rolePerformance), manager.teamOverall || 70);
  const defense = average(defensePlayers.map(rolePerformance), manager.teamOverall || 70);

  const goalkeeperPower = goalkeeper
    ? rolePerformance(goalkeeper)
    : manager.teamOverall || 70;

  const tactics = manager.tactics || {
    style: 'Balanced',
    mentality: 'Balanced',
    defensiveLine: 50,
    pressingIntensity: 50,
    attackWidth: 50,
    tempo: 50,
    risk: 50,
  };

  // Tactical sliders have real trade-offs rather than being free upgrades.
  let effectiveAttack =
    attack +
    (tactics.tempo - 50) * 0.045 +
    (tactics.risk - 50) * 0.055 +
    (tactics.attackWidth - 50) * 0.012;
  let effectiveMidfield =
    midfield +
    (tactics.attackWidth - 50) * 0.018 +
    (tactics.pressingIntensity - 50) * 0.018;
  let effectiveDefense =
    defense +
    (tactics.defensiveLine - 50) * 0.022 -
    (tactics.risk - 50) * 0.032 -
    Math.max(0, tactics.attackWidth - 65) * 0.018 -
    Math.max(0, tactics.defensiveLine - 65) * 0.040;

  if (tactics.style === 'Possession') effectiveMidfield += 5;
  if (tactics.style === 'High Press') {
    effectiveAttack += 2;
    effectiveDefense += 2;
  }
  if (tactics.style === 'Counter Attack') effectiveAttack += 4;
  if (tactics.style === 'Low Block') {
    effectiveDefense += 6;
    effectiveAttack -= 2;
  }
  if (tactics.style === 'Long Ball') effectiveAttack += 2;
  if (tactics.style === 'Aggressive') {
    effectiveAttack += 4;
    effectiveDefense -= 2;
  }

  // Roles now have real, bounded effects. They are never large enough to replace
  // player quality, but a good specialist can matter in the situations they own.
  const roles = manager.roles || { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' };
  const starterIds = new Set(starters.map(s => s.player.id));
  const captainBoost = starterIds.has(roles.captainId) ? 1.2 : 0;
  const freeKickBoost = starterIds.has(roles.freeKickTakerId) ? 0.8 : 0;
  const cornerBoost = starterIds.has(roles.cornerTakerId) ? 0.8 : 0;
  effectiveAttack += captainBoost + freeKickBoost + cornerBoost;
  if (tactics.mentality === 'Defensive') {
    effectiveDefense *= 1.10;
    effectiveAttack *= 0.95;
  } else if (tactics.mentality === 'Aggressive') {
    effectiveAttack *= 1.10;
    effectiveDefense *= 0.95;
  } else {
    effectiveMidfield *= 1.10;
    effectiveAttack *= 0.975;
    effectiveDefense *= 0.975;
  }

  // High fatigue slightly reduces effective output without making tired players useless.
  const fatigue = average(starters.map(s => s.condition.fatigue || 0), 0);
  const intensityLoad =
    Math.max(0, tactics.pressingIntensity - 50) * 0.0007 +
    Math.max(0, tactics.tempo - 50) * 0.00035 +
    Math.max(0, tactics.risk - 50) * 0.00025;
  const fatigueFactor = Math.max(0.84, 1 - fatigue * 0.0015 - intensityLoad);

  effectiveAttack *= fatigueFactor;
  effectiveMidfield *= fatigueFactor;
  effectiveDefense *= fatigueFactor;

  return {
    attack: Math.max(1, effectiveAttack),
    midfield: Math.max(1, effectiveMidfield),
    defense: Math.max(1, effectiveDefense),
    goalkeeper: Math.max(1, goalkeeperPower * fatigueFactor),
    overall: Math.max(1, (effectiveAttack + effectiveMidfield + effectiveDefense + goalkeeperPower) / 4),
  };
}

function normalizeEventTimeline(events: MatchEvent[], firstHalfEnd: number, secondHalfEnd: number): void {
  const toSeconds = (event: MatchEvent) => (event.minute || 0) * 60 + (event.second || 0);
  const setSeconds = (event: MatchEvent, total: number) => {
    event.minute = Math.floor(total / 60);
    event.second = total % 60;
  };

  const halftimeIndex = events.findIndex(event => event.type === 'halftime');
  if (halftimeIndex >= 0) {
    let cursor = 1;
    for (let i = 0; i < halftimeIndex; i++) {
      const maxBeforeWhistle = Math.max(cursor, firstHalfEnd - 1);
      const next = Math.min(Math.max(toSeconds(events[i]), cursor), maxBeforeWhistle);
      setSeconds(events[i], next);
      cursor = next;
    }
    setSeconds(events[halftimeIndex], firstHalfEnd);
    cursor = firstHalfEnd;
    const secondKickoff = events.findIndex((event, index) => index > halftimeIndex && event.type === 'kickoff');
    if (secondKickoff >= 0) {
      setSeconds(events[secondKickoff], firstHalfEnd + 1);
      cursor = firstHalfEnd + 1;
    }
    for (let i = halftimeIndex + 1; i < events.length; i++) {
      if (i === secondKickoff) continue;
      const event = events[i];
      const current = toSeconds(event);
      if (event.type === 'extra_time_start' || event.type === 'penalty_shootout_start') break;
      const next = Math.max(cursor, Math.min(current, secondHalfEnd - 1));
      setSeconds(event, next);
      cursor = next;
    }
  }

  const extraStart = events.findIndex(event => event.type === 'extra_time_start');
  const extraHalf = events.findIndex(event => event.type === 'extra_time_half');
  const extraEnd = events.findIndex(event => event.type === 'extra_time_end');
  if (extraStart >= 0) {
    setSeconds(events[extraStart], secondHalfEnd);
    let cursor = secondHalfEnd;
    const end = extraHalf >= 0 ? extraHalf : extraEnd >= 0 ? extraEnd : events.length;
    for (let i = extraStart + 1; i < end; i++) {
      const next = Math.max(cursor, Math.min(toSeconds(events[i]), 105 * 60 - 1));
      setSeconds(events[i], next);
      cursor = next;
    }
    if (extraHalf >= 0) {
      setSeconds(events[extraHalf], 105 * 60);
      cursor = 105 * 60;
    }
    if (extraEnd >= 0) {
      for (let i = extraHalf >= 0 ? extraHalf + 1 : extraStart + 1; i < extraEnd; i++) {
        const next = Math.max(cursor, Math.min(toSeconds(events[i]), 120 * 60 - 1));
        setSeconds(events[i], next);
        cursor = next;
      }
      setSeconds(events[extraEnd], 120 * 60);
    }
  }

  const shootoutStart = events.findIndex(event => event.type === 'penalty_shootout_start');
  if (shootoutStart >= 0) {
    let cursor = extraEnd >= 0 ? toSeconds(events[extraEnd]) : secondHalfEnd;
    for (let i = shootoutStart; i < events.length; i++) {
      if (events[i].type === 'fulltime') continue;
      const next = Math.max(cursor, toSeconds(events[i]));
      setSeconds(events[i], next);
      cursor = next;
    }
  }

  let previous = 0;
  for (const event of events) {
    const current = toSeconds(event);
    const next = Math.max(previous, current);
    setSeconds(event, next);
    previous = next;
  }
}

function createPrng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPlayerNumber(starters: SquadPlayerEntry[], playerId: string): number {
  const entry = starters.find(candidate => candidate.player.id === playerId);
  if (!entry) return 9;
  if (getPositionCategory(entry.assignedPosition || entry.player.position) === 'GK') return 1;
  if (Number.isInteger(entry.startingSlotIndex)) return (entry.startingSlotIndex as number) + 1;
  const index = starters.findIndex(candidate => candidate.player.id === playerId);
  return index >= 0 ? index + 1 : 9;
}

function orderStartersForFormation(starters: SquadPlayerEntry[], slots: Array<{ index: number; position: Position; category: PositionCategory }>): SquadPlayerEntry[] {
  const source = starters.filter(Boolean);
  const used = new Set<string>();
  const ordered: SquadPlayerEntry[] = [];
  for (const slot of slots) {
    const candidate = source.find(entry => entry.startingSlotIndex === slot.index && !used.has(entry.player.id)) ||
      source
        .filter(entry => !used.has(entry.player.id))
        .sort((a, b) => {
          const aFit = calculatePositionFit(a.player.position, a.player.alternatePositions || [], slot.position);
          const bFit = calculatePositionFit(b.player.position, b.player.alternatePositions || [], slot.position);
          const aCat = getPositionCategory(a.assignedPosition || a.player.position) === slot.category ? 1 : 0;
          const bCat = getPositionCategory(b.assignedPosition || b.player.position) === slot.category ? 1 : 0;
          return bCat - aCat || bFit - aFit;
        })[0];
    if (!candidate) continue;
    used.add(candidate.player.id);
    ordered.push(candidate);
  }
  return ordered;
}

/**
 * Resolves overlapping players so they maintain visual distance while preserving tactical shape.
 * Enforces minimum visual distance so midfield and clustered zones remain completely readable.
 */
function resolveCollisionSeparation(coords: LivePlayerPosition[], activePlayerId?: string): LivePlayerPosition[] {
  const resolved = coords.map(p => ({ ...p }));
  const MIN_DIST = 6.0; // Minimum distance in % coordinates on horizontal pitch
  const PASSES = 8;     // 8 iterative relaxation passes for clean, organic spreading

  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const p1 = resolved[i];
        const p2 = resolved[j];

        let dx = p2.x - p1.x;
        let dy = p2.y - p1.y;
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
          dx = (j % 2 === 0 ? 1 : -1) * 0.5;
          dy = (i % 2 === 0 ? 1 : -1) * 0.5;
        }
        // Pitch aspect ratio compensation (105 / 68 = ~1.54)
        const dist = Math.hypot(dx, dy * 1.54);

        if (dist < MIN_DIST) {
          const overlap = (MIN_DIST - dist) / 2;
          const nx = dx / (dist || 0.001);
          const ny = dy / (dist || 0.001);

          const p1IsActive = p1.id === activePlayerId || p1.hasBall;
          const p2IsActive = p2.id === activePlayerId || p2.hasBall;

          if (p1IsActive && !p2IsActive) {
            // Keep active ball carrier pinned; push the other player away
            p2.x += nx * overlap * 2.2;
            p2.y += ny * overlap * 2.2;
          } else if (p2IsActive && !p1IsActive) {
            // Keep active ball carrier pinned; push p1 away
            p1.x -= nx * overlap * 2.2;
            p1.y -= ny * overlap * 2.2;
          } else {
            // Symmetrically push both players apart naturally
            p1.x -= nx * overlap * 1.05;
            p1.y -= ny * overlap * 1.05;
            p2.x += nx * overlap * 1.05;
            p2.y += ny * overlap * 1.05;
          }

          // Bound clamp
          p1.x = Math.max(4.0, Math.min(96.0, p1.x));
          p1.y = Math.max(7.0, Math.min(93.0, p1.y));
          p2.x = Math.max(4.0, Math.min(96.0, p2.x));
          p2.y = Math.max(7.0, Math.min(93.0, p2.y));
        }
      }
    }
  }

  // Ensure starting goalkeepers stay firmly anchored inside their penalty areas
  for (const p of resolved) {
    if (p.number === 1) {
      if (p.team === 'home') {
        p.x = Math.max(4.5, Math.min(13.0, p.x));
        p.y = Math.max(36.0, Math.min(64.0, p.y));
      } else {
        p.x = Math.max(87.0, Math.min(95.5, p.x));
        p.y = Math.max(36.0, Math.min(64.0, p.y));
      }
    }
  }

  return resolved;
}

/**
 * Calculate dynamic 2D coordinates for all 22 players on the pitch based on:
 * - base formation slots
 * - ball position (ballX: 0 to 100, ballY: 0 to 100)
 * - attacking/defending team roles
 * - team tactics (defensiveLine, pressingIntensity, attackWidth)
 * - active ball carrier and target receiver
 */
function tacticalShapeAdjustments(tactics: any, possession: 'home' | 'away', isHome: boolean) {
  const style = tactics?.style || 'Balanced';
  const mentality = tactics?.mentality || 'Balanced';
  const teamHasBall = possession === (isHome ? 'home' : 'away');
  let depth = 0, width = 1, forwardRun = 0, compact = 0;
  if (style === 'Possession') { depth += teamHasBall ? 3 : 1; width += 0.10; compact += teamHasBall ? -1 : 2; }
  else if (style === 'High Press') { depth += teamHasBall ? 4 : 7; forwardRun += 2; compact += 1; }
  else if (style === 'Counter Attack') { depth += teamHasBall ? 7 : -5; forwardRun += teamHasBall ? 5 : 0; width += 0.04; }
  else if (style === 'Low Block') { depth += teamHasBall ? -1 : -9; compact += 7; width -= 0.08; }
  else if (style === 'Long Ball') { depth += teamHasBall ? 5 : -2; forwardRun += teamHasBall ? 4 : 1; width += 0.03; }
  else if (style === 'Aggressive') { depth += teamHasBall ? 6 : 5; forwardRun += 4; width += 0.05; }
  if (mentality === 'Aggressive') { depth += teamHasBall ? 3 : 2; forwardRun += 3; }
  else if (mentality === 'Defensive') { depth -= teamHasBall ? 2 : 5; compact += 4; width -= 0.04; }
  depth += ((tactics?.defensiveLine || 50) - 50) * 0.10;
  width *= 0.92 + ((tactics?.attackWidth || 50) / 100) * 0.16;
  return { depth, width, forwardRun, compact };
}

function generate22PlayerCoordinates(
  homeStarters: SquadPlayerEntry[],
  awayStarters: SquadPlayerEntry[],
  homeFormation: string,
  awayFormation: string,
  homeTactics: any,
  awayTactics: any,
  ballX: number,
  ballY: number,
  possession: 'home' | 'away',
  activePlayerId?: string,
  targetPlayerId?: string,
  activeAction?: 'idle' | 'running' | 'passing' | 'shooting' | 'diving' | 'tackling' | 'celebrating'
): LivePlayerPosition[] {
  const homeConfig = FORMATIONS_CONFIG[homeFormation as keyof typeof FORMATIONS_CONFIG] || FORMATIONS_CONFIG['4-3-3'];
  const awayConfig = FORMATIONS_CONFIG[awayFormation as keyof typeof FORMATIONS_CONFIG] || FORMATIONS_CONFIG['4-3-3'];

  const coords: LivePlayerPosition[] = [];
  const orderedHomeStarters = orderStartersForFormation(homeStarters, homeConfig.slots);
  const orderedAwayStarters = orderStartersForFormation(awayStarters, awayConfig.slots);

  // Home Outfielders (defend left goal X=3, attack right goal X=97)
  orderedHomeStarters.forEach((entry, idx) => {
    const slot = homeConfig.slots[entry.startingSlotIndex ?? idx] || { x: 50, y: 50, position: entry.assignedPosition || 'CM', category: entry.player.category };
    const isGK = slot.category === 'GK';

    let x = 0;
    let y = 0;
    let action: LivePlayerPosition['action'] = 'idle';

    if (isGK) {
      // Home GK patrols X=5.5 to X=12, tracks ball Y angle
      const ballYAngle = 50 + (ballY - 50) * 0.22;
      x = Math.max(5.5, Math.min(12, 6.5 + (ballX > 50 ? 2.5 : (ballX - 20) * 0.14)));
      y = Math.max(38, Math.min(62, ballYAngle));

      if (possession === 'away' && ballX < 28 && (activeAction === 'shooting' || activeAction === 'diving')) {
        action = 'diving';
        y = Math.max(35, Math.min(65, ballY));
      } else if (entry.player.id === activePlayerId) {
        action = activeAction || 'passing';
      }
    } else {
      // Outfield base position
      const shape = tacticalShapeAdjustments(homeTactics, possession, true);
      let baseDepth = 15 + (slot.y / 100) * 65 + shape.depth;
      const baseWidth = 12 + (slot.x / 100) * 76;

      // Stagger midfield lines so CDMs, CMs, and CAMs don't cluster
      if (slot.position === 'CDM') baseDepth -= 5;
      else if (slot.position === 'CAM') baseDepth += 5;

      const highLineBoost = ((homeTactics?.defensiveLine || 50) - 50) * 0.15;
      const widthFactor = (homeTactics?.attackWidth || 50) / 50;

      if (possession === 'home') {
        // Pushing forward into attack
        const pushX = (ballX - 45) * 0.32 + highLineBoost + shape.forwardRun;
        x = Math.min(93, Math.max(16, baseDepth + pushX));
        const lateralShift = (ballY - 50) * 0.18;
        y = Math.min(91, Math.max(9, 50 + (baseWidth - 50) * widthFactor + lateralShift));

        // Forwards make runs into space
        if (slot.category === 'ATT' && ballX > 50) {
          x = Math.min(94, x + 5);
          action = 'running';
        }
      } else {
        // Defending shape: drop back and compact
        const dropX = Math.min(12, (50 - ballX) * 0.26);
        x = Math.min(84, Math.max(15, baseDepth - dropX + highLineBoost * 0.4));
        const compactWidth = 50 + (baseWidth - 50) * Math.max(0.62, 0.82 - shape.compact * 0.018) * shape.width + (ballY - 50) * 0.14;
        y = Math.min(89, Math.max(11, compactWidth));

        // Nearest defender to ball closes down
        const dist = Math.hypot(x - ballX, y - ballY);
        if (dist < 18 && (slot.category === 'DEF' || slot.category === 'MID')) {
          action = activeAction === 'tackling' && entry.player.id === activePlayerId ? 'tackling' : 'running';
        }
      }

      // If active ball carrier or target receiver
      if (entry.player.id === activePlayerId) {
        if (activeAction === 'passing') {
          action = 'passing';
        } else if (activeAction === 'shooting' || activeAction === 'celebrating' || activeAction === 'diving') {
          x = Math.min(82, Math.max(68, baseDepth + 10));
          y = Math.min(75, Math.max(25, baseWidth));
          action = activeAction;
        } else if (activeAction === 'tackling') {
          x = ballX + (possession === 'home' ? -3.5 : 3.5);
          y = ballY + (idx % 2 === 0 ? 2 : -2);
          action = 'tackling';
        } else {
          x = ballX;
          y = ballY;
          action = activeAction || 'idle';
        }
      } else if (entry.player.id === targetPlayerId) {
        if (activeAction === 'diving') {
          action = 'diving';
        } else {
          x = ballX;
          y = ballY;
          action = activeAction === 'tackling' ? 'idle' : 'running';
        }
      }
    }

    const hasBall = (activeAction === 'passing' ? entry.player.id === targetPlayerId : entry.player.id === activePlayerId);

    coords.push({
      id: entry.player.id,
      name: entry.player.name,
      number: getPlayerNumber(orderedHomeStarters, entry.player.id),
      position: (entry.assignedPosition || slot.position || entry.player.position) as any,
      category: entry.player.category,
      overall: entry.player.overall,
      team: 'home',
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      hasBall: Boolean(hasBall),
      action,
    });
  });

  // Away Outfielders (defend right goal X=97, attack left goal X=3)
  orderedAwayStarters.forEach((entry, idx) => {
    const slot = awayConfig.slots[entry.startingSlotIndex ?? idx] || { x: 50, y: 50, position: entry.assignedPosition || 'CM', category: entry.player.category };
    const isGK = slot.category === 'GK';

    let x = 0;
    let y = 0;
    let action: LivePlayerPosition['action'] = 'idle';

    if (isGK) {
      // Away GK patrols X=88 to X=94.5, tracks ball Y angle
      const ballYAngle = 50 + (ballY - 50) * 0.22;
      x = Math.min(94.5, Math.max(88, 93.5 - (ballX < 50 ? 2.5 : (80 - ballX) * 0.14)));
      y = Math.max(38, Math.min(62, ballYAngle));

      if (possession === 'home' && ballX > 72 && (activeAction === 'shooting' || activeAction === 'diving')) {
        action = 'diving';
        y = Math.max(35, Math.min(65, ballY));
      } else if (entry.player.id === activePlayerId) {
        action = activeAction || 'passing';
      }
    } else {
      const shape = tacticalShapeAdjustments(awayTactics, possession, false);
      let baseDepth = 100 - (15 + (slot.y / 100) * 65) - shape.depth;
      const baseWidth = 100 - (12 + (slot.x / 100) * 76);

      if (slot.position === 'CDM') baseDepth += 5;
      else if (slot.position === 'CAM') baseDepth -= 5;

      const highLineBoost = ((awayTactics?.defensiveLine || 50) - 50) * 0.15;
      const widthFactor = (awayTactics?.attackWidth || 50) / 50;

      if (possession === 'away') {
        const pushX = (55 - ballX) * 0.32 + highLineBoost + shape.forwardRun;
        x = Math.max(7, Math.min(84, baseDepth - pushX));
        const lateralShift = (ballY - 50) * 0.18;
        y = Math.min(91, Math.max(9, 50 + (baseWidth - 50) * widthFactor + lateralShift));

        if (slot.category === 'ATT' && ballX < 50) {
          x = Math.max(6, x - 5);
          action = 'running';
        }
      } else {
        const dropX = Math.min(12, (ballX - 50) * 0.26);
        x = Math.max(16, Math.min(85, baseDepth + dropX - highLineBoost * 0.4));
        const compactWidth = 50 + (baseWidth - 50) * Math.max(0.62, 0.82 - shape.compact * 0.018) * shape.width + (ballY - 50) * 0.14;
        y = Math.min(89, Math.max(11, compactWidth));

        const dist = Math.hypot(x - ballX, y - ballY);
        if (dist < 18 && (slot.category === 'DEF' || slot.category === 'MID')) {
          action = activeAction === 'tackling' && entry.player.id === activePlayerId ? 'tackling' : 'running';
        }
      }

      if (entry.player.id === activePlayerId) {
        if (activeAction === 'passing') {
          action = 'passing';
        } else if (activeAction === 'shooting' || activeAction === 'celebrating' || activeAction === 'diving') {
          x = Math.max(18, Math.min(32, baseDepth - 10));
          y = Math.min(75, Math.max(25, baseWidth));
          action = activeAction;
        } else if (activeAction === 'tackling') {
          x = ballX + (possession === 'away' ? 3.5 : -3.5);
          y = ballY + (idx % 2 === 0 ? -2 : 2);
          action = 'tackling';
        } else {
          x = ballX;
          y = ballY;
          action = activeAction || 'idle';
        }
      } else if (entry.player.id === targetPlayerId) {
        if (activeAction === 'diving') {
          action = 'diving';
        } else {
          x = ballX;
          y = ballY;
          action = activeAction === 'tackling' ? 'idle' : 'running';
        }
      }
    }

    const hasBall = (activeAction === 'passing' ? entry.player.id === targetPlayerId : entry.player.id === activePlayerId);

    coords.push({
      id: entry.player.id,
      name: entry.player.name,
      number: getPlayerNumber(orderedAwayStarters, entry.player.id),
      position: (entry.assignedPosition || slot.position || entry.player.position) as any,
      category: entry.player.category,
      overall: entry.player.overall,
      team: 'away',
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      hasBall: Boolean(hasBall),
      action,
    });
  });

  return resolveCollisionSeparation(coords, activeAction === 'passing' ? targetPlayerId : activePlayerId);
}

const DEFAULT_MATCH_TACTICS = {
  style: 'Balanced' as const,
  mentality: 'Balanced' as const,
  defensiveLine: 50,
  pressingIntensity: 50,
  attackWidth: 50,
  tempo: 50,
  risk: 50,
};

function normalizeManagerForMatch(manager: Manager): Manager {
  const squad = Array.isArray(manager.squad) ? manager.squad.filter(Boolean) : [];
  const normalizedSquad = squad
    .filter((entry) => entry?.player?.id && entry.player.overall !== undefined)
    .map((entry) => {
      const attributes = { ...entry.player.attributes };
      for (const key of ['pac', 'sho', 'pas', 'dri', 'def', 'phy'] as const) {
        if (!Number.isFinite(Number(attributes?.[key]))) {
          console.warn(`[simulation] missing ${key} for player ${entry.player.id}; using 50`);
          attributes[key] = 50;
        }
      }
      return {
        ...entry,
        isStarting: Boolean(entry.isStarting),
        condition: entry.condition || {
          state: 'FIT' as const,
          fatigue: 0,
          injuryMatchesLeft: 0,
          yellowCards: 0,
          redCards: 0,
          suspensionMatchesLeft: 0,
        },
        assignedPosition: entry.assignedPosition || entry.player?.position,
        player: {
          ...entry.player,
          alternatePositions: Array.isArray(entry.player?.alternatePositions) ? entry.player.alternatePositions : [],
          attributes,
        },
      };
    });

  if (normalizedSquad.length < 11) {
    throw new Error(`Cannot simulate ${manager.name || 'team'}: squad has ${normalizedSquad.length}/11 players. Finish the squad before playing.`);
  }

  const formation = manager.formation || '4-3-3';
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const explicitStarters = normalizedSquad.filter(s => s.isStarting);
  const source = explicitStarters.length === 11 ? explicitStarters : normalizedSquad.slice(0, 11);
  if (explicitStarters.length !== 11) {
    console.warn(`[simulation] ${manager.name || 'team'} has ${explicitStarters.length} explicit starters; assigning the 11-player squad to formation slots.`);
  }

  const used = new Set<string>();
  const ordered: SquadPlayerEntry[] = [];
  for (const slot of config.slots) {
    const exact = source.find(entry => entry.startingSlotIndex === slot.index && !used.has(entry.player.id));
    const candidate = exact || source
      .filter(entry => !used.has(entry.player.id))
      .sort((a, b) => {
        const aCat = getPositionCategory(a.assignedPosition || a.player.position) === slot.category ? 1 : 0;
        const bCat = getPositionCategory(b.assignedPosition || b.player.position) === slot.category ? 1 : 0;
        return bCat - aCat ||
          calculatePositionFit(b.player.position, b.player.alternatePositions || [], slot.position) -
          calculatePositionFit(a.player.position, a.player.alternatePositions || [], slot.position);
      })[0];
    if (!candidate) continue;
    used.add(candidate.player.id);
    ordered.push({
      ...candidate,
      isStarting: true,
      startingSlotIndex: slot.index,
      assignedPosition: candidate.assignedPosition || slot.position,
    });
  }

  if (ordered.length < 11) {
    throw new Error(`Cannot simulate ${manager.name || 'team'}: unable to map 11 players onto formation slots.`);
  }

  const starterIds = new Set(ordered.map(s => s.player.id));
  const repairedSquad = normalizedSquad.map(s => ({
    ...s,
    isStarting: starterIds.has(s.player.id),
  }));

  const safeTactics = {
    ...DEFAULT_MATCH_TACTICS,
    ...(manager.tactics || {}),
  };

  return {
    ...manager,
    formation,
    tactics: safeTactics,
    squad: ordered.map(entry => ({ ...entry, isStarting: true })).concat(
      repairedSquad.filter(s => !starterIds.has(s.player.id))
    ),
    teamOverall: Number.isFinite(Number(manager.teamOverall))
      ? Number(manager.teamOverall)
      : calculateTeamOverall(formation, repairedSquad),
  };
}
export function simulateMatch(
  homeManager: Manager,
  awayManager: Manager,
  fixtureId: string,
  matchday: number,
  customSeed?: number,
  isKnockout = false,
  roundName?: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final',
  forcePenalties = false
): Fixture {
  homeManager = normalizeManagerForMatch(homeManager);
  awayManager = normalizeManagerForMatch(awayManager);
  const seed = customSeed ?? (Date.now() ^ (matchday * 1337));
  const rand = createPrng(seed);

  const homeStarters = homeManager.squad.filter(s => s.isStarting);
  const awayStarters = awayManager.squad.filter(s => s.isStarting);

  const homeOvr = calculateTeamOverall(homeManager.formation, homeManager.squad);
  const awayOvr = calculateTeamOverall(awayManager.formation, awayManager.squad);
  let homePower = calculateTeamPower(homeManager);
  let awayPower = calculateTeamPower(awayManager);

  // Home advantage affects possession, chance creation and defensive confidence,
  // rather than simply adding a large amount to player ratings.
  const homeAdvantage = isKnockout ? 1.0 : 2.4;
  const homeTactics = homeManager.tactics;
  const awayTactics = awayManager.tactics;
  const homeRoles = homeManager.roles || { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' };
  const awayRoles = awayManager.roles || { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' };

  // Initialize player match statistics
  const playerStatsMap = new Map<string, PlayerMatchStat>();

  for (const s of homeStarters) {
    playerStatsMap.set(s.player.id, {
      playerId: s.player.id,
      playerName: s.player.name,
      team: 'home',
      minutes: 90,
      goals: 0,
      assists: 0,
      shots: 0,
      passes: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      yellowCard: false,
      redCard: false,
      fouls: 0,
      rating: 6.0,
    });
  }

  for (const s of awayStarters) {
    playerStatsMap.set(s.player.id, {
      playerId: s.player.id,
      playerName: s.player.name,
      team: 'away',
      minutes: 90,
      goals: 0,
      assists: 0,
      shots: 0,
      passes: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      yellowCard: false,
      redCard: false,
      fouls: 0,
      rating: 6.0,
    });
  }

  const recordShot = (stats: TeamMatchStats, player: PlayerMatchStat | undefined, onTarget: boolean, goal: boolean) => {
    stats.shots++;
    if (onTarget) stats.shotsOnTarget++;
    if (goal && player) {
      player.goals++;
      player.rating += 1.4;
    }
    if (player) player.shots++;
  };

  const events: MatchEvent[] = [];
  const sentOffIds = new Set<string>();
  let homeScore = 0;
  let awayScore = 0;

  const homeStats: TeamMatchStats = {
    score: 0,
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passAccuracy: 85,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    offsides: 0,
  };

  const awayStats: TeamMatchStats = {
    score: 0,
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passAccuracy: 85,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    offsides: 0,
  };

  // OVR is a reference signal; actual attributes, roles and tactics drive most of the outcome.
  const homeEffective = homeOvr * 0.30 + homePower.overall * 0.70;
  const awayEffective = awayOvr * 0.30 + awayPower.overall * 0.70;
  const diff = (homeEffective + homeAdvantage) - awayEffective;
  let momentum = Number((diff * 3).toFixed(1));
  const homeWeight = Math.exp(Math.max(-8, Math.min(8, (homeEffective + homeAdvantage) / 12)));
  const awayWeight = Math.exp(Math.max(-8, Math.min(8, awayEffective / 12)));
  const rawDraw = Math.max(0.20, Math.min(0.36, 0.30 - Math.abs(diff) * 0.0022));
  const nonDraw = 1 - rawDraw;
  const totalWeight = homeWeight + awayWeight;
  const homeWinProbability = Number((nonDraw * (homeWeight / totalWeight) * 100).toFixed(1));
  const awayWinProbability = Number((nonDraw * (awayWeight / totalWeight) * 100).toFixed(1));
  const drawProbability = Number((100 - homeWinProbability - awayWinProbability).toFixed(1));

  // Helper getters for players
  const getPlayersByCat = (starters: SquadPlayerEntry[], cat: 'GK' | 'DEF' | 'MID' | 'ATT') =>
    starters.filter(s => getPositionCategory(s.assignedPosition || s.player.position) === cat);

  const homeGK = getPlayersByCat(homeStarters, 'GK')[0] || homeStarters[0];
  const awayGK = getPlayersByCat(awayStarters, 'GK')[0] || awayStarters[0];

  const homeMids = getPlayersByCat(homeStarters, 'MID');
  const awayMids = getPlayersByCat(awayStarters, 'MID');

  const homeDefs = getPlayersByCat(homeStarters, 'DEF');
  const awayDefs = getPlayersByCat(awayStarters, 'DEF');

  const homeAtts = getPlayersByCat(homeStarters, 'ATT');
  const awayAtts = getPlayersByCat(awayStarters, 'ATT');

  // Helper random picker
  const pick = <T>(arr: T[], label = 'player pool'): T => {
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`Match simulation has no valid ${label}.`);
    }
    return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
  };

  // Helper to add event
  const pushEvent = (event: Omit<MatchEvent, 'id' | 'currentScore'>) => {
    const actor = event.playerCoordinates?.find(p => p.id === event.playerId);
    const isChance = ['shot', 'shot_saved', 'shot_missed', 'shot_blocked', 'goal'].includes(event.type);
    const inferredChance = isChance
      ? Number(Math.max(5, Math.min(100, (actor?.overall || 70) * 0.72 + Math.abs(event.momentum || 0) * 0.08)).toFixed(1))
      : undefined;

    events.push({
      ...event,
      id: `ev-${events.length + 1}-${event.minute}-${event.second || 0}`,
      currentScore: { home: homeScore, away: awayScore },
      chanceQuality: event.chanceQuality ?? inferredChance,
    });
  };

  // Monotonically increasing match clock generator (Requirement 8)
  let currentTotalSeconds = 1; // 00:01 Kickoff
  const firstHalfEnd = 2700 + 60 + Math.floor(rand() * 180);
  const secondHalfEnd = 5400 + 60 + Math.floor(rand() * 300);

  // 1. First Half Kickoff (00:01)
  const homeKicker = pick(homeAtts.length > 0 ? homeAtts : homeStarters);
  const homeMidReceiver = pick(homeMids.length > 0 ? homeMids : homeStarters);
  const awayKicker = pick(awayAtts.length > 0 ? awayAtts : awayStarters);
  const awayMidReceiver = pick(awayMids.length > 0 ? awayMids : awayStarters);
  
  pushEvent({
    minute: 0,
    second: 1,
    type: 'kickoff',
    team: 'home',
    playerId: homeKicker.player.id,
    playerName: homeKicker.player.name,
    playerNumber: getPlayerNumber(homeStarters, homeKicker.player.id),
    targetPlayerId: homeMidReceiver.player.id,
    targetPlayerName: homeMidReceiver.player.name,
    commentary: `Referee blows the whistle and we are underway! ${homeKicker.player.name} touches off to ${homeMidReceiver.player.name}.`,
    ballCoordinates: { x: 50, y: 50 },
    ballStartCoordinates: { x: 50, y: 50 },
    playerCoordinates: generate22PlayerCoordinates(
      homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
      homeTactics, awayTactics, 50, 50, 'home', homeKicker.player.id, homeMidReceiver.player.id, 'passing'
    ),
    momentum,
  });

  let currentPossession: 'home' | 'away' = 'home';
  let ballX = 50;
  let ballY = 50;
  let halfTimeWhistled = false;
  let isCounterAttacking = false;

  // Simulate 90 minutes (up to 5350 seconds)
  while (currentTotalSeconds < secondHalfEnd) {
    // Half Time check at 45:00 (2700s)
    if (currentTotalSeconds >= firstHalfEnd && !halfTimeWhistled) {
      halfTimeWhistled = true;
      currentTotalSeconds = firstHalfEnd;

      pushEvent({
        minute: Math.floor(firstHalfEnd / 60),
        second: firstHalfEnd % 60,
        type: 'halftime',
        team: 'home',
        playerId: homeKicker.player.id,
        playerName: homeKicker.player.name,
        commentary: `HALF TIME! The referee brings an intense first half to a close. Current Score: ${homeManager.name} ${homeScore} - ${awayScore} ${awayManager.name}.`,
        ballCoordinates: { x: 50, y: 50 },
        ballStartCoordinates: { x: 50, y: 50 },
        playerCoordinates: generate22PlayerCoordinates(
          homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
          homeTactics, awayTactics, 50, 50, 'home', undefined, undefined, 'idle'
        ),
        momentum,
      });

      // Second-half kickoff follows the actual first-half whistle.
      currentTotalSeconds = firstHalfEnd + 1;
      const shAwayKicker = pick(awayAtts.length > 0 ? awayAtts : awayStarters);
      const shAwayMidRec = pick(awayMids.length > 0 ? awayMids : awayStarters);
      pushEvent({
        minute: Math.floor(currentTotalSeconds / 60),
        second: currentTotalSeconds % 60,
        type: 'kickoff',
        team: 'away',
        playerId: shAwayKicker.player.id,
        playerName: shAwayKicker.player.name,
        targetPlayerId: shAwayMidRec.player.id,
        targetPlayerName: shAwayMidRec.player.name,
        commentary: `Second half begins! ${awayManager.name} restarts play through ${shAwayKicker.player.name}.`,
        ballCoordinates: { x: 50, y: 50 },
        ballStartCoordinates: { x: 50, y: 50 },
        playerCoordinates: generate22PlayerCoordinates(
          homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
          homeTactics, awayTactics, 50, 50, 'away', shAwayKicker.player.id, shAwayMidRec.player.id, 'passing'
        ),
        momentum,
      });

      currentPossession = 'away';
      ballX = 50;
      ballY = 50;
      currentTotalSeconds += Math.floor(rand() * 25) + 20;
      continue;
    }

    const isHome: boolean = currentPossession === 'home';
    const attackingTeam = isHome ? homeManager : awayManager;
    const defendingTeam = isHome ? awayManager : homeManager;
    const attackingStarters = (isHome ? homeStarters : awayStarters).filter(s => !sentOffIds.has(s.player.id));
    const defendingStarters = (isHome ? awayStarters : homeStarters).filter(s => !sentOffIds.has(s.player.id));
    const atkStats = isHome ? homeStats : awayStats;
    const defStats = isHome ? awayStats : homeStats;
    const atkTactics = isHome ? homeTactics : awayTactics;
    const defTactics = isHome ? awayTactics : homeTactics;

    const atkMids = (isHome ? homeMids : awayMids).filter(s => !sentOffIds.has(s.player.id));
    const atkAtts = (isHome ? homeAtts : awayAtts).filter(s => !sentOffIds.has(s.player.id));
    const atkDefs = (isHome ? homeDefs : awayDefs).filter(s => !sentOffIds.has(s.player.id));
    const defDefs = (isHome ? awayDefs : homeDefs).filter(s => !sentOffIds.has(s.player.id));
    const defGK = isHome ? awayGK : homeGK;

    // Step 1: Progression Pass / Buildup (Tactics Influence: Possession vs Counter vs Long Ball)
    const isPossessionStyle = atkTactics.style === 'Possession' || atkTactics.tempo < 45;
    const isLongBallStyle = atkTactics.style === 'Long Ball';

    const passer = isLongBallStyle && atkDefs.length > 0 
      ? pick(atkDefs) 
      : pick(atkMids.length > 0 ? atkMids : attackingStarters);
    
    const receiverPool = (atkAtts.length > 0 ? atkAtts : attackingStarters)
      .filter(p => p.player.id !== passer.player.id);
    const receiver = pick(receiverPool.length > 0 ? receiverPool : attackingStarters, 'attacking receiver');

    const startX = ballX;
    const startY = ballY;

    // Fast counter-attack transition or standard buildup
    let advanceAmount = isCounterAttacking 
      ? 26 + rand() * 15 
      : isLongBallStyle 
      ? 22 + rand() * 14 
      : 14 + rand() * 12;

    const newBallX = isHome ? Math.min(86, ballX + advanceAmount) : Math.max(14, ballX - advanceAmount);
    const newBallY = 16 + rand() * 68;

    atkStats.passes += isPossessionStyle ? 3 : 2;
    const passerStat = playerStatsMap.get(passer.player.id);
    if (passerStat) passerStat.passes += 2;

    // Pass timestamp (advances 12-25 seconds)
    currentTotalSeconds += Math.floor(rand() * 14) + 12;
    const passMin = Math.floor(currentTotalSeconds / 60);
    const passSec = currentTotalSeconds % 60;

    const passCommentary = isCounterAttacking
      ? `⚡ Devastating counter-attack! Direct breakaway pass from ${passer.player.name} unleashes ${receiver.player.name}!`
      : isPossessionStyle
      ? `Fluid passing sequence. ${passer.player.name} orchestrates patient possession play into ${receiver.player.name}.`
      : isLongBallStyle
      ? `Over the top! ${passer.player.name} pumps a long diagonal delivery toward ${receiver.player.name}.`
      : `${passer.player.name} looks up and plays a crisp pass forward into the path of ${receiver.player.name}.`;

    pushEvent({
      minute: passMin,
      second: passSec,
      type: 'pass',
      team: isHome ? 'home' : 'away',
      playerId: passer.player.id,
      playerName: passer.player.name,
      targetPlayerId: receiver.player.id,
      targetPlayerName: receiver.player.name,
      commentary: passCommentary,
      ballCoordinates: { x: Number(newBallX.toFixed(1)), y: Number(newBallY.toFixed(1)) },
      ballStartCoordinates: { x: Number(startX.toFixed(1)), y: Number(startY.toFixed(1)) },
      playerCoordinates: generate22PlayerCoordinates(
        homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
        homeTactics, awayTactics, newBallX, newBallY, currentPossession, passer.player.id, receiver.player.id, 'passing'
      ),
      momentum,
    });

    ballX = newBallX;
    ballY = newBallY;
    const wasCounter = isCounterAttacking;
    isCounterAttacking = false; // reset counter flag after initial surge

    // Advance 8-16 seconds for the ensuing duel or shot
    currentTotalSeconds += Math.floor(rand() * 9) + 8;
    const actionMin = Math.floor(currentTotalSeconds / 60);
    const actionSec = currentTotalSeconds % 60;

    // Calculate Tactical Turnover Modifier (High Press vs Low Block vs Possession)
    const atkPower = isHome ? homePower : awayPower;
    const defPower = isHome ? awayPower : homePower;
    let turnoverThreshold = 0.44 + (defPower.midfield - atkPower.midfield) * 0.003;
    if (defTactics.style === 'High Press') turnoverThreshold += 0.08;
    turnoverThreshold += (defTactics.pressingIntensity - 50) * 0.0022;
    if (atkTactics.style === 'Possession') turnoverThreshold -= 0.05;
    if (defTactics.style === 'Low Block') turnoverThreshold -= 0.03;
    if (atkTactics.mentality === 'Defensive') turnoverThreshold += 0.015;
    if (atkTactics.mentality === 'Aggressive') turnoverThreshold += 0.02;
    turnoverThreshold += Math.max(0, atkTactics.tempo - 50) * 0.0012;
    turnoverThreshold += Math.max(0, atkTactics.risk - 50) * 0.0015;

    // Home sides get a small contextual edge in ball retention; it is deliberately
    // small enough that team/player quality still dominates.
    turnoverThreshold += isHome ? -0.012 : 0.012;

    // Extreme pressing/tempo/risk becomes a liability late in the match.
    // This prevents the "all sliders to 100" exploit.
    const minuteProgress = clamp((currentTotalSeconds / 60 - 45) / 45, 0, 1);
    const intensityFatigue =
      (Math.max(0, atkTactics.pressingIntensity - 60) * 0.0009 +
       Math.max(0, atkTactics.tempo - 60) * 0.00055 +
       Math.max(0, atkTactics.risk - 60) * 0.00045) * minuteProgress;
    turnoverThreshold += intensityFatigue;
    turnoverThreshold = Math.max(0.28, Math.min(0.58, turnoverThreshold));

    // Keep chance volume in a realistic range instead of making most possessions shots.
    const crossChance = Math.max(
      0.06,
      Math.min(
        0.13,
        0.11 +
          (atkTactics.attackWidth - 50) * 0.001 +
          (atkTactics.style === 'Long Ball' ? 0.03 : 0)
      )
    );
    const shotChance = Math.max(
      0.09,
      Math.min(
        0.17,
        0.125 +
          (atkTactics.tempo - 50) * 0.0009 +
          (atkTactics.risk - 50) * 0.0008 +
          (wasCounter ? 0.035 : 0)
      )
    );
    const crossCutoff = Math.min(0.82, turnoverThreshold + crossChance);
    const shotCutoff = Math.min(0.96, crossCutoff + shotChance);

    const actionRoll = rand();

    // ACTION A: Turnover / Tackle / Foul by Defender
    if (actionRoll < turnoverThreshold) {
      const defender = pick(defDefs.length > 0 ? defDefs : defendingStarters);
      const foulIntensity = clamp(
        0.13 +
        (defTactics.style === 'Aggressive' ? 0.12 : 0) +
        Math.max(0, defTactics.pressingIntensity - 65) * 0.0015 +
        Math.max(0, (currentTotalSeconds / 60) - 65) * 0.001,
        0.10,
        0.30
      );
      const isFoul = rand() < foulIntensity;

      if (isFoul) {
        defStats.fouls++;
        const defStatForFoul = playerStatsMap.get(defender.player.id);
        if (defStatForFoul) { defStatForFoul.fouls++; defStatForFoul.rating -= 0.15; }
        const isCard = rand() < 0.22;
        if (isCard) {
          defStats.yellowCards++;
          const defStat = playerStatsMap.get(defender.player.id);
          if (defStat?.yellowCard) {
            defStat.redCard = true;
            defStats.redCards++;
            sentOffIds.add(defender.player.id);
            homePower = calculateTeamPower(homeManager);
            awayPower = calculateTeamPower(awayManager);
            const affectedTeamIsHome = !isHome;
            const missingMultiplier = 0.90;
            if (affectedTeamIsHome) {
              homePower = { ...homePower, attack: homePower.attack * missingMultiplier, midfield: homePower.midfield * missingMultiplier, defense: homePower.defense * missingMultiplier, overall: homePower.overall * missingMultiplier };
            } else {
              awayPower = { ...awayPower, attack: awayPower.attack * missingMultiplier, midfield: awayPower.midfield * missingMultiplier, defense: awayPower.defense * missingMultiplier, overall: awayPower.overall * missingMultiplier };
            }
            pushEvent({
              minute: actionMin,
              second: actionSec,
              type: 'red_card',
              team: isHome ? 'away' : 'home',
              playerId: defender.player.id,
              playerName: defender.player.name,
              commentary: `🟥 SECOND YELLOW! ${defender.player.name} is sent off after receiving a second caution.`,
              ballCoordinates: { x: ballX, y: ballY },
              ballStartCoordinates: { x: ballX, y: ballY },
              playerCoordinates: generate22PlayerCoordinates(
                homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
                homeTactics, awayTactics, ballX, ballY, currentPossession, defender.player.id, receiver.player.id, 'tackling'
              ),
              momentum: isHome ? momentum - 5 : momentum + 5,
            });
          } else {
            if (defStat) defStat.yellowCard = true;
            pushEvent({
              minute: actionMin,
              second: actionSec,
              type: 'yellow_card',
            team: isHome ? 'away' : 'home',
            playerId: defender.player.id,
            playerName: defender.player.name,
            commentary: `🟨 YELLOW CARD! ${defender.player.name} is booked after stopping ${receiver.player.name}'s attack with a cynical foul.`,
            ballCoordinates: { x: ballX, y: ballY },
            ballStartCoordinates: { x: ballX, y: ballY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, ballX, ballY, currentPossession, defender.player.id, receiver.player.id, 'tackling'
            ),
            momentum: isHome ? momentum + 3 : momentum - 3,
            });
          }
        } else {
          pushEvent({
            minute: actionMin,
            second: actionSec,
            type: 'foul',
            team: isHome ? 'away' : 'home',
            playerId: defender.player.id,
            playerName: defender.player.name,
            commentary: `Whistle blown! Foul committed by ${defender.player.name} battling for position with ${receiver.player.name}.`,
            ballCoordinates: { x: ballX, y: ballY },
            ballStartCoordinates: { x: ballX, y: ballY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, ballX, ballY, currentPossession, defender.player.id, receiver.player.id, 'tackling'
            ),
            momentum,
          });
        }
      } else {
        // Successful Tackle / Turnover
        defStats.tackles = (defStats.tackles || 0) + 1;
        const defStat = playerStatsMap.get(defender.player.id);
        if (defStat) {
          defStat.tackles += 1;
          defStat.rating += 0.15;
        }

        const tackleCommentary = defTactics.style === 'High Press'
          ? `Gegenpressing success! ${defender.player.name} swarms ${receiver.player.name} and forces an immediate turnover!`
          : `Superb timing! ${defender.player.name} steps in with a perfectly timed challenge to dispossess ${receiver.player.name}.`;

        pushEvent({
          minute: actionMin,
          second: actionSec,
          type: 'tackle',
          team: isHome ? 'away' : 'home',
          playerId: defender.player.id,
          playerName: defender.player.name,
          commentary: tackleCommentary,
          ballCoordinates: { x: ballX, y: ballY },
          ballStartCoordinates: { x: ballX, y: ballY },
          playerCoordinates: generate22PlayerCoordinates(
            homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
            homeTactics, awayTactics, ballX, ballY, currentPossession, defender.player.id, receiver.player.id, 'tackling'
          ),
          momentum: isHome ? momentum - 5 : momentum + 5,
        });

        // Turnover: check for Counter Attack style
        currentPossession = isHome ? 'away' : 'home';
        if (defTactics.style === 'Counter Attack' || defTactics.tempo > 75) {
          isCounterAttacking = true;
        }
      }
    }
    // ACTION B: Cross & Box Play (Aerial duels / Long balls)
    else if (actionRoll < crossCutoff) {
      const winger = receiver;
      const strikerPool = (atkAtts.length > 0 ? atkAtts : attackingStarters)
        .filter(p => p.player.id !== winger.player.id);
      const striker = pick(
        strikerPool.length > 0 ? strikerPool : attackingStarters,
        'cross target'
      );
      const crossTargetX = isHome ? 91 : 9;
      const crossTargetY = 44 + rand() * 12;

      pushEvent({
        minute: actionMin,
        second: actionSec,
        type: 'cross',
        team: isHome ? 'home' : 'away',
        playerId: winger.player.id,
        playerName: winger.player.name,
        targetPlayerId: striker.player.id,
        targetPlayerName: striker.player.name,
        commentary: `${winger.player.name} beats their marker on the flank and curls a dangerous cross toward ${striker.player.name}!`,
        ballCoordinates: { x: crossTargetX, y: crossTargetY },
        ballStartCoordinates: { x: ballX, y: ballY },
        playerCoordinates: generate22PlayerCoordinates(
          homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
          homeTactics, awayTactics, crossTargetX, crossTargetY, currentPossession, winger.player.id, striker.player.id, 'passing'
        ),
        momentum: isHome ? momentum + 6 : momentum - 6,
      });

      ballX = crossTargetX;
      ballY = crossTargetY;

      // Header or Shot from Cross (advance 6-12s)
      currentTotalSeconds += Math.floor(rand() * 7) + 6;
      const finishMin = Math.floor(currentTotalSeconds / 60);
      const finishSec = currentTotalSeconds % 60;

      const strikerStat = playerStatsMap.get(striker.player.id);
      let crossGoalProbability = 0.105 + (atkPower.attack - defPower.defense) * 0.0018;
      if (defTactics.style === 'Low Block') crossGoalProbability *= 0.74;
      if (atkTactics.attackWidth > 65) crossGoalProbability *= 1.08;
      if (atkTactics.mentality === 'Aggressive') crossGoalProbability *= 1.05;
      crossGoalProbability = Math.max(0.045, Math.min(0.30, crossGoalProbability));
      const isGoal = rand() < crossGoalProbability;

      if (isGoal) {
        if (isHome) homeScore++; else awayScore++;
        atkStats.score++;
        recordShot(atkStats, strikerStat, true, true);
        if (strikerStat) strikerStat.rating += -0.1;
        const wStat = playerStatsMap.get(winger.player.id);
        if (wStat) {
          wStat.assists++;
          wStat.rating += 0.8;
        }

        const goalNetX = isHome ? 98.5 : 1.5;
        const goalNetY = 48 + rand() * 4;

        pushEvent({
          minute: finishMin,
          second: finishSec,
          type: 'goal',
          team: isHome ? 'home' : 'away',
          playerId: striker.player.id,
          playerName: striker.player.name,
          playerNumber: getPlayerNumber(isHome ? homeStarters : awayStarters, striker.player.id),
          assistPlayerId: winger.player.id,
          assistPlayerName: winger.player.name,
          commentary: `⚽ GOAL! ${striker.player.name} powers a magnificent header into the back of the net from ${winger.player.name}'s pin-point cross! (${homeScore} - ${awayScore})`,
          ballCoordinates: { x: goalNetX, y: goalNetY },
          ballStartCoordinates: { x: crossTargetX, y: crossTargetY },
          playerCoordinates: generate22PlayerCoordinates(
            homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
            homeTactics, awayTactics, goalNetX, goalNetY, currentPossession, striker.player.id, defGK.player.id, 'celebrating'
          ),
          momentum: isHome ? Math.min(100, momentum + 25) : Math.max(-100, momentum - 25),
        });

        ballX = 50;
        ballY = 50;
        currentPossession = isHome ? 'away' : 'home';
      } else {
        // Keeper Save or Cleared Corner
        const gkStat = playerStatsMap.get(defGK.player.id);
        if (gkStat) { gkStat.saves++; gkStat.rating += 0.45; }
        const isCorner = rand() < 0.5;
        recordShot(atkStats, strikerStat, isCorner, false);
        if (isCorner) {
          atkStats.corners++;
          pushEvent({
            minute: finishMin,
            second: finishSec,
            type: 'corner',
            team: isHome ? 'home' : 'away',
            playerId: isHome ? homeRoles.cornerTakerId || winger.player.id : awayRoles.cornerTakerId || winger.player.id,
            playerName: (isHome ? homeStarters : awayStarters).find(p => p.player.id === (isHome ? homeRoles.cornerTakerId : awayRoles.cornerTakerId))?.player.name || winger.player.name,
            commentary: `Pushed over the crossbar! Fantastic reaction save by ${defGK.player.name} concedes a corner kick.`,
            ballCoordinates: { x: isHome ? 98 : 2, y: rand() < 0.5 ? 4 : 96 },
            ballStartCoordinates: { x: crossTargetX, y: crossTargetY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, isHome ? 98 : 2, 50, currentPossession, defGK.player.id, undefined, 'diving'
            ),
            momentum,
          });
        } else {
          recordShot(atkStats, strikerStat, false, false);
          pushEvent({
            minute: finishMin,
            second: finishSec,
            type: 'shot_missed',
            team: isHome ? 'home' : 'away',
            playerId: striker.player.id,
            playerName: striker.player.name,
            commentary: `Chance goes begging! ${striker.player.name}'s header flies agonisingly wide of the upright.`,
            ballCoordinates: { x: isHome ? 99 : 1, y: rand() < 0.5 ? 26 : 74 },
            ballStartCoordinates: { x: crossTargetX, y: crossTargetY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, isHome ? 95 : 5, 50, currentPossession, striker.player.id, defGK.player.id, 'shooting'
            ),
            momentum,
          });
          currentPossession = isHome ? 'away' : 'home';
        }
      }
    }
    // ACTION C: Shot on Goal (rating-based chance quality).
    else if (actionRoll < shotCutoff) {
      // Open-play goals are weighted toward attackers, but midfielders and
      // occasional defenders can score too.
      const chanceShooters = [
        ...atkAtts,
        ...atkAtts,
        ...atkMids,
        ...(isHome ? homeDefs : awayDefs).slice(0, 1),
      ];
      const shooter = pick(
        chanceShooters.length > 0 ? chanceShooters : attackingStarters,
        'shot taker'
      );
      const targetGoalX = isHome ? 97 : 3;
      const shooterStat = playerStatsMap.get(shooter.player.id);

      const shooterQuality =
        shooter.player.attributes.sho * 0.52 +
        shooter.player.attributes.dri * 0.20 +
        shooter.player.attributes.pas * 0.10 +
        shooter.player.attributes.pac * 0.10 +
        shooter.player.attributes.phy * 0.08;
      const gkQuality = goalkeeperQuality(defGK);
      const shotXg = estimateShotXg(ballX, ballY, isHome, shooter);

      // Shot accuracy is driven by finishing/technique, while chance quality is
      // driven by location and angle. This prevents every shot from the same
      // generic "edge of the box" probability.
      const isOnTarget = rand() < clamp(
        0.30 + shooterQuality * 0.0044 + shotXg * 0.30,
        0.30,
        0.68
      );

      if (!isOnTarget) {
        recordShot(atkStats, shooterStat, false, false);
        pushEvent({
          minute: actionMin,
          second: actionSec,
          type: 'shot_missed',
          team: isHome ? 'home' : 'away',
          playerId: shooter.player.id,
          playerName: shooter.player.name,
          commentary: `${shooter.player.name} unleashes a ferocious strike from the edge of the box, but it sails just over the crossbar!`,
          ballCoordinates: { x: targetGoalX, y: rand() < 0.5 ? 24 : 76 },
          ballStartCoordinates: { x: ballX, y: ballY },
          playerCoordinates: generate22PlayerCoordinates(
            homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
            homeTactics, awayTactics, targetGoalX, 50, currentPossession, shooter.player.id, defGK.player.id, 'shooting'
          ),
          momentum: isHome ? momentum + 4 : momentum - 4,
        });
        currentPossession = isHome ? 'away' : 'home';
      } else {
        // Low Block cuts goal probability, Possession/Counter increases chance quality
        // Non-penalty conversion is tuned toward realistic match-level scoring.
        const shooterGoalMultiplier = clamp(0.85 + (shooterQuality - 70) * 0.0022, 0.85, 1.15);
        const keeperGoalMultiplier = clamp(1.05 - (gkQuality - 70) * 0.0022, 0.85, 1.15);
        let goalProbability =
          0.10 *
          clamp(shotXg / 0.06, 0.45, 2.0) *
          shooterGoalMultiplier *
          keeperGoalMultiplier;

        // Tactical modifiers change chance quality, but cannot turn a bad chance
        // into a free goal.
        if (defTactics.style === 'Low Block') goalProbability *= 0.78;
        if (atkTactics.style === 'Possession') goalProbability *= 1.03;
        if (atkTactics.style === 'Counter Attack' || wasCounter) goalProbability *= 1.10;
        if (atkTactics.mentality === 'Aggressive') goalProbability *= 1.04;
        goalProbability *= isHome ? 1.035 : 0.985;
        if (atkTactics.mentality === 'Defensive') goalProbability *= 0.95;
        const lateFatigue =
          clamp((currentTotalSeconds / 60 - 60) / 35, 0, 1) *
          (Math.max(0, atkTactics.pressingIntensity - 60) * 0.0009);
        goalProbability *= 1 - lateFatigue;
        goalProbability = clamp(goalProbability, 0.018, 0.34);

        if (rand() < goalProbability) {
          recordShot(atkStats, shooterStat, true, true);
          // GOAL! A normal open-play goal is not automatically assisted.
          // If it is assisted, the assister must be a different player from the scorer.
          if (isHome) homeScore++; else awayScore++;
          atkStats.score++;
          if (shooterStat) {
            shooterStat.rating += 0;
          }

          const possibleAssisters = [passer, receiver, ...atkMids, ...atkAtts]
            .filter((p, index, arr) =>
              p.player.id !== shooter.player.id &&
              arr.findIndex(x => x.player.id === p.player.id) === index
            );
          const assistedGoal = possibleAssisters.length > 0 && rand() < 0.72;
          const assister = assistedGoal
            ? pick(possibleAssisters, 'assister')
            : undefined;
          const assisterStat = assister ? playerStatsMap.get(assister.player.id) : undefined;
          if (assisterStat) {
            assisterStat.assists++;
            assisterStat.rating += 0.7;
          }

          const goalNetX = isHome ? 98.2 : 1.8;
          const goalNetY = 46 + rand() * 8;

          pushEvent({
            minute: actionMin,
            second: actionSec,
            type: 'goal',
            team: isHome ? 'home' : 'away',
            playerId: shooter.player.id,
            playerName: shooter.player.name,
            playerNumber: getPlayerNumber(isHome ? homeStarters : awayStarters, shooter.player.id),
            assistPlayerId: assister?.player.id,
            assistPlayerName: assister?.player.name,
            commentary: `⚽ GOAL! ${shooter.player.name} picks out the corner with an unstoppable finish! (${homeScore} - ${awayScore})`,
            ballCoordinates: { x: goalNetX, y: goalNetY },
            ballStartCoordinates: { x: ballX, y: ballY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, goalNetX, goalNetY, currentPossession, shooter.player.id, defGK.player.id, 'celebrating'
            ),
            chanceQuality: Number((shotXg * 100).toFixed(1)),
            momentum: isHome ? Math.min(100, momentum + 30) : Math.max(-100, momentum - 30),
          });

          ballX = 50;
          ballY = 50;
          currentPossession = isHome ? 'away' : 'home';
        } else {
          // Sensational Goalkeeper Save
          const gkStat = playerStatsMap.get(defGK.player.id);
          if (gkStat) {
            gkStat.saves++;
            gkStat.rating += 0.45;
          }

          pushEvent({
            minute: actionMin,
            second: actionSec,
            type: 'shot_saved',
            team: isHome ? 'home' : 'away',
            playerId: shooter.player.id,
            playerName: shooter.player.name,
            commentary: `🧤 INCREDIBLE SAVE! ${defGK.player.name} dives full stretch to deny ${shooter.player.name} with a fingertip stop!`,
            ballCoordinates: { x: isHome ? 95 : 5, y: 50 },
            ballStartCoordinates: { x: ballX, y: ballY },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, isHome ? 95 : 5, 50, currentPossession, shooter.player.id, defGK.player.id, 'diving'
            ),
            momentum: isHome ? momentum + 4 : momentum - 4,
          });

          currentPossession = isHome ? 'away' : 'home';
          ballX = isHome ? 86 : 14;
        }
      }
    }

    // Step clock forward 45 to 90 seconds for next attacking phase
    currentTotalSeconds += Math.floor(rand() * 45) + 45;
  }

  // Repair the authoritative event timeline before adding extra time/shootout events.
  normalizeEventTimeline(events, firstHalfEnd, secondHalfEnd);

  // Knockout Extra Time and Penalty Shootout Check (Requirement 17)
  let wentToExtraTime = false;
  let wentToPenalties = false;
  let homePenaltyScore: number | undefined;
  let awayPenaltyScore: number | undefined;
  let penaltyShootout: PenaltyKickResult[] | undefined;
  let winnerManagerId: string | undefined;

  if ((isKnockout && homeScore === awayScore) || forcePenalties) {
    if (!forcePenalties) {
      wentToExtraTime = true;
      currentTotalSeconds = secondHalfEnd;

    pushEvent({
      minute: Math.floor(secondHalfEnd / 60),
      second: secondHalfEnd % 60,
      type: 'extra_time_start',
      team: 'home',
      playerId: homeKicker.player.id,
      playerName: homeKicker.player.name,
      commentary: `Full-time ends level (${homeScore} - ${awayScore})! We head into EXTRA TIME (30 additional minutes)!`,
      ballCoordinates: { x: 50, y: 50 },
      ballStartCoordinates: { x: 50, y: 50 },
      playerCoordinates: generate22PlayerCoordinates(
        homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
        homeTactics, awayTactics, 50, 50, 'home', undefined, undefined, 'idle'
      ),
      momentum,
    });

    // Simulate actual extra-time chances in two 15-minute periods.
    const runExtraTimePeriod = (startMinute: number) => {
      for (let minute = startMinute; minute < startMinute + 15; minute += 6) {
        const isEtHome = rand() < 0.5;
        const etAtk = isEtHome ? homePower : awayPower;
        const etDef = isEtHome ? awayPower : homePower;
        const etAttackers = isEtHome ? homeAtts : awayAtts;
        const etDefenderGK = isEtHome ? awayGK : homeGK;
        const shooter = pick(etAttackers.length ? etAttackers : (isEtHome ? homeStarters : awayStarters));
        const shooterQuality = shooter.player.attributes.sho * 0.55 + shooter.player.attributes.dri * 0.20 + shooter.player.attributes.pac * 0.15 + shooter.player.attributes.phy * 0.10;
        const gkQuality = goalkeeperQuality(etDefenderGK);
        const etX = isEtHome ? 97.5 : 2.5;
        const etY = 35 + rand() * 30;
        const etXg = estimateShotXg(etX, etY, isEtHome, shooter);
        let etGoalProbability = etXg * (0.90 + (shooterQuality - 75) * 0.0025) * (1.02 - (gkQuality - 80) * 0.003);
        etGoalProbability *= 0.92;
        if ((isEtHome ? homeTactics : awayTactics).mentality === 'Aggressive') etGoalProbability *= 1.07;
        etGoalProbability = Math.max(0.06, Math.min(0.48, etGoalProbability));

        const isGoal = rand() < etGoalProbability;
        const etSec = Math.floor(rand() * 59);

        if (isGoal) {
          if (isEtHome) homeScore++; else awayScore++;
          const stat = playerStatsMap.get(shooter.player.id);
          if (stat) {
            recordShot(isEtHome ? homeStats : awayStats, stat, true, true);
            stat.rating += -0.2;
          }
          pushEvent({
            minute,
            second: etSec,
            type: 'goal',
            team: isEtHome ? 'home' : 'away',
            playerId: shooter.player.id,
            playerName: shooter.player.name,
            playerNumber: getPlayerNumber(isEtHome ? homeStarters : awayStarters, shooter.player.id),
            commentary: `⚽ EXTRA-TIME GOAL! ${shooter.player.name} finds the breakthrough! (${homeScore} - ${awayScore})`,
            ballCoordinates: { x: etX, y: etY },
            ballStartCoordinates: { x: 50, y: 50 },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, etX, etY, isEtHome ? 'home' : 'away', shooter.player.id, etDefenderGK.player.id, 'celebrating'
            ),
            momentum: isEtHome ? Math.min(100, momentum + 22) : Math.max(-100, momentum - 22),
          });
        } else {
          const stat = playerStatsMap.get(shooter.player.id);
          recordShot(isEtHome ? homeStats : awayStats, stat, false, false);
          pushEvent({
            minute,
            second: etSec,
            type: 'shot_missed',
            team: isEtHome ? 'home' : 'away',
            playerId: shooter.player.id,
            playerName: shooter.player.name,
            commentary: `${shooter.player.name} fires in extra time, but the chance goes wide.`,
            ballCoordinates: { x: etX, y: etY },
            ballStartCoordinates: { x: 50, y: 50 },
            playerCoordinates: generate22PlayerCoordinates(
              homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
              homeTactics, awayTactics, etX, etY, isEtHome ? 'home' : 'away', shooter.player.id, etDefenderGK.player.id, 'shooting'
            ),
            momentum,
          });
        }
      }
    };

    runExtraTimePeriod(96);

    // Extra Time Halftime (105:00)
    currentTotalSeconds = 6300; // 105:00
    pushEvent({
      minute: 105,
      second: 0,
      type: 'extra_time_half',
      team: 'away',
      playerId: awayKicker.player.id,
      playerName: awayKicker.player.name,
      commentary: `Extra time half-time reached (105'). Teams switch ends for the final 15 minutes!`,
      ballCoordinates: { x: 50, y: 50 },
      ballStartCoordinates: { x: 50, y: 50 },
      playerCoordinates: generate22PlayerCoordinates(
        homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
        homeTactics, awayTactics, 50, 50, 'away', undefined, undefined, 'idle'
      ),
      momentum,
    });

    runExtraTimePeriod(108);

    // Extra Time Full-Time (120:00)
    currentTotalSeconds = 7200; // 120:00
    pushEvent({
      minute: 120,
      second: 0,
      type: 'extra_time_end',
      team: 'home',
      playerId: homeKicker.player.id,
      playerName: homeKicker.player.name,
      commentary: homeScore === awayScore
        ? `120 minutes played! Deadlock remains unbroken (${homeScore} - ${awayScore}). PENALTY SHOOTOUT DECIDER!`
        : `120 minutes played! Extra time decides it: ${homeScore} - ${awayScore}.`,
      ballCoordinates: { x: 50, y: 50 },
      ballStartCoordinates: { x: 50, y: 50 },
      playerCoordinates: generate22PlayerCoordinates(
        homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
        homeTactics, awayTactics, 50, 50, 'home', undefined, undefined, 'idle'
      ),
      momentum,
    });

    }
    // PENALTY SHOOTOUT SIMULATION: five kicks each, then sudden death.
    if (forcePenalties || homeScore === awayScore) {
      wentToPenalties = true;
      penaltyShootout = [];
    let hPens = 0;
    let aPens = 0;

    // Pick 5 penalty takers per team
    const sortTakers = (starters: SquadPlayerEntry[], prefId?: string) => {
      const preferred = starters.find(s => s.player.id === prefId);
      const outfield = starters.filter(
        s => getPositionCategory(s.assignedPosition || s.player.position) !== 'GK'
      );
      const sorted = [...(outfield.length > 0 ? outfield : starters)]
        .sort((a, b) => penaltyAbility(b) - penaltyAbility(a));
      if (preferred) {
        return [preferred, ...sorted.filter(s => s.player.id !== preferred.player.id)];
      }
      return sorted;
    };

    const homeTakers = sortTakers(homeStarters.filter(s => !sentOffIds.has(s.player.id)), homeRoles.penaltyTakerId);
    const awayTakers = sortTakers(awayStarters.filter(s => !sentOffIds.has(s.player.id)), awayRoles.penaltyTakerId);

    // All eligible players take one kick before anyone repeats, as required by Law 10.
    // Goalkeeper handling is represented by the GK's SHO attribute, but GKs are excluded
    // from the kicking pool by sortTakers above.
    let penaltyKickIndex = 0;
    const penaltyEventTime = () => {
      const totalSeconds = 121 * 60 + penaltyKickIndex * 8;
      penaltyKickIndex++;
      return {
        minute: Math.floor(totalSeconds / 60),
        second: totalSeconds % 60,
      };
    };

    const penaltyCoordinates = (team: 'home' | 'away', takerId: string, keeperId: string): LivePlayerPosition[] => {
      const coords = generate22PlayerCoordinates(
        homeStarters.filter(s => !sentOffIds.has(s.player.id)),
        awayStarters.filter(s => !sentOffIds.has(s.player.id)),
        homeManager.formation,
        awayManager.formation,
        homeTactics,
        awayTactics,
        team === 'home' ? 97 : 3,
        50,
        team,
        takerId,
        keeperId,
        'shooting'
      );
      const taker = coords.find(p => p.id === takerId);
      const keeper = coords.find(p => p.id === keeperId);
      if (taker) {
        taker.x = team === 'home' ? 97 : 3;
        taker.y = 50;
        taker.action = 'shooting';
      }
      if (keeper) {
        keeper.x = team === 'home' ? 92 : 8;
        keeper.y = 50;
        keeper.action = 'diving';
      }
      for (const player of coords) {
        if (player.id !== takerId && player.id !== keeperId) {
          player.x = team === 'home' ? Math.min(49, player.x) : Math.max(51, player.x);
        }
      }
      return coords;
    };

    // Push Shootout Start Event
    pushEvent({
      minute: 121,
      second: 0,
      type: 'penalty_shootout_start',
      team: 'home',
      playerId: homeTakers[0].player.id,
      playerName: homeTakers[0].player.name,
      commentary: `PENALTY SHOOTOUT BEGINS! High pressure spot-kicks under the floodlights!`,
      ballCoordinates: { x: 88.5, y: 50 },
      ballStartCoordinates: { x: 88.5, y: 50 },
      momentum,
      playerCoordinates: penaltyCoordinates('home', homeTakers[0].player.id, awayGK.player.id),
    });

    // 5 standard rounds
    for (let round = 1; round <= 5; round++) {
      // Home kick
      const hTaker = homeTakers[(round - 1) % homeTakers.length];
      const hSho = penaltyAbility(hTaker);
      const aGkReflex = goalkeeperQuality(awayGK);
      const hSuccessRate = clamp(0.76 + (hSho - 80) * 0.0032 - (aGkReflex - 80) * 0.0028, 0.62, 0.91);
      const hRoll = rand();
      let hOutcome: 'goal' | 'saved' | 'missed' = 'goal';
      if (hRoll > hSuccessRate) {
        hOutcome = rand() < 0.65 ? 'saved' : 'missed';
      }
      if (hOutcome === 'goal') hPens++;

      penaltyShootout.push({
        round,
        team: 'home',
        takerId: hTaker.player.id,
        takerName: hTaker.player.name,
        takerNumber: getPlayerNumber(homeStarters, hTaker.player.id),
        outcome: hOutcome,
        scoreAfter: { home: hPens, away: aPens },
        commentary: hOutcome === 'goal' 
          ? `[PENALTIES] Round ${round}: ${hTaker.player.name} steps up... SCORES! Buries it into the bottom corner!`
          : hOutcome === 'saved'
          ? `[PENALTIES] Round ${round}: ${hTaker.player.name} shoots... SAVED! ${awayGK.player.name} guesses right and blocks!`
          : `[PENALTIES] Round ${round}: ${hTaker.player.name} fires wide of the post!`,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'home',
        playerId: hTaker.player.id,
        playerName: hTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 1].commentary,
        ballCoordinates: { x: 97, y: hOutcome === 'goal' ? 49 : 45 },
        ballStartCoordinates: { x: 88.5, y: 50 },
        playerCoordinates: penaltyCoordinates('home', hTaker.player.id, awayGK.player.id),
        momentum,
      });

      if (hPens > aPens + (5 - round)) break;

      // Away kick
      const aTaker = awayTakers[(round - 1) % awayTakers.length];
      const aSho = penaltyAbility(aTaker);
      const hGkReflex = goalkeeperQuality(homeGK);
      const aSuccessRate = clamp(0.76 + (aSho - 80) * 0.0032 - (hGkReflex - 80) * 0.0028, 0.62, 0.91);
      const aRoll = rand();
      let aOutcome: 'goal' | 'saved' | 'missed' = 'goal';
      if (aRoll > aSuccessRate) {
        aOutcome = rand() < 0.65 ? 'saved' : 'missed';
      }
      if (aOutcome === 'goal') aPens++;

      penaltyShootout.push({
        round,
        team: 'away',
        takerId: aTaker.player.id,
        takerName: aTaker.player.name,
        takerNumber: getPlayerNumber(awayStarters, aTaker.player.id),
        outcome: aOutcome,
        scoreAfter: { home: hPens, away: aPens },
        commentary: aOutcome === 'goal' 
          ? `[PENALTIES] Round ${round}: ${aTaker.player.name} steps up... SCORES! Coolly dispatched into the side-netting!`
          : aOutcome === 'saved'
          ? `[PENALTIES] Round ${round}: ${aTaker.player.name} shoots... DENIED! Heroic save by ${homeGK.player.name}!`
          : `[PENALTIES] Round ${round}: ${aTaker.player.name} strikes the crossbar! Missed!`,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'away',
        playerId: aTaker.player.id,
        playerName: aTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 1].commentary,
        ballCoordinates: { x: 3, y: aOutcome === 'goal' ? 51 : 55 },
        ballStartCoordinates: { x: 11.5, y: 50 },
        playerCoordinates: penaltyCoordinates('away', aTaker.player.id, homeGK.player.id),
        momentum,
      });
      if (Math.abs(hPens - aPens) > (5 - round)) break;
    }

    // Sudden death: one kick each until the score is no longer level.
    // Unlike the old implementation, we stop immediately when the second kick
    // of a round makes the scores different. This keeps the stored kick-by-kick
    // score and the final fixture score perfectly consistent.
    let sdRound = 6;
    const MAX_SUDDEN_DEATH_ROUNDS = 20;

    while (hPens === aPens && sdRound <= MAX_SUDDEN_DEATH_ROUNDS) {
      const hTaker = homeTakers[(sdRound - 1) % homeTakers.length];
      const aTaker = awayTakers[(sdRound - 1) % awayTakers.length];

      const hSho = penaltyAbility(hTaker);
      const aSho = penaltyAbility(aTaker);
      const aGkReflex = goalkeeperQuality(awayGK);
      const hGkReflex = goalkeeperQuality(homeGK);

      const hSuccessRate = clamp(0.74 + (hSho - 80) * 0.0028 - (aGkReflex - 80) * 0.0025, 0.62, 0.90);
      const aSuccessRate = clamp(0.74 + (aSho - 80) * 0.0028 - (hGkReflex - 80) * 0.0025, 0.62, 0.90);

      const hOutcome: 'goal' | 'saved' | 'missed' =
        rand() < hSuccessRate ? 'goal' : (rand() < 0.65 ? 'saved' : 'missed');
      if (hOutcome === 'goal') hPens++;

      penaltyShootout.push({
        round: sdRound,
        team: 'home',
        takerId: hTaker.player.id,
        takerName: hTaker.player.name,
        takerNumber: getPlayerNumber(homeStarters, hTaker.player.id),
        outcome: hOutcome,
        scoreAfter: { home: hPens, away: aPens },
        commentary: hOutcome === 'goal'
          ? `[SUDDEN DEATH] Round ${sdRound}: ${hTaker.player.name} SCORES! Ice-cold from the spot.`
          : hOutcome === 'saved'
            ? `[SUDDEN DEATH] Round ${sdRound}: ${hTaker.player.name} is DENIED by ${awayGK.player.name}!`
            : `[SUDDEN DEATH] Round ${sdRound}: ${hTaker.player.name} misses the target!`,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'home',
        playerId: hTaker.player.id,
        playerName: hTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 1].commentary,
        ballCoordinates: { x: 97, y: hOutcome === 'goal' ? 49 : 45 },
        ballStartCoordinates: { x: 88.5, y: 50 },
        momentum,
      });

      // If the first kick puts one side ahead, the second kick is still taken
      // because the round must be shown as a complete pair in this simulation.
      const aOutcome: 'goal' | 'saved' | 'missed' =
        rand() < aSuccessRate ? 'goal' : (rand() < 0.65 ? 'saved' : 'missed');
      if (aOutcome === 'goal') aPens++;

      penaltyShootout.push({
        round: sdRound,
        team: 'away',
        takerId: aTaker.player.id,
        takerName: aTaker.player.name,
        takerNumber: getPlayerNumber(awayStarters, aTaker.player.id),
        outcome: aOutcome,
        scoreAfter: { home: hPens, away: aPens },
        commentary: aOutcome === 'goal'
          ? `[SUDDEN DEATH] Round ${sdRound}: ${aTaker.player.name} SCORES! Pressure handled.`
          : aOutcome === 'saved'
            ? `[SUDDEN DEATH] Round ${sdRound}: ${aTaker.player.name} is SAVED by ${homeGK.player.name}!`
            : `[SUDDEN DEATH] Round ${sdRound}: ${aTaker.player.name} misses!`,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'away',
        playerId: aTaker.player.id,
        playerName: aTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 1].commentary,
        ballCoordinates: { x: 3, y: aOutcome === 'goal' ? 51 : 55 },
        ballStartCoordinates: { x: 11.5, y: 50 },
        momentum,
      });

      sdRound++;
    }

    // Deterministic safety net. It is represented by real kick records so the
    // UI scorecard, scoreAfter values, and fixture winner can never disagree.
    if (hPens === aPens) {
      const hTaker = homeTakers[(sdRound - 1) % homeTakers.length];
      const aTaker = awayTakers[(sdRound - 1) % awayTakers.length];

      hPens++;
      penaltyShootout.push({
        round: sdRound,
        team: 'home',
        takerId: hTaker.player.id,
        takerName: hTaker.player.name,
        takerNumber: getPlayerNumber(homeStarters, hTaker.player.id),
        outcome: 'goal',
        scoreAfter: { home: hPens, away: aPens },
        commentary: `[SUDDEN DEATH] Round ${sdRound}: ${hTaker.player.name} SCORES the decisive kick!`,
      });

      penaltyShootout.push({
        round: sdRound,
        team: 'away',
        takerId: aTaker.player.id,
        takerName: aTaker.player.name,
        takerNumber: getPlayerNumber(awayStarters, aTaker.player.id),
        outcome: 'missed',
        scoreAfter: { home: hPens, away: aPens },
        commentary: `[SUDDEN DEATH] Round ${sdRound}: ${aTaker.player.name} misses — shootout over!`,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'home',
        playerId: hTaker.player.id,
        playerName: hTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 2].commentary,
        ballCoordinates: { x: 97, y: 49 },
        ballStartCoordinates: { x: 88.5, y: 50 },
        momentum,
      });

      pushEvent({
        ...penaltyEventTime(),
        type: 'penalty_shootout_kick',
        team: 'away',
        playerId: aTaker.player.id,
        playerName: aTaker.player.name,
        commentary: penaltyShootout[penaltyShootout.length - 1].commentary,
        ballCoordinates: { x: 3, y: 55 },
        ballStartCoordinates: { x: 11.5, y: 50 },
        momentum,
      });
    }

    homePenaltyScore = hPens;
    awayPenaltyScore = aPens;
    winnerManagerId = hPens > aPens ? homeManager.id : awayManager.id;
  }

    }

  if (wentToExtraTime && !wentToPenalties && homeScore !== awayScore) {
    winnerManagerId = homeScore > awayScore ? homeManager.id : awayManager.id;
  }

  normalizeEventTimeline(events, firstHalfEnd, secondHalfEnd);
  const lastTimelineSeconds = events.length > 0
    ? Math.max(...events.map(event => event.minute * 60 + (event.second || 0)))
    : secondHalfEnd;
  const finalWhistleSeconds = wentToPenalties
    ? Math.max(122 * 60, lastTimelineSeconds + 1)
    : wentToExtraTime
      ? 120 * 60
      : secondHalfEnd;

  // Final Whistle at the actual second-half/extra-time/shootout end.
  pushEvent({
    minute: Math.floor(finalWhistleSeconds / 60),
    second: finalWhistleSeconds % 60,
    type: 'fulltime',
    team: 'home',
    playerId: homeKicker.player.id,
    playerName: homeKicker.player.name,
    commentary: wentToPenalties
      ? `FULL TIME! ${winnerManagerId === homeManager.id ? homeManager.name : awayManager.name} wins on penalties (${homePenaltyScore} - ${awayPenaltyScore})!`
      : `FULL TIME! The referee sounds the final whistle. Final Result: ${homeManager.name} ${homeScore} - ${awayScore} ${awayManager.name}.`,
    ballCoordinates: { x: 50, y: 50 },
    ballStartCoordinates: { x: 50, y: 50 },
    playerCoordinates: generate22PlayerCoordinates(
      homeStarters.filter(s => !sentOffIds.has(s.player.id)), awayStarters.filter(s => !sentOffIds.has(s.player.id)), homeManager.formation, awayManager.formation,
      homeTactics, awayTactics, 50, 50, 'home', undefined, undefined, 'idle'
    ),
    momentum,
  });

  // Final timeline safety check: never allow a decreasing timestamp in production.
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1].minute * 60 + (events[i - 1].second || 0);
    const current = events[i].minute * 60 + (events[i].second || 0);
    if (current < prev) {
      console.warn('[simulation] non-monotonic event timeline repaired', { index: i, prev, current });
      events[i].minute = events[i - 1].minute;
      events[i].second = events[i - 1].second;
    }
  }

  // Possession is derived from the event timeline, not pass counters.
  const possessionSeconds = { home: 0, away: 0 };
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];
    const duration = Math.max(0, (next.minute * 60 + (next.second || 0)) - (current.minute * 60 + (current.second || 0)));
    if (current.team === 'home' || current.team === 'away') possessionSeconds[current.team] += duration;
  }
  const totalPossessionSeconds = Math.max(1, possessionSeconds.home + possessionSeconds.away);
  homeStats.possession = Math.round((possessionSeconds.home / totalPossessionSeconds) * 100);
  awayStats.possession = 100 - homeStats.possession;

  const midfieldQualityHome = homePower.midfield;
  const midfieldQualityAway = awayPower.midfield;
  homeStats.passAccuracy = Math.round(clamp(82 + (midfieldQualityHome - midfieldQualityAway) * 0.12 - (awayTactics.pressingIntensity - 50) * 0.12, 72, 92));
  awayStats.passAccuracy = Math.round(clamp(82 + (midfieldQualityAway - midfieldQualityHome) * 0.12 - (homeTactics.pressingIntensity - 50) * 0.12, 72, 92));
  homeStats.score = homeScore;
  awayStats.score = awayScore;

  // Final player ratings: contributions in both directions, with a 3.0 floor.
  for (const stat of playerStatsMap.values()) {
    const conceded = stat.team === 'home' ? awayScore : homeScore;
    const entry = (stat.team === 'home' ? homeStarters : awayStarters).find(s => s.player.id === stat.playerId);
    if (stat.team === 'home' && awayScore === 0 && entry && ['GK', 'DEF'].includes(getPositionCategory(entry.assignedPosition || entry.player.position))) stat.rating += 0.4;
    if (stat.team === 'away' && homeScore === 0 && entry && ['GK', 'DEF'].includes(getPositionCategory(entry.assignedPosition || entry.player.position))) stat.rating += 0.4;
    if (entry && ['GK', 'DEF'].includes(getPositionCategory(entry.assignedPosition || entry.player.position))) stat.rating -= conceded * 0.35;
    stat.rating += stat.tackles * 0.08 + stat.interceptions * 0.10 + stat.saves * 0.18;
    stat.rating -= (stat.yellowCard ? 0.3 : 0) + (stat.redCard ? 1.5 : 0) + stat.fouls * 0.05;
  }

  const playerStatsList = Array.from(playerStatsMap.values()).map(stat => ({
    ...stat,
    rating: Math.min(10.0, Math.max(3.0, Number(stat.rating.toFixed(1)))),
  }));

  return {
    id: fixtureId,
    matchday,
    homeManagerId: homeManager.id,
    homeManagerName: homeManager.name,
    awayManagerId: awayManager.id,
    awayManagerName: awayManager.name,
    played: true,
    homeScore,
    awayScore,
    events,
    homeStats,
    awayStats,
    playerStats: playerStatsList,
    seed,
    isKnockout,
    roundName,
    wentToExtraTime,
    wentToPenalties,
    homePenaltyScore,
    awayPenaltyScore,
    penaltyShootout,
    winnerManagerId: winnerManagerId || (homeScore > awayScore ? homeManager.id : awayScore > homeScore ? awayManager.id : undefined),
    homeWinProbability,
    drawProbability,
    awayWinProbability,
    homeStrength: Number(homeEffective.toFixed(2)),
    awayStrength: Number(awayEffective.toFixed(2)),
  };
}
