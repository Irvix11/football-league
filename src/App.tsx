import React, { useState } from 'react';
import { useGameSocket } from './hooks/useGameSocket';
import { MainMenu } from './components/MainMenu';
import { LobbyRoomView } from './components/LobbyRoomView';
import { FormationSelectView } from './components/FormationSelectView';
import { LiveAuctionView } from './components/LiveAuctionView';
import { TeamManagementView } from './components/TeamManagementView';
import { LeagueDashboardView } from './components/LeagueDashboardView';
import { KnockoutDashboardView } from './components/KnockoutDashboardView';
import { SeasonEndView } from './components/SeasonEndView';
import { Volume2, VolumeX, AlertCircle, UserX, X } from 'lucide-react';
import { sound } from './utils/audio';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  handleRecovery = () => {
    this.setState({ hasError: false });
  };

  handleResetSavedGame = () => {
    try {
      localStorage.removeItem('fal_session');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-3xl border border-rose-500/30 bg-slate-900 p-7 text-center shadow-2xl">
            <div className="text-rose-400 text-3xl font-black mb-3">!</div>
            <h1 className="text-xl font-black">Game state recovered</h1>
            <p className="mt-2 text-sm text-slate-400">
              The current screen hit an invalid saved state. Your browser has not been permanently damaged.
            </p>
            <button
              onClick={this.handleRecovery}
              className="mt-5 w-full px-5 py-3 rounded-xl bg-emerald-500 text-slate-950 font-black hover:bg-emerald-400"
            >
              TRY AGAIN
            </button>
            <button
              onClick={this.handleResetSavedGame}
              className="mt-3 w-full px-5 py-3 rounded-xl border border-slate-700 bg-slate-950 text-slate-200 font-black hover:bg-slate-800"
            >
              RESET SAVED GAME
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const {
    room,
    managerId,
    isConnected,
    errorMessage,
    startSoloGame,
    createLobby,
    joinLobby,
    resumeLobby,
    updateSettings,
    toggleReady,
    kickPlayer,
    startGame,
    selectFormation,
    beginAuction,
    markFormationDone,
    markAuctionDone,
    skipAuctionSolo,
    placeBid,
    submitBlindBid,
    secretBidSubmitted,
    updateLineup,
    confirmTeam,
    runMatchday,
    completeLeagueMatch,
    runKnockoutMatch,
    completeKnockoutMatch,
    proceedToNextMatchday,
    finishSeason,
    isSimulating,
    simulationError,
    proposeTransfer,
    respondTransfer,
    closeTransferWindow,
    rematch,
    leaveLobby,
    savedSession,
  } = useGameSocket();

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showKickPanel, setShowKickPanel] = useState(false);

  const toggleSound = () => {
    sound.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  const currentManager = room?.managers.find((m) => m.id === managerId);
  const isHost = currentManager?.isHost ?? false;
  const kickTargets = room?.managers.filter((m) => m.id !== managerId && !m.isHost) ?? [];

  const handleLeagueMatchComplete = async (fixtureId: string) => {
    if (!room || !managerId || !isHost) return;
    completeLeagueMatch(fixtureId);
  };


  const knownPhases = new Set([
    'lobby',
    'formation_select',
    'auction',
    'team_management',
    'league',
    'knockout',
    'season_end',
  ]);
  const rawPhase = room ? String((room as unknown as { phase?: unknown }).phase ?? '') : '';
  const hasUnsupportedPhase = Boolean(room && !knownPhases.has(rawPhase));

  const resetBrokenSession = () => {
    try { localStorage.removeItem('fal_session'); } catch {}
    window.location.reload();
  };

  return (
    <div className="min-h-screen min-h-dvh bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950 pb-[env(safe-area-inset-bottom)]">
      {/* Global Error Banner */}
      {errorMessage && (
        <div className="fixed top-[calc(env(safe-area-inset-top)+8px)] left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-2.5 rounded-xl bg-rose-500 text-slate-950 font-bold text-xs shadow-2xl flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Host-only kick control is available during the entire active game. */}
      {room && managerId && isHost && room.phase !== 'lobby' && (
        <>
          <button
            onClick={() => setShowKickPanel(true)}
            title="Host: remove a manager"
            className="fixed top-[calc(env(safe-area-inset-top)+72px)] right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/95 border border-rose-500/30 text-rose-300 hover:bg-rose-950/50 hover:border-rose-400/60 shadow-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95"
          >
            <UserX className="w-4 h-4" />
            KICK
          </button>

          {showKickPanel && (
            <div className="fixed inset-0 z-[80] bg-slate-950/75 backdrop-blur-sm flex items-start justify-center p-4 pt-20">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-rose-400 font-black">HOST CONTROL</div>
                    <h2 className="text-lg font-black text-slate-100">Remove Manager</h2>
                    <p className="text-xs text-slate-400 mt-1">This works at any point before the season ends.</p>
                  </div>
                  <button onClick={() => setShowKickPanel(false)} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-4 space-y-2">
                  {kickTargets.length === 0 ? (
                    <div className="text-sm text-slate-500 text-center py-6">No other managers to remove.</div>
                  ) : (
                    kickTargets.map((manager) => (
                      <button
                        key={manager.id}
                        onClick={() => {
                          if (window.confirm(`Remove ${manager.name} from the game?`)) {
                            kickPlayer(manager.id);
                            setShowKickPanel(false);
                          }
                        }}
                        className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-rose-500/60 hover:bg-rose-950/20 transition-all text-left"
                      >
                        <div>
                          <div className="font-bold text-sm text-slate-100">{manager.name}</div>
                          <div className="text-[10px] text-slate-500">{manager.isBot ? 'AI MANAGER' : 'HUMAN MANAGER'}</div>
                        </div>
                        <UserX className="w-4 h-4 text-rose-400" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Global Audio Toggle (Floating in bottom-right corner) */}
      <button
        onClick={toggleSound}
        title={soundEnabled ? 'Mute Audio' : 'Enable Audio'}
        className="fixed bottom-4 right-4 z-40 p-2.5 rounded-full bg-slate-900/90 border border-slate-800 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 shadow-xl transition-all"
      >
        {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
      </button>

      {/* Primary Phase Router */}
      {!room || !managerId ? (
        <MainMenu
          onCreateLobby={(name, settings) => {
            createLobby(name, false, undefined, settings);
          }}
          onJoinLobby={(code, name) => joinLobby(code, name)}
          onSoloPlay={(name, formation) => startSoloGame(name, formation)}
          savedSession={savedSession}
          onResumeSession={(code, name) => savedSession?.reconnectToken && resumeLobby({ ...savedSession, roomCode: code, managerName: name })}
          isConnected={isConnected}
        />
      ) : room.phase === 'lobby' ? (
        <LobbyRoomView
          room={room}
          managerId={managerId}
          onToggleReady={toggleReady}
          onStartGame={startGame}
          onUpdateSettings={updateSettings}
          onKickPlayer={kickPlayer}
          onLeaveLobby={leaveLobby}
        />
      ) : room.phase === 'formation_select' ? (
        <FormationSelectView
          room={room}
          managerId={managerId}
          onSelectFormation={selectFormation}
          onBeginAuction={beginAuction}
          onMarkDone={markFormationDone}
          onSkipAuctionSolo={skipAuctionSolo}
        />
      ) : room.phase === 'auction' ? (
        <LiveAuctionView
          room={room}
          managerId={managerId}
          onPlaceBid={placeBid}
          onSubmitBlindBid={submitBlindBid}
          secretBidSubmitted={secretBidSubmitted}
          onMarkDone={markAuctionDone}
          onLeaveMatch={leaveLobby}
        />
      ) : room.phase === 'team_management' ? (
        <TeamManagementView
          room={room}
          managerId={managerId}
          onUpdateLineup={updateLineup}
          onConfirmTeam={confirmTeam}
        />
      ) : room.phase === 'league' ? (
        <LeagueDashboardView
          room={room}
          managerId={managerId}
          onRunMatchday={runMatchday}
          onMatchComplete={handleLeagueMatchComplete}
          onProceedNextMatchday={proceedToNextMatchday}
          onFinishSeason={finishSeason}
          onProposeTransfer={proposeTransfer}
          onRespondTransfer={respondTransfer}
          onUpdateLineup={updateLineup}
          onFinishManagement={closeTransferWindow}
          isSimulating={isSimulating}
          simulationError={simulationError}
        />
      ) : room.phase === 'knockout' ? (
        <KnockoutDashboardView
          room={room}
          managerId={managerId}
          onRunMatch={runKnockoutMatch}
          onMatchComplete={completeKnockoutMatch}
          isSimulating={isSimulating}
          simulationError={simulationError}
        />
      ) : room.phase === 'season_end' ? (
        <SeasonEndView
          room={room}
          managerId={managerId}
          onRematch={rematch}
          onNewLobby={leaveLobby}
        />
      ) : hasUnsupportedPhase ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-3xl border border-amber-500/30 bg-slate-900/90 p-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-300 text-xl font-black">!</div>
            <h1 className="text-xl font-black">Saved game needs recovery</h1>
            <p className="mt-2 text-sm text-slate-400">
              This room contains an unsupported game state (<span className="font-mono text-amber-300">{rawPhase || 'missing phase'}</span>).
              The app was previously rendering a blank screen here.
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm"
              >
                Reconnect
              </button>
              <button
                onClick={resetBrokenSession}
                className="px-4 py-2.5 rounded-xl bg-rose-500 text-slate-950 hover:bg-rose-400 font-black text-sm"
              >
                Reset Saved Game
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-slate-400">
            <p className="font-bold">Loading game state…</p>
            <p className="text-xs mt-1">If this stays here, reconnect or reset the saved session.</p>
          </div>
        </div>
      )}
    </div>
  );
}


export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
