import React, { useState } from 'react';
import { GameRoom, LobbySettings, PlayerPool, Era, AuctionMode, LeagueType, CompetitionFormat } from '../types/football';
import { Crown, Bot, CheckCircle2, Clock, Copy, Check, Settings, UserX, Play, LogOut, ShieldAlert, User } from 'lucide-react';

interface LobbyRoomViewProps {
  room: GameRoom;
  managerId: string;
  onToggleReady: () => void;
  onStartGame: () => void;
  onUpdateSettings: (settings: Partial<LobbySettings>) => void;
  onKickPlayer: (targetManagerId: string) => void;
  onLeaveLobby: () => void;
}

export const LobbyRoomView: React.FC<LobbyRoomViewProps> = ({
  room,
  managerId,
  onToggleReady,
  onStartGame,
  onUpdateSettings,
  onKickPlayer,
  onLeaveLobby,
}) => {
  const [copied, setCopied] = useState(false);
  const [showEditSettings, setShowEditSettings] = useState(false);

  const currentManager = room.managers.find((m) => m.id === managerId);
  const isHost = currentManager?.isHost ?? false;

  // Settings form local state
  const [maxManagers, setMaxManagers] = useState(room.settings.maxManagers);
  const [startingBudget, setStartingBudget] = useState(room.settings.startingBudget);
  const [playerPool, setPlayerPool] = useState<PlayerPool>(room.settings.playerPool);
  const [era, setEra] = useState<Era>(room.settings.era);
  const [auctionMode, setAuctionMode] = useState<AuctionMode>(room.settings.auctionMode);
  const [transfersEnabled, setTransfersEnabled] = useState(room.settings.transfersEnabled);
  const [leagueType, setLeagueType] = useState<LeagueType>(room.settings.leagueType);
  const [competitionFormat, setCompetitionFormat] = useState<CompetitionFormat>(room.settings.competitionFormat || 'League');

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      maxManagers,
      startingBudget,
      playerPool,
      era,
      auctionMode,
      transfersEnabled,
      leagueType,
      competitionFormat,
    });
    setShowEditSettings(false);
  };

  const allReady = room.managers.length >= 2 && room.managers.every((m) => m.isReady || m.isBot);

  return (
    <div className="min-h-screen bg-[#040812] text-slate-100 p-4 sm:p-6 md:p-8 flex flex-col justify-between max-w-6xl mx-auto select-none">
      {/* Top Header: Room Code & Quick Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-900 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-widest font-black text-emerald-400">MULTIPLAYER LOCKER ROOM</span>
            <span className="text-xs text-slate-400 font-mono">
              {room.managers.length} / {room.settings.maxManagers} Managers
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <h1 className="font-display font-black text-2xl sm:text-3xl text-slate-100">
              LOBBY CODE: <span className="text-emerald-400 tracking-wider font-mono">{room.code}</span>
            </h1>
            <button
              onClick={handleCopyCode}
              title="Copy Room Code"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500 text-xs font-semibold text-slate-300 transition-colors cursor-pointer active:scale-95 shadow-sm"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-xs">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-xs">Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isHost && (
            <button
              onClick={() => setShowEditSettings(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer active:scale-95"
            >
              <Settings className="w-4 h-4 text-emerald-400" />
              <span>SETTINGS</span>
            </button>
          )}

          <button
            onClick={onLeaveLobby}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-rose-900/60 hover:text-rose-400 text-xs font-semibold text-slate-400 transition-colors cursor-pointer active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>EXIT</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Managers List + Settings Specs Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-6 flex-1 items-start">
        {/* Managers Roster (8 cols) */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
            <span>Managers in Room ({room.managers.length})</span>
            <span>Status</span>
          </div>

          <div className="space-y-2.5">
            {room.managers.map((m) => {
              const isMe = m.id === managerId;
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                    isMe
                      ? 'bg-gradient-to-r from-emerald-950/30 to-slate-900/90 border-emerald-500/50 shadow-md shadow-emerald-500/5'
                      : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700/80'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    {/* Avatar Icon */}
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center font-display font-black text-sm shadow-sm ${
                        m.isHost
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : m.isBot
                          ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                          : 'bg-slate-800 text-slate-200 border border-slate-700'
                      }`}
                    >
                      {m.isHost ? <Crown className="w-5 h-5" /> : m.isBot ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-bold text-slate-100 text-base">{m.name}</span>
                        {isMe && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-black tracking-wider bg-emerald-500 text-slate-950 uppercase shadow-sm">
                            YOU
                          </span>
                        )}
                        {m.isHost && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-black tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                            HOST
                          </span>
                        )}
                        {m.isBot && (
                          <span className="text-[10px] px-2 py-0.5 rounded font-black tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/40 uppercase">
                            BOT
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-mono">
                        Budget: <span className="text-emerald-400 font-bold">£{m.budget}M</span> · Formation: {m.formation}
                      </div>
                    </div>
                  </div>

                  {/* Ready Status & Host Kick */}
                  <div className="flex items-center gap-3">
                    {m.isReady || m.isBot ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-black text-emerald-400 shadow-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>READY</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-400">
                        <Clock className="w-3.5 h-3.5 animate-spin" />
                        <span>NOT READY</span>
                      </div>
                    )}

                    {isHost && !m.isHost && (
                      <button
                        onClick={() => onKickPlayer(m.id)}
                        title="Kick Manager"
                        className="p-2 rounded-lg hover:bg-rose-950/40 hover:text-rose-400 text-slate-500 transition-colors cursor-pointer"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Settings Specs Panel (4 cols) */}
        <div className="lg:col-span-4 p-5 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between shadow-xl">
          <div className="space-y-4">
            <h2 className="font-display font-black text-xs uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Settings className="w-4 h-4 text-emerald-400" />
              <span>SETTINGS & RULES</span>
            </h2>

            <div className="space-y-2.5 text-xs divide-y divide-slate-800/60">
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Starting Budget</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">£{room.settings.startingBudget}M</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Player Pool</span>
                <span className="font-semibold text-slate-200">{room.settings.playerPool}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Era</span>
                <span className="font-semibold text-slate-200">{room.settings.era}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Auction Mode</span>
                <span className="font-bold text-amber-400">{room.settings.auctionMode} Auction</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Squad Target</span>
                <span className="font-semibold text-slate-200">11 Starters + 7 Bench (18 Total)</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">Transfers</span>
                <span className="font-semibold text-slate-200">{room.settings.transfersEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-400">League Format</span>
                <span className="font-semibold text-slate-200">{room.settings.competitionFormat === 'Knockout' ? 'Knockout Cup' : room.settings.competitionFormat === 'Champions Cup' ? 'Champions Cup' : 'Double Round Robin · Home + Away'}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
            <strong className="text-slate-200">Notice:</strong> Once all managers are ready, the host can start the tactical formation setup.
          </div>
        </div>
      </div>

      {/* Footer Controls: Ready Toggle & Start Game */}
      <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          {!allReady && (
            <div className="flex items-center gap-2 text-xs text-amber-400 font-semibold">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Waiting for all managers to be READY before match launch.</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Player Ready Toggle */}
          {!currentManager?.isBot && (
            <button
              onClick={onToggleReady}
              className={`flex-1 sm:flex-none px-6 py-3 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all border cursor-pointer active:scale-95 shadow-md ${
                currentManager?.isReady
                  ? 'bg-slate-900 border-emerald-500/60 text-emerald-400 hover:bg-slate-800'
                  : 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 border-emerald-400 shadow-emerald-500/20'
              }`}
            >
              {currentManager?.isReady ? 'CHANGE TO NOT READY' : 'READY TO PLAY'}
            </button>
          )}

          {/* Host Start Game Button */}
          {isHost && (
            <button
              onClick={onStartGame}
              disabled={!allReady}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all shadow-lg ${
                allReady
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-300 hover:from-emerald-300 hover:to-teal-200 text-slate-950 shadow-emerald-500/25 cursor-pointer active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>START GAME</span>
            </button>
          )}
        </div>
      </div>

      {/* --- EDIT SETTINGS MODAL --- */}
      {showEditSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">EDIT LOBBY SETTINGS</h2>
              <button
                onClick={() => setShowEditSettings(false)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-left">
              <div>
                <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  <span>Max Managers</span>
                  <span className="text-emerald-400 font-mono font-bold">{maxManagers}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="16"
                  value={maxManagers}
                  onChange={(e) => setMaxManagers(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Starting Budget (£M)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[200, 300, 500, 750, 1000].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setStartingBudget(b)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        startingBudget === b
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      £{b}M
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setStartingBudget(Math.max(100, Math.min(5000, startingBudget)))}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      ![200, 300, 500, 750, 1000].includes(startingBudget)
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    CUSTOM
                  </button>
                </div>
                <input
                  type="number"
                  min="100"
                  max="5000"
                  step="50"
                  value={startingBudget}
                  onChange={(e) => setStartingBudget(Math.max(100, Math.min(5000, Number(e.target.value) || 100)))}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono outline-none"
                  placeholder="Custom budget (£M)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Player Pool
                  </label>
                  <select
                    value={playerPool}
                    onChange={(e) => setPlayerPool(e.target.value as PlayerPool)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="Global">Global</option>
                    <option value="Premier League">Premier League</option>
                    <option value="La Liga">La Liga</option>
                    <option value="Bundesliga">Bundesliga</option>
                    <option value="Serie A">Serie A</option>
                    <option value="Brasileirão">Brasileirão</option>
                    <option value="Champions League">Champions League</option>
                    <option value="World Cup">World Cup</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Auction Mode
                  </label>
                  <select
                    value={auctionMode}
                    onChange={(e) => setAuctionMode(e.target.value as AuctionMode)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="Classic">Classic Live</option>
                    <option value="Blind">Blind Secret Bids</option>
                    <option value="Quick">Quick Blitz</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    League Type
                  </label>
                  {competitionFormat === 'League' ? (
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                      Double Round Robin · Home + Away
                    </div>
                  ) : (
                    <select
                      value={leagueType}
                      onChange={(e) => setLeagueType(e.target.value as LeagueType)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                    >
                      <option value="Round Robin">Round Robin</option>
                      <option value="Double Round Robin">Double Round Robin</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Competition
                  </label>
                  <select
                    value={competitionFormat}
                    onChange={(e) => setCompetitionFormat(e.target.value as CompetitionFormat)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="League">League Season</option>
                    <option value="Knockout">Knockout Cup</option>
                    <option value="Champions Cup">Champions Cup</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 mt-4 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-95"
              >
                SAVE SETTINGS
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
