import React from 'react';
import { GameRoom, Formation } from '../types/football';
import { FORMATIONS_CONFIG, getFormationStarterCategoryCounts, getFormationSquadCategoryLimits } from '../constants/formations';
import { PitchGraphic } from './PitchGraphic';
import { PlayerPitchMarker } from './PlayerPitchMarker';
import { FastForward, Play, Bot, User } from 'lucide-react';

interface FormationSelectViewProps {
  room: GameRoom;
  managerId: string;
  onSelectFormation: (formation: Formation) => void;
  onBeginAuction: () => void;
  onSkipAuctionSolo: () => void;
}

export const FormationSelectView: React.FC<FormationSelectViewProps> = ({
  room,
  managerId,
  onSelectFormation,
  onBeginAuction,
  onSkipAuctionSolo,
}) => {
  const currentManager = room.managers.find((m) => m.id === managerId);
  const isHost = currentManager?.isHost ?? false;
  const isSolo = room.managers.length === 2 && room.managers.some((m) => m.isBot);

  const selectedFormation = currentManager?.formation || '4-3-3';
  const formationConfig = FORMATIONS_CONFIG[selectedFormation] || FORMATIONS_CONFIG['4-3-3'];
  const starterCounts = getFormationStarterCategoryCounts(selectedFormation);
  const squadLimits = getFormationSquadCategoryLimits(selectedFormation);
  const botManager = room.managers.find((m) => m.isBot);

  return (
    <div className="min-h-screen bg-[#040812] text-slate-100 p-4 sm:p-6 md:p-8 flex flex-col justify-between max-w-6xl mx-auto select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-900 gap-4">
        <div>
          <span className="text-[11px] uppercase tracking-widest font-black text-emerald-400">TACTICAL SETUP</span>
          <h1 className="font-display font-black text-2xl sm:text-3xl text-slate-100 mt-1">
            SELECT FORMATION
          </h1>
        </div>

        {/* Solo Matchup Banner */}
        {isSolo && botManager && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-900 border border-emerald-500/30 shadow-md">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
              <User className="w-4 h-4 text-emerald-400" />
              <span>{currentManager?.name}</span>
            </div>
            <span className="text-xs font-extrabold text-amber-400">VS</span>
            <div className="flex items-center gap-2 text-xs font-bold text-teal-400">
              <Bot className="w-4 h-4" />
              <span>{botManager.name} ({botManager.formation})</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Pitch & Formation Picker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 my-6 flex-1 items-start">
        {/* Left column: Formation selection buttons & position quotas (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Available Formations
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(Object.keys(FORMATIONS_CONFIG) as Formation[]).map((fKey) => {
                const cfg = FORMATIONS_CONFIG[fKey];
                const isSelected = selectedFormation === fKey;
                return (
                  <button
                    key={fKey}
                    type="button"
                    onClick={() => onSelectFormation(fKey)}
                    className={`p-3.5 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-400 text-slate-100 shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-display font-black text-lg text-slate-100">{fKey}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{cfg.name}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Formation Requirements Breakdown */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 shadow-lg">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Auction Roster Rules: {selectedFormation}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              {(['GK', 'DEF', 'MID', 'ATT'] as const).map((cat) => (
                <div key={cat} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
                  <div className="text-slate-400 font-semibold text-[10px]">{cat}</div>
                  <div className="font-mono font-black text-emerald-400 text-sm mt-0.5">
                    {starterCounts[cat]} STARTERS
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5">
                    Squad cap {squadLimits[cat]}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your formation locks the exact starting XI positions. The auction also reserves 7 bench slots, so you can bid for substitutes without breaking the formation. After the auction, the game auto-fills the best XI using OVR, attributes and position fit — and you can edit it.
            </p>
          </div>
        </div>

        {/* Right column: Interactive Visual Football Pitch with 11 slot markers (7 cols) */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full max-w-md">
            <PitchGraphic aspectRatio="vertical" className="p-4 shadow-2xl">
              {formationConfig.slots.map((slot) => (
                <div
                  key={slot.index}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                  style={{
                    left: `${slot.x}%`,
                    top: `${slot.y}%`,
                  }}
                >
                  <PlayerPitchMarker
                    positionLabel={slot.position}
                    slotIndex={slot.index}
                    size="md"
                  />
                </div>
              ))}
            </PitchGraphic>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-xs text-slate-400">
          Selected Formation: <strong className="text-emerald-400">{selectedFormation}</strong>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Solo Play ONLY: [ SKIP AUCTION ] */}
          {isSolo && (
            <button
              onClick={onSkipAuctionSolo}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-slate-900 border border-amber-500/50 hover:border-amber-400 text-amber-300 hover:bg-slate-800 transition-all shadow-lg shadow-amber-500/10 cursor-pointer active:scale-95"
            >
              <FastForward className="w-4 h-4 text-amber-400" />
              <span>SKIP AUCTION (INSTANT SQUAD)</span>
            </button>
          )}

          {/* Host or Solo: Proceed to Auction */}
          {(isHost || isSolo) && (
            <button
              onClick={onBeginAuction}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-95"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START LIVE AUCTION</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
