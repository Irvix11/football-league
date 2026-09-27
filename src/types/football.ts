export type Position = 
  | 'GK' 
  | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB'
  | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM'
  | 'LW' | 'RW' | 'ST' | 'CF';

export type PositionCategory = 'GK' | 'DEF' | 'MID' | 'ATT';

export interface PlayerAttributes {
  pac: number; // Pace or Diving (GK)
  sho: number; // Shooting or Handling (GK)
  pas: number; // Passing or Kicking (GK)
  dri: number; // Dribbling or Reflexes (GK)
  def: number; // Defending or Speed (GK)
  phy: number; // Physical or Positioning (GK)
}

export type BlindStatKey = keyof PlayerAttributes;

export interface BlindStatClue {
  key: BlindStatKey;
  value: number;
}

export interface Player {
  id: string;
  name: string;
  club: string;
  league: string;
  nationality: string;
  position: Position;
  category: PositionCategory;
  overall: number;
  attributes: PlayerAttributes;
  age: number;
  preferredFoot: 'Left' | 'Right';
  alternatePositions: Position[];
  marketValue: number; // in Millions (£M)
  startingPrice: number; // in Millions (£M)
  valueSource: string;
  valueVersion: string;
  updatedAt: string;
  /** Present only for a masked Blind Auction player. */
  blindClues?: BlindStatClue[];
}

export type Formation = 
  | '4-3-3' 
  | '4-2-3-1' 
  | '4-4-2' 
  | '3-5-2' 
  | '3-4-3' 
  | '5-3-2' 
  | '4-1-4-1';

export type TacticalStyle = 
  | 'Balanced' 
  | 'Possession' 
  | 'High Press' 
  | 'Counter Attack' 
  | 'Low Block' 
  | 'Long Ball' 
  | 'Aggressive';

export type TacticalMentality = 'Defensive' | 'Balanced' | 'Aggressive';

export interface TeamTactics {
  style: TacticalStyle;
  mentality?: TacticalMentality;
  defensiveLine: number; // 1-100
  pressingIntensity: number; // 1-100
  attackWidth: number; // 1-100
  tempo: number; // 1-100
  risk: number; // 1-100
}

export interface TeamRoles {
  captainId: string;
  penaltyTakerId: string;
  freeKickTakerId: string;
  cornerTakerId: string;
}

export type ConditionState = 'FIT' | 'TIRED' | 'INJURED' | 'SUSPENDED';

export interface PlayerCondition {
  state: ConditionState;
  fatigue: number; // 0 - 100
  injuryMatchesLeft: number;
  yellowCards: number;
  redCards: number;
  suspensionMatchesLeft: number;
}

export interface SquadPlayerEntry {
  player: Player;
  isStarting: boolean;
  startingSlotIndex?: number; // 0-10 for starters
  /** Deprecated: retained for saved-room compatibility; XI-only squads never use it. */
  benchIndex?: number;
  assignedPosition?: Position;
  condition: PlayerCondition;
}

export interface Manager {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  isReady: boolean;
  budget: number; // in Millions (£M)
  initialBudget: number;
  formation: Formation;
  tactics: TeamTactics;
  roles: TeamRoles;
  squad: SquadPlayerEntry[];
  confirmedTeam: boolean;
  teamOverall: number;
}

export type PlayerPool = 
  | 'Global' 
  | 'Premier League' 
  | 'La Liga' 
  | 'Bundesliga' 
  | 'Serie A' 
  | 'Brasileirão' 
  | 'Champions League' 
  | 'World Cup';

export type Era = 'Current' | 'All-Time';
export type AuctionMode = 'Classic' | 'Blind' | 'Quick';
export type LeagueType = 'Round Robin' | 'Double Round Robin';
export type CompetitionFormat = 'League' | 'Knockout' | 'Champions Cup';

export interface LobbySettings {
  maxManagers: number; // 2-16
  startingBudget: number; // in Millions (£M)
  playerPool: PlayerPool;
  era: Era;
  auctionMode: AuctionMode;
  transfersEnabled: boolean;
  leagueType: LeagueType;
  competitionFormat?: CompetitionFormat;
}

export type GamePhase = 
  | 'lobby' 
  | 'formation_select' 
  | 'auction' 
  | 'team_management' 
  | 'league' 
  | 'knockout'
  | 'season_end';

export interface AuctionHistoryItem {
  id: string;
  playerId: string;
  playerName: string;
  playerOverall: number;
  playerPosition: Position;
  winnerId: string;
  winnerName: string;
  price: number;
  timestamp: number;
}

export interface AuctionState {
  currentPlayerIndex: number;
  totalPlayersInPool: number;
  currentPlayer: Player | null;
  currentBid: number;
  highestBidderId: string | null;
  highestBidderName: string | null;
  secondsRemaining: number;
  isPaused: boolean;
  isSold: boolean;
  winnerId: string | null;
  soldPrice: number;
  auctionHistory: AuctionHistoryItem[];
  // For blind auction
  hasSubmittedSecretBid?: Record<string, boolean>; // public indicator that a manager submitted
  /** Two server-selected attributes shown before a Blind Auction reveal. */
  blindClues?: BlindStatClue[];
}

export type MatchEventType = 
  | 'kickoff'
  | 'goal' 
  | 'shot' 
  | 'shot_saved' 
  | 'shot_missed' 
  | 'shot_blocked'
  | 'tackle' 
  | 'interception' 
  | 'pass' 
  | 'carry'
  | 'cross'
  | 'corner' 
  | 'foul' 
  | 'yellow_card' 
  | 'red_card' 
  | 'penalty_awarded'
  | 'penalty_shot'
  | 'injury' 
  | 'substitution'
  | 'offside'
  | 'halftime'
  | 'extra_time_start'
  | 'extra_time_half'
  | 'extra_time_end'
  | 'penalty_shootout_start'
  | 'penalty_shootout_kick'
  | 'fulltime';

export interface LivePlayerPosition {
  id: string;
  name: string;
  number: number;
  position: Position;
  category: PositionCategory;
  overall: number;
  team: 'home' | 'away';
  x: number; // 0 to 100 on horizontal pitch
  y: number; // 0 to 100 on horizontal pitch
  hasBall?: boolean;
  action?: 'idle' | 'running' | 'passing' | 'shooting' | 'diving' | 'tackling' | 'celebrating';
}

export interface MatchEvent {
  id: string;
  minute: number;
  second?: number;
  type: MatchEventType;
  team: 'home' | 'away';
  playerId: string;
  playerName: string;
  playerNumber?: number;
  targetPlayerId?: string;
  targetPlayerName?: string;
  assistPlayerId?: string;
  assistPlayerName?: string;
  commentary: string;
  ballCoordinates: { x: number; y: number }; // 0 to 100 on pitch
  ballStartCoordinates?: { x: number; y: number };
  playerCoordinates?: LivePlayerPosition[];
  momentum: number; // -100 (away dominance) to +100 (home dominance)
  currentScore?: { home: number; away: number };
  chanceQuality?: number; // 0-100 game-model chance quality
}

export interface TeamMatchStats {
  score: number;
  possession: number; // percentage
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passAccuracy: number;
  corners: number;
  fouls: number;
  tackles?: number;
  saves?: number;
  yellowCards: number;
  redCards: number;
  offsides: number;
}

export interface PlayerMatchStat {
  playerId: string;
  playerName: string;
  team: 'home' | 'away';
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  passes: number;
  tackles: number;
  interceptions: number;
  saves: number;
  yellowCard: boolean;
  redCard: boolean;
  rating: number; // 5.0 to 10.0
}

export interface PenaltyKickResult {
  round: number;
  team: 'home' | 'away';
  takerId: string;
  takerName: string;
  takerNumber: number;
  outcome: 'goal' | 'saved' | 'missed';
  scoreAfter: { home: number; away: number };
  commentary: string;
}

export interface Fixture {
  id: string;
  matchday: number;
  homeManagerId: string;
  homeManagerName: string;
  awayManagerId: string;
  awayManagerName: string;
  played: boolean;
  homeScore?: number;
  awayScore?: number;
  events?: MatchEvent[];
  homeStats?: TeamMatchStats;
  awayStats?: TeamMatchStats;
  playerStats?: PlayerMatchStat[];
  seed?: number;
  isKnockout?: boolean;
  roundName?: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final';
  wentToExtraTime?: boolean;
  wentToPenalties?: boolean;
  homePenaltyScore?: number;
  awayPenaltyScore?: number;
  penaltyShootout?: PenaltyKickResult[];
  winnerManagerId?: string;
  homeWinProbability?: number;
  drawProbability?: number;
  awayWinProbability?: number;
  homeStrength?: number;
  awayStrength?: number;
}

export interface KnockoutRound {
  roundName: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final';
  fixtures: Fixture[];
  isComplete: boolean;
}

export interface KnockoutStageState {
  currentRound: 'Round of 16' | 'Quarter-Final' | 'Semi-Final' | 'Third-Place' | 'Final';
  rounds: KnockoutRound[];
  championId?: string;
  championName?: string;
}

export interface LeagueTableRow {
  managerId: string;
  managerName: string;
  isBot: boolean;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: ('W' | 'D' | 'L')[];
}

export interface TransferOffer {
  id: string;
  fromManagerId: string;
  fromManagerName: string;
  toManagerId: string;
  toManagerName: string;
  offeredPlayerId: string;
  offeredPlayerName: string;
  requestedPlayerId: string;
  requestedPlayerName: string;
  offeredCash: number; // in £M
  matchday: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: number;
}

export interface SeasonAwards {
  goldenBoot: { playerId: string; playerName: string; teamName: string; goals: number };
  topAssists: { playerId: string; playerName: string; teamName: string; assists: number };
  bestGK: { playerId: string; playerName: string; teamName: string; cleanSheets: number; saves: number };
  playerOfTheSeason: { playerId: string; playerName: string; teamName: string; avgRating: number; goals: number; assists: number };
  bestDefender: { playerId: string; playerName: string; teamName: string; avgRating: number; tackles: number };
  bestMidfielder: { playerId: string; playerName: string; teamName: string; avgRating: number; passes: number };
  bestYoungPlayer: { playerId: string; playerName: string; teamName: string; age: number; goals: number; assists: number };
  managerOfTheSeason: { managerId: string; managerName: string; points: number; winRate: number };
}

export interface GameRoom {
  code: string;
  hostId: string;
  settings: LobbySettings;
  phase: GamePhase;
  managers: Manager[];
  auction: AuctionState;
  fixtures: Fixture[];
  currentMatchday: number;
  totalMatchdays: number;
  leagueTable: LeagueTableRow[];
  transferOffers: TransferOffer[];
  /** Explicit phase readiness for formation/auction/team setup. */
  phaseReadyIds?: string[];
  /** True when the season is paused for the mid-season management/transfer window. */
  transferWindowOpen?: boolean;
  /** Matchday after which the mid-season window opened. */
  transferWindowMatchday?: number;
  /** Managers who have finished their mid-season review. */
  transferWindowReadyIds?: string[];
  knockoutStage?: KnockoutStageState;
  awards: SeasonAwards | null;
  createdAt: number;
  updatedAt: number;
}
