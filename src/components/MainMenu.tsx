import React, { useState } from 'react';
import { Formation, LobbySettings, PlayerPool, Era, AuctionMode, LeagueType, CompetitionFormat } from '../types/football';
import { FORMATIONS_CONFIG } from '../constants/formations';
import { Trophy, Users, Shield, Zap, Sparkles, Play, ArrowRight, Activity } from 'lucide-react';

interface MainMenuProps {
  onCreateLobby: (managerName: string, settings?: Partial<LobbySettings>) => void;
  onJoinLobby: (roomCode: string, managerName: string) => void;
  onSoloPlay: (managerName: string, formation: Formation) => void | Promise<void>;
  savedSession: { roomCode: string; managerId: string; managerName: string } | null;
  onResumeSession: (roomCode: string, managerName: string) => void;
  isConnected: boolean;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onCreateLobby,
  onJoinLobby,
  onSoloPlay,
  savedSession,
  onResumeSession,
  isConnected,
}) => {
  const [activeModal, setActiveModal] = useState<'create' | 'join' | 'solo' | null>(null);

  // Form states
  const [managerName, setManagerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [soloFormation, setSoloFormation] = useState<Formation>('4-3-3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Lobby settings states
  const [maxManagers, setMaxManagers] = useState(8);
  const [startingBudget, setStartingBudget] = useState(500);
  const [customBudget, setCustomBudget] = useState('500');
  const [playerPool, setPlayerPool] = useState<PlayerPool>('Global');
  const [era, setEra] = useState<Era>('Current');
  const [auctionMode, setAuctionMode] = useState<AuctionMode>('Classic');
  const [transfersEnabled, setTransfersEnabled] = useState(true);
  const [leagueType, setLeagueType] = useState<LeagueType>('Round Robin');
  const [competitionFormat, setCompetitionFormat] = useState<CompetitionFormat>('League');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!managerName.trim()) return;
    const finalBudget = startingBudget === -1 ? (parseInt(customBudget, 10) || 500) : startingBudget;
    onCreateLobby(managerName.trim(), {
      maxManagers,
      startingBudget: finalBudget,
      playerPool,
      era,
      auctionMode,
      transfersEnabled,
      leagueType,
      competitionFormat,
    });
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!managerName.trim() || !joinCode.trim()) return;
    onJoinLobby(joinCode.trim().toUpperCase(), managerName.trim());
  };

  const handleSoloSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!managerName.trim()) {
      setValidationError('Please enter your manager name to start.');
      return;
    }
    setValidationError(null);
    setIsSubmitting(true);
    try {
      await onSoloPlay(managerName.trim(), soloFormation);
    } catch (err: any) {
      setValidationError(err.message || 'Failed to start Solo Game');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between p-4 sm:p-6 md:p-8 bg-[radial-gradient(circle_at_50%_-10%,#12352d_0%,#06130f_28%,#02050b_65%,#010307_100%)] text-slate-100 overflow-hidden select-none">
      {/* Dynamic Background: Pitch Lines, Center Circle & Subtle Stadium Floodlights */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Stadium Floodlight Cones */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[850px] h-[550px] bg-emerald-500/10 blur-[140px] rounded-full" />
        <div className="absolute -bottom-36 left-1/4 w-[600px] h-[400px] bg-teal-500/10 blur-[130px] rounded-full" />
        <div className="absolute top-1/3 -right-24 w-[500px] h-[350px] bg-amber-500/5 blur-[120px] rounded-full" />

        {/* Pitch Center Circle Line Graphic */}
        <svg
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[750px] h-[750px] opacity-[0.035] pointer-events-none"
          viewBox="0 0 100 100"
          fill="none"
          stroke="white"
          strokeWidth="0.5"
        >
          <circle cx="50" cy="50" r="45" />
          <circle cx="50" cy="50" r="18" />
          <line x1="0" y1="50" x2="100" y2="50" />
          <circle cx="50" cy="50" r="1.5" fill="white" />
        </svg>

        {/* Subtle Pitch Grass Turf Stripes */}
        <div className="absolute inset-0 opacity-[0.02] bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:24px_24px]" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 max-w-6xl mx-auto w-full flex items-center justify-between py-3 px-1 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-sm shadow-emerald-500/20">
            <Trophy className="w-4 h-4" />
          </div>
          <span className="font-display font-black text-sm tracking-wider text-slate-200 uppercase">
            FC TACTICAL ARENA
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-amber-400 animate-pulse'}`} />
            <span className="font-mono text-[11px]">{isConnected ? 'Server Online' : 'Connecting...'}</span>
          </div>
        </div>
      </header>

      {/* Main Center Content */}
      <main className="relative z-10 max-w-5xl mx-auto w-full my-auto py-7 sm:py-12 flex flex-col items-center text-center">
        {/* Reconnect Banner if saved session exists */}
        {savedSession && (
          <div className="mb-6 w-full max-w-md p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 backdrop-blur-md flex items-center justify-between shadow-lg">
            <div className="text-left">
              <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Active Lobby Session</div>
              <div className="text-sm font-bold text-slate-200">{savedSession.managerName} · Room {savedSession.roomCode}</div>
            </div>
            <button
              onClick={() => onResumeSession(savedSession.roomCode, savedSession.managerName)}
              className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all active:scale-95 shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              Rejoin
            </button>
          </div>
        )}

        {/* Category Pill Tag */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.045] border border-emerald-300/20 text-[11px] font-bold text-emerald-300 mb-6 shadow-lg shadow-emerald-500/5 backdrop-blur-xl">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Realtime Tactical Auction & 2D Animated Match Engine</span>
        </div>

        {/* Mandatory Title/Branding: FOOTBALL / AUCTION / LEAGUE */}
        <div className="flex flex-col items-center mb-6 leading-none">
          <h1 className="font-display font-black text-4xl sm:text-6xl md:text-7xl tracking-tight text-white uppercase drop-shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
            FOOTBALL
          </h1>
          <div className="font-display font-black text-4xl sm:text-6xl md:text-7xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300 uppercase py-1">
            AUCTION
          </div>
          <div className="font-display font-black text-4xl sm:text-6xl md:text-7xl tracking-tight text-slate-200 uppercase">
            LEAGUE
          </div>
        </div>

        <p className="max-w-2xl text-slate-400 text-xs sm:text-sm md:text-base leading-relaxed mb-5 px-4">
          Draft world-class stars, build an 11-player squad, tune your tactics, and play through live animated matchdays.
        </p>
        <div className="mb-8 flex flex-wrap justify-center gap-2.5 px-3">
          {['LIVE AUCTION', '11 PLAYER SQUADS', '2–16 MANAGERS', '2D MATCH ENGINE'].map((label) => (
            <span key={label} className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[9px] font-black tracking-[0.16em] text-slate-400 shadow-lg shadow-black/10 backdrop-blur-xl">
              {label}
            </span>
          ))}
        </div>

        {/* 3 Main Action Buttons with SOLO PLAY visually prominent */}
        <div className="w-full max-w-2xl flex flex-col gap-4 px-2">
          {/* 1. SOLO PLAY (Dominant / Hero Button) */}
          <button
            onClick={() => {
              setActiveModal('solo');
              setManagerName(savedSession?.managerName || '');
            }}
            className="group relative p-5 sm:p-6 rounded-[1.75rem] bg-gradient-to-br from-emerald-400/95 via-teal-400/95 to-emerald-500/95 border border-emerald-200/70 hover:border-white/80 text-slate-950 transition-all duration-300 shadow-2xl shadow-emerald-500/20 hover:shadow-emerald-400/30 hover:-translate-y-0.5 active:scale-[0.985] cursor-pointer flex items-center justify-between overflow-hidden"
          >
            <div className="flex items-center gap-4 text-left">
              <div className="w-12 h-12 rounded-xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-md group-hover:scale-105 transition-transform">
                <Zap className="w-6 h-6 fill-current" />
              </div>
              <div>
                <div className="font-display font-black text-xl sm:text-2xl text-slate-950 tracking-wide uppercase">
                  SOLO PLAY
                </div>
                <div className="text-xs sm:text-sm text-emerald-950 font-semibold mt-0.5">
                  Instant match vs smart tactical AI · Skip Auction or Live Bidding
                </div>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 font-display font-black text-xs uppercase tracking-wider bg-slate-950/20 px-3 py-1.5 rounded-lg text-slate-950 group-hover:translate-x-1 transition-transform">
              <span>PLAY NOW</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>

          {/* 2 & 3. Secondary Multiplayer Actions (CREATE LOBBY & JOIN LOBBY) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              onClick={() => {
                setActiveModal('create');
                setManagerName(savedSession?.managerName || '');
              }}
              className="group relative p-4 sm:p-5 rounded-[1.5rem] bg-white/[0.045] backdrop-blur-2xl border border-white/10 hover:border-emerald-300/35 hover:bg-white/[0.065] transition-all duration-300 text-left flex items-center justify-between shadow-xl shadow-black/20 hover:-translate-y-0.5 active:scale-[0.985] cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-display font-black text-base text-slate-100 uppercase tracking-wide">
                    CREATE LOBBY
                  </div>
                  <div className="text-xs text-slate-400">Host 2–16 managers with custom rules</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform shrink-0" />
            </button>

            <button
              onClick={() => {
                setActiveModal('join');
                setManagerName(savedSession?.managerName || '');
              }}
              className="group relative p-4 sm:p-5 rounded-2xl bg-white/[0.045] backdrop-blur-2xl border border-white/10 hover:border-teal-300/35 hover:bg-white/[0.065] transition-all duration-300 text-left flex items-center justify-between shadow-xl shadow-black/20 hover:-translate-y-0.5 active:scale-[0.985] cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-display font-black text-base text-slate-100 uppercase tracking-wide">
                    JOIN LOBBY
                  </div>
                  <div className="text-xs text-slate-400">Enter a 6-letter lobby room code</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-teal-400 group-hover:translate-x-1 transition-transform shrink-0" />
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-6xl mx-auto w-full py-4 border-t border-slate-900/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <div>Verified football ratings & 11-player squad tactical simulation.</div>
        <div className="flex items-center gap-3 text-slate-400">
          <span>Season 2025/26</span>
          <span aria-hidden="true">·</span>
          <span>Fast-Paced Auction League</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-emerald-400/90 font-semibold tracking-wider">MADE BY IRVIX</span>
        </div>
      </footer>

      {/* --- CREATE LOBBY MODAL --- */}
      {activeModal === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">CREATE LOBBY</h2>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Manager Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Master Tactician"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500 text-slate-100 text-sm outline-none transition-colors"
                />
              </div>

              {/* Max Managers */}
              <div>
                <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  <span>Max Managers</span>
                  <span className="text-emerald-400 font-mono font-bold">{maxManagers} Managers</span>
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

              {/* Starting Budget */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Starting Budget
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[200, 300, 500, 750, 1000, -1].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStartingBudget(val)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        startingBudget === val
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {val === -1 ? 'Custom' : val === 1000 ? '£1B' : `£${val}M`}
                    </button>
                  ))}
                </div>
                {startingBudget === -1 && (
                  <input
                    type="number"
                    min="100"
                    max="5000"
                    placeholder="Enter Budget in £M"
                    value={customBudget}
                    onChange={(e) => setCustomBudget(e.target.value)}
                    className="mt-2 w-full px-4 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs outline-none"
                  />
                )}
              </div>

              {/* Player Pool & Era */}
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
                    <option value="Global">Global All Stars</option>
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
                    Era
                  </label>
                  <select
                    value={era}
                    onChange={(e) => setEra(e.target.value as Era)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="Current">Current Stars</option>
                    <option value="All-Time">All-Time Icons</option>
                  </select>
                </div>
              </div>

              {/* Auction Mode & League Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    Auction Mode
                  </label>
                  <select
                    value={auctionMode}
                    onChange={(e) => setAuctionMode(e.target.value as AuctionMode)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="Classic">Classic Live Auction</option>
                    <option value="Blind">Blind Secret Bids</option>
                    <option value="Quick">Quick Blitz Auction</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                    League Format
                  </label>
                  <select
                    value={leagueType}
                    onChange={(e) => setLeagueType(e.target.value as LeagueType)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs outline-none"
                  >
                    <option value="Round Robin">Round Robin (1x)</option>
                    <option value="Double Round Robin">Double Round Robin (2x)</option>
                  </select>
                </div>
              </div>

              {/* Competition Format */}
              <div className="grid grid-cols-2 gap-3">
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
                  </select>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center">
                  {competitionFormat === 'Knockout'
                    ? 'Bracket: Round of 16 → Quarter-Final → Semi-Final → Final, with extra time and penalties.'
                    : 'Round-robin standings with matchdays and a final league table.'}
                </div>
              </div>

              {/* Transfers Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Mid-Season Transfers</div>
                  <div className="text-[11px] text-slate-400">Player ↔ Player + Cash swaps</div>
                </div>
                <button
                  type="button"
                  onClick={() => setTransfersEnabled(!transfersEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${transfersEnabled ? 'bg-emerald-500' : 'bg-slate-800'}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      transfersEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 mt-4 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-[0.99]"
              >
                CREATE LOBBY
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- JOIN LOBBY MODAL --- */}
      {activeModal === 'join' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">JOIN LOBBY</h2>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleJoinSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Manager Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Master Tactician"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-teal-500 text-slate-100 text-sm outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Lobby Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="e.g. EPL892"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-lg bg-slate-950 border border-slate-800 focus:border-teal-500 text-slate-100 font-mono font-bold tracking-widest text-center text-lg uppercase outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3.5 mt-4 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-teal-400 hover:bg-teal-300 text-slate-950 transition-all shadow-lg shadow-teal-500/20 cursor-pointer active:scale-[0.99]"
              >
                JOIN LOBBY
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- SOLO PLAY MODAL --- */}
      {activeModal === 'solo' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-emerald-500/50 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-emerald-400" />
                <h2 className="font-display font-black text-xl text-slate-100 uppercase tracking-wide">SOLO PLAY</h2>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSoloSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Your Manager Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pep Manager"
                  value={managerName}
                  onChange={(e) => {
                    setManagerName(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 focus:border-emerald-500 text-slate-100 text-sm outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Initial Formation
                </label>
                <select
                  value={soloFormation}
                  onChange={(e) => setSoloFormation(e.target.value as Formation)}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-sm outline-none"
                >
                  {Object.keys(FORMATIONS_CONFIG).map((f) => (
                    <option key={f} value={f}>
                      {FORMATIONS_CONFIG[f as Formation].name} ({f})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs text-slate-300 space-y-1">
                <div className="font-bold text-emerald-400">Solo Play Highlights:</div>
                <div>· Smart AI Opponent with custom squad & tactics</div>
                <div>· Choose START AUCTION or SKIP AUCTION explicitly</div>
                <div>· Live 2D match engine with tactical AI</div>
              </div>

              {validationError && (
                <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-300 font-semibold animate-in fade-in">
                  {validationError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 mt-4 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>LAUNCHING GAME...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>START GAME</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
