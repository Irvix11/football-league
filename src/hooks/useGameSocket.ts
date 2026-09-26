import { useState, useEffect, useRef, useCallback } from 'react';
import { GameRoom, Formation, TeamTactics, TeamRoles, SquadPlayerEntry, LobbySettings } from '../types/football';
import { calculateTeamOverall } from '../constants/formations';
import { sound } from '../utils/audio';

export interface SavedSession {
  roomCode: string;
  managerId: string;
  managerName: string;
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      setErrorMessage(null);

      // Attempt reconnection if saved session exists
      const saved = getSavedSession();
      if (saved && !managerId) {
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
        const { type, room: newRoom, roomCode, managerId: assignedId, message, amount } = data;

        switch (type) {
          case 'LOBBY_CREATED':
          case 'LOBBY_JOINED':
            setRoom(newRoom);
            setManagerId(assignedId);
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

          case 'ROOM_UPDATE':
            setRoom(newRoom);
            break;

          case 'BLIND_BID_CONFIRMED':
            setSecretBidSubmitted(amount);
            sound.playBid();
            break;

          case 'ERROR':
            setErrorMessage(message);
            setTimeout(() => setErrorMessage(null), 5000);
            break;
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 2500);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket encountered error:', err);
      ws.close();
    };

    socketRef.current = ws;
  }, [getSavedSession, managerId, saveSession]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [connect]);

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
      // Fast REST creation to ensure instant, reliable setup
      const res = await fetch('/api/solo-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerName: managerName.trim(), formation }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.room && data.managerId) {
          setRoom(data.room);
          setManagerId(data.managerId);
          saveSession({
            roomCode: data.roomCode,
            managerId: data.managerId,
            managerName: managerName.trim(),
          });

          // Join socket if open
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
              type: 'JOIN_LOBBY',
              payload: { roomCode: data.roomCode, managerName: managerName.trim(), reconnectId: data.managerId }
            }));
          }
          return;
        }
      }

      // Fallback via WebSocket
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'START_SOLO_GAME',
          payload: { managerName: managerName.trim(), soloFormation: formation }
        }));
      } else {
        throw new Error('Connection failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Error starting solo game:', err);
      setErrorMessage(err.message || 'Failed to start Solo Game. Please try again.');
    }
  }, [saveSession]);

  const createLobby = useCallback((managerName: string, isSolo = false, soloFormation?: Formation) => {
    if (isSolo) {
      startSoloGame(managerName, soloFormation || '4-3-3');
      return;
    }
    send('CREATE_LOBBY', { managerName, isSolo: false });
  }, [send, startSoloGame]);

  const joinLobby = useCallback((roomCode: string, managerName: string) => {
    send('JOIN_LOBBY', { roomCode, managerName });
  }, [send]);

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

    // 1. Instant optimistic state update
    setRoom((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        managers: prev.managers.map((m) => {
          if (m.id !== managerId) return m;
          const nextFormation = formation || m.formation;
          const nextSquad = squad || m.squad;
          const nextTactics = tactics || m.tactics;
          const nextRoles = roles || m.roles;
          const nextOvr = calculateTeamOverall(nextFormation, nextSquad);
          return {
            ...m,
            formation: nextFormation,
            squad: nextSquad,
            tactics: nextTactics,
            roles: nextRoles,
            teamOverall: nextOvr,
          };
        }),
      };
    });

    // 2. WebSocket sync
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      send('UPDATE_LINEUP', { roomCode: room.code, managerId, squad, formation, tactics, roles });
    }

    // 3. Reliable REST sync
    fetch('/api/room/update-lineup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: room.code, managerId, squad, formation, tactics, roles }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.room) {
          setRoom(data.room);
        }
      })
      .catch((err) => console.warn('REST lineup update error:', err));
  }, [room, managerId, send]);

  const confirmTeam = useCallback(async () => {
    if (!room || !managerId) return;
    sound.playWhistle();

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      send('CONFIRM_TEAM', { roomCode: room.code, managerId });
    }

    try {
      const res = await fetch('/api/room/confirm-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: room.code, managerId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room) setRoom(data.room);
      }
    } catch (err) {
      // Socket handles update
    }
  }, [room, managerId, send]);

  const runMatchday = useCallback(async (matchday: number) => {
    if (!room) return;
    setIsSimulating(true);
    setSimulationError(null);
    sound.playWhistle();

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      send('RUN_MATCHDAY', { roomCode: room.code, matchday });
    }

    try {
      const res = await fetch('/api/room/run-matchday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: room.code, matchday }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to simulate matchday');
      }
      if (data.room) {
        setRoom(data.room);
      }
    } catch (err: any) {
      console.error('Simulation error:', err);
      setSimulationError(err.message || 'Error simulating matchday. Please try again.');
    } finally {
      setIsSimulating(false);
    }
  }, [room, send]);

  const proceedToNextMatchday = useCallback(async (nextMatchday: number) => {
    if (!room) return;
    setSimulationError(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      send('NEXT_MATCHDAY', { roomCode: room.code, nextMatchday });
    }

    try {
      const res = await fetch('/api/room/next-matchday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: room.code, nextMatchday }),
      });
      const data = await res.json();
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      console.error('Error proceeding to next matchday:', err);
    }
  }, [room, send]);

  const finishSeason = useCallback(async () => {
    if (!room) return;
    setSimulationError(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      send('FINISH_SEASON', { roomCode: room.code });
    }

    try {
      const res = await fetch('/api/room/finish-season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: room.code }),
      });
      const data = await res.json();
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      console.error('Error finishing season:', err);
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

  const rematch = useCallback(() => {
    if (!room) return;
    send('REMATCH', { roomCode: room.code });
  }, [room, send]);

  const leaveLobby = useCallback(() => {
    saveSession(null);
    setRoom(null);
    setManagerId(null);
    setSecretBidSubmitted(null);
  }, [saveSession]);

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
    proposeTransfer,
    rematch,
    leaveLobby,
    savedSession: getSavedSession(),
  };
}
