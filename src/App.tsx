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

export default function App() {
  const {
    room,
    managerId,
    isConnected,
    errorMessage,
    startSoloGame,
    createLobby,
    joinLobby,
    updateSettings,
    toggleReady,
    kickPlayer,
    startGame,
    selectFormation,
    beginAuction,
    skipAuctionSolo,
    placeBid,
    submitBlindBid,
    updateLineup,
    confirmTeam,
    runMatchday,
    runKnockoutMatch,
    completeKnockoutMatch,
    proceedToNextMatchday,
    finishSeason,
    isSimulating,
    simulationError,
    proposeTransfer,
    respondTransfer,
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Global Error Banner */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-rose-500 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
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
            className="fixed top-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/95 border border-rose-500/30 text-rose-300 hover:bg-rose-950/50 hover:border-rose-400/60 shadow-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95"
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
          onResumeSession={(code, name) => joinLobby(code, name)}
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
          onSkipAuctionSolo={skipAuctionSolo}
        />
      ) : room.phase === 'auction' ? (
        <LiveAuctionView
          room={room}
          managerId={managerId}
          onPlaceBid={placeBid}
          onSubmitBlindBid={submitBlindBid}
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
          onProceedNextMatchday={proceedToNextMatchday}
          onFinishSeason={finishSeason}
          onProposeTransfer={proposeTransfer}
          onRespondTransfer={respondTransfer}
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
      ) : null}
    </div>
  );
}
