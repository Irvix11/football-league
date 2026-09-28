import React from 'react';
import {
  if (player?.position === 'OFF') return null;
import { Player, Position } from '../types/football';

interface PlayerPitchMarkerProps {
  player?: Player | null;
  positionLabel: Position;
  slotIndex?: number;
  isSelected?: boolean;
  isHighlighted?: boolean;
  isSubTarget?: boolean;
  fitPercentage?: number;
  effectiveOverall?: number;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

// Traditional 1-11 football jersey numbering by position & slot index
export function getTraditionalJerseyNumber(position: Position, slotIndex: number = 0): number {
  switch (position) {
    case 'GK':
      return 1;
    case 'RB':
    case 'RWB':
      return 2;
    case 'LB':
    case 'LWB':
      return 3;
    case 'CB':
      return slotIndex === 2 ? 4 : 5;
    case 'CDM':
      return 6;
    case 'RW':
    case 'RM':
      return 7;
    case 'CM':
      return slotIndex === 5 ? 8 : 10;
    case 'ST':
    case 'CF':
      return 9;
    case 'CAM':
      return 10;
    case 'LW':
    case 'LM':
      return 11;
    default:
      return slotIndex + 1;
  }
}

export const PlayerPitchMarker: React.FC<PlayerPitchMarkerProps> = ({
  player,
  positionLabel,
  slotIndex = 0,
  isSelected = false,
  isHighlighted = false,
  isSubTarget = false,
  fitPercentage,
  effectiveOverall,
  size = 'md',
  onClick,
  className = '',
}) => {
  const isGK = positionLabel === 'GK' || player?.category === 'GK';
  const jerseyNumber = getTraditionalJerseyNumber(positionLabel, slotIndex);

  // Size variations
  const sizeClasses = {
    sm: {
      marker: 'w-7 h-7 sm:w-8 sm:h-8',
      num: 'text-[11px] sm:text-xs',
      ovrBadge: 'text-[8px] px-1 py-0',
      posBadge: 'text-[7px] px-1',
    },
    md: {
      marker: 'w-8 h-8 sm:w-10 sm:h-10',
      num: 'text-xs sm:text-sm',
      ovrBadge: 'text-[9px] px-1.5 py-0.2',
      posBadge: 'text-[8px] px-1',
    },
    lg: {
      marker: 'w-10 h-10 sm:w-12 sm:h-12',
      num: 'text-sm sm:text-base',
      ovrBadge: 'text-[10px] px-1.5 py-0.5',
      posBadge: 'text-[9px] px-1.5',
    },
  }[size];

  // If empty slot
  if (!player) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`group relative flex flex-col items-center justify-center cursor-pointer transition-all duration-200 active:scale-95 ${className}`}
      >
        <div
          className={`${sizeClasses.marker} rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-200 shadow-md ${
            isSelected
              ? 'border-amber-400 bg-amber-500/25 ring-4 ring-amber-400/30'
              : 'border-slate-500/80 bg-slate-950/60 text-slate-400 group-hover:border-emerald-400 group-hover:text-emerald-300 group-hover:bg-slate-900/80'
          }`}
        >
          <span className={`font-mono font-bold ${sizeClasses.num}`}>
            {positionLabel}
          </span>
        </div>
      </button>
    );
  }

  // Kit themes based on GK vs Outfield and overall rating
  const isElite = player.overall >= 88;
  const isLegend = player.id.startsWith('fc-icon');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-center justify-center cursor-pointer transition-all duration-200 active:scale-95 ${className}`}
    >
      {/* Selection Glow Halo */}
      {(isSelected || isHighlighted || isSubTarget) && (
        <div
          className={`absolute -inset-1.5 rounded-full animate-pulse blur-[3px] ${
            isSelected
              ? 'bg-amber-400/60 ring-2 ring-amber-400'
              : isSubTarget
              ? 'bg-emerald-400/60 ring-2 ring-emerald-400'
              : 'bg-teal-400/40'
          }`}
        />
      )}

      {/* Main Jersey Badge Token */}
      <div
        className={`relative ${sizeClasses.marker} rounded-full flex items-center justify-center font-display font-black shadow-lg transition-all duration-200 ${
          isSelected
            ? 'border-2 border-amber-400 ring-2 ring-amber-400/40 scale-105'
            : isGK
            ? 'border-2 border-amber-500/80 bg-gradient-to-br from-amber-600 to-amber-900 text-amber-100 shadow-amber-950/60'
            : isLegend
            ? 'border-2 border-amber-300 bg-gradient-to-br from-amber-400 via-yellow-600 to-amber-950 text-slate-950 shadow-amber-900/60'
            : isElite
            ? 'border-2 border-emerald-300 bg-gradient-to-br from-emerald-500 to-teal-900 text-white shadow-emerald-950/60'
            : 'border-2 border-emerald-400/80 bg-gradient-to-br from-emerald-600 to-slate-900 text-white shadow-black/80'
        }`}
      >
        {/* Subtle Kit Collar Notch */}
        <div className="absolute top-0.5 w-2 h-1 rounded-b-full bg-white/30" />

        {/* Big Crisp Jersey Number */}
        <span className={`leading-none tracking-tight font-black select-none ${sizeClasses.num}`}>
          {jerseyNumber}
        </span>

        {/* Small OVR Pill on bottom-right */}
        <span
          className={`absolute -bottom-1 -right-1 rounded-md font-mono font-bold leading-tight shadow-md border ${
            player.overall >= 88
              ? 'bg-amber-400 text-slate-950 border-amber-300'
              : player.overall >= 82
              ? 'bg-emerald-500 text-slate-950 border-emerald-400'
              : 'bg-slate-900 text-slate-200 border-slate-700'
          } ${sizeClasses.ovrBadge}`}
        >
          {effectiveOverall ?? player.overall}
        </span>

        {/* Position Badge on top-left (e.g. ST, CB) */}
        <span
          className={`absolute -top-1 -left-1 rounded font-mono font-bold leading-none bg-slate-950/90 text-slate-300 border border-slate-700/80 ${sizeClasses.posBadge}`}
        >
          {positionLabel}
        </span>
      </div>

      <div className="mt-1 max-w-[92px] text-center">
        <div className="truncate text-[9px] sm:text-[10px] font-black text-white drop-shadow-md">
          {player.name}
        </div>
        <div className="text-[8px] text-slate-400 font-mono">
          {player.club}
        </div>
      </div>

      {/* Player name + position/OVR are always visible on the squad pitch. */}
      <div className="mt-1 max-w-[88px] rounded-md bg-slate-950/90 border border-slate-800/90 px-1.5 py-0.5 text-center shadow-md">
        <div className="text-[8px] sm:text-[9px] font-black text-slate-100 truncate leading-tight">
          {player.name}
        </div>
        <div className="flex items-center justify-center gap-1 text-[7px] sm:text-[8px] font-mono font-bold">
          <span className="text-slate-500">{positionLabel}</span>
          <span className="text-emerald-400">{player.overall} OVR</span>
        </div>
      </div>

      {/* Natural / alternate / out-of-position indicator */}
      {typeof fitPercentage === 'number' && (
        <span className={`absolute -bottom-3 text-[8px] font-mono font-black bg-slate-950/95 px-1.5 rounded border ${
          fitPercentage >= 90
            ? 'text-emerald-400 border-emerald-500/30'
            : fitPercentage >= 70
            ? 'text-amber-400 border-amber-500/30'
            : 'text-rose-400 border-rose-500/30'
        }`}>
          {fitPercentage >= 90 ? 'NATURAL' : fitPercentage >= 70 ? 'ALT' : 'OOP'} · {fitPercentage}%
        </span>
      )}
    </button>
  );
};
