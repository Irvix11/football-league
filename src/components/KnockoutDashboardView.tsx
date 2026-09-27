import React, { useEffect, useMemo, useState } from 'react';
import { GameRoom, Fixture } from '../types/football';
import { LiveMatchEngine } from './LiveMatchEngine';
import { Trophy, Play, CheckCircle2, Clock3 } from 'lucide-react';

interface KnockoutDashboardViewProps {
  room: GameRoom;
  managerId: string;
  onRunMatch: (fixtureId: string) => void;
  onMatchComplete?: (fixtureId: string) => void;
  isSimulating?: boolean;
  simulationError?: string | null;
}

export const KnockoutDashboardView: React.FC<KnockoutDashboardViewProps> = ({
  room,
  managerId,
  onRunMatch,
  onMatchComplete,
  isSimulating = false,
  simulationError = null,
}) => {
  const stage = room.knockoutStage;
  const round = stage?.rounds[stage.rounds.length - 1];
  const fixtures = round?.fixtures || [];
  const userFixture = fixtures.find(f => f.homeManagerId === managerId || f.awayManagerId === managerId);
  const [selectedFixtureId, setSelectedFixtureId] = useState(userFixture?.id || fixtures[0]?.id || '');

  useEffect(() => {
    if (fixtures.length && !fixtures.some(f => f.id === selectedFixtureId)) {
      setSelectedFixtureId(fixtures[0].id);
    }
  }, [fixtures, selectedFixtureId]);

  const selectedFixture = useMemo(
    () => fixtures.find(f => f.id === selectedFixtureId) || userFixture || fixtures[0],
    [fixtures, selectedFixtureId, userFixture]
  );

  const allPlayed = fixtures.length > 0 && fixtures.every(f => f.played);
  const nextRoundLabel = round?.roundName === 'Round of 16'
    ? 'Quarter-Final'
    : round?.roundName === 'Quarter-Final'
      ? 'Semi-Final'
      : round?.roundName === 'Semi-Final'
        ? 'Third-Place Match'
        : round?.roundName === 'Third-Place'
          ? 'Final'
          : null;

  const renderFixture = (fixture: Fixture) => {
    const isUserMatch = fixture.homeManagerId === managerId || fixture.awayManagerId === managerId;
    const isSelected = fixture.id === selectedFixtureId;
    return (
      <button
        key={fixture.id}
        type="button"
        onClick={() => setSelectedFixtureId(fixture.id)}
        className={`w-full text-left p-3 rounded-xl border transition-all ${isSelected ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'} ${isUserMatch ? 'ring-1 ring-emerald-500/20' : ''}`}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">
          <span>{fixture.played ? 'COMPLETED' : 'UP NEXT'}</span>
          {fixture.wentToPenalties && <span className="text-amber-400">PENALTIES</span>}
        </div>
        <div className="flex items-center justify-between gap-3 text-sm font-display font-black">
          <span className={fixture.winnerManagerId === fixture.homeManagerId ? 'text-emerald-300' : 'text-slate-200'}>{fixture.homeManagerName}</span>
          <span className="font-mono text-base text-white">
            {fixture.played ? `${fixture.homeScore ?? 0} - ${fixture.awayScore ?? 0}` : 'VS'}
          </span>
          <span className={fixture.winnerManagerId === fixture.awayManagerId ? 'text-emerald-300' : 'text-slate-200'}>{fixture.awayManagerName}</span>
        </div>
        {fixture.wentToPenalties && (
          <div className="mt-2 text-[10px] text-amber-300 font-mono text-center">
            PK {fixture.homePenaltyScore} - {fixture.awayPenaltyScore}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#040812] text-slate-100 p-3 sm:p-5 md:p-6 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-900">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-black text-amber-400">
            <Trophy className="w-3.5 h-3.5" /> KNOCKOUT CUP
          </div>
          <h1 className="font-display font-black text-2xl sm:text-3xl uppercase mt-1">
            {round?.roundName === 'Third-Place' ? 'THIRD-PLACE MATCH' : (round?.roundName || 'Knockout')}
          </h1>
          <p className="text-xs text-slate-500 mt-1">League playoffs · Extra time · Penalty shootouts</p>
        </div>
        <div className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
          {fixtures.filter(f => f.played).length}/{fixtures.length} matches complete
        </div>
      </header>

      {simulationError && (
        <div className="my-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-xs font-semibold">
          {simulationError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-5">
        <aside className="lg:col-span-4 space-y-3">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-amber-400" />
              <h2 className="font-display font-black text-xs uppercase tracking-wider">Bracket</h2>
            </div>
            <div className="space-y-2">
              {fixtures.map(renderFixture)}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 space-y-4">
          {selectedFixture?.played ? (
            <LiveMatchEngine
              fixture={selectedFixture}
              userTeamId={managerId}
              onMatchComplete={onMatchComplete}
            />
          ) : selectedFixture ? (
            <div className="p-8 sm:p-12 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl text-center">
              <Clock3 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <div className="text-xs uppercase tracking-widest text-slate-500 font-bold">{round?.roundName}</div>
              <h2 className="font-display font-black text-xl sm:text-2xl mt-2">
                {selectedFixture.homeManagerName} <span className="text-slate-500">VS</span> {selectedFixture.awayManagerName}
              </h2>
              <p className="text-xs text-slate-400 mt-3 max-w-md mx-auto">
                Run this match to generate its authoritative event timeline. The 2D broadcast will then play the exact simulated events.
              </p>
              <button
                type="button"
                onClick={() => onRunMatch(selectedFixture.id)}
                disabled={isSimulating}
                className="mt-6 px-7 py-3 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20"
              >
                {isSimulating ? 'SIMULATING...' : 'START MATCH'}
                {!isSimulating && <Play className="inline w-4 h-4 ml-2 fill-current" />}
              </button>
            </div>
          ) : null}

          {allPlayed && nextRoundLabel && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-xs">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="font-display font-black uppercase">{nextRoundLabel} ready</div>
                <div className="text-slate-400 mt-0.5">All {round?.roundName} fixtures are complete. The server has advanced the bracket to the next round.</div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="mt-6 text-center text-[10px] text-slate-600 font-mono tracking-widest uppercase">
        FOOTBALL AUCTION LEAGUE · MADE BY IRVIX
      </footer>
    </div>
  );
};
