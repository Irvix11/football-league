import type { Formation, LobbySettings, Manager } from '../src/types/football.js';
import { FORMATIONS_CONFIG } from '../src/constants/formations.js';
import { newId } from './security.js';

export const SUPPORTED_FORMATIONS = new Set(Object.keys(FORMATIONS_CONFIG) as Formation[]);
export const SUPPORTED_PLAYER_POOLS = new Set(['Global', 'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Brasileirão', 'Champions League', 'World Cup'] as const);
export const SUPPORTED_ERAS = new Set(['Current', 'All-Time'] as const);
export const SUPPORTED_AUCTION_MODES = new Set(['Classic', 'Blind', 'Quick'] as const);
export const SUPPORTED_LEAGUE_TYPES = new Set(['Double Round Robin'] as const);
export const SUPPORTED_COMPETITIONS = new Set(['League'] as const);

export function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function sanitizeManagerName(value: unknown, fallback = 'Manager') {
  const clean = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return clean || fallback;
}

export function sanitizeLobbySettings(raw: Partial<LobbySettings> | null | undefined, base?: LobbySettings): LobbySettings {
  const fallback: LobbySettings = base || { maxManagers: 8, startingBudget: 500, playerPool: 'Global', era: 'Current', auctionMode: 'Classic', transfersEnabled: true, leagueType: 'Double Round Robin', competitionFormat: 'League' };
  const maxManagers = Math.round(clampFiniteNumber(raw?.maxManagers, fallback.maxManagers, 2, 16));
  const startingBudget = Math.round(clampFiniteNumber(raw?.startingBudget, fallback.startingBudget, 100, 5000));
  const playerPool = SUPPORTED_PLAYER_POOLS.has(raw?.playerPool as any) ? raw!.playerPool! : fallback.playerPool;
  const era = SUPPORTED_ERAS.has(raw?.era as any) ? raw!.era! : fallback.era;
  const auctionMode = SUPPORTED_AUCTION_MODES.has(raw?.auctionMode as any) ? raw!.auctionMode! : fallback.auctionMode;
  return { maxManagers, startingBudget, playerPool, era, auctionMode, transfersEnabled: typeof raw?.transfersEnabled === 'boolean' ? raw.transfersEnabled : fallback.transfersEnabled, leagueType: 'Double Round Robin', competitionFormat: 'League' };
}

export const BOT_NAMES = ['Pep AI Tactical','Ancelotti Prime','Klopp Heavy Metal','Mourinho Special','Zidane Masterclass','Arteta Process','Xabi Invicto','Flick Blitz'];
export function createBotManager(nameIndex = 0, initialBudget = 500): Manager {
  const botFormations: Formation[] = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'];
  const chosenFormation = botFormations[nameIndex % botFormations.length];
  const botName = BOT_NAMES[nameIndex % BOT_NAMES.length] || 'Tactical Bot ' + (nameIndex + 1);
  return { id: newId('bot-' + nameIndex), name: botName, isHost: false, isBot: true, isReady: true, budget: initialBudget, initialBudget, formation: chosenFormation, tactics: { style: 'Balanced', mentality: 'Balanced', defensiveLine: 55, pressingIntensity: 65, attackWidth: 60, tempo: 65, risk: 50 }, roles: { captainId: '', penaltyTakerId: '', freeKickTakerId: '', cornerTakerId: '' }, squad: [], confirmedTeam: false, teamOverall: 0 };
}