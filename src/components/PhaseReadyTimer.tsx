import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { GameRoom } from '../types/football';

interface PhaseReadyTimerProps {
  room: GameRoom;
  label: string;
  accent?: 'amber' | 'emerald' | 'sky';
}

export const PhaseReadyTimer: React.FC<PhaseReadyTimerProps> = ({ room, label, accent = 'amber' }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!room.phaseReadyDeadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [room.phaseReadyDeadline]);

  if (!room.phaseReadyDeadline) return null;

  const seconds = Math.max(0, Math.ceil((room.phaseReadyDeadline - now) / 1000));
  const palette = {
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    sky: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  }[accent];

  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wider ${palette}`}>
      <Clock className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="font-mono text-sm tabular-nums">{String(seconds).padStart(2, '0')}s</span>
    </div>
  );
};
