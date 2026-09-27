import React from 'react';
import { Player } from '../types/football';

interface PlayerCardProps {
  player: Player;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
  className?: string;
  onClick?: () => void;
}

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  size = 'md',
  highlight = false,
  className = '',
  onClick,
}) => {
  const isGK = player.category === 'GK';
  const isHighOvr = player.overall >= 88;
  const isIcon = player.id.startsWith('fc-icon');

  if (size === 'sm') {
    return (
      <div
        onClick={onClick}
        className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
          highlight
            ? 'bg-emerald-950/40 border-emerald-400 ring-2 ring-emerald-400/30 shadow-lg shadow-emerald-500/10'
            : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
        } ${className}`}
      >
        <div
          className={`flex items-center justify-center w-9 h-9 rounded-xl font-display font-black text-sm shadow-sm ${
            isIcon
              ? 'bg-amber-400 text-slate-950'
              : isHighOvr
              ? 'bg-emerald-400 text-slate-950'
              : 'bg-slate-800 text-slate-200 border border-slate-700'
          }`}
        >
          {player.overall}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-100 truncate">{player.name}</div>
          <div className="text-[10px] text-slate-400 truncate">
            {player.position} · {player.club}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono font-bold text-emerald-400">£{player.marketValue}M</div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border transition-all shadow-2xl ${
        isIcon
          ? 'border-amber-400/60 bg-gradient-to-b from-amber-950/30 via-slate-900 to-slate-950 shadow-amber-500/10'
          : isHighOvr
          ? 'border-emerald-500/40 bg-gradient-to-b from-emerald-950/20 via-slate-900 to-slate-950 shadow-emerald-500/10'
          : 'border-slate-800 bg-slate-900/95 hover:border-slate-700'
      } ${className}`}
    >
      {/* Top Banner: OVR, Position, Nation */}
      <div className="p-4 border-b border-slate-800/80 flex items-start justify-between">
        <div className="flex items-baseline gap-2">
          <div className="font-display font-black text-4xl md:text-5xl tracking-tight text-amber-400">
            {player.overall}
          </div>
          <div className="text-sm font-black uppercase tracking-wider text-slate-300">
            {player.position}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400">
            {player.nationality}
          </div>
          <div className="text-xs text-slate-200 font-semibold truncate max-w-[140px]">
            {player.club}
          </div>
        </div>
      </div>

      {/* Player Identity */}
      <div className="px-4 py-3 bg-slate-950/50">
        <div className="text-lg font-black font-display text-white tracking-wide truncate">
          {player.name}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
          <span>{player.league}</span>
          <span aria-hidden="true">·</span>
          <span>Age {player.age}</span>
          <span aria-hidden="true">·</span>
          <span>{player.preferredFoot} Foot</span>
        </div>
      </div>

      {/* Hexagon / 6 Attributes Grid */}
      <div className="p-4 grid grid-cols-3 gap-2 bg-slate-900/60 text-center">
        {isGK ? (
          <>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">DIV</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.pac}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">HAN</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.sho}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">KIC</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.pas}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">REF</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.dri}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">SPE</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.def}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">POS</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.phy}</div>
            </div>
          </>
        ) : (
          <>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">PAC</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.pac}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">SHO</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.sho}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">PAS</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.pas}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">DRI</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.dri}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">DEF</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.def}</div>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-bold">PHY</div>
              <div className="text-base font-black font-mono text-emerald-400">{player.attributes.phy}</div>
            </div>
          </>
        )}
      </div>

      {/* Valuation Footer */}
      <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <div>
          <span className="text-slate-400">Market Value: </span>
          <span className="font-mono font-bold text-white">£{player.marketValue}M</span>
        </div>
        <div>
          <span className="text-slate-400">Starting Price: </span>
          <span className="font-mono font-bold text-amber-400">£{player.startingPrice}M</span>
        </div>
      </div>
    </div>
  );
};
