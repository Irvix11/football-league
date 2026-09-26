import React, { useEffect } from 'react';
import React, { useEffect } from 'react';
import { GameRoom } from '../types/football';
import confetti from 'canvas-confetti';
import { Trophy, Award, Flame, Star, Shield, RotateCcw, Home } from 'lucide-react';

interface SeasonEndViewProps {
  room: GameRoom;
  managerId: string;
  onRematch: () => void;
  onNewLobby: () => void;
}

export const SeasonEndView: React.FC<SeasonEndViewProps> = ({
  room,
  managerId,
  onRematch,
  onNewLobby,
}) => {
  const champion = room.leagueTable[0];
  const knockoutChampionId = room.knockoutStage?.championId;
  const knockoutChampionName = room.knockoutStage?.championName;
  const isKnockout = room.settings.competitionFormat === 'Knockout';
  const isChampion = isKnockout ? knockoutChampionId === managerId : champion?.managerId === managerId;
  const awards = room.awards;

  useEffect(() => {
    // Launch celebratory confetti bursts!
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#10b981', '#fbbf24', '#06b6d4'],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#10b981', '#fbbf24', '#06b6d4'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  return (
    <div className="min-h-screen bg-[#040812] text-slate-100 p-4 sm:p-6 md:p-8 flex flex-col justify-between max-w-6xl mx-auto select-none">
      {/* Top Banner: Champion Ceremony */}
      <div className="text-center py-6 sm:py-8 relative">
        <div className="inline-flex p-4 rounded-2xl bg-amber-500/20 border-2 border-amber-400 text-amber-400 mb-3 shadow-2xl shadow-amber-500/20 animate-bounce">
          <Trophy className="w-12 h-12" />
        </div>
        <div className="text-xs uppercase tracking-widest font-black text-amber-400 mb-1">
          {isChampion ? 'CONGRATULATIONS CHAMPION!' : isKnockout ? 'OFFICIAL KNOCKOUT CHAMPION' : 'OFFICIAL SEASON CHAMPION'}
        </div>
        <h1 className="font-display font-black text-4xl sm:text-5xl md:text-6xl text-white uppercase tracking-tight">
          {knockoutChampionName || champion?.managerName || 'Champion'}
        </h1>
        <p className="text-xs text-slate-400 mt-2 font-mono">
          {isKnockout
            ? 'Knockout champion decided through the final bracket.'
            : <>Final Points: <span className="text-amber-400 font-bold">{champion?.points} PTS</span> · Won {champion?.won} of {champion?.played} Matches</>}
        </p>
      </div>

      {/* Main Grid: Awards Showcase (Left 7 cols) + Final Table (Right 5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-6 flex-1 items-start">
        {/* --- AWARDS SHOWCASE --- */}
        <div className="lg:col-span-7 space-y-3.5">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <h2 className="font-display font-black text-xs uppercase tracking-wider text-slate-200">
              Season Honours & Individual Accolades
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Golden Boot */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>GOLDEN BOOT</span>
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.goldenBoot.playerName}</div>
              <div className="text-slate-400 text-[11px]">{awards?.goldenBoot.teamName}</div>
              <div className="font-mono font-black text-amber-400 pt-1 text-sm">
                ⚽ {awards?.goldenBoot.goals} Goals
              </div>
            </div>

            {/* Top Assists */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>PLAYMAKER OF THE SEASON</span>
                <Star className="w-4 h-4 text-teal-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.topAssists.playerName}</div>
              <div className="text-slate-400 text-[11px]">{awards?.topAssists.teamName}</div>
              <div className="font-mono font-black text-teal-400 pt-1 text-sm">
                🎯 {awards?.topAssists.assists} Assists
              </div>
            </div>

            {/* Player of the Season */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>PLAYER OF THE SEASON (MVP)</span>
                <Trophy className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.playerOfTheSeason.playerName}</div>
              <div className="text-slate-400 text-[11px]">{awards?.playerOfTheSeason.teamName}</div>
              <div className="font-mono font-black text-emerald-400 pt-1 text-sm">
                ★ {awards?.playerOfTheSeason.avgRating} Avg Rating
              </div>
            </div>

            {/* Best Goalkeeper */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>GOLDEN GLOVE (BEST GK)</span>
                <Shield className="w-4 h-4 text-sky-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.bestGK.playerName}</div>
              <div className="text-slate-400 text-[11px]">{awards?.bestGK.teamName}</div>
              <div className="font-mono font-black text-sky-400 pt-1 text-sm">
                🧤 {awards?.bestGK.saves} Saves · {awards?.bestGK.cleanSheets} Clean Sheets
              </div>
            </div>

            {/* Best Defender */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>DEFENDER OF THE SEASON</span>
                <Shield className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.bestDefender.playerName}</div>
              <div className="text-slate-400 text-[11px]">{awards?.bestDefender.teamName}</div>
              <div className="font-mono font-black text-indigo-400 pt-1 text-sm">
                🛡️ {awards?.bestDefender.tackles} Key Tackles
              </div>
            </div>

            {/* Manager of the Season */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-md">
              <div className="flex items-center justify-between text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                <span>MANAGER OF THE SEASON</span>
                <Award className="w-4 h-4 text-amber-400" />
              </div>
              <div className="font-display font-black text-slate-100 text-base">{awards?.managerOfTheSeason.managerName}</div>
              <div className="text-slate-400 text-[11px]">Championship Title</div>
              <div className="font-mono font-black text-amber-400 pt-1 text-sm">
                {awards?.managerOfTheSeason.points} PTS · {awards?.managerOfTheSeason.winRate}% Win Rate
              </div>
            </div>
          </div>
        </div>

        {/* --- FINAL LEAGUE TABLE --- */}
        <div className="lg:col-span-5 space-y-3.5">
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <h3 className="font-display font-black text-xs uppercase tracking-wider text-slate-200">
              {isKnockout ? 'Competition Result' : 'Final Standings'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                    <th className="pb-2.5 pl-2">POS</th>
                    <th className="pb-2.5">TEAM</th>
                    <th className="pb-2.5 text-center">P</th>
                    <th className="pb-2.5 text-center">W</th>
                    <th className="pb-2.5 text-center">GD</th>
                    <th className="pb-2.5 pr-2 text-right">PTS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {room.leagueTable.map((row, idx) => (
                    <tr
                      key={row.managerId}
                      className={idx === 0 ? 'bg-amber-500/10 text-amber-300 font-bold' : 'text-slate-300'}
                    >
                      <td className="py-2.5 pl-2 font-black">{idx + 1}</td>
                      <td className="py-2.5 font-sans font-bold truncate max-w-[130px]">
                        {row.managerName}
                      </td>
                      <td className="py-2.5 text-center text-slate-400">{row.played}</td>
                      <td className="py-2.5 text-center text-slate-300">{row.won}</td>
                      <td className="py-2.5 text-center">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>
                      <td className="py-2.5 pr-2 text-right font-black text-white text-xs">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer: Rematch / Return */}
      <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-center gap-4">
        <button
          onClick={onRematch}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 text-slate-950 transition-all shadow-lg shadow-emerald-500/25 cursor-pointer active:scale-95"
        >
          <RotateCcw className="w-4 h-4" />
          <span>PLAY REMATCH SEASON</span>
        </button>

        <button
          onClick={onNewLobby}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 transition-all cursor-pointer active:scale-95"
        >
          <Home className="w-4 h-4" />
          <span>RETURN TO MAIN MENU</span>
        </button>
      </div>
    </div>
  );
};
