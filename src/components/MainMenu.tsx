import React, { useState } from 'react';
import { Formation, LobbySettings, PlayerPool, Era, AuctionMode, LeagueType, CompetitionFormat } from '../types/football';
import { FORMATIONS_CONFIG } from '../constants/formations';
import { ArrowRight, Trophy } from 'lucide-react';
import ResponsiveHeroBanner from './ui/responsive-hero-banner';

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
    <div className="relative min-h-screen overflow-hidden bg-[#02040a] text-slate-100">
      <ResponsiveHeroBanner
        badgeLabel={isConnected ? "LIVE" : "CONNECTING"}
        badgeText={isConnected ? "Realtime Auction • Tactical 2D Match Engine" : "Connecting to game server…"}
        title="FOOTBALL"
        titleLine2="AUCTION LEAGUE"
        description="Draft elite players, build your 11-player squad, outbid rival managers, set your tactics, and play the season."
        primaryButtonText="Solo Play"
        secondaryButtonText="Create Lobby"
        ctaButtonText="Join Lobby"
        onPrimaryClick={() => {
          setActiveModal('solo');
          setManagerName(savedSession?.managerName || '');
        }}
        onSecondaryClick={() => {
          setActiveModal('create');
          setManagerName(savedSession?.managerName || '');
        }}
        onCtaClick={() => {
          setActiveModal('join');
          setManagerName(savedSession?.managerName || '');
        }}
      />

      {savedSession && (
        <div className="relative z-20 -mt-8 mx-auto mb-8 w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-emerald-400/20 bg-[#07110f]/95 p-4 shadow-2xl backdrop-blur-xl sm:w-full">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
                Active Lobby Session
              </div>
              <div className="mt-1 truncate text-sm font-bold text-white">
                {savedSession.managerName} · Room {savedSession.roomCode}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onResumeSession(savedSession.roomCode, savedSession.managerName)}
              className="shrink-0 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300"
            >
              Rejoin
            </button>
          </div>
        </div>
      )}

      <footer className="relative z-10 border-t border-white/5 bg-[#02040a] px-5 py-5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/30 sm:flex sm:items-center sm:justify-between sm:text-left">
        <span>11-player tactical auction league</span>
        <span className="mt-2 block text-emerald-400/70 sm:mt-0">Made by Irvix</span>
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
