import { Formation, Position, PositionCategory, SquadPlayerEntry } from '../types/football.js';

export interface FormationSlot {
  index: number;
  position: Position;
  category: PositionCategory;
  name: string;
  // Normalized coordinates on pitch (0-100% width, 0-100% height)
  // Height 0% = Goalkeeper line, 100% = Forward line
  x: number;
  y: number;
}

export interface PositionRequirements {
  min: number;
  recommended: number;
  max: number;
}

export interface FormationConfig {
  id: Formation;
  name: string;
  categoryRequirements: Record<PositionCategory, PositionRequirements>;
  slots: FormationSlot[];
}


// Each manager owns exactly 11 players: the starting XI.
// There are no substitutes. The formation therefore controls the exact
// natural-category quota available during the auction.
export const BENCH_CATEGORY_ALLOCATION: Record<PositionCategory, number> = {
  GK: 0,
  DEF: 0,
  MID: 0,
  ATT: 0,
};

export function getFormationStarterCategoryCounts(formation: Formation): Record<PositionCategory, number> {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const counts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const slot of config.slots) counts[slot.category] += 1;
  return counts;
}

export function getFormationSquadCategoryLimits(formation: Formation): Record<PositionCategory, number> {
  // With an XI-only squad, the auction limits are exactly the formation's
  // starting category counts.
  return getFormationStarterCategoryCounts(formation);
}

export const FORMATIONS_CONFIG: Record<Formation, FormationConfig> = {
  '4-3-3': {
    id: '4-3-3',
    name: '4-3-3 Attack',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 4, recommended: 5, max: 7 },
      MID: { min: 3, recommended: 5, max: 6 },
      ATT: { min: 3, recommended: 4, max: 6 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'LB', category: 'DEF', name: 'Left Back', x: 18, y: 28 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 38, y: 24 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 62, y: 24 },
      { index: 4, position: 'RB', category: 'DEF', name: 'Right Back', x: 82, y: 28 },
      { index: 5, position: 'CM', category: 'MID', name: 'Left Center Mid', x: 30, y: 52 },
      { index: 6, position: 'CDM', category: 'MID', name: 'Defensive Mid', x: 50, y: 44 },
      { index: 7, position: 'CM', category: 'MID', name: 'Right Center Mid', x: 70, y: 52 },
      { index: 8, position: 'LW', category: 'ATT', name: 'Left Winger', x: 20, y: 80 },
      { index: 9, position: 'ST', category: 'ATT', name: 'Striker', x: 50, y: 86 },
      { index: 10, position: 'RW', category: 'ATT', name: 'Right Winger', x: 80, y: 80 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    name: '4-2-3-1 Modern',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 4, recommended: 5, max: 7 },
      MID: { min: 4, recommended: 6, max: 7 },
      ATT: { min: 2, recommended: 3, max: 5 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'LB', category: 'DEF', name: 'Left Back', x: 18, y: 28 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 38, y: 24 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 62, y: 24 },
      { index: 4, position: 'RB', category: 'DEF', name: 'Right Back', x: 82, y: 28 },
      { index: 5, position: 'CDM', category: 'MID', name: 'Defensive Mid (L)', x: 35, y: 44 },
      { index: 6, position: 'CDM', category: 'MID', name: 'Defensive Mid (R)', x: 65, y: 44 },
      { index: 7, position: 'LM', category: 'MID', name: 'Left Mid', x: 20, y: 68 },
      { index: 8, position: 'CAM', category: 'MID', name: 'Attacking Mid', x: 50, y: 68 },
      { index: 9, position: 'RM', category: 'MID', name: 'Right Mid', x: 80, y: 68 },
      { index: 10, position: 'ST', category: 'ATT', name: 'Striker', x: 50, y: 88 },
    ],
  },
  '4-4-2': {
    id: '4-4-2',
    name: '4-4-2 Classic',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 4, recommended: 5, max: 7 },
      MID: { min: 4, recommended: 5, max: 7 },
      ATT: { min: 2, recommended: 3, max: 5 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'LB', category: 'DEF', name: 'Left Back', x: 18, y: 28 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 38, y: 24 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 62, y: 24 },
      { index: 4, position: 'RB', category: 'DEF', name: 'Right Back', x: 82, y: 28 },
      { index: 5, position: 'LM', category: 'MID', name: 'Left Midfielder', x: 18, y: 55 },
      { index: 6, position: 'CM', category: 'MID', name: 'Central Mid (L)', x: 38, y: 52 },
      { index: 7, position: 'CM', category: 'MID', name: 'Central Mid (R)', x: 62, y: 52 },
      { index: 8, position: 'RM', category: 'MID', name: 'Right Midfielder', x: 82, y: 55 },
      { index: 9, position: 'ST', category: 'ATT', name: 'Striker (L)', x: 35, y: 84 },
      { index: 10, position: 'ST', category: 'ATT', name: 'Striker (R)', x: 65, y: 84 },
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    name: '3-5-2 Wingbacks',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 3, recommended: 4, max: 6 },
      MID: { min: 5, recommended: 6, max: 8 },
      ATT: { min: 2, recommended: 3, max: 5 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 26, y: 26 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (C)', x: 50, y: 23 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 74, y: 26 },
      { index: 4, position: 'LWB', category: 'DEF', name: 'Left Wing Back', x: 14, y: 54 },
      { index: 5, position: 'CDM', category: 'MID', name: 'Central Defensive Mid', x: 50, y: 46 },
      { index: 6, position: 'CM', category: 'MID', name: 'Central Mid (L)', x: 34, y: 60 },
      { index: 7, position: 'CM', category: 'MID', name: 'Central Mid (R)', x: 66, y: 60 },
      { index: 8, position: 'RWB', category: 'DEF', name: 'Right Wing Back', x: 86, y: 54 },
      { index: 9, position: 'ST', category: 'ATT', name: 'Striker (L)', x: 36, y: 85 },
      { index: 10, position: 'CF', category: 'ATT', name: 'Striker (R)', x: 64, y: 85 },
    ],
  },
  '3-4-3': {
    id: '3-4-3',
    name: '3-4-3 Wide Attack',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 3, recommended: 4, max: 6 },
      MID: { min: 4, recommended: 5, max: 7 },
      ATT: { min: 3, recommended: 4, max: 6 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 25, y: 25 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (C)', x: 50, y: 22 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 75, y: 25 },
      { index: 4, position: 'LM', category: 'MID', name: 'Left Mid', x: 18, y: 52 },
      { index: 5, position: 'CM', category: 'MID', name: 'Central Mid (L)', x: 38, y: 50 },
      { index: 6, position: 'CM', category: 'MID', name: 'Central Mid (R)', x: 62, y: 50 },
      { index: 7, position: 'RM', category: 'MID', name: 'Right Mid', x: 82, y: 52 },
      { index: 8, position: 'LW', category: 'ATT', name: 'Left Winger', x: 22, y: 80 },
      { index: 9, position: 'ST', category: 'ATT', name: 'Striker', x: 50, y: 86 },
      { index: 10, position: 'RW', category: 'ATT', name: 'Right Winger', x: 78, y: 80 },
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    name: '5-3-2 Solid Defense',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 5, recommended: 6, max: 8 },
      MID: { min: 3, recommended: 4, max: 6 },
      ATT: { min: 2, recommended: 3, max: 5 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'LWB', category: 'DEF', name: 'Left Wing Back', x: 14, y: 38 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 32, y: 24 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Sweeper / Center', x: 50, y: 20 },
      { index: 4, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 68, y: 24 },
      { index: 5, position: 'RWB', category: 'DEF', name: 'Right Wing Back', x: 86, y: 38 },
      { index: 6, position: 'CM', category: 'MID', name: 'Center Mid (L)', x: 30, y: 56 },
      { index: 7, position: 'CDM', category: 'MID', name: 'Central Defensive Mid', x: 50, y: 50 },
      { index: 8, position: 'CM', category: 'MID', name: 'Center Mid (R)', x: 70, y: 56 },
      { index: 9, position: 'ST', category: 'ATT', name: 'Striker (L)', x: 35, y: 84 },
      { index: 10, position: 'ST', category: 'ATT', name: 'Striker (R)', x: 65, y: 84 },
    ],
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    name: '4-1-4-1 Tactical',
    categoryRequirements: {
      GK: { min: 1, recommended: 1, max: 2 },
      DEF: { min: 4, recommended: 5, max: 7 },
      MID: { min: 5, recommended: 6, max: 8 },
      ATT: { min: 1, recommended: 2, max: 4 },
    },
    slots: [
      { index: 0, position: 'GK', category: 'GK', name: 'Goalkeeper', x: 50, y: 10 },
      { index: 1, position: 'LB', category: 'DEF', name: 'Left Back', x: 18, y: 28 },
      { index: 2, position: 'CB', category: 'DEF', name: 'Center Back (L)', x: 38, y: 24 },
      { index: 3, position: 'CB', category: 'DEF', name: 'Center Back (R)', x: 62, y: 24 },
      { index: 4, position: 'RB', category: 'DEF', name: 'Right Back', x: 82, y: 28 },
      { index: 5, position: 'CDM', category: 'MID', name: 'Holding Mid', x: 50, y: 44 },
      { index: 6, position: 'LM', category: 'MID', name: 'Left Mid', x: 18, y: 64 },
      { index: 7, position: 'CM', category: 'MID', name: 'Center Mid (L)', x: 38, y: 64 },
      { index: 8, position: 'CM', category: 'MID', name: 'Center Mid (R)', x: 62, y: 64 },
      { index: 9, position: 'RM', category: 'MID', name: 'Right Mid', x: 82, y: 64 },
      { index: 10, position: 'ST', category: 'ATT', name: 'Striker', x: 50, y: 88 },
    ],
  },
};

export function getEntryAssignedPosition(entry: SquadPlayerEntry): Position {
  return entry.assignedPosition || entry.player.position;
}

export function getEntryAssignedCategory(entry: SquadPlayerEntry): PositionCategory {
  return getPositionCategory(getEntryAssignedPosition(entry));
}

export function getPositionCategory(pos: Position): PositionCategory {
  if (pos === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
  return 'ATT';
}

/**
 * Calculates how well a player fits an assigned position (0-100%).
 */
export function calculatePositionFit(playerPos: Position, altPositions: Position[], targetPos: Position): number {
  if (playerPos === targetPos) return 100;
  if (altPositions.includes(targetPos)) return 90;

  const playerCat = getPositionCategory(playerPos);
  const targetCat = getPositionCategory(targetPos);

  if (playerCat !== targetCat) {
    if (playerCat === 'GK' || targetCat === 'GK') return 20; // GK out of position is terrible
    return 40;
  }

  // Same category fit
  if (targetCat === 'DEF') {
    if ((playerPos === 'LB' || playerPos === 'RB') && (targetPos === 'LWB' || targetPos === 'RWB')) return 85;
    if (playerPos === 'CB' && (targetPos === 'LB' || targetPos === 'RB')) return 70;
    return 75;
  }
  if (targetCat === 'MID') {
    if ((playerPos === 'CDM' && targetPos === 'CM') || (playerPos === 'CM' && targetPos === 'CAM')) return 85;
    if ((playerPos === 'LM' || playerPos === 'RM') && (targetPos === 'LW' || targetPos === 'RW')) return 80;
    return 75;
  }
  if (targetCat === 'ATT') {
    if ((playerPos === 'ST' && targetPos === 'CF') || (playerPos === 'CF' && targetPos === 'ST')) return 90;
    if ((playerPos === 'LW' || playerPos === 'RW') && targetPos === 'ST') return 75;
    return 80;
  }

  return 60;
}

/**
 * Validates a squad against the formation requirements.
 */
export function validateSquadFormation(formation: Formation, squad: SquadPlayerEntry[]): {
  isValid: boolean;
  startersCount: number;
  substitutesCount: number;
  totalCount: number;
  missingPositions: string[];
  categoryCounts: Record<PositionCategory, number>;
  starterCategoryCounts: Record<PositionCategory, number>;
  errors: string[];
} {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const starters = squad.filter(s => s.isStarting);
  const substitutes = squad.filter(s => !s.isStarting);
  const categoryCounts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  const starterCategoryCounts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };

  for (const entry of squad) {
    const cat = getEntryAssignedCategory(entry);
    categoryCounts[cat] += 1;
    if (entry.isStarting) starterCategoryCounts[cat] += 1;
  }

  const errors: string[] = [];
  const missingPositions: string[] = [];
  const starterRequirements = getFormationStarterCategoryCounts(formation);

  // Formation slots define the XI structure. A manager may put an outfield
  // player into another outfield role; positional fit is reflected elsewhere.
  const usedSlots = new Set<number>();
  for (const entry of starters) {
    if (entry.startingSlotIndex == null || usedSlots.has(entry.startingSlotIndex)) {
      errors.push('Each starting player must occupy a unique formation slot.');
      continue;
    }
    const slot = config.slots.find(s => s.index === entry.startingSlotIndex);
    if (!slot) {
      errors.push('A starting player has an invalid formation slot.');
      continue;
    }
    usedSlots.add(slot.index);
    if (slot.category === 'GK' && entry.player.category !== 'GK') {
      errors.push('Only a goalkeeper can occupy the GK slot.');
    }
  }

  for (const cat of ['GK', 'DEF', 'MID', 'ATT'] as PositionCategory[]) {
    const required = starterRequirements[cat];
    const occupied = config.slots.filter(s => s.category === cat && usedSlots.has(s.index)).length;
    if (occupied < required) {
      const diff = required - occupied;
      missingPositions.push(`${diff} ${cat}`);
      errors.push(`Missing ${diff} starting ${cat}`);
    } else if (occupied > required) {
      errors.push(`Too many starting ${cat} players for ${formation}`);
    }
  }

  if (squad.length > 11) errors.push('Squad cannot exceed 11 players.');
  if (starters.length !== 11) errors.push('Starting XI must contain exactly 11 players.');
  if (substitutes.length !== 0) errors.push('Squad cannot contain substitutes.');

  const naturalCategoryCounts: Record<PositionCategory, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const entry of squad) naturalCategoryCounts[entry.player.category] += 1;
  const squadLimits = getFormationSquadCategoryLimits(formation);
  for (const cat of ['GK', 'DEF', 'MID', 'ATT'] as PositionCategory[]) {
    if (naturalCategoryCounts[cat] > squadLimits[cat]) {
      errors.push(`Too many ${cat} players for ${formation} (maximum ${squadLimits[cat]} in the 18-player squad)`);
    }
  }

  const gkCount = naturalCategoryCounts.GK;
  if (gkCount > squadLimits.GK) errors.push(`Squad can contain at most ${squadLimits.GK} goalkeepers.`);

  return {
    isValid: errors.length === 0 && starters.length === 11 && substitutes.length === 0 && squad.length === 11,
    startersCount: starters.length,
    substitutesCount: substitutes.length,
    totalCount: squad.length,
    missingPositions,
    categoryCounts,
    starterCategoryCounts,
    errors,
  };
}

/**
 * Computes overall team rating factoring in starter ratings, position fits, positional weights (GK 15%, DEF 30%, MID 30%, ATT 25%), and condition.
 */
export function calculatePositionalRatings(formation: Formation, squad: SquadPlayerEntry[]) {
  const starters = squad.filter(s => s.isStarting);
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];

  const categoryScores: Record<PositionCategory, number[]> = { GK: [], DEF: [], MID: [], ATT: [] };

  for (let i = 0; i < 11; i++) {
    const slot = config.slots[i];
    const starter = starters.find(s => s.startingSlotIndex === i) || starters[i];
    if (!starter) continue;

    const fit = calculatePositionFit(
      starter.player.position, 
      starter.player.alternatePositions,
      starter.assignedPosition || slot?.position || starter.player.position
    );

    // Condition penalty (Injured / Suspended / Tired)
    let conditionMultiplier = 1.0;
    if (starter.condition.state === 'INJURED' || starter.condition.state === 'SUSPENDED') {
      conditionMultiplier = 0.5;
    } else if (starter.condition.state === 'TIRED' || starter.condition.fatigue > 50) {
      conditionMultiplier = 0.9;
    }

    const effectiveRating = starter.player.overall * (0.6 + 0.4 * (fit / 100)) * conditionMultiplier;
    const cat = slot?.category || getEntryAssignedCategory(starter);
    categoryScores[cat].push(effectiveRating);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 60;

  return {
    gk: avg(categoryScores.GK),
    def: avg(categoryScores.DEF),
    mid: avg(categoryScores.MID),
    att: avg(categoryScores.ATT),
  };
}

export function calculateTeamOverall(formation: Formation, squad: SquadPlayerEntry[]): number {
  const starters = squad.filter(s => s.isStarting);
  if (starters.length === 0) return 0;

  const { gk, def, mid, att } = calculatePositionalRatings(formation, squad);

  // Weight players according to position: GK 15%, DEF 30%, MID 30%, ATT 25%
  const weightedOverall = Math.round(gk * 0.15 + def * 0.30 + mid * 0.30 + att * 0.25);
  return Math.max(50, Math.min(99, weightedOverall));
}
