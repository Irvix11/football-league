import React, { useState, useEffect, useRef } from 'react';
import { GameRoom, Player } from '../types/football';
import { FORMATIONS_CONFIG, getFormationStarterCategoryCounts, getFormationSquadCategoryLimits } from '../constants/formations';
import { PlayerCard } from './PlayerCard';
import { PitchGraphic } from './PitchGraphic';
import { PlayerPitchMarker } from './PlayerPitchMarker';
import { sound } from '../utils/audio';
import confetti from 'canvas-confetti';
import { Gavel, Clock, Lock, Sparkles, CheckCircle2, ArrowRight, AlertTriangle, Shield } from 'lucide-react';

interface LiveAuctionViewProps {
  room: GameRoom;
  managerId: string;
  onPlaceBid: (amount: number) => void;
  onSubmitBlindBid: (amount: number) => void;
}

export const LiveAuctionView: React.FC<LiveAuctionViewProps> = ({
  room,
  managerId,
  onPlaceBid,
  onSubmitBlindBid,
}) => {
  const currentManager = room.managers.find((m) => m.id === managerId);
  const auction = room.auction;
  const player = auction.currentPlayer;
  const isBlind = room.settings.auctionMode === 'Blind';

  const [customBidInput, setCustomBidInput] = useState('');
  const [blindBidInput, setBlindBidInput] = useState('');

  // Bid animation tracking
  const prevBidRef = useRef(auction.currentBid);
  const prevBidderRef = useRef(auction.highestBidderId);
  const [bidUpdated, setBidUpdated] = useState(false);
  const [wasOutbid, setWasOutbid] = useState(false);

  // Detect new bid or outbid
  useEffect(() => {
    if (auction.currentBid !== prevBidRef.current) {
      setBidUpdated(true);
      const timer = setTimeout(() => setBidUpdated(false), 900);

      // Check if current user was previously winning and got outbid
      if (prevBidderRef.current === managerId && auction.highestBidderId !== managerId && !auction.isSold) {
        setWasOutbid(true);
        sound.playWhistle();
        const outbidTimer = setTimeout(() => setWasOutbid(false), 3500);
        return () => clearTimeout(outbidTimer);
      }

      prevBidRef.current = auction.currentBid;
      prevBidderRef.current = auction.highestBidderId;
      return () => clearTimeout(timer);
    }
  }, [auction.currentBid, auction.highestBidderId, auction.isSold, managerId]);

  // Audio & confetti on SOLD
  useEffect(() => {
    if (auction.isSold && auction.winnerId) {
      sound.playGavel();
      if (auction.winnerId === managerId) {
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#10b981', '#fbbf24', '#38bdf8'],
        });
      }
    }
  }, [auction.isSold, auction.winnerId, managerId]);

  // Audio tick on last 3 seconds
  useEffect(() => {
    if (auction.secondsRemaining > 0 && auction.secondsRemaining <= 3 && !auction.isSold) {
      sound.playTick();
    }
  }, [auction.secondsRemaining, auction.isSold]);

  if (!currentManager) return null;

  const formationConfig = FORMATIONS_CONFIG[currentManager.formation] || FORMATIONS_CONFIG['4-3-3'];
  const starterCategoryCounts = getFormationStarterCategoryCounts(currentManager.formation);
  const squadCategoryLimits = getFormationSquadCategoryLimits(currentManager.formation);

  // Current category counts for user's squad
  const categoryCounts = {
    GK: currentManager.squad.filter((s) => s.player.category === 'GK').length,
    DEF: currentManager.squad.filter((s) => s.player.category === 'DEF').length,
    MID: currentManager.squad.filter((s) => s.player.category === 'MID').length,
    ATT: currentManager.squad.filter((s) => s.player.category === 'ATT').length,
  };

  const isCategoryFull = player
    ? categoryCounts[player.category] >= squadCategoryLimits[player.category]
    : false;

  const minNextBid = auction.highestBidderId ? auction.currentBid + 1 : auction.currentBid;
  const canAfford = currentManager.budget >= minNextBid;
  const isSquadFull = currentManager.squad.length >= 18;
  const isWinning = auction.highestBidderId === managerId;

  const hasSubmittedSecret = Boolean(isBlind && auction.hasSubmittedSecretBid?.[managerId]);

  const handleCustomBid = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customBidInput, 10);
    if (!isNaN(val) && val >= minNextBid && val <= currentManager.budget) {
      onPlaceBid(val);
      setCustomBidInput('');
    }
  };

  const handleBlindBid = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(blindBidInput, 10);
    if (!isNaN(val) && val >= (player?.startingPrice || 10) && val <= currentManager.budget) {
      onSubmitBlindBid(val);
      setBlindBidInput('');
    }
  };

  // Map squad starters onto formation slots for the mini-pitch
  const slotAssignments: (Player | null)[] = formationConfig.slots.map((slot, index) => {
    const starter = currentManager.squad.find(
      (s) => s.isStarting && (s.startingSlotIndex === index || s.assignedPosition === slot.position)
    );
    return starter ? starter.player : null;
  });

  return (
    <div className="min-h-screen bg-[#040812] text-slate-100 p-3 sm:p-5 md:p-6 flex flex-col justify-between max-w-7xl mx-auto select-none">
      {/* Top Bar: Live Auction status, User budget, Team metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-900 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest font-black text-amber-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {room.settings.auctionMode.toUpperCase()} AUCTION
            </span>
            <span className="text-xs text-slate-500 font-mono">
              Lot {auction.currentPlayerIndex} / {auction.totalPlayersInPool}
            </span>
          </div>
          <h1 className="font-display font-black text-xl sm:text-2xl text-slate-100">
            LIVE BIDDING ARENA
          </h1>
        </div>

        {/* User Key Financial & Squad Stats */}
        <div className="flex items-center gap-4 bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl shadow-md">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">BUDGET</div>
            <div className="font-mono font-black text-emerald-400 text-lg sm:text-xl">£{currentManager.budget}M</div>
          </div>
          <div className="h-8 w-[1px] bg-slate-800" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">SQUAD</div>
            <div className="font-mono font-black text-slate-200 text-lg sm:text-xl">{currentManager.squad.length} / 18</div>
          </div>
          <div className="h-8 w-[1px] bg-slate-800" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">TEAM OVR</div>
            <div className="font-mono font-black text-amber-400 text-lg sm:text-xl">{currentManager.teamOverall}</div>
          </div>
        </div>
      </div>

      {/* Main 3-Column Layout:
          1. Current Lot & Dominant Bid Console (5 cols)
          2. Squad Mini Pitch with Real Player Tokens (4 cols)
          3. Room Managers & Activity Log (3 cols)
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 my-4 flex-1 items-start">
        {/* --- COLUMN 1: LIVE PLAYER CARD & BIDDING CONSOLE (5 cols) --- */}
        <div className="lg:col-span-5 space-y-4">
          {player ? (
            <div className="relative">
              {/* SOLD! OVERLAY ANIMATION & "PLAYER -> YOUR SQUAD" BANNER */}
              {auction.isSold && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-[#040812]/90 backdrop-blur-md rounded-2xl border-2 border-amber-400 animate-in fade-in zoom-in-95 duration-200 shadow-2xl">
                  {/* SOLD! Stamp */}
                  <div className="flex items-center gap-2 px-6 py-2 rounded-full bg-amber-400 text-slate-950 font-display font-black text-lg tracking-wider uppercase mb-3 shadow-xl shadow-amber-500/30 animate-bounce">
                    <Gavel className="w-5 h-5" />
                    <span>SOLD!</span>
                  </div>

                  <div className="text-xl sm:text-2xl font-black font-display text-white text-center">
                    {auction.winnerId === managerId ? (
                      <span className="text-emerald-400">SIGNING COMPLETE!</span>
                    ) : (
                      <span>{auction.highestBidderName || 'Manager'} WON</span>
                    )}
                  </div>

                  {/* Transition: PLAYER -> YOUR SQUAD */}
                  <div className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200 shadow-md">
                    <span className="text-amber-400 font-display">{player.name}</span>
                    <ArrowRight className="w-4 h-4 text-emerald-400" />
                    <span className={auction.winnerId === managerId ? 'text-emerald-400' : 'text-slate-400'}>
                      {auction.winnerId === managerId ? 'YOUR SQUAD' : `${auction.highestBidderName}'S SQUAD`}
                    </span>
                  </div>

                  <div className="text-sm font-mono text-emerald-400 mt-2 font-bold">
                    Final Price: £{auction.soldPrice}M
                  </div>
                </div>
              )}

              {/* Player Card (Reveal with subtle animation) */}
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <PlayerCard player={player} size="lg" />
              </div>

              {/* Live Bidding Console */}
              <div className="mt-4 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
                {/* Countdown & Status Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Clock
                      className={`w-4 h-4 ${
                        auction.secondsRemaining <= 4 ? 'text-rose-500 animate-bounce' : 'text-amber-400'
                      }`}
                    />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      COUNTDOWN
                    </span>
                  </div>

                  <div
                    className={`font-mono font-black text-2xl tracking-wider px-3 py-0.5 rounded-lg border ${
                      auction.secondsRemaining <= 4
                        ? 'text-rose-400 bg-rose-950/40 border-rose-500/50 animate-pulse'
                        : 'text-slate-100 bg-slate-950 border-slate-800'
                    }`}
                  >
                    00:{auction.secondsRemaining < 10 ? `0${auction.secondsRemaining}` : auction.secondsRemaining}
                  </div>
                </div>

                {/* Classic / Quick Bid Display */}
                {!isBlind ? (
                  <>
                    {/* VISUALLY DOMINANT CURRENT BID */}
                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          CURRENT BID
                        </div>
                        <div
                          className={`font-mono font-black text-3xl sm:text-4xl text-emerald-400 transition-all duration-200 ${
                            bidUpdated ? 'scale-110 text-amber-300' : ''
                          }`}
                        >
                          £{auction.currentBid}M
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          LEADING BIDDER
                        </div>
                        <div className="mt-1">
                          {isWinning ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-display font-black text-xs uppercase border border-emerald-500/40 shadow-sm shadow-emerald-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" /> YOU ARE WINNING
                            </span>
                          ) : (
                            <span className="font-bold text-sm text-slate-200">
                              {auction.highestBidderName || 'No Bids Yet'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* OUTBID WARNING BANNER */}
                    {wasOutbid && (
                      <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-bold flex items-center gap-2 animate-in shake duration-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>YOU WERE OUTBID! Increase your offer now to stay in the race.</span>
                      </div>
                    )}

                    {/* Bid Action Buttons */}
                    {isSquadFull ? (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center text-xs text-amber-400 font-semibold">
                        Your squad is full (18/18). You cannot bid on further players.
                      </div>
                    ) : isCategoryFull ? (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-center text-xs text-rose-400 font-semibold">
                        Max {player.category} limit reached for {currentManager.formation}.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-4 gap-2">
                          {[1, 5, 10, 25].map((inc) => {
                            const targetBid = auction.highestBidderId ? auction.currentBid + inc : auction.currentBid + inc - 1;
                            const possible = currentManager.budget >= targetBid;
                            return (
                              <button
                                key={inc}
                                type="button"
                                disabled={!possible || auction.isSold}
                                onClick={() => onPlaceBid(targetBid)}
                                className={`py-3 rounded-xl font-mono font-black text-xs transition-all duration-150 cursor-pointer active:scale-95 ${
                                  possible && !auction.isSold
                                    ? 'bg-slate-800 hover:bg-emerald-400 hover:text-slate-950 text-emerald-300 border border-slate-700/80 shadow-sm'
                                    : 'bg-slate-950 text-slate-600 border border-slate-900 cursor-not-allowed'
                                }`}
                              >
                                +£{inc}M
                              </button>
                            );
                          })}
                        </div>

                        {/* Custom Bid Input */}
                        <form onSubmit={handleCustomBid} className="flex gap-2">
                          <input
                            type="number"
                            min={minNextBid}
                            max={currentManager.budget}
                            disabled={!canAfford || auction.isSold}
                            placeholder={`Min £${minNextBid}M`}
                            value={customBidInput}
                            onChange={(e) => setCustomBidInput(e.target.value)}
                            className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-xs outline-none focus:border-emerald-500"
                          />
                          <button
                            type="submit"
                            disabled={!canAfford || auction.isSold}
                            className={`px-6 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all duration-150 active:scale-95 ${
                              canAfford && !auction.isSold
                                ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-500/20 cursor-pointer'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            PLACE BID
                          </button>
                        </form>
                      </div>
                    )}
                  </>
                ) : (
                  /* Blind Auction Controls */
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-slate-950 border border-amber-500/30 text-xs text-slate-300 flex items-start gap-2">
                      <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong>BLIND SECRET BID:</strong> All bids are strictly encrypted. The highest secret bid wins when the timer runs out!
                      </div>
                    </div>

                    {hasSubmittedSecret && (
                      <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/40 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-bold text-xs">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Secret Bid Submitted!</span>
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleBlindBid} className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={player.startingPrice}
                          max={currentManager.budget}
                          disabled={auction.isSold}
                          placeholder={`Min Starting Price: £${player.startingPrice}M`}
                          value={blindBidInput}
                          onChange={(e) => setBlindBidInput(e.target.value)}
                          className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-xs outline-none focus:border-amber-400"
                        />
                        <button
                          type="submit"
                          disabled={auction.isSold || !canAfford}
                          className="px-5 py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-amber-400 hover:bg-amber-300 text-slate-950 transition-all shadow-md shadow-amber-500/20 cursor-pointer active:scale-95"
                        >
                          SUBMIT BID
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
              <Sparkles className="w-8 h-8 text-emerald-400 mx-auto mb-2 animate-pulse" />
              <div className="text-sm font-bold text-slate-200">Preparing Next Player Lot...</div>
            </div>
          )}
        </div>

        {/* --- COLUMN 2: REAL MINI FOOTBALL PITCH (4 cols) --- */}
        {/* Requirement 6: Mini pitch with real player markers (Jersey # + OVR), readable on mobile, no permanent player names */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Squad Pitch ({currentManager.formation})
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">
              Starters: {currentManager.squad.filter((s) => s.isStarting).length} / 11
            </span>
          </div>

          {/* Mini Pitch with authentic player markers */}
          <PitchGraphic aspectRatio="vertical" className="p-3 shadow-xl">
            {formationConfig.slots.map((slot, index) => {
              const assignedPlayer = slotAssignments[index];
              return (
                <div
                  key={slot.index}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                  style={{
                    left: `${slot.x}%`,
                    top: `${slot.y}%`,
                  }}
                >
                  <PlayerPitchMarker
                    player={assignedPlayer}
                    positionLabel={slot.position}
                    slotIndex={slot.index}
                    size="sm"
                  />
                </div>
              );
            })}
          </PitchGraphic>

          {/* Formation-aware auction quota indicator */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400">
            <div className="flex items-center justify-between mb-2">
              <span className="font-black uppercase tracking-wider text-slate-300">Formation {currentManager.formation}</span>
              <span className="font-mono text-emerald-400">XI targets are exact</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(['GK', 'DEF', 'MID', 'ATT'] as const).map((cat) => (
                <div key={cat} className="text-center">
                  <div className="text-slate-500">{cat}</div>
                  <div className="font-mono font-black text-slate-200">{starterCategoryCounts[cat]}</div>
                  <div className="text-[9px] text-slate-600">XI · {squadCategoryLimits[cat]} squad</div>
                </div>
              ))}
            </div>
          </div>

          {/* Category Quotas Indicator */}
          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            {(['GK', 'DEF', 'MID', 'ATT'] as const).map((cat) => {
              const starterReq = starterCategoryCounts[cat];
              const squadMax = squadCategoryLimits[cat];
              const count = categoryCounts[cat];
              const isMax = count >= squadMax;
              return (
                <div
                  key={cat}
                  className={`p-2 rounded-xl border ${
                    isMax
                      ? 'bg-rose-950/20 border-rose-900/60 text-rose-300'
                      : count >= starterReq
                      ? 'bg-slate-950 border-emerald-900/40 text-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="text-[10px] text-slate-400 font-semibold">{cat}</div>
                  <div className="font-mono font-bold text-xs mt-0.5">
                    {count}/{squadMax}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* --- COLUMN 3: LEADERBOARD & RECENT SIGNINGS (3 cols) --- */}
        <div className="lg:col-span-3 space-y-4">
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 shadow-lg">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Managers in Auction ({room.managers.length})
            </h3>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {room.managers.map((m) => {
                const isMe = m.id === managerId;
                return (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                      isMe ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-slate-950 border-slate-800/80'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-200 truncate max-w-[110px]">
                        {m.name} {isMe && '(You)'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {m.squad.length}/18 Players · OVR {m.teamOverall}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-emerald-400">£{m.budget}M</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Auction History */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 shadow-lg">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Recent Signings ({auction.auctionHistory.length})
            </h3>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {auction.auctionHistory.length === 0 ? (
                <div className="text-xs text-slate-500 py-3 text-center">No players signed yet.</div>
              ) : (
                auction.auctionHistory.slice().reverse().map((item) => (
                  <div key={item.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 truncate">{item.playerName}</span>
                      <span className="font-mono font-bold text-emerald-400">£{item.price}M</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      Signed by <strong className="text-slate-300">{item.winnerName}</strong>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
