import React, { useState } from 'react';
import { useGameSocket } from './hooks/useGameSocket';
import { MainMenu } from './components/MainMenu';
import { LobbyRoomView } from './components/LobbyRoomView';
import { FormationSelectView } from './components/FormationSelectView';
import { LiveAuctionView } from './components/LiveAuctionView';
import { TeamManagementView } from './components/TeamManagementView';
import { LeagueDashboardView } from './components/LeagueDashboardView';
import { SeasonEndView } from './components/SeasonEndView';
import { Volume2, VolumeX, AlertCircle } from 'lucide-react';
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
    proceedToNextMatchday,
    finishSeason,
    isSimulating,
    simulationError,
    proposeTransfer,
    rematch,
    leaveLobby,
    savedSession,
  } = useGameSocket();

  const [soundEnabled, setSoundEnabled] = useState(true);

  const toggleSound = () => {
    sound.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Global Error Banner */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-rose-500 text-slate-950 font-bold text-xs shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
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
            createLobby(name, false);
            if (settings) {
              setTimeout(() => updateSettings(settings), 300);
            }
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
