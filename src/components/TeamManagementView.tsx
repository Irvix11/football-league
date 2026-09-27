import React, { useState } from 'react';
import { GameRoom, Formation, TacticalStyle, TacticalMentality, SquadPlayerEntry, TeamTactics, TeamRoles, Player, Position } from '../types/football';
import { FORMATIONS_CONFIG, validateSquadFormation, calculatePositionFit, getPositionCategory } from '../constants/formations';
import { PitchGraphic } from './PitchGraphic';
import { PlayerCard } from './PlayerCard';
import { PlayerPitchMarker } from './PlayerPitchMarker';
import { CheckCircle2, AlertTriangle, Shuffle, Info, X, Shield, Users, Zap, Check, Flame, Award, Sliders } from 'lucide-react';

interface TeamManagementViewProps {
  room: GameRoom;
  managerId: string;
  onUpdateLineup: (squad: SquadPlayerEntry[], formation?: Formation, tactics?: TeamTactics, roles?: TeamRoles) => void;
  onConfirmTeam: () => void;
}

/**
 * Automatically maps starting players to the optimal slots in a new formation
 * based on position suitability and category requirements.
 */
function playerLineupScore(entry: SquadPlayerEntry, slot: { position: any; category: any }): number {
  const player = entry.player;
  const fit = calculatePositionFit(player.position, player.alternatePositions, slot.position);
  const a = player.attributes;
  const relevant = slot.category === 'GK'
    ? (a.dri + a.def + a.phy) / 3
    : slot.category === 'DEF'
      ? a.def * 0.55 + a.pas * 0.20 + a.phy * 0.15 + a.pac * 0.10
      : slot.category === 'MID'
        ? a.pas * 0.35 + a.dri * 0.25 + a.def * 0.15 + a.sho * 0.15 + a.pac * 0.10
        : a.sho * 0.40 + a.pac * 0.20 + a.dri * 0.25 + a.pas * 0.15;
  return player.overall * 0.55 + fit * 0.35 + relevant * 0.10;
}

/**
 * Automatically fills every formation slot with the best available player,
 * considering OVR, attributes and positional fit. Remaining players become
 * The manager can then manually swap/edit the XI.
 */
function autoFillBestLineup(squad: SquadPlayerEntry[], formation: Formation): SquadPlayerEntry[] {
  const config = FORMATIONS_CONFIG[formation] || FORMATIONS_CONFIG['4-3-3'];
  const remaining = [...squad];
  const starters: SquadPlayerEntry[] = [];

  const orderedSlots = [...config.slots].sort((a, b) => {
    if (a.category === 'GK') return -1;
    if (b.category === 'GK') return 1;
    const specific = (position: string) => ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
    return Number(specific(b.position)) - Number(specific(a.position));
  });

  for (const slot of orderedSlots) {
    const candidates = remaining.filter(entry =>
      slot.category === 'GK' ? entry.player.category === 'GK' : entry.player.category !== 'GK'
    );
    const pool = candidates.length ? candidates : remaining;
    const chosen = [...pool].sort(
      (a, b) => playerLineupScore(b, slot) - playerLineupScore(a, slot) || b.player.overall - a.player.overall
    )[0];
    if (!chosen) continue;

    remaining.splice(remaining.findIndex(entry => entry.player.id === chosen.player.id), 1);
    starters.push({
      ...chosen,
      isStarting: true,
      startingSlotIndex: slot.index,
      benchIndex: undefined,
      assignedPosition: slot.position,
    });
  }

  const bench = remaining.slice(0, 7).map((entry, index) => ({
    ...entry,
    isStarting: false,
    startingSlotIndex: undefined,
    benchIndex: index,
    assignedPosition: entry.assignedPosition || entry.player.position,
  }));

  return [
    ...starters.sort((a, b) => (a.startingSlotIndex ?? 99) - (b.startingSlotIndex ?? 99)).slice(0, 11),
    ...bench,
  ];
}
const ALL_POSITIONS: Position[] = [
  'GK','LB','CB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','ST','CF',
];

function allowedPositionsForPlayer(player: Player, _starterCategory?: 'GK' | 'DEF' | 'MID' | 'ATT'): Position[] {
  // The formation owns the slot; the manager chooses the tactical role.
  // Any outfield player may be played anywhere on the pitch. Natural and
  // alternate positions are listed first, followed by every other outfield
  // role. Out-of-position play is legal and is reflected in Effective OVR.
  if (player.category === 'GK') return ['GK'];
  const preferred = [player.position, ...(player.alternatePositions || [])]
    .filter((p, index, list) => p !== 'GK' && list.indexOf(p) === index);
  const other = ALL_POSITIONS.filter((position) => position !== 'GK' && !preferred.includes(position));
  return [...preferred, ...other];
}

function bestPositionForCategory(entry: SquadPlayerEntry, category: 'GK' | 'DEF' | 'MID' | 'ATT'): Position {
  const candidates = ALL_POSITIONS.filter((p) => getPositionCategory(p) === category);
  return [...candidates].sort(
    (a, b) =>
      calculatePositionFit(entry.player.position, entry.player.alternatePositions, b) -
      calculatePositionFit(entry.player.position, entry.player.alternatePositions, a)
  )[0] || entry.player.position;
}

function reassignStartersToFormation(squad: SquadPlayerEntry[], newFormation: Formation): SquadPlayerEntry[] {
  return autoFillBestLineup(squad, newFormation);
}


export const TeamManagementView: React.FC<TeamManagementViewProps> = ({
  room,
  managerId,
  onUpdateLineup,
  onConfirmTeam,
}) => {
  const currentManager = room.managers.find((m) => m.id === managerId);
  if (!currentManager) return null;

  const [activeTab, setActiveTab] = useState<'pitch' | 'tactics' | 'roles'>('pitch');
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // Mobile Bottom Sheet modal for inspected player
  const [inspectedPlayer, setInspectedPlayer] = useState<{
    entry: SquadPlayerEntry;
    slotIndex?: number;
    isStarter: boolean;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const formationConfig = FORMATIONS_CONFIG[currentManager.formation] || FORMATIONS_CONFIG['4-3-3'];
  const validation = validateSquadFormation(currentManager.formation, currentManager.squad);

  const starters = currentManager.squad.filter((s) => s.isStarting);
  const getEffectiveOvr = (entry: SquadPlayerEntry, slotPosition: Position) => {
    const fit = calculatePositionFit(entry.player.position, entry.player.alternatePositions, entry.assignedPosition || slotPosition);
    const conditionMultiplier = entry.condition.state === 'INJURED' || entry.condition.state === 'SUSPENDED'
      ? 0.5
      : entry.condition.state === 'TIRED' || entry.condition.fatigue > 50 ? 0.9 : 1;
    return Math.round(entry.player.overall * (0.6 + 0.4 * (fit / 100)) * conditionMultiplier);
  };

  // All 7 supported tactical presets
  const TACTICAL_PRESETS: Record<TacticalStyle, TeamTactics> = {
    Balanced: { style: 'Balanced', mentality: 'Balanced', defensiveLine: 50, pressingIntensity: 50, attackWidth: 50, tempo: 50, risk: 50 },
    Possession: { style: 'Possession', mentality: 'Balanced', defensiveLine: 65, pressingIntensity: 60, attackWidth: 70, tempo: 40, risk: 40 },
    'High Press': { style: 'High Press', mentality: 'Aggressive', defensiveLine: 75, pressingIntensity: 85, attackWidth: 60, tempo: 75, risk: 65 },
    'Counter Attack': { style: 'Counter Attack', mentality: 'Aggressive', defensiveLine: 35, pressingIntensity: 45, attackWidth: 65, tempo: 85, risk: 70 },
    'Low Block': { style: 'Low Block', mentality: 'Defensive', defensiveLine: 25, pressingIntensity: 35, attackWidth: 40, tempo: 35, risk: 30 },
    'Long Ball': { style: 'Long Ball', mentality: 'Balanced', defensiveLine: 40, pressingIntensity: 40, attackWidth: 50, tempo: 80, risk: 60 },
    Aggressive: { style: 'Aggressive', mentality: 'Aggressive', defensiveLine: 65, pressingIntensity: 90, attackWidth: 60, tempo: 70, risk: 80 },
  };

  const handleFormationChange = (newFormation: Formation) => {
    const reassignedSquad = reassignStartersToFormation(currentManager.squad, newFormation);
    const nextValidation = validateSquadFormation(newFormation, reassignedSquad);
    if (!nextValidation.isValid) {
      setActionError(nextValidation.errors.join(' '));
      return;
    }
    setActionError(null);
    onUpdateLineup(reassignedSquad, newFormation);
  };

  const handleAutoFill = () => {
    const optimized = autoFillBestLineup(currentManager.squad, currentManager.formation);
    const validation = validateSquadFormation(currentManager.formation, optimized);
    if (!validation.isValid) {
      setActionError(validation.errors.join(' '));
      return;
    }
    setActionError(null);
    onUpdateLineup(optimized, currentManager.formation);
  };

  const handleTacticalStyleChange = (style: TacticalStyle) => {
    const preset = TACTICAL_PRESETS[style] || TACTICAL_PRESETS.Balanced;
    onUpdateLineup(currentManager.squad, currentManager.formation, preset);
  };

  const handleMentalityChange = (mentality: TacticalMentality) => {
    const updated: TeamTactics = {
      ...currentManager.tactics,
      mentality,
    };
    onUpdateLineup(currentManager.squad, currentManager.formation, updated);
  };

  const handleSliderChange = (field: keyof TeamTactics, val: number) => {
    const updated: TeamTactics = {
      ...currentManager.tactics,
      [field]: val,
    };
    onUpdateLineup(currentManager.squad, currentManager.formation, updated);
  };

  const handleRoleChange = (role: keyof TeamRoles, playerId: string) => {
    const updatedRoles: TeamRoles = {
      ...currentManager.roles,
      [role]: playerId,
    };
    onUpdateLineup(currentManager.squad, currentManager.formation, currentManager.tactics, updatedRoles);
  };

  // Tap one player and then another to swap two starting-XI players.
  const handlePlayerSwapById = (firstId: string, secondId: string) => {
    if (firstId === secondId) return;
    const firstIndex = currentManager.squad.findIndex((s) => s.player.id === firstId);
    const secondIndex = currentManager.squad.findIndex((s) => s.player.id === secondId);
    if (firstIndex < 0 || secondIndex < 0) return;

    const next = [...currentManager.squad];
    const first = next[firstIndex];
    const second = next[secondIndex];
    const firstSlot = first.startingSlotIndex ?? firstIndex;
    const secondSlot = second.startingSlotIndex ?? secondIndex;
    const firstSlotPos = formationConfig.slots.find((s) => s.index === firstSlot)?.position || first.assignedPosition || first.player.position;
    const secondSlotPos = formationConfig.slots.find((s) => s.index === secondSlot)?.position || second.assignedPosition || second.player.position;

    next[firstIndex] = { ...second, isStarting: true, startingSlotIndex: firstSlot, assignedPosition: firstSlotPos };
    next[secondIndex] = { ...first, isStarting: true, startingSlotIndex: secondSlot, assignedPosition: firstSlotPos };

    setActionError(null);
    setSelectedPlayerId(null);
    setSelectedSlotIndex(null);
    setInspectedPlayer(null);
    onUpdateLineup(next);
  };

  const handlePositionChange = (playerId: string, position: Position) => {
    const entry = currentManager.squad.find((s) => s.player.id === playerId);
    if (!entry) return;

    const nextCategory = getPositionCategory(position);
    if (entry.player.category === 'GK' && nextCategory !== 'GK') {
      setActionError('Goalkeepers can only be assigned to GK.');
      return;
    }
    if (entry.player.category !== 'GK' && nextCategory === 'GK') {
      setActionError('Outfield players cannot be assigned to GK.');
      return;
    }

    const updated = currentManager.squad.map((s) =>
      s.player.id === playerId ? { ...s, assignedPosition: position } : s
    );
    setActionError(null);
    onUpdateLineup(updated);
  };

  const confirmedCount = room.managers.filter((m) => m.confirmedTeam || m.isBot).length;
  const totalCount = room.managers.length;

  return (
    <div className="min-h-screen bg-[#02050b] text-slate-100 p-3 sm:p-5 md:p-6 pb-20 flex flex-col justify-between max-w-7xl mx-auto select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-900 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-black text-emerald-400">FOOTBALL AUCTION LEAGUE</span>
            <span className="text-xs text-slate-500 font-mono">Team Headquarters</span>
          </div>
          <h1 className="font-display font-black text-2xl sm:text-3xl text-slate-100 tracking-tight">
            TEAM MANAGEMENT
          </h1>
        </div>

        {/* Stats Badges */}
        <div className="flex items-center gap-3 bg-white/[0.035] backdrop-blur-xl border border-white/7 p-2 sm:p-2.5 rounded-2xl shadow-2xl shadow-black/20">
          <div className="px-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">TEAM OVR</div>
            <div className="font-mono font-black text-emerald-400 text-lg sm:text-xl">{currentManager.teamOverall}</div>
          </div>
          <div className="h-8 w-[1px] bg-slate-800" />
          <div className="px-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">FORMATION</div>
            <div className="font-mono font-black text-slate-200 text-lg sm:text-xl">{currentManager.formation}</div>
          </div>
          <div className="h-8 w-[1px] bg-slate-800" />
          <div className="px-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">READY</div>
            <div className="font-mono font-black text-amber-400 text-lg sm:text-xl">
              {confirmedCount}/{totalCount}
            </div>
          </div>
        </div>
      </div>

      {/* Segmented Navigation Tabs (Requirements 1, 2, 3) */}
      <div className="grid grid-cols-3 gap-1.5 p-1 bg-white/[0.025] backdrop-blur-xl rounded-2xl border border-white/7 my-3 shadow-xl shadow-black/10">
        <button
          onClick={() => setActiveTab('pitch')}
          className={`py-2.5 sm:py-3 px-2 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 ${
            activeTab === 'pitch'
              ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="truncate">Starting XI</span>
        </button>

        <button
          onClick={() => setActiveTab('tactics')}
          className={`py-2.5 sm:py-3 px-2 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 ${
            activeTab === 'tactics'
              ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="truncate">Tactics & Playstyle</span>
        </button>

        <button
          onClick={() => setActiveTab('roles')}
          className={`py-2.5 sm:py-3 px-2 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 ${
            activeTab === 'roles'
              ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="truncate">Captain & Set Pieces</span>
        </button>
      </div>

      {/* Validation Warning Alert if formation incomplete */}
      {!validation.isValid && (
        <div className="mb-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 flex items-center gap-3 text-xs text-rose-300 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <span className="font-bold uppercase tracking-wider">Lineup Incomplete: </span>
            {validation.errors.join(' · ')}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 1: STARTING XI (Formation Switcher + Interactive Pitch) --- */}
      {/* ========================================================================= */}
      {activeTab === 'pitch' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-2 flex-1 items-start">
          {/* Large Interactive Pitch (7 cols) */}
          <div className="lg:col-span-7 flex flex-col items-center">
            {/* All 7 Clickable Formations (Requirement 1) */}
            <div className="w-full mb-3 p-3 rounded-2xl bg-white/[0.035] backdrop-blur-xl border border-white/7 space-y-2 shadow-xl shadow-black/10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-bold uppercase tracking-wider">Select Formation:</span>
                <span className="font-mono text-emerald-400 font-black">{currentManager.formation}</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {(['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3', '5-3-2', '4-1-4-1'] as Formation[]).map((f) => {
                  const isCurrent = currentManager.formation === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => handleFormationChange(f)}
                      className={`py-2 px-1 rounded-xl text-xs font-mono font-black border transition-all cursor-pointer active:scale-95 text-center ${
                        isCurrent
                          ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleAutoFill}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-950 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400/60 transition-all font-display font-black text-xs uppercase tracking-wider active:scale-[0.98]"
              >
                <Shuffle className="w-4 h-4" />
                AUTO-FILL BEST XI
              </button>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">TEAM OVR</div>
                  <div className="text-xl font-mono font-black text-emerald-400">{currentManager.teamOverall}</div>
                </div>
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">STARTERS</div>
                  <div className="text-xl font-mono font-black text-slate-100">{starters.length}/11</div>
                </div>
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">SQUAD</div>
                  <div className="text-xl font-mono font-black text-slate-100">{currentManager.squad.length}/18</div>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                TEAM BUILDER uses OVR + attributes + positional fit. Tap a player to inspect them, swap two starters, or assign any outfield position. Effective OVR updates instantly.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-mono font-black">
                <span className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">NATURAL 90–100</span>
                <span className="px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">ALT 70–89</span>
                <span className="px-2 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">OOP &lt;70</span>
              </div>
            </div>

            {actionError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] font-semibold">
                {actionError}
              </div>
            )}

            {/* Interactive Football Pitch (Requirement 9: Position, Jersey #, OVR) */}
            <div className="w-full max-w-lg">
              <PitchGraphic aspectRatio="vertical" className="p-4 shadow-2xl">
                {formationConfig.slots.map((slot) => {
                  const starter = currentManager.squad.find(
                    (s) => s.isStarting && s.startingSlotIndex === slot.index
                  );
                  const isSelected = selectedSlotIndex === slot.index;
                  const fit = starter
                    ? calculatePositionFit(starter.player.position, starter.player.alternatePositions, starter.assignedPosition || slot.position)
                    : 100;

                  return (
                    <div
                      key={slot.index}
                      className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                      style={{
                        left: `${slot.x}%`,
                        top: `${slot.y}%`,
                      }}
                    >
                      <PlayerPitchMarker
                        player={starter?.player}
                        positionLabel={(starter?.assignedPosition || slot.position)}
                        slotIndex={slot.index}
                        isSelected={isSelected}
                        isSubTarget={false}
                        fitPercentage={starter ? fit : undefined}
                        effectiveOverall={starter ? getEffectiveOvr(starter, slot.position) : undefined}
                        size="md"
                        onClick={() => {
                          if (starter && selectedPlayerId && selectedPlayerId !== starter.player.id) {
                            handlePlayerSwapById(selectedPlayerId, starter.player.id);
                            return;
                          }
                          if (starter) {
                            setSelectedPlayerId(selectedPlayerId === starter.player.id ? null : starter.player.id);
                            setInspectedPlayer({
                              entry: starter,
                              slotIndex: slot.index,
                              isStarter: true,
                            });
                            setSelectedSlotIndex(isSelected ? null : slot.index);
                          } else {
                            setSelectedPlayerId(null);
                            setSelectedSlotIndex(null);
                            setInspectedPlayer(null);
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </PitchGraphic>
            </div>

            <div className="mt-3 w-full rounded-2xl bg-slate-900/80 border border-slate-800 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider font-black text-slate-400">STARTING XI OVR</span>
                <span className="font-mono font-black text-emerald-400">TEAM OVR {currentManager.teamOverall}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {starters.slice().sort((a, b) => (a.startingSlotIndex ?? 99) - (b.startingSlotIndex ?? 99)).map((entry) => (
                  <button key={entry.player.id} type="button" onClick={() => setInspectedPlayer({ entry, slotIndex: entry.startingSlotIndex, isStarter: true })} className="text-left rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 hover:border-emerald-500/50">
                    <div className="text-[10px] text-slate-300 truncate">{entry.player.name}</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-mono text-slate-500">{entry.assignedPosition || entry.player.position}</span>
                      <span className="text-[11px] font-mono font-black text-emerald-400">
                        {entry.player.overall} OVR
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <span className="text-[8px] text-slate-600">
                        NAT {entry.player.position}
                      </span>
                      <span className="text-[8px] font-mono font-bold text-sky-300">
                        EFFECTIVE {getEffectiveOvr(entry, formationConfig.slots.find(s => s.index === entry.startingSlotIndex)?.position || entry.assignedPosition || entry.player.position)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 text-center">Tap a player to change position. OVR is the player's base rating; Team OVR includes positional fit and condition.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">XI OVR AVG</div>
                  <div className="font-mono font-black text-slate-100">
                    {starters.length ? Math.round(starters.reduce((sum, s) => sum + s.player.overall, 0) / starters.length) : 0}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-950 border border-emerald-500/20 px-2 py-1.5 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">TEAM OVR</div>
                  <div className="font-mono font-black text-emerald-400">{currentManager.teamOverall}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Starting XI & Active Player Details (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Desktop Selected Player Preview */}
            {inspectedPlayer && (
              <div className="hidden lg:block p-4 rounded-2xl bg-slate-900 border border-emerald-500/40 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Starting XI Player
                  </span>
                  <button
                    onClick={() => setInspectedPlayer(null)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <PlayerCard player={inspectedPlayer.entry.player} size="sm" />
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider font-black text-slate-400">PLAY AS</span>
                    <span className="font-mono font-black text-emerald-400">
                      {inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position}
                    </span>
                  </div>
                  <select
                    value={inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position}
                    onChange={(e) => handlePositionChange(inspectedPlayer.entry.player.id, e.target.value as Position)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-bold text-white"
                  >
                    {allowedPositionsForPlayer(
                      inspectedPlayer.entry.player,
                      inspectedPlayer.isStarter && inspectedPlayer.entry.startingSlotIndex !== undefined
                        ? formationConfig.slots.find((s) => s.index === inspectedPlayer.entry.startingSlotIndex)?.category
                        : undefined
                    ).map((pos) => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                  </select>
                  {(() => {
                    const slot = inspectedPlayer.slotIndex !== undefined
                      ? formationConfig.slots.find((s) => s.index === inspectedPlayer.slotIndex)
                      : undefined;
                    const fit = calculatePositionFit(
                      inspectedPlayer.entry.player.position,
                      inspectedPlayer.entry.player.alternatePositions,
                      inspectedPlayer.entry.assignedPosition || slot?.position || inspectedPlayer.entry.player.position
                    );
                    const effective = getEffectiveOvr(
                      inspectedPlayer.entry,
                      slot?.position || inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position
                    );
                    return (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-slate-900 border border-slate-800 p-2">
                            <div className="text-[8px] uppercase text-slate-600 font-black">BASE OVR</div>
                            <div className="font-mono font-black text-slate-100">{inspectedPlayer.entry.player.overall}</div>
                          </div>
                          <div className="rounded-lg bg-slate-900 border border-emerald-500/20 p-2">
                            <div className="text-[8px] uppercase text-slate-600 font-black">EFFECTIVE OVR</div>
                            <div className="font-mono font-black text-emerald-400">{effective}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px]">
                          <span className="text-slate-500">Natural: {inspectedPlayer.entry.player.position}</span>
                          <span className={fit >= 90 ? 'text-emerald-400 font-bold' : fit >= 70 ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold'}>
                            {fit >= 90 ? 'NATURAL' : fit >= 70 ? 'ALTERNATE' : 'OUT OF POSITION'} · {fit}%
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">
                          Alternate: {inspectedPlayer.entry.player.alternatePositions.join(', ') || 'None'}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">STARTING XI · 11 PLAYERS</h3>
                <span className="font-mono text-emerald-400 text-xs font-black">TEAM OVR {currentManager.teamOverall}</span>
              </div>
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {starters.slice().sort((a, b) => (a.startingSlotIndex ?? 99) - (b.startingSlotIndex ?? 99)).map((entry) => {
                  const slot = formationConfig.slots.find(s => s.index === entry.startingSlotIndex);
                  const assigned = entry.assignedPosition || slot?.position || entry.player.position;
                  const effective = getEffectiveOvr(entry, slot?.position || assigned);
                  const fit = calculatePositionFit(entry.player.position, entry.player.alternatePositions, assigned);
                  return (
                    <button key={entry.player.id} type="button"
                      onClick={() => setInspectedPlayer({ entry, slotIndex: entry.startingSlotIndex, isStarter: true })}
                      className="w-full text-left p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-100 truncate">{entry.player.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{assigned} · {entry.player.club}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-black text-emerald-400 text-sm">{entry.player.overall} OVR</div>
                          <div className="font-mono text-[9px] text-sky-300">EFFECTIVE {effective}</div>
                        </div>
                      </div>
                      <div className="mt-1 flex justify-between text-[9px] font-mono">
                        <span className="text-slate-600">NAT {entry.player.position} · ALT {entry.player.alternatePositions.join(', ') || '—'}</span>
                        <span className={fit >= 90 ? 'text-emerald-400' : fit >= 70 ? 'text-amber-400' : 'text-rose-400'}>{fit}% FIT</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">XI OVR AVG</div>
                  <div className="font-mono font-black text-slate-100 text-lg">{starters.length ? Math.round(starters.reduce((sum, s) => sum + s.player.overall, 0) / starters.length) : 0}</div>
                </div>
                <div className="rounded-lg bg-slate-950 border border-emerald-500/20 px-2 py-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 font-black">TEAM OVR</div>
                  <div className="font-mono font-black text-emerald-400 text-lg">{currentManager.teamOverall}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 2: TACTICS & PLAYSTYLE (Presets + Sliders) (Requirement 2)         */}
      {/* ========================================================================= */}
      {activeTab === 'tactics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 my-2 flex-1 items-start">
          {/* Tactical Style Presets (All 7 working) */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3.5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Tactical Philosophy & Style
              </h3>
              <span className="text-xs font-mono font-black text-emerald-400">
                Active: {currentManager.tactics.style}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(['Balanced', 'Possession', 'High Press', 'Counter Attack', 'Low Block', 'Long Ball', 'Aggressive'] as TacticalStyle[]).map(
                (style) => {
                  const isSelected = currentManager.tactics.style === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      onClick={() => handleTacticalStyleChange(style)}
                      className={`p-3.5 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400 text-slate-100 shadow-md shadow-emerald-500/20 ring-2 ring-emerald-400/40'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display font-bold text-sm text-slate-100">{style}</span>
                        {isSelected && <Check className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {style === 'Possession' && 'Patient possession, high passing volume.'}
                        {style === 'High Press' && 'Aggressive turnovers, high stamina burn.'}
                        {style === 'Counter Attack' && 'Deep defense with rapid breakaway passes.'}
                        {style === 'Low Block' && 'Deep compact box, reduced chance quality.'}
                        {style === 'Aggressive' && 'Hard tackling, intimidation & card risk.'}
                        {style === 'Balanced' && 'Standard versatile match structure.'}
                        {style === 'Long Ball' && 'Direct overhead aerial service to strikers.'}
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Tactical Sliders (Defensive Line, Pressing, Width, Tempo, Risk) */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Tactical Slider Attributes
            </h3>

            {/* Defensive Line */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Defensive Line Depth</span>
                <span className="font-mono text-emerald-400 font-bold">{currentManager.tactics.defensiveLine}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={currentManager.tactics.defensiveLine}
                onChange={(e) => handleSliderChange('defensiveLine', parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Deep / Low Block</span>
                <span>High Line</span>
              </div>
            </div>

            {/* Pressing Intensity */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Pressing Intensity</span>
                <span className="font-mono text-emerald-400 font-bold">{currentManager.tactics.pressingIntensity}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                value={currentManager.tactics.pressingIntensity}
                onChange={(e) => handleSliderChange('pressingIntensity', parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Stand-off</span>
                <span>Gegenpressing</span>
              </div>
            </div>

            {/* Attack Width */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Attack Width</span>
                <span className="font-mono text-emerald-400 font-bold">{currentManager.tactics.attackWidth}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="85"
                value={currentManager.tactics.attackWidth}
                onChange={(e) => handleSliderChange('attackWidth', parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Narrow</span>
                <span>Wide Wings</span>
              </div>
            </div>

            {/* Tempo */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Tempo & Speed</span>
                <span className="font-mono text-emerald-400 font-bold">{currentManager.tactics.tempo}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="90"
                value={currentManager.tactics.tempo}
                onChange={(e) => handleSliderChange('tempo', parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Patient</span>
                <span>Rapid Fast-Break</span>
              </div>
            </div>

            {/* Direct Risk */}
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Direct Risk & Penetration</span>
                <span className="font-mono text-emerald-400 font-bold">{currentManager.tactics.risk}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="90"
                value={currentManager.tactics.risk}
                onChange={(e) => handleSliderChange('risk', parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Safe Ball Retention</span>
                <span>High-Risk Killers</span>
              </div>
            </div>
          </div>

          {/* Tactical Mentalities (Requirement: Defensive +10% def/-5% atk, Aggressive +10% atk/-5% def, Balanced +10% mid/-2.5% atk & def) */}
          <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Tactical Mentality & Live Simulation Modifiers
                </h3>
              </div>
              <span className="text-xs font-mono font-black text-amber-400">
                Active: {currentManager.tactics.mentality || 'Balanced'}
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Tactical mentalities apply hard statistical modifiers directly to the simulation engine, shifting sector weightings across defense, midfield control, and clinical finishing.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* DEFENSIVE */}
              <button
                type="button"
                onClick={() => handleMentalityChange('Defensive')}
                className={`p-4 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                  (currentManager.tactics.mentality || 'Balanced') === 'Defensive'
                    ? 'bg-blue-500/20 border-blue-400 text-slate-100 shadow-md shadow-blue-500/20 ring-2 ring-blue-400/40'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-400" />
                    <span className="font-display font-black text-sm tracking-wide text-blue-300">DEFENSIVE</span>
                  </div>
                  {(currentManager.tactics.mentality || 'Balanced') === 'Defensive' && (
                    <Check className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <div className="text-xs space-y-1 mt-3 font-mono">
                  <div className="text-emerald-400 font-bold">+10% Defensive Effectiveness</div>
                  <div className="text-rose-400 font-bold">-5% Attacking Effectiveness</div>
                </div>
                <div className="text-[11px] text-slate-400 mt-2 font-sans">
                  Deep box compaction, tight marking, forces opponent into low-probability shots.
                </div>
              </button>

              {/* BALANCED */}
              <button
                type="button"
                onClick={() => handleMentalityChange('Balanced')}
                className={`p-4 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                  (currentManager.tactics.mentality || 'Balanced') === 'Balanced'
                    ? 'bg-emerald-500/20 border-emerald-400 text-slate-100 shadow-md shadow-emerald-500/20 ring-2 ring-emerald-400/40'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span className="font-display font-black text-sm tracking-wide text-emerald-300">BALANCED</span>
                  </div>
                  {(currentManager.tactics.mentality || 'Balanced') === 'Balanced' && (
                    <Check className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
                <div className="text-xs space-y-1 mt-3 font-mono">
                  <div className="text-emerald-400 font-bold">+10% Midfield & Possession</div>
                  <div className="text-amber-400 font-bold">-2.5% Attacking & -2.5% Defending</div>
                </div>
                <div className="text-[11px] text-slate-400 mt-2 font-sans">
                  Dominates midfield duels, maximizes passing accuracy and sustained possession rhythm.
                </div>
              </button>

              {/* AGGRESSIVE */}
              <button
                type="button"
                onClick={() => handleMentalityChange('Aggressive')}
                className={`p-4 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                  (currentManager.tactics.mentality || 'Balanced') === 'Aggressive'
                    ? 'bg-red-500/20 border-red-400 text-slate-100 shadow-md shadow-red-500/20 ring-2 ring-red-400/40'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-rose-400" />
                    <span className="font-display font-black text-sm tracking-wide text-rose-300">AGGRESSIVE</span>
                  </div>
                  {(currentManager.tactics.mentality || 'Balanced') === 'Aggressive' && (
                    <Check className="w-4 h-4 text-rose-400" />
                  )}
                </div>
                <div className="text-xs space-y-1 mt-3 font-mono">
                  <div className="text-emerald-400 font-bold">+10% Attacking Effectiveness</div>
                  <div className="text-rose-400 font-bold">-5% Defensive Effectiveness</div>
                </div>
                <div className="text-[11px] text-slate-400 mt-2 font-sans">
                  Overloads final third, lethal finishing volume, vulnerable to rapid transition counters.
                </div>
              </button>
            </div>

            {/* Tactical Interactions with Attributes Guide */}
            <div className="mt-4 pt-4 border-t border-slate-800/80">
              <div className="flex items-center gap-2 mb-2">
                <Award className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Player Attribute & Tactical Synergies (Active in Match Engine)
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px]">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-amber-300">High Pace (PAC) + Counter Attack / Aggressive</div>
                  <div className="text-slate-400 mt-0.5">Rapid breakaway runs behind high lines, lethal 1-on-1 transition attacks.</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-emerald-300">High Passing (PAS) + Balanced / Possession</div>
                  <div className="text-slate-400 mt-0.5">High pass completion, patient buildup that unlocks compact low blocks.</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-rose-300">High Shooting (SHO) + Aggressive Tactics</div>
                  <div className="text-slate-400 mt-0.5">Clinical finishing inside box, maximum conversion against elite keepers.</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-blue-300">High Defending (DEF) + Defensive / Low Block</div>
                  <div className="text-slate-400 mt-0.5">Rock-solid box protection, crucial blocks, interceptions, and tackles.</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-purple-300">High Physical (PHY) + High Press</div>
                  <div className="text-slate-400 mt-0.5">Overpowers opponents in duels, forces turnovers in attacking half (higher fatigue).</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-bold text-cyan-300">High Dribbling (DRI) + 1-on-1 Duels</div>
                  <div className="text-slate-400 mt-0.5">Beats defenders in isolated duels to open clear shooting and crossing lanes.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 3: CAPTAIN & SET PIECES (Requirement 3)                          --- */}
      {/* ========================================================================= */}
      {activeTab === 'roles' && (
        <div className="max-w-2xl mx-auto w-full my-4 p-5 sm:p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Captaincy & Set Piece Specialists
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Assign leaders and dead-ball specialists from your Starting XI.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { role: 'captainId', title: 'Team Captain (C)', desc: 'Leads team composure and morale under pressure.' },
              { role: 'penaltyTakerId', title: 'Penalty Taker (PK)', desc: 'Takes high-pressure spot-kicks and shootouts.' },
              { role: 'freeKickTakerId', title: 'Free-Kick Specialist (FK)', desc: 'Curling direct shots and whipped indirect deliveries.' },
              { role: 'cornerTakerId', title: 'Corner Kick Taker (CK)', desc: 'Whipped in-swingers and out-swingers.' },
            ].map(({ role, title, desc }) => (
              <div key={role} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-200">{title}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{desc}</span>
                </div>
                <select
                  value={(currentManager.roles as any)[role] || ''}
                  onChange={(e) => handleRoleChange(role as keyof TeamRoles, e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-semibold outline-none cursor-pointer hover:border-emerald-500 transition-colors"
                >
                  <option value="">Auto Select Best Qualified Starter</option>
                  {starters.map((s) => (
                    <option key={s.player.id} value={s.player.id}>
                      {s.player.name} ({s.player.position} · OVR {s.player.overall} · SHO {s.player.attributes.sho} · PAS {s.player.attributes.pas})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Bottom Sheet Modal for Inspected Player */}
      {inspectedPlayer && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-50 p-4 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[85vh] overflow-y-auto">
          <div className="w-12 h-1 rounded-full bg-slate-700 mx-auto mb-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Starting XI Player
            </span>
            <button
              onClick={() => setInspectedPlayer(null)}
              className="p-1 rounded text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <PlayerCard player={inspectedPlayer.entry.player} size="md" />
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider font-black text-slate-400">PLAY AS</span>
              <span className="font-mono font-black text-emerald-400">{inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position}</span>
            </div>
            <select value={inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position} onChange={(e) => handlePositionChange(inspectedPlayer.entry.player.id, e.target.value as Position)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-bold text-white">
              {allowedPositionsForPlayer(
              inspectedPlayer.entry.player,
              inspectedPlayer.isStarter && inspectedPlayer.entry.startingSlotIndex !== undefined
                ? formationConfig.slots.find((s) => s.index === inspectedPlayer.entry.startingSlotIndex)?.category
                : undefined
            ).map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select>
            <div className="mt-2 text-[10px] text-slate-500">OVR {inspectedPlayer.entry.player.overall} · Primary {inspectedPlayer.entry.player.position} · Alt {inspectedPlayer.entry.player.alternatePositions.join(', ') || 'None'}</div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div className="text-[10px] uppercase tracking-wider font-black text-slate-400 mb-2">POSITION / OVR</div>
            <div className="flex items-center justify-between">
              <span className="font-mono font-black text-emerald-400">{inspectedPlayer.entry.assignedPosition || inspectedPlayer.entry.player.position}</span>
              <span className="font-mono font-black text-amber-400">{inspectedPlayer.entry.player.overall} OVR</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500">
              OVR {inspectedPlayer.entry.player.overall} · Primary {inspectedPlayer.entry.player.position} · Alt {inspectedPlayer.entry.player.alternatePositions.join(', ') || 'None'}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sticky Action Bar: Confirm Team & Proceed to Competition */}
      <div className="sticky bottom-0 z-20 mt-4 p-3 rounded-2xl bg-[#040812]/95 border border-slate-800 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {validation.isValid ? (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Starting XI Valid & Ready
            </span>
          ) : (
            <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              Adjust Lineup to Fill Missing Roles
            </span>
          )}
        </div>

        <button
          onClick={onConfirmTeam}
          disabled={!validation.isValid}
          className={`px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all cursor-pointer active:scale-95 ${
            currentManager.confirmedTeam
              ? 'bg-amber-400 text-slate-950'
              : validation.isValid
              ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-500/25'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {currentManager.confirmedTeam ? 'TEAM CONFIRMED (WAITING FOR OTHERS)' : 'CONFIRM TEAM & PROCEED'}
        </button>
      </div>

      {/* Developer Branding Credit (Requirement 7 & 23) */}
      <div className="mt-4 text-center text-[10px] text-slate-600 font-mono tracking-widest uppercase">
        FOOTBALL AUCTION LEAGUE · MADE BY IRVIX
      </div>
    </div>
  );
};
