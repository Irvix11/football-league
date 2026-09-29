import React, { useEffect, useState } from 'react';
import { GameRoom } from '../types/football';
import { LiveMatchEngine } from './LiveMatchEngine';
import { TeamManagementView } from './TeamManagementView';
import { sound } from '../utils/audio';
import { 
  Play, FastForward, Trophy, BarChart2, ArrowRightLeft, AlertCircle, Calendar 
} from 'lucide-react';

interface LeagueDashboardViewProps {
  room: GameRoom;
  managerId: string;
  reconnectToken?: string;
  onRunMatchday: (matchday: number) => Promise<void> | void;
  onMatchComplete?: (fixtureId: string) => Promise<void> | void;
  onProceedNextMatchday?: (nextMatchday: number) => Promise<void> | void;
  onFinishSeason?: () => Promise<void> | void;
  onProposeTransfer: (offer: any) => void;
  onRespondTransfer: (offerId: string, accept: boolean) => void;
  onUpdateLineup?: (squad: any[], formation?: any, tactics?: any, roles?: any) => void;
  onFinishManagement?: () => void;
  isSimulating?: boolean;
  simulationError?: string | null;
}

export const LeagueDashboardView: React.FC<LeagueDashboardViewProps> = ({
  room,
  managerId,
  reconnectToken,
  onRunMatchday,
  onMatchComplete,
  onProceedNextMatchday,
  onFinishSeason,
  onProposeTransfer,
  onRespondTransfer,
  onUpdateLineup,
  onFinishManagement,
  isSimulating = false,
  simulationError = null,
}) => {
  const currentManager = room.managers.find((m) => m.id === managerId);
  const currentMatchday = room.currentMatchday;

  // Selected fixture to watch in 2D live pitch
  const matchdayFixtures = room.fixtures.filter((f) => f.matchday === currentMatchday);

  // Default to user's match if available, else first fixture of matchday
  const userFixture = matchdayFixtures.find(
    (f) => f.homeManagerId === managerId || f.awayManagerId === managerId
  );

  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(
    matchdayFixtures.find((f) => !f.played && (f.homeManagerId === managerId || f.awayManagerId === managerId))?.id ||
    matchdayFixtures.find((f) => !f.played)?.id ||
    userFixture?.id ||
    matchdayFixtures[0]?.id ||
    ''
  );

  // Mobile Tabs: 'match' | 'table'
  const [mobileTab, setMobileTab] = useState<'match' | 'table'>('match');

  // Active fixture currently shown in the match engine
  const activeFixture = 
    (room.liveFixtureId ? room.fixtures.find((f) => f.id === room.liveFixtureId) : null) ||
    room.fixtures.find((f) => f.id === selectedFixtureId) ||
    userFixture ||
    matchdayFixtures[0];

  // Transfer modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [targetManagerId, setTargetManagerId] = useState('');
  const [offeredPlayerId, setOfferedPlayerId] = useState('');
  const [requestedPlayerId, setRequestedPlayerId] = useState('');
  const [offeredCash, setOfferedCash] = useState(0);

  // Match stats modal
  const [showStatsModal, setShowStatsModal] = useState(false);
  const midSeasonOpen = room.transferWindowOpen === true;
  const readyIds = room.transferWindowReadyIds || [];
  const alreadyFinishedManagement = readyIds.includes(managerId);

  // Synchronize selected fixture when matchday changes
  useEffect(() => {
    if (matchdayFixtures.length > 0) {
      const uFix = matchdayFixtures.find(
        (f) => f.homeManagerId === managerId || f.awayManagerId === managerId
      );
      const next = matchdayFixtures.find((f) => !f.played && (f.homeManagerId === managerId || f.awayManagerId === managerId))
        || matchdayFixtures.find((f) => !f.played)
        || uFix
        || matchdayFixtures[0];
      if (room.liveFixtureId) setSelectedFixtureId(room.liveFixtureId);
      else if (next) setSelectedFixtureId(next.id);
    }
  }, [currentMatchday, matchdayFixtures.map((f) => `${f.id}:${f.played}`).join(','), managerId, room.liveFixtureId]);

  // Check if current matchday is completely played
  const isCurrentMatchdayPlayed = matchdayFixtures.length > 0 && matchdayFixtures.every((f) => f.played);

  // Start the current matchday one fixture at a time. The live engine's
  // FULL TIME -> CONTINUE action calls onMatchComplete, which starts the
  // next fixture so every match can be watched instead of only the final one.
  const handleSimulateClick = async () => {
    if (isSimulating) return;
    try {
      const nextFixture = matchdayFixtures.find((f) => !f.played);
      if (nextFixture) setSelectedFixtureId(nextFixture.id);
      await onRunMatchday(currentMatchday);
    } catch (err) {
      console.error('Failed to simulate matchday:', err);
    }
  };

  const handleMatchComplete = async (fixtureId: string) => {
    if (onMatchComplete) {
      await onMatchComplete(fixtureId);
    }
  };

  // Handler for advancing to next matchday
  const handleNextMatchdayClick = async () => {
    if (currentMatchday < room.totalMatchdays) {
      sound.playWhistle();
      if (onProceedNextMatchday) {
        await onProceedNextMatchday(currentMatchday + 1);
      } else {
        await onRunMatchday(currentMatchday + 1);
      }
    }
  };

  // Handler for finishing season
  const handleFinishManagementClick = () => {
    if (alreadyFinishedManagement) return;
    onFinishManagement?.();
  };

  const handleFinishSeasonClick = async () => {
    sound.playGoal();
    if (onFinishSeason) {
      await onFinishSeason();
    }
  };

  // Transfer Submit
  const handleSendTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentManager || !targetManagerId || !offeredPlayerId || !requestedPlayerId) return;

    const targetMgr = room.managers.find((m) => m.id === targetManagerId);
    const offeredP = currentManager.squad.find((s) => s.player.id === offeredPlayerId)?.player;
    const requestedP = targetMgr?.squad.find((s) => s.player.id === requestedPlayerId)?.player;

    if (offeredP && requestedP && targetMgr) {
      if (offeredCash < 0 || offeredCash > currentManager.budget) return;
      onProposeTransfer({
        fromManagerId: currentManager.id,
        fromManagerName: currentManager.name,
        toManagerId: targetMgr.id,
        toManagerName: targetMgr.name,
        offeredPlayerId: offeredP.id,
        offeredPlayerName: offeredP.name,
        requestedPlayerId: requestedP.id,
        requestedPlayerName: requestedP.name,
        offeredCash,
        matchday: currentMatchday,
      });
      setShowTransferModal(false);
      setTargetManagerId('');
      setOfferedPlayerId('');
      setRequestedPlayerId('');
      setOfferedCash(0);
    }
  };

  const homeManager = room.managers.find((m) => m.id === activeFixture?.homeManagerId);
  const awayManager = room.managers.find((m) => m.id === activeFixture?.awayManagerId);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#0e1d1b_0%,#040812_45%,#02050b_100%)] text-slate-100 p-3 sm:p-5 md:p-6 pb-24 lg:pb-8 flex flex-col justify-between max-w-7xl mx-auto select-none">
      {midSeasonOpen && onUpdateLineup && (
        <div className="fixed inset-0 z-40 bg-slate-950/90 backdrop-blur-md overflow-y-auto p-2 sm:p-5">
          <div className="max-w-5xl mx-auto">
            <div className="mb-3 rounded-2xl border border-amber-400/20 bg-slate-900/95 shadow-2xl shadow-black/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] font-black text-amber-300">MID-SEASON BREAK</div>
                <div className="text-lg sm:text-xl font-black text-white">Review your squad before the second half</div>
                <div className="text-[11px] text-slate-400 mt-1">Change formation, reposition players, tune tactics, and negotiate player-for-player swaps with optional cash.</div>
              </div>
              <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-right">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">MANAGERS READY</div>
                <div className="font-mono font-black text-amber-300">{readyIds.length}/{room.managers.length}</div>
              </div>
            </div>
            <TeamManagementView
              room={room}
              managerId={managerId}
              onUpdateLineup={onUpdateLineup}
              managementOnly
              onFinishManagement={handleFinishManagementClick}
              onOpenTransfers={() => setShowTransferModal(true)}
              windowReadyCount={readyIds.length}
              windowManagerCount={room.managers.length}
            />
          </div>
        </div>
      )}

      {/* Top Header: MATCHDAY X as visual anchor */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-900 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-black text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              LEAGUE COMPETITION
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Round {currentMatchday} of {room.totalMatchdays}
            </span>
          </div>
          <h1 className="font-display font-black text-2xl sm:text-3xl text-slate-100 tracking-tight uppercase">
            MATCHDAY {currentMatchday}
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          {room.settings.transfersEnabled && (
            <button
              onClick={() => setShowTransferModal(true)}
              disabled={!midSeasonOpen}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-slate-200 transition-colors cursor-pointer active:scale-95"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
              <span>{midSeasonOpen ? 'MID-SEASON TRANSFERS' : 'TRANSFERS LOCKED'}</span>
            </button>
          )}

          {activeFixture?.played && (
            <button
              onClick={() => setShowStatsModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-teal-500/50 text-xs font-bold text-slate-200 transition-colors cursor-pointer active:scale-95"
            >
              <BarChart2 className="w-3.5 h-3.5 text-teal-400" />
              <span>MATCH STATS</span>
            </button>
          )}

          {/* SIMULATE / NEXT MATCHDAY / FINISH SEASON BUTTON */}
          {midSeasonOpen ? (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-300 text-xs font-black uppercase tracking-wider">
              MID-SEASON BREAK
            </div>
          ) : !isCurrentMatchdayPlayed ? (
            <button
              onClick={handleSimulateClick}
              disabled={isSimulating}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 shadow-lg shadow-emerald-500/25 transition-all cursor-pointer active:scale-95"
            >
              {isSimulating ? (
                <>
                  <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>STARTING LIVE MATCH...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>SIMULATE MATCHDAY {currentMatchday}</span>
                </>
              )}
            </button>
          ) : currentMatchday < room.totalMatchdays ? (
            <button
              onClick={handleNextMatchdayClick}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-sky-400 hover:bg-sky-300 text-slate-950 shadow-lg shadow-sky-500/25 transition-all cursor-pointer active:scale-95"
            >
              <FastForward className="w-4 h-4 fill-current" />
              <span>PROCEED TO MATCHDAY {currentMatchday + 1}</span>
            </button>
          ) : (
            <button
              onClick={handleFinishSeasonClick}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
            >
              <Trophy className="w-4 h-4 fill-current" />
              <span>VIEW SEASON END & AWARDS</span>
            </button>
          )}
        </div>
      </div>

      {/* Visible Simulation Error Banner */}
      {simulationError && (
        <div className="my-3 p-3.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{simulationError}</span>
          </div>
          <button
            onClick={handleSimulateClick}
            className="px-3 py-1 rounded bg-rose-500 hover:bg-rose-400 text-slate-950 font-display font-bold text-xs uppercase cursor-pointer"
          >
            RETRY
          </button>
        </div>
      )}

      {/* Mobile Segmented Navigation Tabs */}
      <div className="flex lg:hidden items-center justify-center p-1 bg-slate-900 rounded-xl my-3 border border-slate-800">
        <button
          onClick={() => setMobileTab('match')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
            mobileTab === 'match' ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400'
          }`}
        >
          Match View
        </button>
        <button
          onClick={() => setMobileTab('table')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
            mobileTab === 'table' ? 'bg-emerald-400 text-slate-950 shadow-sm' : 'text-slate-400'
          }`}
        >
          League Table
        </button>
      </div>

      {/* Main Grid: NEXT MATCH / Live Pitch (7 cols) + LEAGUE TABLE (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-2 flex-1 items-start">
        {/* --- LEFT: NEXT MATCH / LIVE MATCH ENGINE (7 cols) --- */}
        <div className={`lg:col-span-7 space-y-4 ${mobileTab !== 'match' ? 'hidden lg:block' : ''}`}>
          {/* Matchday Fixture selector tabs */}
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              NEXT MATCH
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              {matchdayFixtures.map((fix) => {
                const isSelected = activeFixture?.id === fix.id;
                const isUser = fix.homeManagerId === managerId || fix.awayManagerId === managerId;
                return (
                  <button
                    key={fix.id}
                    onClick={() => setSelectedFixtureId(fix.id)}
                    className={`px-3 py-1 rounded-lg border whitespace-nowrap font-medium transition-colors cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                      isSelected
                        ? 'bg-slate-900 border-emerald-400 text-emerald-400 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isUser && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    <span>{fix.homeManagerName} vs {fix.awayManagerName}</span>
                    {fix.played && (
                      <span className="font-mono font-bold text-slate-200">
                        ({fix.homeScore}-{fix.awayScore})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {activeFixture ? (
            (activeFixture.played || room.liveFixtureId === activeFixture.id) ? (
              /* LIVE 2D MATCH ENGINE: Renders broadcast pitch with compact scoreboard, possession, 22 players */
              <LiveMatchEngine
                  reconnectToken={reconnectToken}
                fixture={activeFixture}
                userTeamId={managerId}
                onMatchComplete={room.hostId === managerId ? handleMatchComplete : undefined}
              />
            ) : (
              /* PRE-MATCH ARENA PREVIEW */
              <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl flex flex-col items-center justify-center text-center space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 font-mono text-xs uppercase tracking-widest font-bold">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Matchday {currentMatchday} Fixture Preview</span>
                </div>

                {/* Team Matchup */}
                <div className="flex items-center justify-center gap-6 sm:gap-12 w-full max-w-lg">
                  {/* Home Team */}
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center font-display font-black text-2xl text-emerald-400 shadow-xl mb-2">
                      {activeFixture.homeManagerName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="font-display font-black text-base sm:text-lg text-slate-100">
                      {activeFixture.homeManagerName}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      OVR: {homeManager?.teamOverall ?? 0} · {homeManager?.formation || '4-3-3'}
                    </div>
                  </div>

                  {/* VS Divider */}
                  <div className="font-display font-black text-2xl text-slate-700">
                    VS
                  </div>

                  {/* Away Team */}
                  <div className="flex-1 flex flex-col items-center">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-sky-500/20 border-2 border-sky-500/50 flex items-center justify-center font-display font-black text-2xl text-sky-400 shadow-xl mb-2">
                      {activeFixture.awayManagerName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="font-display font-black text-base sm:text-lg text-slate-100">
                      {activeFixture.awayManagerName}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      OVR: {awayManager?.teamOverall ?? 0} · {awayManager?.formation || '4-4-2'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 w-full max-w-lg">
                  {[
                    { label: activeFixture.homeManagerName, value: activeFixture.homeWinProbability ?? 50 },
                    { label: 'DRAW', value: activeFixture.drawProbability ?? 20 },
                    { label: activeFixture.awayManagerName, value: activeFixture.awayWinProbability ?? 30 },
                  ].map((item) => (
                    <div key={item.label} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                      <div className="text-[9px] uppercase tracking-wider text-slate-500 truncate">{item.label}</div>
                      <div className="font-mono font-black text-sm text-emerald-400 mt-1">{Number(item.value).toFixed(1)}%</div>
                      <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(item.value)))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 max-w-md">
                  Match probabilities are derived from team attributes, formation, tactics and home advantage; the live engine then applies seeded match-event variance.
                </div>

                {/* Big Action Button */}
                <button
                  onClick={handleSimulateClick}
                  disabled={isSimulating}
                  className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-display font-black text-sm uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 shadow-xl shadow-emerald-500/25 transition-all flex items-center justify-center gap-2.5 cursor-pointer active:scale-95"
                >
                  {isSimulating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>SIMULATING MATCHDAY {currentMatchday}...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      <span>{matchdayFixtures.some((f) => f.played) ? 'START NEXT MATCH' : 'START MATCH'}</span>
                    </>
                  )}
                </button>
              </div>
            )
          ) : (
            <div className="p-12 text-center bg-slate-900 rounded-2xl border border-slate-800">
              <Calendar className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <div className="font-bold text-slate-200">No Fixture Selected</div>
            </div>
          )}
        </div>

        {/* --- RIGHT: LEAGUE TABLE (5 cols) --- */}
        {/* Requirement 8: Proper football standings table with columns: POS, TEAM, P, W, D, L, GF, GA, GD, PTS, FORM. Highlight YOUR TEAM with subtle accent. */}
        <div className={`lg:col-span-5 space-y-4 ${mobileTab !== 'table' ? 'hidden lg:block' : ''}`}>
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <h2 className="font-display font-black text-sm uppercase tracking-wider text-slate-200">
                  LEAGUE TABLE
                </h2>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                Matchday {currentMatchday} / {room.totalMatchdays}
              </span>
            </div>

            {/* Standings Table with exact requested columns */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                    <th className="pb-2.5 pl-2">POS</th>
                    <th className="pb-2.5">TEAM</th>
                    <th className="pb-2.5 text-center">P</th>
                    <th className="pb-2.5 text-center">W</th>
                    <th className="pb-2.5 text-center">D</th>
                    <th className="pb-2.5 text-center">L</th>
                    <th className="pb-2.5 text-center">GF</th>
                    <th className="pb-2.5 text-center">GA</th>
                    <th className="pb-2.5 text-center">GD</th>
                    <th className="pb-2.5 text-center font-bold text-slate-200">PTS</th>
                    <th className="pb-2.5 pr-2 text-right">FORM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {room.leagueTable.map((row, idx) => {
                    const isUserTeam = row.managerId === managerId;
                    const isPlayingNow =
                      activeFixture &&
                      (activeFixture.homeManagerId === row.managerId ||
                        activeFixture.awayManagerId === row.managerId);

                    return (
                      <tr
                        key={row.managerId}
                        className={`transition-colors ${
                          isUserTeam
                            ? 'bg-emerald-950/40 border-l-2 border-emerald-400 text-emerald-300 font-bold'
                            : isPlayingNow
                            ? 'bg-slate-800/40 text-slate-200'
                            : 'hover:bg-slate-800/20 text-slate-300'
                        }`}
                      >
                        <td className="py-2.5 pl-2 font-black">{idx + 1}</td>
                        <td className="py-2.5 font-sans font-bold truncate max-w-[110px]">
                          {row.managerName} {isUserTeam && <span className="text-[10px] text-emerald-400 ml-1 font-mono">(You)</span>}
                        </td>
                        <td className="py-2.5 text-center text-slate-400">{row.played}</td>
                        <td className="py-2.5 text-center text-slate-300">{row.won}</td>
                        <td className="py-2.5 text-center text-slate-400">{row.drawn}</td>
                        <td className="py-2.5 text-center text-slate-400">{row.lost}</td>
                        <td className="py-2.5 text-center text-slate-300">{row.goalsFor}</td>
                        <td className="py-2.5 text-center text-slate-400">{row.goalsAgainst}</td>
                        <td className="py-2.5 text-center">
                          {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                        </td>
                        <td className="py-2.5 text-center font-black text-amber-400 text-xs">
                          {row.points}
                        </td>
                        <td className="py-2.5 pr-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {row.form.length === 0 ? (
                              <span className="text-[10px] text-slate-600">-</span>
                            ) : (
                              row.form.map((res, fIdx) => (
                                <span
                                  key={fIdx}
                                  className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] font-bold ${
                                    res === 'W'
                                      ? 'bg-emerald-500 text-slate-950'
                                      : res === 'D'
                                      ? 'bg-slate-700 text-slate-300'
                                      : 'bg-rose-500 text-slate-950'
                                  }`}
                                >
                                  {res}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Global subtle footer branding */}
      <footer className="mt-8 pt-4 pb-2 border-t border-slate-900/80 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
          <span>Real-time match engine & tactical league manager</span>
        </div>
        <div className="font-mono text-[10px] tracking-widest uppercase text-slate-400 font-semibold">
          FOOTBALL AUCTION LEAGUE · <span className="text-emerald-400">MADE BY IRVIX</span>
        </div>
      </footer>

      {/* --- MATCH STATS MODAL --- */}
      {showStatsModal && activeFixture && activeFixture.played && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">MATCH REPORT & STATS</h2>
              <button
                onClick={() => setShowStatsModal(false)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Team Stats Comparison */}
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-xs font-bold text-slate-400 pb-1 border-b border-slate-800">
                <span className="text-emerald-400 font-display font-black">{activeFixture.homeManagerName}</span>
                <span className="uppercase tracking-wider">Team Stats</span>
                <span className="text-sky-400 font-display font-black">{activeFixture.awayManagerName}</span>
              </div>

              {[
                { label: 'Score', home: activeFixture.homeScore, away: activeFixture.awayScore },
                { label: 'Possession', home: `${activeFixture.homeStats?.possession || 50}%`, away: `${activeFixture.awayStats?.possession || 50}%` },
                { label: 'Total Shots', home: activeFixture.homeStats?.shots || 0, away: activeFixture.awayStats?.shots || 0 },
                { label: 'Shots on Target', home: activeFixture.homeStats?.shotsOnTarget || 0, away: activeFixture.awayStats?.shotsOnTarget || 0 },
                { label: 'Passes', home: activeFixture.homeStats?.passes || 0, away: activeFixture.awayStats?.passes || 0 },
                { label: 'Corners', home: activeFixture.homeStats?.corners || 0, away: activeFixture.awayStats?.corners || 0 },
                { label: 'Fouls', home: activeFixture.homeStats?.fouls || 0, away: activeFixture.awayStats?.fouls || 0 },
                { label: 'Yellow Cards', home: activeFixture.homeStats?.yellowCards || 0, away: activeFixture.awayStats?.yellowCards || 0 },
              ].map(({ label, home, away }) => (
                <div key={label} className="flex justify-between items-center text-xs py-1 font-mono">
                  <span className="font-bold text-emerald-400 w-12 text-left">{home}</span>
                  <span className="font-sans text-slate-400 text-center">{label}</span>
                  <span className="font-bold text-sky-400 w-12 text-right">{away}</span>
                </div>
              ))}
            </div>

            {/* Player Ratings Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Player Match Ratings & Performance
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {activeFixture.playerStats?.map((ps) => (
                  <div
                    key={ps.playerId}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-200 mr-2">{ps.playerName}</span>
                      <span className="text-[10px] text-slate-400">
                        {ps.team === 'home' ? activeFixture.homeManagerName : activeFixture.awayManagerName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono">
                      {ps.goals > 0 && <span className="text-emerald-400 font-bold">⚽ {ps.goals}</span>}
                      {ps.assists > 0 && <span className="text-sky-400 font-bold">🎯 {ps.assists}</span>}
                      <span className="font-bold text-amber-400 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800">
                        ★ {ps.rating}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TRANSFERS MODAL --- */}
      {showTransferModal && currentManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg p-6 rounded-3xl bg-slate-900/95 border border-white/10 shadow-2xl shadow-black/40 my-8 backdrop-blur-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">PROPOSE TRANSFER SWAP</h2>
              <button
                onClick={() => setShowTransferModal(false)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {room.transferOffers.filter(o => o.toManagerId === managerId && o.status === 'pending').length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-black text-amber-400">Incoming Offers</div>
                {room.transferOffers.filter(o => o.toManagerId === managerId && o.status === 'pending').map((offer) => (
                  <div key={offer.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-xs text-slate-200 font-semibold">
                      {offer.fromManagerName} offers <span className="text-emerald-400">{offer.offeredPlayerName}</span>
                      {offer.offeredCash > 0 && <span className="text-amber-300"> + £{offer.offeredCash}M</span>}
                      {' '}for <span className="text-sky-300">{offer.requestedPlayerName}</span>.
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button type="button" onClick={() => onRespondTransfer(offer.id, true)} className="py-2 rounded-lg bg-emerald-400 text-slate-950 text-[11px] font-black uppercase">Accept</button>
                      <button type="button" onClick={() => onRespondTransfer(offer.id, false)} className="py-2 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-black uppercase">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {room.transferOffers.filter(o => o.fromManagerId === managerId && o.status === 'pending').length > 0 && (
              <div className="mb-4 p-3 rounded-2xl bg-sky-500/5 border border-sky-400/20">
                <div className="text-[10px] uppercase tracking-widest font-black text-sky-300 mb-2">Outgoing · Awaiting Response</div>
                <div className="space-y-1.5">
                  {room.transferOffers.filter(o => o.fromManagerId === managerId && o.status === 'pending').map((offer) => (
                    <div key={offer.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2">
                      <div className="text-[10px] text-slate-300">
                        <span className="font-bold">{offer.offeredPlayerName}</span>
                        {offer.offeredCash > 0 && <span className="text-amber-300"> + £{offer.offeredCash}M</span>}
                        <span className="text-slate-500"> → {offer.requestedPlayerName} · {offer.toManagerName}</span>
                      </div>
                      <span className="text-[9px] font-mono text-amber-300">PENDING</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4 p-3 rounded-2xl bg-slate-950/70 border border-white/5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-amber-300">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Transfer rules
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-[9px] text-slate-500">
                <span>• Opens once at the season midpoint</span>
                <span>• Player-for-player + cash</span>
                <span>• Both squads stay within formation limits</span>
                <span>• Budgets are updated atomically</span>
              </div>
            </div>

            <form onSubmit={handleSendTransfer} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Select Target Manager
                </label>
                <select
                  value={targetManagerId}
                  onChange={(e) => {
                    setTargetManagerId(e.target.value);
                    setRequestedPlayerId('');
                  }}
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose Manager --</option>
                  {room.managers
                    .filter((m) => m.id !== managerId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.isBot ? 'AI' : 'Human'})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Player You Offer (From Your Squad)
                </label>
                <select
                  value={offeredPlayerId}
                  onChange={(e) => setOfferedPlayerId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose Your Player --</option>
                  {currentManager.squad.map((s) => (
                    <option key={s.player.id} value={s.player.id}>
                      {s.player.name} ({s.player.position} · OVR {s.player.overall})
                    </option>
                  ))}
                </select>
              </div>

              {targetManagerId && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Player You Want
                  </label>
                  <select
                    value={requestedPlayerId}
                    onChange={(e) => setRequestedPlayerId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs outline-none focus:border-amber-500"
                  >
                    <option value="">-- Choose Requested Player --</option>
                    {room.managers
                      .find((m) => m.id === targetManagerId)
                      ?.squad.map((s) => (
                        <option key={s.player.id} value={s.player.id}>
                          {s.player.name} ({s.player.position} · OVR {s.player.overall})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Additional Cash Sweetener (£M)
                </label>
                <input
                  type="number"
                  min="0"
                  max={currentManager.budget}
                  value={offeredCash}
                  onChange={(e) => setOfferedCash(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-lg shadow-amber-500/20 transition-all cursor-pointer active:scale-95"
                >
                  SEND TRANSFER PROPOSAL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
