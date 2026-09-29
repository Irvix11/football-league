import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Fixture, MatchEvent, LivePlayerPosition, PenaltyKickResult } from '../types/football';
import { sound } from '../utils/audio';
import { 
  Play, Pause, SkipForward, RotateCcw, 
  Volume2, VolumeX, Activity, ChevronRight,
  Flame, Award, Star, X, BarChart2
} from 'lucide-react';

interface LiveMatchEngineProps {
  fixture: Fixture;
  roomCode?: string;
  userTeamId?: string;
  reconnectToken?: string;
  onMatchComplete?: (fixtureId: string) => void;
  className?: string;
}

interface GoalOverlayState {
  scorer: string;
  scorerNumber?: number;
  assist?: string;
  team: 'home' | 'away';
  teamName: string;
  minute: number;
  second?: number;
  score: { home: number; away: number };
}

interface InspectedPlayerState {
  player: LivePlayerPosition;
  screenX: number;
  screenY: number;
}


/**
 * Smooth cubic easing function for realistic player and ball acceleration/deceleration.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export const LiveMatchEngine: React.FC<LiveMatchEngineProps> = ({
  fixture,
  roomCode,
  userTeamId,
  reconnectToken,
  onMatchComplete,
  className = '',
}) => {
  const [loadedEvents, setLoadedEvents] = useState<MatchEvent[] | null>(() =>
    fixture.events?.length ? fixture.events : null
  );

  useEffect(() => {
    let cancelled = false;
    setLoadedEvents(fixture.events?.length ? fixture.events : null);
    if (fixture.events?.length || !roomCode || !userTeamId) return;
    const base = (import.meta.env.VITE_GAME_SERVER_URL?.trim() || window.location.origin).replace(/\/$/, '');
    fetch(`${base}/api/room/${encodeURIComponent(roomCode)}/fixture/${encodeURIComponent(fixture.id)}/events`, {
      headers: {
        'X-Manager-Id': userTeamId,
        ...(reconnectToken ? { Authorization: `Bearer ${reconnectToken}` } : {}),
      },
      cache: 'no-store',
    })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!cancelled && Array.isArray(payload?.events)) setLoadedEvents(payload.events as MatchEvent[]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [fixture.id, fixture.events, roomCode, userTeamId, reconnectToken]);

  const events = useMemo(() => loadedEvents || fixture.events || [], [loadedEvents, fixture.events]);
  const [currentEventIndex, setCurrentEventIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 4x
  const [, forceSoundUpdate] = useState(0);

  // Overlays
  const [goalOverlay, setGoalOverlay] = useState<GoalOverlayState | null>(null);
  const [halfTimeOverlay, setHalfTimeOverlay] = useState<boolean>(false);
  const [fullTimeOverlay, setFullTimeOverlay] = useState<boolean>(false);
  const [showStatsModal, setShowStatsModal] = useState<boolean>(false);
  const [scorePulse, setScorePulse] = useState<'home' | 'away' | null>(null);
  const [penaltyIndex, setPenaltyIndex] = useState(0);
  const [showPenaltyShootout, setShowPenaltyShootout] = useState(false);
  // Penalty shootouts deliberately use a slow, broadcast-style reveal sequence.
  // The result is hidden until the kicker/keeper animation has played out.
  const [penaltyRevealStage, setPenaltyRevealStage] = useState<'walkup' | 'strike' | 'result'>('walkup');

  const penaltySequence = fixture.penaltyShootout || [];
  const currentPenalty = penaltySequence[penaltyIndex];
  const completedPenalties = penaltySequence.slice(0, penaltyIndex);
  const penaltyDiveDirection = useMemo(() => {
    if (!currentPenalty) return 0;
    const hash = [...currentPenalty.takerId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return (hash % 3) - 1;
  }, [currentPenalty]);
  const penaltyIsOver = penaltyIndex >= penaltySequence.length && penaltySequence.length > 0;

  // Keep every penalty slow and tense: walk-up -> strike -> result.
  // This effect intentionally ignores playback speed so penalties can never be rushed.
  useEffect(() => {
    if (!showPenaltyShootout || !currentPenalty || penaltyIsOver) return;

    setPenaltyRevealStage('walkup');
    const strikeTimer = window.setTimeout(() => {
      setPenaltyRevealStage('strike');
    }, playbackSpeed >= 2 ? 900 : 2200);
    const resultTimer = window.setTimeout(() => {
      setPenaltyRevealStage('result');
    }, playbackSpeed >= 2 ? 2100 : 4800);

    return () => {
      window.clearTimeout(strikeTimer);
      window.clearTimeout(resultTimer);
    };
  }, [showPenaltyShootout, penaltyIndex, penaltyIsOver, playbackSpeed]);

  // Interactive Player Inspection Tooltip (Tap on player)
  const [inspectedPlayer, setInspectedPlayer] = useState<InspectedPlayerState | null>(null);

  // Synchronized Match Clock state (minutes and seconds)
  const [displaySeconds, setDisplaySeconds] = useState<number>(0);

  // Animation Engine state (Real Continuous Smooth Interpolation)
  const [animatedPlayers, setAnimatedPlayers] = useState<LivePlayerPosition[]>([]);
  const pitchRef = useRef<HTMLDivElement | null>(null);
  const playerNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const ballNodeRef = useRef<HTMLDivElement | null>(null);
  const ballShadowRef = useRef<HTMLDivElement | null>(null);
  const visualPlayerCoordsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const visualBallCoordsRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  // Subtle broadcast camera offset for dynamic action focus (Requirement 14)
  const [cameraOffset, setCameraOffset] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });

  // Animation loop refs
  const animationFrameRef = useRef<number | null>(null);
  const phaseStartTimeRef = useRef<number>(performance.now());
  const startPlayersRef = useRef<LivePlayerPosition[]>([]);
  const targetPlayersRef = useRef<LivePlayerPosition[]>([]);
  const startBallRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  const targetBallRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });
  const startClockSecsRef = useRef<number>(0);
  const targetClockSecsRef = useRef<number>(0);
  const goalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clockUiUpdateRef = useRef<number>(0);

  // Initialize only when the fixture/timeline actually changes. Room polling and
  // WebSocket resyncs replace the fixture object every few seconds; resetting the
  // playback cursor on every object identity change made the score visibly jump
  // back to 0-0 during a live simulation.
  const timelineKey = `${fixture.id}:${events.length}:${events[0]?.id || ''}:${events[events.length - 1]?.id || ''}`;
  const timelineKeyRef = useRef<string>('');

  useEffect(() => {
    if (timelineKeyRef.current === timelineKey) return;
    timelineKeyRef.current = timelineKey;
    setCurrentEventIndex(0);
    setGoalOverlay(null);
    setHalfTimeOverlay(false);
    setFullTimeOverlay(false);
    setShowStatsModal(false);
    setPenaltyIndex(0);
    setShowPenaltyShootout(false);
    setPenaltyRevealStage('walkup');
    setIsPlaying(true);
    setScorePulse(null);
    setInspectedPlayer(null);

    const firstEvent = events[0];
    if (firstEvent) {
      const initialSeparated = firstEvent.playerCoordinates || [];
      startPlayersRef.current = initialSeparated;
      targetPlayersRef.current = initialSeparated;
      setAnimatedPlayers(initialSeparated);
      visualPlayerCoordsRef.current.clear();
      initialSeparated.forEach(p => visualPlayerCoordsRef.current.set(p.id, { x: p.x, y: p.y }));

      const bPos = firstEvent.ballCoordinates || { x: 50, y: 50 };
      startBallRef.current = bPos;
      targetBallRef.current = bPos;
      visualBallCoordsRef.current = { x: bPos.x, y: bPos.y };

      const firstSecs = (firstEvent.minute || 0) * 60 + (firstEvent.second || 0);
      startClockSecsRef.current = firstSecs;
      targetClockSecsRef.current = firstSecs;
      setDisplaySeconds(firstSecs);
    }
  }, [timelineKey, fixture.id]);

  const currentEvent: MatchEvent | undefined = events[currentEventIndex] || events[0];

  // Derive live score from the current event
  const currentScore = currentEvent?.currentScore || {
    home: fixture.played ? (fixture.homeScore || 0) : 0,
    away: fixture.played ? (fixture.awayScore || 0) : 0,
  };

  const liveStats = useMemo(() => {
    const home = { possession: 50, shots: 0, shotsOnTarget: 0, goals: 0 };
    const away = { possession: 50, shots: 0, shotsOnTarget: 0, goals: 0 };
    const upto = Math.min(currentEventIndex, Math.max(0, events.length - 1));
    const included = events.slice(0, upto + 1);
    for (const event of included) {
      const stats = event.team === 'home' ? home : away;
      if (['shot', 'shot_saved', 'shot_missed', 'shot_blocked', 'goal'].includes(event.type)) {
        stats.shots += 1;
      }
      if (['shot_saved', 'goal'].includes(event.type)) {
        stats.shotsOnTarget += 1;
      }
      if (event.type === 'goal') stats.goals += 1;
    }

    const possessionSeconds = { home: 0, away: 0 };
    for (let i = 0; i < upto; i++) {
      const current = events[i];
      const next = events[i + 1];
      const duration = Math.max(
        0,
        (next.minute * 60 + (next.second || 0)) -
        (current.minute * 60 + (current.second || 0))
      );
      if (current.team === 'home' || current.team === 'away') {
        possessionSeconds[current.team] += duration;
      }
    }
    const total = possessionSeconds.home + possessionSeconds.away;
    if (total > 0) {
      home.possession = Math.round((possessionSeconds.home / total) * 100);
      away.possession = 100 - home.possession;
    }
    return { home, away };
  }, [events, currentEventIndex]);

  // Duration in milliseconds for current event animation
  const getEventDuration = useCallback((ev?: MatchEvent) => {
    if (!ev) return 1200;
    let base = 1200;
    if (ev.type === 'goal') base = 2000;
    else if (ev.type === 'shot' || ev.type === 'shot_saved') base = 1500;
    else if (ev.type === 'cross' || ev.type === 'corner') base = 1400;
    else if (ev.type === 'tackle') base = 1300;
    else if (ev.type === 'pass') base = 1000;
    return Math.max(250, base / playbackSpeed);
  }, [playbackSpeed]);

  // When currentEventIndex changes, configure start and target positions
  useEffect(() => {
    if (!currentEvent) return;

    // The target players are separated to guarantee ZERO overlap
    const targetSeparated = currentEvent.playerCoordinates?.length
      ? currentEvent.playerCoordinates
      : (targetPlayersRef.current.length ? targetPlayersRef.current : animatedPlayers);

    // Start from the exact last rendered positions so the next event never teleports.
    startPlayersRef.current = targetSeparated.map(target => {
      const visual = visualPlayerCoordsRef.current.get(target.id);
      return visual ? { ...target, x: visual.x, y: visual.y } : target;
    });
    targetPlayersRef.current = targetSeparated;
    setAnimatedPlayers(targetSeparated);

    // Start the ball from the exact last rendered position when available.
    startBallRef.current = currentEvent.ballStartCoordinates || visualBallCoordsRef.current;
    targetBallRef.current = currentEvent.ballCoordinates || { x: 50, y: 50 };

    // Synchronize clock endpoints for smooth interpolation
    startClockSecsRef.current = displaySeconds;
    const targetClockSecs = (currentEvent.minute || 0) * 60 + (currentEvent.second || 0);
    targetClockSecsRef.current = Math.max(startClockSecsRef.current, targetClockSecs);

      // Keep the pitch at a fixed viewport scale. The old broadcast camera
    // briefly changed the entire pitch to 1.025x during shots/goals, which
    // looked like the iPad screen itself was zooming in and out.
    setCameraOffset({ x: 0, y: 0, scale: 1 });

    phaseStartTimeRef.current = performance.now();

    if (currentEvent.type === 'goal') {
      setScorePulse(currentEvent.team);
      setTimeout(() => setScorePulse(null), 1800);
    }
  }, [currentEventIndex]);

  // Dismiss half-time overlay and resume 2nd half
  const dismissHalfTimeOverlay = () => {
    setHalfTimeOverlay(false);
    setIsPlaying(true);
    if (currentEventIndex < events.length - 1) {
      setCurrentEventIndex(prev => prev + 1);
    }
  };

  const advanceToNextEvent = useCallback(() => {
    if (currentEventIndex >= events.length - 1) {
      setIsPlaying(false);
      return;
    }
    const nextIndex = currentEventIndex + 1;
    const nextEvent = events[nextIndex];
    if (nextEvent.type === 'goal' && sound.enabled) sound.playGoal();
    if (nextEvent.type === 'penalty_shootout_start') {
      if (sound.enabled) sound.playWhistle();
      setCurrentEventIndex(nextIndex);
      setPenaltyIndex(0);
      setPenaltyRevealStage('walkup');
      setShowPenaltyShootout(true);
      setIsPlaying(false);
      return;
    }
    if (nextEvent.type === 'halftime') {
      if (sound.enabled) sound.playWhistle();
      setCurrentEventIndex(nextIndex);
      setHalfTimeOverlay(true);
      setIsPlaying(false);
      return;
    }
    if (nextEvent.type === 'fulltime') {
      if (sound.enabled) sound.playWhistle();
      setCurrentEventIndex(nextIndex);
      if (fixture.wentToPenalties && penaltySequence.length > 0) {
        setPenaltyIndex(0);
        setPenaltyRevealStage('walkup');
        setShowPenaltyShootout(true);
        setFullTimeOverlay(false);
      } else {
        setFullTimeOverlay(true);
      }
      setIsPlaying(false);
      return;
    }
    setCurrentEventIndex(nextIndex);
    setIsPlaying(true);
  }, [currentEventIndex, events, fixture.wentToPenalties, penaltySequence.length]);

  // Continuous 60fps RequestAnimationFrame Loop
  useEffect(() => {
    let active = true;

    const animateFrame = (now: number) => {
      if (!active) return;

      const duration = getEventDuration(currentEvent);
      const elapsed = now - phaseStartTimeRef.current;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      const easedT = easeInOutCubic(progress);

      // 1. Smoothly interpolate all 22 player positions
      const starts = startPlayersRef.current;
      const targets = targetPlayersRef.current;
      const pitch = pitchRef.current;
      const width = pitch?.clientWidth || 0;
      const height = pitch?.clientHeight || 0;

      if (targets.length > 0) {
        for (const target of targets) {
          const start = starts.find(s => s.id === target.id) || target;
          const currX = start.x + (target.x - start.x) * easedT;
          const currY = start.y + (target.y - start.y) * easedT;
          const node = playerNodesRef.current.get(target.id);
          visualPlayerCoordsRef.current.set(target.id, { x: currX, y: currY });
          if (node && width > 0 && height > 0) {
            node.style.left = `${currX}%`;
            node.style.top = `${currY}%`;
            node.style.transform = 'translate(-50%, -50%)';
          }
        }
      }

      // 2. Smoothly interpolate ball position & parabolic height arc
      const sBall = startBallRef.current;
      const tBall = targetBallRef.current;
      const bCurrX = sBall.x + (tBall.x - sBall.x) * easedT;
      const bCurrY = sBall.y + (tBall.y - sBall.y) * easedT;

      const isHighBall = currentEvent?.type === 'cross' || currentEvent?.type === 'corner';
      const isGroundPass = currentEvent?.type === 'pass';
      const maxArc = isHighBall ? 4.5 : isGroundPass ? 1.0 : 2.5;
      const arc = Math.sin(progress * Math.PI) * maxArc;

      visualBallCoordsRef.current = { x: bCurrX, y: bCurrY };
      if (pitch && width > 0 && height > 0 && ballNodeRef.current) {
        ballNodeRef.current.style.transform = `translate3d(${(bCurrX / 100) * width}px, ${((bCurrY - arc) / 100) * height}px, 0)`;
        if (ballShadowRef.current) {
          const shadowScale = Math.max(0.55, 1 - arc * 0.08);
          ballShadowRef.current.style.transform = `translate3d(-50%, -50%, 0) scaleX(${shadowScale})`;
          ballShadowRef.current.style.opacity = String(Math.max(0.16, 0.62 - arc * 0.08));
        }
      }

      // Update the visible clock at a low cadence; movement itself remains frame-perfect.
      const sSecs = startClockSecsRef.current;
      const tSecs = targetClockSecsRef.current;
      const currentInterpolatedSecs = Math.round(sSecs + (tSecs - sSecs) * easedT);
      if (now - (clockUiUpdateRef.current || 0) > 80 || progress >= 1) {
        clockUiUpdateRef.current = now;
        setDisplaySeconds(currentInterpolatedSecs);
      }

      // 4. Event completion check (Requirements 4, 5: Goal Pause Mechanic)
      if (progress >= 1 && isPlaying && !halfTimeOverlay && !fullTimeOverlay && !showPenaltyShootout) {
        // Did the active event just finish a GOAL?
        if (currentEvent?.type === 'goal') {
          // Goal overlay is visual-only. Do not pause the match timeline.
          // The next event starts immediately so goal announcements never stall
          // the live 2D simulation.
          const teamName = currentEvent.team === 'home' ? fixture.homeManagerName : fixture.awayManagerName;
          const currentSc = currentEvent.currentScore || {
            home: currentScore.home,
            away: currentScore.away,
          };

          setGoalOverlay({
            scorer: currentEvent.playerName,
            scorerNumber: currentEvent.playerNumber || 9,
            assist: currentEvent.assistPlayerName,
            team: currentEvent.team,
            teamName,
            minute: currentEvent.minute,
            second: currentEvent.second,
            score: currentSc,
          });

          if (goalTimerRef.current) clearTimeout(goalTimerRef.current);
          goalTimerRef.current = setTimeout(() => {
            setGoalOverlay(null);
            setCameraOffset({ x: 0, y: 0, scale: 1 });
          }, Math.max(500, 1200 / playbackSpeed));

          advanceToNextEvent();
          return;
        }

        // Current event animation finished; one advance path handles every event boundary.
        advanceToNextEvent();
      }

      if (isPlaying && !halfTimeOverlay && !fullTimeOverlay && !showPenaltyShootout) {
        animationFrameRef.current = requestAnimationFrame(animateFrame);
      }
    };

    if (isPlaying && !halfTimeOverlay && !fullTimeOverlay) {
      animationFrameRef.current = requestAnimationFrame(animateFrame);
    }

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    isPlaying, currentEventIndex, events, playbackSpeed, 
    goalOverlay, halfTimeOverlay, fullTimeOverlay, showPenaltyShootout, getEventDuration,
    fixture, advanceToNextEvent, onMatchComplete, currentScore, currentEvent
  ]);

  const handleTogglePlay = () => {
    if (currentEventIndex >= events.length - 1) {
      setCurrentEventIndex(0);
      setGoalOverlay(null);
      setHalfTimeOverlay(false);
      setFullTimeOverlay(false);
      setShowPenaltyShootout(false);
      setPenaltyIndex(0);
      setPenaltyRevealStage('walkup');
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
      phaseStartTimeRef.current = performance.now();
    }
  };

  const handleSkipToNextEvent = () => {
    setGoalOverlay(null);
    advanceToNextEvent();
    phaseStartTimeRef.current = performance.now();
  };

  const handleSkipToFullTime = () => {
    if (events.length > 0) {
      const lastIndex = events.length - 1;
      setCurrentEventIndex(lastIndex);
      setIsPlaying(false);
      setGoalOverlay(null);
      setHalfTimeOverlay(false);
      if (fixture.wentToPenalties && penaltySequence.length > 0) {
        setPenaltyIndex(0);
        setShowPenaltyShootout(true);
        setFullTimeOverlay(false);
      } else {
        setFullTimeOverlay(true);
      }
      const lastEv = events[lastIndex];
      const endSecs = (lastEv.minute || 90) * 60 + (lastEv.second || 0);
      setDisplaySeconds(endSecs);
      if (sound.enabled) sound.playWhistle();
      // Keep the match engine mounted at full-time. The CONTINUE button
      // below is the single action that advances the server-side competition.
    }
  };

  const handleRestart = () => {
    setCurrentEventIndex(0);
    setGoalOverlay(null);
    setHalfTimeOverlay(false);
    setFullTimeOverlay(false);
    setShowPenaltyShootout(false);
    setPenaltyIndex(0);
    setPenaltyRevealStage('walkup');
    setIsPlaying(true);
    phaseStartTimeRef.current = performance.now();
    const firstEvent = events[0];
    const firstSecs = (firstEvent?.minute || 0) * 60 + (firstEvent?.second || 0);
    setDisplaySeconds(firstSecs);
  };

  // Clock string calculation (strictly synchronized with current event)
  const clockMin = Math.floor(displaySeconds / 60);
  const clockSec = displaySeconds % 60;
  const formattedTime = `${String(clockMin).padStart(2, '0')}:${String(clockSec).padStart(2, '0')}`;
  const isHalfTime = currentEvent?.type === 'halftime' || (clockMin === 45 && clockSec === 0 && halfTimeOverlay);
  // Only a real full-time timeline event is full time. Extra-time events can
  // legitimately reach 120:xx without disabling the full-time control early.
  const isFullTime = currentEvent?.type === 'fulltime' || (
    currentEventIndex >= events.length - 1 && currentEvent?.type !== 'halftime'
  );
  const isExtraTime = fixture.wentToExtraTime && clockMin > 90 && !isFullTime;
  const clockLabel = isExtraTime ? `ET ${formattedTime}` : isFullTime ? `FT ${formattedTime}` : formattedTime;

  // Active ball carrier identification for glowing possession ring
  const activeCarrierId = useMemo(() => {
    if (currentEvent?.type === 'pass') return currentEvent.targetPlayerId || currentEvent.playerId;
    return currentEvent?.playerId;
  }, [currentEvent]);
  const inspectedVisual = inspectedPlayer ? visualPlayerCoordsRef.current.get(inspectedPlayer.player.id) : null;
  const inspectedRect = pitchRef.current?.getBoundingClientRect();
  const inspectedScreenX = inspectedRect && inspectedVisual ? inspectedRect.left + (inspectedVisual.x / 100) * inspectedRect.width : inspectedPlayer?.screenX;
  const inspectedScreenY = inspectedRect && inspectedVisual ? inspectedRect.top + (inspectedVisual.y / 100) * inspectedRect.height : inspectedPlayer?.screenY;

  // Recalculate the inspected player's screen position after rotation/resize.
  // The pitch uses percentage coordinates, so the tooltip must not retain stale
  // pixel coordinates from before the viewport changed.
  useEffect(() => {
    if (!inspectedPlayer || typeof ResizeObserver === 'undefined') return;
    const pitch = pitchRef.current;
    if (!pitch) return;
    const refreshTooltip = () => setInspectedPlayer(current => current ? { ...current } : current);
    const observer = new ResizeObserver(refreshTooltip);
    observer.observe(pitch);
    window.addEventListener('orientationchange', refreshTooltip);
    window.addEventListener('resize', refreshTooltip);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', refreshTooltip);
      window.removeEventListener('resize', refreshTooltip);
    };
  }, [inspectedPlayer?.player.id]);

  useEffect(() => {
    setInspectedPlayer(null);
  }, [currentEventIndex]);

  return (
    <div className={`flex flex-col space-y-3 ${className}`}>
      {/* ========================================================================= */}
      {/* 1. BROADCAST SCOREBOARD (Requirement 7: HOME TEAM 2  20:12  1 AWAY TEAM)   */}
      {/* ========================================================================= */}
      <div className="bg-[#050b14]/98 border border-slate-800 rounded-2xl px-3 sm:px-4 py-2.5 shadow-xl backdrop-blur-md select-none">
        <div className="grid grid-cols-12 items-center gap-2">
          {/* HOME TEAM (Left, 5 cols) */}
          <div className="col-span-5 flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-display font-black text-xs text-emerald-400 shrink-0 shadow-sm">
              {fixture.homeManagerName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1">
                <span>HOME</span>
                {userTeamId === fixture.homeManagerId && (
                  <span className="text-[8px] px-1 bg-emerald-500/30 text-emerald-300 rounded font-mono font-bold">YOU</span>
                )}
              </div>
              <div className="font-display font-black text-xs sm:text-sm text-slate-100 truncate" title={fixture.homeManagerName}>
                {fixture.homeManagerName}
              </div>
            </div>
            {/* Home Score */}
            <span
              className={`font-mono font-black text-2xl sm:text-3xl text-slate-100 shrink-0 ml-1 transition-transform duration-200 ${
                scorePulse === 'home' ? 'text-emerald-400 scale-125' : ''
              }`}
            >
              {currentScore.home}
            </span>
          </div>

          {/* CENTER: BROADCAST CLOCK PILL (2 cols) */}
          <div className="col-span-2 flex flex-col items-center justify-center">
            <div className="px-2.5 py-1 rounded-full bg-slate-950 border border-slate-700 text-[11px] sm:text-xs font-mono font-black text-amber-400 shadow-inner flex items-center gap-1.5 tracking-wider whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span>{isFullTime ? clockLabel : isHalfTime ? `HT ${formattedTime}` : clockLabel}</span>
            </div>
          </div>

          {/* AWAY TEAM (Right, 5 cols) */}
          <div className="col-span-5 flex items-center justify-end gap-2 sm:gap-2.5 min-w-0 text-right">
            {/* Away Score */}
            <span
              className={`font-mono font-black text-2xl sm:text-3xl text-slate-100 shrink-0 mr-1 transition-transform duration-200 ${
                scorePulse === 'away' ? 'text-sky-400 scale-125' : ''
              }`}
            >
              {currentScore.away}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] uppercase font-bold tracking-wider text-sky-400 flex items-center justify-end gap-1">
                {userTeamId === fixture.awayManagerId && (
                  <span className="text-[8px] px-1 bg-sky-500/30 text-sky-300 rounded font-mono font-bold">YOU</span>
                )}
                <span>AWAY</span>
              </div>
              <div className="font-display font-black text-xs sm:text-sm text-slate-100 truncate" title={fixture.awayManagerName}>
                {fixture.awayManagerName}
              </div>
            </div>
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center font-display font-black text-xs text-sky-400 shrink-0 shadow-sm">
              {fixture.awayManagerName.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Possession & Momentum Bar */}
        <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span className="text-emerald-400 font-semibold">{liveStats.home.possession}% Possession</span>
          <div className="w-24 sm:w-44 h-1 bg-slate-950 rounded-full overflow-hidden flex mx-2 border border-slate-800/60">
            <div 
              className="bg-emerald-500 h-full transition-all duration-300" 
              style={{ width: `${liveStats.home.possession}%` }}
            />
            <div 
              className="bg-sky-500 h-full transition-all duration-300" 
              style={{ width: `${100 - (liveStats.home.possession)}%` }}
            />
          </div>
          <span className="text-sky-400 font-semibold">{100 - (liveStats.home.possession)}% Possession</span>
        </div>
      </div>

      {/* 2. THE 2D LIVE FOOTBALL PITCH (Broadcast Arena)                           */}
      {/* ========================================================================= */}
      <div 
        className="relative w-full rounded-2xl overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.38)] border border-white/10 bg-emerald-950 select-none live-match-pitch-enter"
        style={{
          transform: `translate(${cameraOffset.x}%, ${cameraOffset.y}%)`,
        }}
      >
        <div
          ref={pitchRef}
          className="relative w-full overflow-hidden live-pitch-surface"
          style={{ aspectRatio: '105 / 68' }}
        >
          {/* Alternating lawn mowing stripes (12 vertical turf bands) */}
          <div className="absolute inset-0 flex pointer-events-none">
            {Array.from({ length: 12 }).map((_, i) => (
              <div 
                key={i} 
                className={`flex-1 h-full ${i % 2 === 0 ? 'bg-[#064e3b]' : 'bg-[#065f46]'} opacity-95`} 
              />
            ))}
          </div>

          {/* Stadium Floodlight Radial Vignette */}
          <div className="absolute inset-0 pointer-events-none bg-radial from-emerald-400/10 via-transparent to-black/50" />

          {/* Crisp Pitch Markings SVG */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            fill="none"
            stroke="rgba(255, 255, 255, 0.45)"
            strokeWidth="0.8"
          >
            {/* Outer Pitch Boundary */}
            <rect x="3.5" y="4.5" width="93" height="91" rx="1.5" />

            {/* Halfway line */}
            <line x1="50" y1="4.5" x2="50" y2="95.5" strokeDasharray="none" />

            {/* Center Circle & Spot */}
            <circle cx="50" cy="50" r="10.5" />
            <circle cx="50" cy="50" r="0.8" fill="rgba(255, 255, 255, 0.9)" />

            {/* LEFT GOAL & PENALTY AREA (Home defending left) */}
            <rect x="3.5" y="24" width="16.5" height="52" />
            <rect x="3.5" y="36.5" width="6" height="27" />
            <circle cx="14.5" cy="50" r="0.8" fill="rgba(255, 255, 255, 0.9)" />
            <path d="M 20 39.5 A 10.5 10.5 0 0 1 20 60.5" />

            {/* RIGHT GOAL & PENALTY AREA (Away defending right) */}
            <rect x="80" y="24" width="16.5" height="52" />
            <rect x="90.5" y="36.5" width="6" height="27" />
            <circle cx="85.5" cy="50" r="0.8" fill="rgba(255, 255, 255, 0.9)" />
            <path d="M 80 39.5 A 10.5 10.5 0 0 0 80 60.5" />

            {/* Corner Arcs */}
            <path d="M 3.5 7.5 A 3 3 0 0 0 6.5 4.5" />
            <path d="M 3.5 92.5 A 3 3 0 0 1 6.5 95.5" />
            <path d="M 96.5 7.5 A 3 3 0 0 1 93.5 4.5" />
            <path d="M 96.5 92.5 A 3 3 0 0 0 93.5 95.5" />

            {/* Goals */}
            <rect x="1" y="42" width="2.5" height="16" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.95)" strokeWidth="1" />
            <rect x="96.5" y="42" width="2.5" height="16" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.95)" strokeWidth="1" />
          </svg>

          {/* Goal Net Flash Ping on Goal */}
          {currentEvent?.type === 'goal' && (
            <div 
              className={`absolute top-[42%] w-7 h-[16%] rounded-sm animate-ping pointer-events-none ${
                currentEvent.team === 'home' ? 'right-0 bg-emerald-400/50' : 'left-0 bg-sky-400/50'
              }`} 
            />
          )}

          {/* 3. 22 PLAYERS (ONLY JERSEY NUMBERS - NO PERMANENT NAMES ON PITCH!) */}
          {animatedPlayers.map((player) => {
            const isHome = player.team === 'home';
            const isGK = player.category === 'GK' || player.position === 'GK';
            const hasBall = player.hasBall || player.id === activeCarrierId;
            const isScorer = currentEvent?.type === 'goal' && player.id === currentEvent?.playerId;

            // Team Kit Color
            const kitStyle = isGK
              ? isHome 
                ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 border-amber-200 shadow-amber-500/30' 
                : 'bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white border-fuchsia-200 shadow-pink-500/30'
              : isHome
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white border-emerald-300 shadow-emerald-500/30'
                : 'bg-gradient-to-br from-sky-400 to-blue-600 text-white border-sky-200 shadow-sky-500/30';

            return (
              <div
                key={player.id}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setInspectedPlayer({
                    player,
                    screenX: rect.left + rect.width / 2,
                    screenY: rect.top - 10,
                  });
                }}
                ref={(node) => {
                  if (node) playerNodesRef.current.set(player.id, node);
                  else playerNodesRef.current.delete(player.id);
                }}
                className="absolute z-10 min-w-10 min-h-10 cursor-pointer will-change-transform flex items-center justify-center"
                style={{
                  left: `${player.x}%`,
                  top: `${player.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="relative flex flex-col items-center -translate-x-1/2 -translate-y-1/2">
                  {/* Ball Possession Glowing Halo */}
                  {hasBall && (
                    <span className="absolute -inset-1.5 rounded-full ring-2 ring-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.8)] animate-pulse pointer-events-none" />
                  )}

                  {/* Scorer Celebration Icon */}
                  {isScorer && (
                    <span className="absolute -top-4 text-xs animate-bounce pointer-events-none">⚽</span>
                  )}

                  {/* Circular Player Kit Marker: ONLY JERSEY NUMBER DISPLAYED */}
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-display font-black text-[9px] sm:text-[10.5px] shadow-lg border ${kitStyle} ${
                      hasBall ? 'scale-110 ring-2 ring-amber-300/80' : ''
                    } transition-transform`}
                  >
                    {player.number}
                  </div>
                </div>
              </div>
            );
          })}

          {/* 5. VISIBLE FOOTBALL WITH REAL FLIGHT ARC & DYNAMIC SHADOW */}
          <div
            ref={ballNodeRef}
            className="absolute left-0 top-0 z-20 pointer-events-none will-change-transform"
            style={{ transform: 'translate3d(0, 0, 0)' }}
          >
            <div className="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
              {/* Dynamic Ground Drop Shadow on the pitch turf directly beneath */}
              <div
                ref={ballShadowRef}
                className="absolute left-1/2 top-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/65 blur-[2px] will-change-transform"
                style={{ width: '14px', height: '4px', opacity: 0.62 }}
              />
              
              {/* Bold, Visible Football Sphere (White + Black Pentagon Pattern) */}
              <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-gradient-to-br from-white via-slate-100 to-slate-300 border-2 border-slate-950 shadow-[0_2px_8px_rgba(0,0,0,0.6)] flex items-center justify-center relative">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-sm bg-slate-950 rotate-45" />
                <div className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-white/80 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 5. COMPACT GLASS BROADCAST GOAL OVERLAY (Requirements 4, 5, 6)             */}
          {/* ========================================================================= */}
          {/* Transparent, glass effect, slight blur, compact, pitch remains visible    */}
          {/* No huge full-screen card, no giant GOAAAL text, no Continue button        */}
          {goalOverlay && (
            <div className="absolute top-3 sm:top-5 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-in fade-in slide-in-from-top-3 duration-300">
              <div className="px-5 py-3 rounded-2xl bg-slate-950/85 backdrop-blur-md border border-amber-400/60 shadow-[0_12px_40px_rgba(0,0,0,0.8)] flex flex-col items-center text-center min-w-[240px] max-w-sm">
                {/* Header with flash */}
                <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 font-mono text-[10.5px] font-black uppercase tracking-wider mb-1 animate-pulse">
                  <span>⚽ GOAL</span>
                </div>

                {/* Scorer name & minute */}
                <div className="font-display font-black text-sm sm:text-base text-white tracking-wide uppercase drop-shadow">
                  {goalOverlay.scorer}
                </div>
                <div className="text-[11px] font-mono text-amber-300 font-bold mt-0.5">
                  {goalOverlay.minute}'
                </div>

                {/* Assist */}
                {goalOverlay.assist && (
                  <div className="text-[10px] text-slate-300 font-sans mt-0.5">
                    Assist: <span className="text-slate-100 font-semibold">{goalOverlay.assist}</span>
                  </div>
                )}

                {/* Score */}
                <div className="mt-2 pt-1.5 border-t border-slate-700/60 flex items-center gap-2 font-mono font-black text-xs sm:text-sm text-slate-100">
                  <span className={`truncate max-w-[80px] ${goalOverlay.team === 'home' ? 'text-emerald-400 font-black' : 'text-slate-300'}`}>
                    {fixture.homeManagerName}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-amber-400 text-sm">
                    {goalOverlay.score.home} — {goalOverlay.score.away}
                  </span>
                  <span className={`truncate max-w-[80px] ${goalOverlay.team === 'away' ? 'text-sky-400 font-black' : 'text-slate-300'}`}>
                    {fixture.awayManagerName}
                  </span>
                </div>
              </div>
            </div>
          )}

          {halfTimeOverlay && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
              <div className="w-full max-w-sm p-5 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl text-center space-y-3.5">
                <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-amber-400 text-xs font-mono font-black uppercase tracking-widest">
                  ⏸ HALF TIME ({formattedTime})
                </div>

                {/* Score Display */}
                <div className="flex items-center justify-around py-2 border-y border-slate-800">
                  <div className="flex-1 text-center truncate">
                    <div className="font-bold text-xs text-slate-300 truncate">{fixture.homeManagerName}</div>
                    <div className="font-mono font-black text-2xl text-emerald-400">{currentScore.home}</div>
                  </div>
                  <div className="text-slate-600 font-bold text-base px-2">—</div>
                  <div className="flex-1 text-center truncate">
                    <div className="font-bold text-xs text-slate-300 truncate">{fixture.awayManagerName}</div>
                    <div className="font-mono font-black text-2xl text-sky-400">{currentScore.away}</div>
                  </div>
                </div>

                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300 font-mono py-1">
                  <div className="p-1.5 rounded bg-slate-950/80 border border-slate-800/80">
                    <div>Possession</div>
                    <div className="font-bold text-slate-100">{liveStats.home.possession}% - {liveStats.away.possession}%</div>
                  </div>
                  <div className="p-1.5 rounded bg-slate-950/80 border border-slate-800/80">
                    <div>Shots (On Target)</div>
                    <div className="font-bold text-slate-100">
                      {liveStats.home.shots}({liveStats.home.shotsOnTarget}) - {liveStats.away.shots}({liveStats.away.shotsOnTarget})
                    </div>
                  </div>
                </div>

                <button
                  onClick={dismissHalfTimeOverlay}
                  className="w-full py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-md shadow-emerald-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>CONTINUE SECOND HALF</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 7. COMPACT GLASS FULL-TIME SUMMARY (Requirement 16)                       */}
          {/* ========================================================================= */}
          {fullTimeOverlay && fixture.wentToPenalties && !showPenaltyShootout && !penaltyIsOver && (
            <div className="absolute inset-0 z-35 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
              <div className="p-6 rounded-3xl bg-slate-900 border border-amber-500/30 text-center">
                <div className="text-amber-400 text-xs uppercase tracking-widest font-black">120:00 — Level after extra time</div>
                <div className="font-display font-black text-2xl mt-2">PENALTY SHOOTOUT</div>
                <p className="text-xs text-slate-400 mt-2">The actual takers will step up one by one.</p>
                <button type="button" onClick={() => { setFullTimeOverlay(false); setPenaltyIndex(0); setShowPenaltyShootout(true); }} className="mt-5 px-7 py-3 rounded-xl bg-amber-400 text-slate-950 font-display font-black text-xs uppercase tracking-wider">
                  START SHOOTOUT
                </button>
              </div>
            </div>
          )}

          {fullTimeOverlay && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
              <div className="w-full max-w-sm p-5 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl text-center space-y-3.5">
                <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-xs font-mono font-black uppercase tracking-widest">
                  🏁 FULL TIME ({formattedTime})
                </div>

                {/* Score Display */}
                <div className="flex items-center justify-around py-2 border-y border-slate-800">
                  <div className="flex-1 text-center truncate">
                    <div className="font-bold text-xs text-slate-300 truncate">{fixture.homeManagerName}</div>
                    <div className="font-mono font-black text-2xl text-emerald-400">{currentScore.home}</div>
                  </div>
                  <div className="text-slate-600 font-bold text-base px-2">—</div>
                  <div className="flex-1 text-center truncate">
                    <div className="font-bold text-xs text-slate-300 truncate">{fixture.awayManagerName}</div>
                    <div className="font-mono font-black text-2xl text-sky-400">{currentScore.away}</div>
                  </div>
                </div>

                {/* Penalty Shootout outcome banner if applicable */}
                {fixture.wentToPenalties && (
                  <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
                    Penalties: {fixture.homePenaltyScore} — {fixture.awayPenaltyScore}
                  </div>
                )}

                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300 font-mono py-1">
                  <div className="p-1.5 rounded bg-slate-950/80 border border-slate-800/80">
                    <div>Shots (Target)</div>
                    <div className="font-bold text-slate-100">
                      {liveStats.home.shots}({liveStats.home.shotsOnTarget}) - {liveStats.away.shots}({liveStats.away.shotsOnTarget})
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-slate-950/80 border border-slate-800/80">
                    <div>Fouls / Cards</div>
                    <div className="font-bold text-slate-100">
                      {fixture.homeStats?.fouls || 0}(🟨{fixture.homeStats?.yellowCards || 0}) - {fixture.awayStats?.fouls || 0}(🟨{fixture.awayStats?.yellowCards || 0})
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowStatsModal(true)}
                    className="flex-1 py-2 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    MATCH STATS
                  </button>
                  {onMatchComplete ? (
                    <button
                      onClick={() => {
                        setFullTimeOverlay(false);
                        onMatchComplete(fixture.id);
                      }}
                      className="flex-1 py-2 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
                    >
                      CONTINUE
                    </button>
                  ) : (
                    <div className="flex-1 py-2 rounded-xl border border-slate-700 bg-slate-950 text-slate-400 text-center text-xs font-black uppercase tracking-wider">
                      WAITING FOR HOST TO CONTINUE...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

{showPenaltyShootout && fixture.wentToPenalties && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-slate-950/95 backdrop-blur-md animate-in fade-in duration-500 overflow-y-auto overscroll-contain">
              <div className="w-full max-w-3xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-3xl bg-slate-900/98 border border-amber-400/30 shadow-[0_25px_100px_rgba(0,0,0,.65)]">
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-amber-400 font-black">Penalty Shootout</div>
                    <h2 className="font-display font-black text-xl sm:text-2xl mt-1">NO RUSH. ONE KICK AT A TIME.</h2>
                  </div>
                  <div className="font-mono text-xs text-slate-400">
                    KICK {Math.min(penaltyIndex + 1, penaltySequence.length)} / {penaltySequence.length}
                  </div>
                </div>

                {/* Persistent 5-kick scorecard with ticks/crosses */}
                <div className="px-5 pt-5">
                  <div className="rounded-2xl bg-black/30 border border-slate-800 p-4">
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-black truncate">{fixture.homeManagerName}</div>
                        <div className="flex gap-2 mt-3 flex-wrap">
                          {Array.from({ length: Math.max(5, Math.ceil(penaltySequence.length / 2)) }).map((_, i) => {
                            const kick = completedPenalties.find(p => p.team === 'home' && p.round === i + 1);
                            return (
                              <div key={i} className="w-8 h-8 rounded-full border border-slate-700 bg-slate-950 flex items-center justify-center text-sm font-black">
                                {kick ? (kick.outcome === 'goal'
                                  ? <span className="text-emerald-400">✓</span>
                                  : <span className="text-rose-400">×</span>)
                                  : <span className="text-slate-700">•</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="text-center px-2">
                        <div className="text-3xl sm:text-4xl font-mono font-black text-white tabular-nums">
                          {completedPenalties.filter(p => p.outcome === 'goal' && p.team === 'home').length}
                          <span className="text-slate-600 mx-2">—</span>
                          {completedPenalties.filter(p => p.outcome === 'goal' && p.team === 'away').length}
                        </div>
                        <div className="text-[8px] uppercase tracking-[0.25em] text-slate-500 mt-1">LIVE SHOOTOUT</div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest text-sky-400 font-black truncate">{fixture.awayManagerName}</div>
                        <div className="flex gap-2 mt-3 flex-wrap justify-end">
                          {Array.from({ length: Math.max(5, Math.ceil(penaltySequence.length / 2)) }).map((_, i) => {
                            const kick = completedPenalties.find(p => p.team === 'away' && p.round === i + 1);
                            return (
                              <div key={i} className="w-8 h-8 rounded-full border border-slate-700 bg-slate-950 flex items-center justify-center text-sm font-black">
                                {kick ? (kick.outcome === 'goal'
                                  ? <span className="text-emerald-400">✓</span>
                                  : <span className="text-rose-400">×</span>)
                                  : <span className="text-slate-700">•</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mx-5 mt-5 relative h-64 sm:h-72 rounded-2xl overflow-hidden border border-slate-700 bg-[radial-gradient(circle_at_center,_#14532d_0%,_#052e16_65%,_#022c22_100%)]">
                  <div className="absolute inset-0 opacity-30 bg-[linear-gradient(90deg,transparent_49.5%,rgba(255,255,255,.8)_50%,transparent_50.5%)]" />
                  <div className="absolute left-1/2 top-2 bottom-2 w-40 -translate-x-1/2 border border-white/50 rounded-b-[55%]" />
                  <div className="absolute left-1/2 top-2 -translate-x-1/2 w-28 h-14 border-x border-b border-white/60" />
                  <div className="absolute left-1/2 top-5 -translate-x-1/2 w-20 h-12 border-2 border-white/70 rounded-sm bg-slate-900/20">
                    <div className="absolute inset-0 border border-white/20" />
                  </div>

                  <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-[9px] uppercase tracking-widest text-white/70 font-black">
                    {penaltyRevealStage === 'walkup' ? 'THE KICKER STEPS UP' : penaltyRevealStage === 'strike' ? 'THE STRIKE' : 'THE VERDICT'}
                  </div>

                  <div
                    className="absolute left-1/2 top-10 -translate-x-1/2 text-4xl drop-shadow-[0_4px_8px_rgba(0,0,0,.7)] transition-transform duration-1000"
                    style={{
                      transform: penaltyRevealStage === 'result' && currentPenalty?.outcome === 'saved'
                        ? `translateX(calc(-50% + ${penaltyDiveDirection * 42}px)) rotate(${penaltyDiveDirection * 8}deg)`
                        : 'translateX(0)',
                    }}
                  >
                    🧤
                  </div>

                  {currentPenalty && (
                    <>
                      <div className="absolute left-1/2 bottom-9 -translate-x-1/2 text-4xl drop-shadow-[0_4px_8px_rgba(0,0,0,.7)]">
                        🧍
                      </div>
                      <div
                        className={[
                          'absolute left-1/2 bottom-20 -translate-x-1/2 text-xl transition-all',
                          penaltyRevealStage === 'walkup' ? 'opacity-0 scale-50' : '',
                          penaltyRevealStage === 'strike' ? 'opacity-100 duration-[1400ms] ' + (currentPenalty.outcome === 'goal' ? 'translate-y-[-95px] scale-150' : currentPenalty.outcome === 'saved' ? 'translate-x-[45px] translate-y-[-55px] scale-125' : 'translate-x-[-55px] translate-y-[-65px] rotate-12 scale-125') : '',
                          penaltyRevealStage === 'result' ? 'opacity-100 ' + (currentPenalty.outcome === 'goal' ? 'translate-y-[-95px] scale-150' : currentPenalty.outcome === 'saved' ? 'translate-x-[45px] translate-y-[-55px] scale-125' : 'translate-x-[-55px] translate-y-[-65px] rotate-12 scale-125') : ''
                        ].join(' ')}
                      >
                        ⚽
                      </div>
                      <div className="absolute left-1/2 bottom-2 -translate-x-1/2 text-[9px] font-mono text-white/80 uppercase tracking-wider whitespace-nowrap">
                        #{currentPenalty.takerNumber} {currentPenalty.takerName}
                      </div>
                    </>
                  )}
                </div>

                <div className="p-5">
                  {currentPenalty && !penaltyIsOver ? (
                    <div className="rounded-2xl bg-black/30 border border-slate-800 p-4 text-center">
                      <div className="text-xs text-slate-400">
                        {penaltyRevealStage === 'walkup'
                          ? currentPenalty.takerName + ' walks to the spot...'
                          : penaltyRevealStage === 'strike'
                            ? 'HE TAKES THE KICK...'
                            : currentPenalty.commentary}
                      </div>

                      <div className="mt-4 flex items-center justify-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${penaltyRevealStage !== 'walkup' ? 'bg-amber-400' : 'bg-slate-700'}`} />
                        <span className={`h-2 w-2 rounded-full ${penaltyRevealStage === 'result' ? 'bg-amber-400' : 'bg-slate-700'}`} />
                        <span className={`h-2 w-2 rounded-full ${penaltyRevealStage === 'result' ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                      </div>

                      <div className={`mt-4 text-sm font-display font-black uppercase transition-opacity duration-500 ${penaltyRevealStage === 'result' ? 'opacity-100' : 'opacity-0'} ${currentPenalty.outcome === 'goal' ? 'text-emerald-400' : currentPenalty.outcome === 'saved' ? 'text-rose-400' : 'text-amber-300'}`}>
                        {currentPenalty.outcome === 'goal' ? 'GOAL' : currentPenalty.outcome === 'saved' ? 'SAVED BY THE KEEPER' : 'MISSED'}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPenaltyIndex(penaltySequence.length);
                          setPenaltyRevealStage('result');
                        }}
                        className="w-full mt-2 py-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 font-display font-black text-[10px] uppercase tracking-wider"
                      >
                        SKIP SHOOTOUT
                      </button>

                      <button
                        type="button"
                        disabled={penaltyRevealStage !== 'result'}
                        onClick={() => {
                          setPenaltyRevealStage('walkup');
                          setPenaltyIndex(i => Math.min(i + 1, penaltySequence.length));
                        }}
                        className="w-full mt-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-display font-black text-xs uppercase tracking-wider active:scale-[.99] transition-all"
                      >
                        {penaltyIndex + 1 < penaltySequence.length ? 'NEXT KICK' : 'SHOW RESULT'}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-emerald-400 font-display font-black uppercase">Shootout complete</div>
                      <div className="text-slate-300 text-sm mt-1">
                        {fixture.winnerManagerId === fixture.homeManagerId ? fixture.homeManagerName : fixture.awayManagerName} wins on penalties.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPenaltyShootout(false);
                          setPenaltyRevealStage('walkup');
                          const fulltimeIndex = events.findIndex(event => event.type === 'fulltime');
                          setCurrentEventIndex(fulltimeIndex >= 0 ? fulltimeIndex : events.length - 1);
                          setFullTimeOverlay(true);
                          setIsPlaying(false);
                        }}
                        className="mt-4 px-6 py-2.5 rounded-xl bg-emerald-400 text-slate-950 font-display font-black text-xs uppercase"
                      >
                        CONTINUE TO FULL TIME
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* ========================================================================= */}
          {/* 6. COMPACT GLASS HALF-TIME OVERLAY (Requirement 15)                       */}
          {/* ========================================================================= */}
          

      {/* Floating Player Info Popup (Tapping a player on the pitch) */}
      {inspectedPlayer && (
        <div 
          className="fixed z-50 p-3 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl text-xs flex items-center gap-3 animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${Math.min(window.innerWidth - 180, Math.max(16, (inspectedScreenX || 80) - 80))}px`,
            top: `${Math.max(20, (inspectedScreenY || 80) - 70)}px`,
          }}
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 font-display font-black flex items-center justify-center text-sm border border-emerald-500/40">
            {inspectedPlayer.player.overall}
          </div>
          <div>
            <div className="font-bold text-slate-100">{inspectedPlayer.player.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">
              #{inspectedPlayer.player.number} · {inspectedPlayer.player.position} · {inspectedPlayer.player.team.toUpperCase()}
            </div>
          </div>
          <button 
            onClick={() => setInspectedPlayer(null)}
            className="p-1 rounded-md text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. SYNCHRONIZED LIVE COMMENTARY FEED (Strict Timeline Match)              */}
      {/* ========================================================================= */}
      <div className="p-3 rounded-2xl bg-[#050b14]/90 border border-slate-800 shadow-md space-y-1.5 select-none">
        <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <Activity className="w-3 h-3" />
            LIVE COMMENTARY FEED
          </span>
          <span className="font-mono text-slate-500">Action {currentEventIndex + 1}/{events.length}</span>
        </div>

        {/* Current Active Event Banner: Displays matching clock time */}
        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-950 border border-slate-800">
          <div className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 font-mono font-black text-xs shrink-0">
            {formattedTime}
          </div>
          <div className="text-xs sm:text-sm text-slate-100 font-semibold truncate flex-1">
            {currentEvent?.commentary || 'Match underway.'}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. SAFE-AREA MOBILE PLAYBACK CONTROLS (Never cut off or hidden)           */}
      {/* ========================================================================= */}
      <div className="sticky bottom-0 z-20 p-2.5 sm:p-3 rounded-2xl bg-[#050b14]/98 border border-slate-800 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 select-none backdrop-blur-md">
        {/* Playback Primary Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            disabled={halfTimeOverlay || fullTimeOverlay || showPenaltyShootout}
            onClick={handleTogglePlay}
            className={`p-2.5 sm:px-4 sm:py-2 rounded-xl font-display font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
              isPlaying
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            <span className="hidden sm:inline">{isPlaying ? 'PAUSE' : 'PLAY'}</span>
          </button>

          <button
            onClick={handleSkipToNextEvent}
            disabled={currentEventIndex >= events.length - 1}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 disabled:opacity-40 transition-colors cursor-pointer active:scale-95"
            title="Next Event"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            onClick={handleRestart}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 transition-colors cursor-pointer active:scale-95"
            title="Restart Match"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={handleSkipToFullTime}
            disabled={isFullTime}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-300 disabled:opacity-40 transition-colors cursor-pointer active:scale-95"
            title="Skip to Full Time"
          >
            <SkipForward className="w-3.5 h-3.5 inline mr-1" />
            <span className="hidden sm:inline">FULL TIME</span>
          </button>
        </div>

        {/* Speed Multipliers & Audio Toggle & Developer Branding */}
        <div className="flex items-center gap-1.5">
          {[1, 2, 4].map((spd) => (
            <button
              key={spd}
              onClick={() => setPlaybackSpeed(spd)}
              className={`px-2.5 py-1.5 rounded-lg font-mono font-black text-xs transition-colors cursor-pointer active:scale-95 ${
                playbackSpeed === spd
                  ? 'bg-emerald-400 text-slate-950 shadow-sm'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {spd}X
            </button>
          ))}

          <button
            onClick={() => { sound.enabled = !sound.enabled; forceSoundUpdate(v => v + 1); }}
            className={`p-2 rounded-lg transition-colors cursor-pointer active:scale-95 ${
              sound.enabled ? 'text-emerald-400 bg-slate-900 border border-slate-800' : 'text-slate-500 bg-slate-950'
            }`}
            title={sound.enabled ? 'Mute Audio' : 'Enable Audio'}
          >
            {sound.enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="text-center text-[9px] text-slate-700 font-mono tracking-[0.28em] uppercase">
        FAL · IRVIX
      </div>

      {/* Full Match Stats Modal */}
      {showStatsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-lg p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display font-black text-lg text-slate-100 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-emerald-400" />
                <span>OFFICIAL MATCH REPORT</span>
              </h3>
              <button
                onClick={() => setShowStatsModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              {[
                { label: 'Score', home: currentScore.home, away: currentScore.away },
                { label: 'Possession', home: `${liveStats.home.possession}%`, away: `${liveStats.away.possession}%` },
                { label: 'Total Shots', home: liveStats.home.shots, away: liveStats.away.shots },
                { label: 'Shots on Target', home: liveStats.home.shotsOnTarget, away: liveStats.away.shotsOnTarget },
                { label: 'Passes Completed', home: fixture.homeStats?.passes || 0, away: fixture.awayStats?.passes || 0 },
                { label: 'Corners', home: fixture.homeStats?.corners || 0, away: fixture.awayStats?.corners || 0 },
                { label: 'Fouls', home: fixture.homeStats?.fouls || 0, away: fixture.awayStats?.fouls || 0 },
                { label: 'Yellow Cards', home: fixture.homeStats?.yellowCards || 0, away: fixture.awayStats?.yellowCards || 0 },
              ].map((row, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80">
                  <span className="font-bold text-emerald-400 w-16 text-left">{row.home}</span>
                  <span className="text-slate-400 uppercase tracking-wider">{row.label}</span>
                  <span className="font-bold text-sky-400 w-16 text-right">{row.away}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowStatsModal(false)}
              className="w-full py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              CLOSE REPORT
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Production redeploy marker: penalty shootout pacing + scorecard (1790528797239)

// Force production Git deployment marker 2026-09-27T17:19:22.012Z
