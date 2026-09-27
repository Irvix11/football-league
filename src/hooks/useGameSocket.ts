import { useState, useEffect, useRef, useCallback } from 'react';
import { GameRoom, Formation, TeamTactics, TeamRoles, SquadPlayerEntry, LobbySettings } from '../types/football';
import { sound } from '../utils/audio';

export interface SavedSession {
  roomCode: string;
  managerId: string;
  managerName: string;
}

function getGameServerBaseUrl(): string {
  const configured = import.meta.env.VITE_GAME_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  // Production runs frontend and realtime backend on the same Vercel origin.
  // Keep VITE_GAME_SERVER_URL as an optional override for local/staging servers.
  return window.location.origin;
}

function getWebSocketBaseUrl(): string {
  const configured = import.meta.env.VITE_GAME_SERVER_URL?.trim();
  const base = configured || window.location.origin;

  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

function restoreViewerIdentity(snapshot: GameRoom, viewerId: string | null, viewerName: string | null): GameRoom {
  if (!snapshot || !viewerId) return snapshot;

  const isMine = (name?: string) => Boolean(viewerName && name === viewerName);

  const next = { ...snapshot };
  next.managers = snapshot.managers.map(m => isMine(m.name) ? { ...m, id: viewerId } : m);
  const me = next.managers.find(m => m.id === viewerId);
  if (me?.isHost) next.hostId = viewerId;

  next.leagueTable = snapshot.leagueTable.map(row =>
    isMine(row.managerName) ? { ...row, managerId: viewerId } : row
  );

  next.fixtures = snapshot.fixtures.map(f => ({
    ...f,
    homeManagerId: isMine(f.homeManagerName) ? viewerId : f.homeManagerId,
    awayManagerId: isMine(f.awayManagerName) ? viewerId : f.awayManagerId,
    winnerManagerId:
      (isMine(f.homeManagerName) && f.winnerManagerId === f.homeManagerId) ||
      (isMine(f.awayManagerName) && f.winnerManagerId === f.awayManagerId)
        ? viewerId
        : f.winnerManagerId,
  }));

  if (next.transferOffers) {
    next.transferOffers = snapshot.transferOffers.map(offer => ({
      ...offer,
      fromManagerId: isMine(offer.fromManagerName) ? viewerId : offer.fromManagerId,
      toManagerId: isMine(offer.toManagerName) ? viewerId : offer.toManagerId,
    }));
  }

  if (next.auction) {
    next.auction.highestBidderId =
      next.auction.highestBidderName === viewerName ? viewerId : next.auction.highestBidderId;
    next.auction.winnerId =
      next.auction.winnerId === viewerId || (next.auction.highestBidderName === viewerName && next.auction.isSold)
        ? viewerId
        : next.auction.winnerId;
  }

  if (next.knockoutStage) {
    next.knockoutStage = {
      ...next.knockoutStage,
      rounds: next.knockoutStage.rounds.map(round => ({
        ...round,
        fixtures: round.fixtures.map(f => ({
          ...f,
          homeManagerId: isMine(f.homeManagerName) ? viewerId : f.homeManagerId,
          awayManagerId: isMine(f.awayManagerName) ? viewerId : f.awayManagerId,
        })),
      })),
    };
  }

  return next;
}

export function useGameSocket() {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [secretBidSubmitted, setSecretBidSubmitted] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const managerIdRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const isSimulatingRef = useRef(false);

  useEffect(() => {
    managerIdRef.current = managerId;
  }, [managerId]);

  // Load saved session
  const getSavedSession = useCallback((): SavedSession | null => {
    try {
      const stored = localStorage.getItem('fal_session');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return null;
  }, []);

  const saveSession = useCallback((session: SavedSession | null) => {
    try {
      if (session) {
        localStorage.setItem('fal_session', JSON.stringify(session));
      } else {
        localStorage.removeItem('fal_session');
      }
    } catch {}
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    intentionalCloseRef.current = false;
    const ws = new WebSocket(`${getWebSocketBaseUrl()}/api/ws`);

    ws.onopen = () => {
      setIsConnected(true);
      setErrorMessage(null);

      const saved = getSavedSession();
      if (saved) {
        ws.send(JSON.stringify({
          type: 'JOIN_LOBBY',
          payload: {
            roomCode: saved.roomCode,
            managerName: saved.managerName,
            reconnectId: saved.managerId,
          }
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, room: newRoom, managerId: assignedId, message, amount } = data;

        switch (type) {
          case 'LOBBY_CREATED':
          case 'LOBBY_JOINED': {
            setRoom(restoreViewerIdentity(newRoom, assignedId, null));
            setManagerId(assignedId);
            managerIdRef.current = assignedId;
            setSecretBidSubmitted(null);
            const myManager = newRoom.managers.find((m: any) => m.id === assignedId);
            if (myManager) {
              saveSession({
                roomCode: newRoom.code,
                managerId: assignedId,
                managerName: myManager.name,
              });
            }
            break;
          }

          case 'ROOM_UPDATE': {
            const saved = getSavedSession();
            setRoom(restoreViewerIdentity(newRoom, managerIdRef.current, saved?.managerName || null));
            break;
          }
            isSimulatingRef.current = false;
            setIsSimulating(false);
            break;

          case 'BLIND_BID_CONFIRMED':
            setSecretBidSubmitted(amount);
            sound.playBid();
            break;

          case 'ERROR':
            if (isSimulatingRef.current) {
              isSimulatingRef.current = false;
              setIsSimulating(false);
              setSimulationError(typeof message === 'string' ? message : 'Knockout match failed to start.');
            }
            // Reconnects can land on a different Vercel Function instance. Give the
            // durable snapshot one HTTP retry before deciding that a saved room is gone.
            if (typeof message === 'string' && message.toLowerCase().includes('lobby not found')) {
              const saved = getSavedSession();
              if (saved) {
                fetch(`${getGameServerBaseUrl()}/api/room/${encodeURIComponent(saved.roomCode)}`, { cache: 'no-store' })
                  .then((response) => {
                    if (response.ok) {
                      setErrorMessage(null);
                      // Restore the server snapshot into the UI before retrying the
                      // WebSocket join. This prevents the home screen from flashing
                      // a false "lobby not found" state during a Vercel cold start.
                      response.json().then((snapshot) => {
                        if (snapshot?.code) setRoom(snapshot as GameRoom);
                      }).catch(() => {});
                      if (socketRef.current?.readyState === WebSocket.OPEN) {
                        socketRef.current.send(JSON.stringify({
                          type: 'JOIN_LOBBY',
                          payload: {
                            roomCode: saved.roomCode,
                            managerName: saved.managerName,
                            reconnectId: saved.managerId,
                          }
                        }));
                      }
                      return;
                    }
                    saveSession(null);
                    managerIdRef.current = null;
                    setRoom(null);
                    setManagerId(null);
                    setErrorMessage(message);
                  })
                  .catch(() => setErrorMessage(message));
              } else {
                setErrorMessage(message);
              }
            } else {
              setErrorMessage(message);
            }
            setTimeout(() => setErrorMessage(null), 5000);
            break;
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      socketRef.current = null;
      if (!intentionalCloseRef.current) {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    ws.onerror = (err) => {
      console.warn('WebSocket encountered error:', err);
      // onclose performs the reconnect; avoid recursively closing/reconnecting here.
    };

    socketRef.current = ws;
  }, [getSavedSession, saveSession]);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  // Poll the durable room snapshot so reconnects and multi-instance updates stay synchronized.
  useEffect(() => {
    if (!room?.code) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch(`${getGameServerBaseUrl()}/api/room/${encodeURIComponent(room.code)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const snapshot = await response.json() as GameRoom;
        if (cancelled) return;
        setRoom(current => {
          if (!current || snapshot.updatedAt >= current.updatedAt) {
            const saved = getSavedSession();
            return restoreViewerIdentity(snapshot, managerIdRef.current, saved?.managerName || current.managers.find(m => m.id === managerIdRef.current)?.name || null);
          }
          return current;
        });
      } catch {}
    };
    const timer = window.setInterval(sync, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [room?.code]);

  // Actions
  const send = useCallback((type: string, payload: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, payload }));
    } else {
      setErrorMessage('Connecting to game server...');
    }
  }, []);

  const startSoloGame = useCallback(async (managerName: string, formation: Formation = '4-3-3') => {
    try {
      setErrorMessage(null);

      // Give the Vercel realtime function a short window to cold-start and complete
      // the WebSocket handshake before reporting the connection as unavailable.
      const deadline = Date.now() + 8000;
      while ((!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 200));
      }

      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error('Game server is offline. Wait a few seconds and try again.');
      }

      socketRef.current.send(JSON.stringify({
        type: 'START_SOLO_GAME',
        payload: { managerName: managerName.trim(), soloFormation: formation }
      }));
    } catch (err: any) {
      console.error('Error starting solo game:', err);
      setErrorMessage(err.message || 'Failed to start Solo Game. Please try again.');
    }
  }, []);

  const createLobby = useCallback((managerName: string, isSolo = false, soloFormation?: Formation, settings?: Partial<LobbySettings>) => {
    if (isSolo) {
      startSoloGame(managerName, soloFormation || '4-3-3');
      return;
    }
    send('CREATE_LOBBY', { managerName, isSolo: false, settings });
  }, [send, startSoloGame]);

  const joinLobby = useCallback((roomCode: string, managerName: string, reconnectId?: string) => {
    send('JOIN_LOBBY', { roomCode: roomCode.trim().toUpperCase(), managerName, reconnectId });
  }, [send]);

  const resumeLobby = useCallback((session: SavedSession) => {
    if (!session?.roomCode || !session?.managerId) return;
    const roomCode = session.roomCode.trim().toUpperCase();
    saveSession(session);

      fetch(`${getGameServerBaseUrl()}/api/room/${encodeURIComponent(roomCode)}`, { cache: 'no-store' })
      .then((response) => {
        if (response.status === 404) {
          saveSession(null);
          setRoom(null);
          setManagerId(null);
          managerIdRef.current = null;
          setErrorMessage('That saved lobby has expired. Create a new lobby.');
          return;
        }
        if (!response.ok) throw new Error('snapshot check failed');
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          send('JOIN_LOBBY', {
            roomCode,
            managerName: session.managerName,
            reconnectId: session.managerId,
          });
        } else {
          setErrorMessage('Connecting to game server...');
        }
      })
      .catch(() => {
        // The WebSocket path remains authoritative if the snapshot endpoint
        // is temporarily unavailable.
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          send('JOIN_LOBBY', {
            roomCode,
            managerName: session.managerName,
            reconnectId: session.managerId,
          });
        } else {
          setErrorMessage('Connecting to game server...');
        }
      });
  }, [saveSession, send]);

  const updateSettings = useCallback((settings: Partial<LobbySettings>) => {
    if (!room) return;
    send('UPDATE_SETTINGS', { roomCode: room.code, settings });
  }, [room, send]);

  const toggleReady = useCallback(() => {
    if (!room || !managerId) return;
    send('TOGGLE_READY', { roomCode: room.code, managerId });
  }, [room, managerId, send]);

  const kickPlayer = useCallback((targetManagerId: string) => {
    if (!room) return;
    send('KICK_PLAYER', { roomCode: room.code, targetManagerId });
  }, [room, send]);

  const startGame = useCallback(() => {
    if (!room) return;
    sound.playWhistle();
    send('START_GAME', { roomCode: room.code });
  }, [room, send]);

  const selectFormation = useCallback((formation: Formation) => {
    if (!room || !managerId) return;
    send('SELECT_FORMATION', { roomCode: room.code, managerId, formation });
  }, [room, managerId, send]);

  const beginAuction = useCallback(() => {
    if (!room) return;
    send('BEGIN_AUCTION', { roomCode: room.code });
  }, [room, send]);

  const markFormationDone = useCallback(() => {
    if (!room || !managerId) return;
    send('FORMATION_READY', { roomCode: room.code, managerId });
  }, [room, managerId, send]);

  const markAuctionDone = useCallback(() => {
    if (!room || !managerId) return;
    send('AUCTION_READY', { roomCode: room.code, managerId });
  }, [room, managerId, send]);

  const skipAuctionSolo = useCallback(() => {
    if (!room) return;
    send('SKIP_AUCTION_SOLO', { roomCode: room.code });
  }, [room, send]);

  const placeBid = useCallback((amount: number) => {
    if (!room || !managerId) return;
    sound.playBid();
    send('AUCTION_BID', { roomCode: room.code, managerId, amount });
  }, [room, managerId, send]);

  const submitBlindBid = useCallback((amount: number) => {
    if (!room || !managerId) return;
    send('SUBMIT_BLIND_BID', { roomCode: room.code, managerId, amount });
  }, [room, managerId, send]);

  const updateLineup = useCallback((squad: SquadPlayerEntry[], formation?: Formation, tactics?: TeamTactics, roles?: TeamRoles) => {
    if (!room || !managerId) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send('UPDATE_LINEUP', { roomCode: room.code, managerId, squad, formation, tactics, roles });
    } else {
      setErrorMessage('Connection lost. Reconnect before changing your lineup.');
    }
  }, [room, managerId, send]);

  const confirmTeam = useCallback(async () => {
    if (!room || !managerId) return;
    sound.playWhistle();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send('CONFIRM_TEAM', { roomCode: room.code, managerId });
    } else {
      setErrorMessage('Connection lost. Reconnect before confirming your team.');
    }
  }, [room, managerId, send]);

  const runKnockoutMatch = useCallback((fixtureId: string) => {
    if (!room || !managerId) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setSimulationError('Connection lost. Reconnect before starting the knockout match.');
      return;
    }
    setSimulationError(null);
    isSimulatingRef.current = true;
    setIsSimulating(true);
    send('RUN_KNOCKOUT_MATCH', { roomCode: room.code, managerId, fixtureId });
  }, [room, managerId, send]);
  const completeKnockoutMatch = useCallback((fixtureId: string) => {
    if (!room || !managerId) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setSimulationError('Connection lost. Reconnect before continuing the knockout round.');
      return;
    }

    // Keep bracket advancement on the same authoritative WebSocket instance that
    // simulated the match. Using a REST request here can hit a different Vercel
    // function instance before the just-finished fixture has been persisted.
    setSimulationError(null);
    isSimulatingRef.current = true;
    setIsSimulating(true);
    send('COMPLETE_KNOCKOUT_MATCH', { roomCode: room.code, managerId, fixtureId });
  }, [room, managerId, send]);

  const runMatchday = useCallback((matchday: number) => {
    if (!room || !managerId) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setSimulationError('Connection lost. Reconnect before starting the match.');
      return;
    }

    // Matchday simulation now uses the same authoritative WebSocket instance as
    // knockout matches. This prevents a Vercel REST request from landing on a
    // different serverless instance with a stale room snapshot.
    setSimulationError(null);
    isSimulatingRef.current = true;
    setIsSimulating(true);
    sound.playWhistle();
    send('RUN_MATCHDAY', { roomCode: room.code, managerId, matchday });
  }, [room, managerId, send]);

  const proceedToNextMatchday = useCallback(async (nextMatchday: number) => {
    if (!room) return;
    setSimulationError(null);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send('NEXT_MATCHDAY', { roomCode: room.code, nextMatchday });
    } else {
      setSimulationError('Connection lost. Reconnect before advancing the matchday.');
    }
  }, [room, send]);

  const finishSeason = useCallback(async () => {
    if (!room) return;
    setSimulationError(null);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send('FINISH_SEASON', { roomCode: room.code });
    } else {
      setSimulationError('Connection lost. Reconnect before finishing the season.');
    }
  }, [room, send]);

  const proposeTransfer = useCallback((offer: {
    fromManagerId: string;
    fromManagerName: string;
    toManagerId: string;
    toManagerName: string;
    offeredPlayerId: string;
    offeredPlayerName: string;
    requestedPlayerId: string;
    requestedPlayerName: string;
    offeredCash: number;
    matchday: number;
  }) => {
    if (!room) return;
    send('PROPOSE_TRANSFER', { roomCode: room.code, offer });
  }, [room, send]);

  const respondTransfer = useCallback((offerId: string, accept: boolean) => {
    if (!room || !managerId) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      send('RESPOND_TRANSFER', { roomCode: room.code, managerId, offerId, accept });
    } else {
      setErrorMessage('Connection lost. Reconnect before responding to a transfer.');
    }
  }, [room, managerId, send]);

  const closeTransferWindow = useCallback(() => {
    if (!room || !managerId) return;
    send('CLOSE_TRANSFER_WINDOW', { roomCode: room.code, managerId });
  }, [room, managerId, send]);

  const rematch = useCallback(() => {
    if (!room) return;
    send('REMATCH', { roomCode: room.code });
  }, [room, send]);

  const leaveLobby = useCallback(() => {
    if (room && managerId && socketRef.current?.readyState === WebSocket.OPEN) {
      send('LEAVE_ROOM', { roomCode: room.code, managerId });
    }
    saveSession(null);
    managerIdRef.current = null;
    setRoom(null);
    setManagerId(null);
    setSecretBidSubmitted(null);
  }, [room, managerId, send, saveSession]);

  const currentManager = room?.managers.find(m => m.id === managerId) || null;

  return {
    room,
    managerId,
    currentManager,
    isConnected,
    errorMessage,
    isSimulating,
    simulationError,
    secretBidSubmitted,
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
    updateLineup,
    confirmTeam,
    runMatchday,
    runKnockoutMatch,
    completeKnockoutMatch,
    proceedToNextMatchday,
    finishSeason,
    proposeTransfer,
    respondTransfer,
    closeTransferWindow,
    rematch,
    leaveLobby,
    savedSession: getSavedSession(),
  };
}
