'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BALL_RADIUS,
  HEAD_STRING_X,
  PLAY_HALF_LENGTH,
  PLAY_HALF_WIDTH,
} from '@/engine/constants';
import {
  clampShotInput,
  isValidCueBallPlacement,
  simulateShot,
} from '@/engine/physics';
import {
  createInitialGameState,
  evaluateShotOutcome,
  getLegalTargetBallIds,
} from '@/engine/rules';
import { type InterpolatedBallPose, sampleTimelineAt } from '@/engine/timeline';
import type {
  GameStateSnapshot,
  ShotInput,
  ShotKeyframe,
  SimEvent,
} from '@/engine/types';
import { computeAimGuide } from '@/game/aimGuide';
import { PoolAudio } from '@/game/audio';
import { PoolInputController } from '@/game/inputController';
import { type CameraPreset, PoolRenderer3D } from '@/game/renderer3d';
import {
  getOrCreateTabSessionToken,
  getWebSocketUrl,
} from '@/game/session';
import type {
  RoomVisibility,
  ServerWsMessage,
  TurnTimerSec,
} from '@/shared/protocol';
import { GameHud } from './GameHud';

interface PoolTableViewProps {
  mode: 'online' | 'practice';
  roomCode?: string;
  playerName: string;
}

interface PendingTimeline {
  shotInput: ShotInput;
  duration: number;
  keyframes: ShotKeyframe[];
  events: SimEvent[];
  nextState: GameStateSnapshot;
}

function createInitialPoses(): InterpolatedBallPose[] {
  return Array.from({ length: 16 }, (_, id) => ({
    id,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    pocketed: false,
  }));
}

export function PoolTableView({
  mode,
  roomCode,
  playerName,
}: PoolTableViewProps) {
  const router = useRouter();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PoolRenderer3D | null>(null);
  const inputRef = useRef<PoolInputController | null>(null);
  const audioRef = useRef<PoolAudio | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [gameState, setGameState] = useState<GameStateSnapshot>(() =>
    createInitialGameState(
      [
        { slot: 0, id: 'p0', name: playerName || 'Treino', group: null, connected: true },
        null,
      ],
      Date.now(),
      mode === 'practice'
    )
  );
  const [yourSlot, setYourSlot] = useState<0 | 1>(0);
  const [roomMeta, setRoomMeta] = useState<{
    name: string;
    visibility: RoomVisibility;
    turnTimerSec: TurnTimerSec;
  }>({ name: 'Mesa de Sinuca', visibility: 'public', turnTimerSec: 45 });
  const [rematchVotes, setRematchVotes] = useState<[boolean, boolean]>([false, false]);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [pullPower, setPullPower] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [tipX, setTipX] = useState(0);
  const [tipY, setTipY] = useState(0);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('classic');
  const [muted, setMuted] = useState(false);

  // Mutable hot-loop refs (avoid React re-renders during 60/120fps gameplay)
  const gameStateRef = useRef<GameStateSnapshot>(gameState);
  const yourSlotRef = useRef<0 | 1>(yourSlot);
  const aimAngleRef = useRef(0);
  const pullPowerRef = useRef(0);
  const isPullingRef = useRef(false);
  const tipRef = useRef({ x: 0, y: 0 });
  const ballInHandValidRef = useRef(true);
  const lastValidCuePosRef = useRef({ x: -0.56, z: 0 });

  const waitingShotRef = useRef(false);
  const strikeDoneRef = useRef(false);
  const pendingTimelineRef = useRef<PendingTimeline | null>(null);
  const activeTimelineRef = useRef<{
    timeline: PendingTimeline;
    elapsed: number;
    nextEventIdx: number;
  } | null>(null);
  const posesRef = useRef<InterpolatedBallPose[]>(createInitialPoses());

  const oppAimRef = useRef<{
    active: boolean;
    angle: number;
    targetAngle: number;
    power: number;
    targetPower: number;
    tipX: number;
    tipY: number;
  }>({
    active: false,
    angle: 0,
    targetAngle: 0,
    power: 0,
    targetPower: 0,
    tipX: 0,
    tipY: 0,
  });

  const lastAimSentAtRef = useRef(0);
  const lastMoveSentAtRef = useRef(0);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    yourSlotRef.current = yourSlot;
  }, [yourSlot]);

  const tryBeginTimelinePlayback = useCallback(() => {
    if (!strikeDoneRef.current || !pendingTimelineRef.current) return;
    const tl = pendingTimelineRef.current;
    pendingTimelineRef.current = null;
    strikeDoneRef.current = false;
    activeTimelineRef.current = {
      timeline: tl,
      elapsed: 0,
      nextEventIdx: 0,
    };
    setIsPlayingTimeline(true);
  }, []);

  const sendAimUpdate = useCallback(() => {
    if (mode !== 'online') return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - lastAimSentAtRef.current < 40) return; // ~25Hz cap
    lastAimSentAtRef.current = now;

    const gs = gameStateRef.current;
    if (
      gs.activeSlot !== yourSlotRef.current ||
      gs.phase === 'WAITING_FOR_PLAYERS' ||
      gs.phase === 'GAME_OVER'
    ) {
      return;
    }
    const cue = gs.balls[0];
    ws.send(
      JSON.stringify({
        type: 'AIM_UPDATE',
        angle: aimAngleRef.current,
        power: pullPowerRef.current,
        tipX: tipRef.current.x,
        tipY: tipRef.current.y,
        cueBallPos:
          gs.phase === 'BALL_IN_HAND' || gs.phase === 'BREAK_PLACEMENT'
            ? { x: cue.x, z: cue.z }
            : undefined,
      })
    );
  }, [mode]);

  const executeLocalOrRemoteShot = useCallback(
    (angle: number, power: number) => {
      const gs = gameStateRef.current;
      const cue = gs.balls[0];
      const canPlace =
        gs.phase === 'BALL_IN_HAND' || gs.phase === 'BREAK_PLACEMENT';
      const safePos = ballInHandValidRef.current
        ? { x: cue.x, z: cue.z }
        : lastValidCuePosRef.current;

      if (canPlace && !ballInHandValidRef.current) {
        cue.x = safePos.x;
        cue.z = safePos.z;
        ballInHandValidRef.current = true;
      }

      const shotInput = clampShotInput({
        angle,
        power,
        tipX: tipRef.current.x,
        tipY: tipRef.current.y,
        cueBallPos: canPlace ? safePos : undefined,
      });

      audioRef.current?.unlock();
      waitingShotRef.current = true;
      strikeDoneRef.current = false;
      pendingTimelineRef.current = null;

      if (mode === 'practice') {
        const sim = simulateShot(gs.balls, shotInput);
        const nextState = evaluateShotOutcome(gs, sim, { practiceMode: true });
        pendingTimelineRef.current = {
          shotInput,
          duration: sim.duration,
          keyframes: sim.keyframes,
          events: sim.events,
          nextState,
        };
      } else {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          waitingShotRef.current = false;
          return;
        }
        ws.send(JSON.stringify({ type: 'SHOOT', shot: shotInput }));
      }

      rendererRef.current?.triggerStrikeAnimation(power, () => {
        audioRef.current?.playCueStrike(power);
        strikeDoneRef.current = true;
        tryBeginTimelinePlayback();
      });
    },
    [mode, tryBeginTimelinePlayback]
  );

  // Initialize Three.js Renderer, Audio, InputController, and animation loop
  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const audio = new PoolAudio();
    const renderer = new PoolRenderer3D(host);
    audioRef.current = audio;
    rendererRef.current = renderer;
    renderer.syncBallsImmediate(gameStateRef.current.balls);

    const input = new PoolInputController(renderer.getDomElement(), {
      getState: () => {
        const gs = gameStateRef.current;
        const myTurn =
          mode === 'practice' ||
          (gs.activeSlot === yourSlotRef.current &&
            gs.phase !== 'WAITING_FOR_PLAYERS' &&
            gs.phase !== 'GAME_OVER');
        const canInteract =
          myTurn &&
          !waitingShotRef.current &&
          !activeTimelineRef.current &&
          (gs.phase === 'AIMING' ||
            gs.phase === 'BREAK_PLACEMENT' ||
            gs.phase === 'BALL_IN_HAND');
        const canMoveCueBall =
          canInteract &&
          (gs.phase === 'BREAK_PLACEMENT' || gs.phase === 'BALL_IN_HAND');
        return {
          canInteract,
          canMoveCueBall,
          cueX: gs.balls[0]?.x ?? 0,
          cueZ: gs.balls[0]?.z ?? 0,
        };
      },
      onAimAngleChange: (angle) => {
        audio.unlock();
        aimAngleRef.current = angle;
        sendAimUpdate();
      },
      onPullPowerChange: (power, pulling) => {
        audio.unlock();
        pullPowerRef.current = power;
        isPullingRef.current = pulling;
        setPullPower(power);
        setIsPulling(pulling);
        sendAimUpdate();
      },
      onBallInHandDrag: (rawX, rawZ) => {
        const gs = gameStateRef.current;
        const margin = BALL_RADIUS + 0.002;
        const maxX = gs.breakBehindHeadString
          ? HEAD_STRING_X
          : PLAY_HALF_LENGTH - margin;
        const clampedX = Math.max(-PLAY_HALF_LENGTH + margin, Math.min(maxX, rawX));
        const clampedZ = Math.max(
          -PLAY_HALF_WIDTH + margin,
          Math.min(PLAY_HALF_WIDTH - margin, rawZ)
        );
        const valid = isValidCueBallPlacement(
          gs.balls,
          clampedX,
          clampedZ,
          gs.breakBehindHeadString
        );

        gs.balls[0].x = clampedX;
        gs.balls[0].z = clampedZ;
        ballInHandValidRef.current = valid;
        if (valid) {
          lastValidCuePosRef.current = { x: clampedX, z: clampedZ };
          if (mode === 'online') {
            const ws = wsRef.current;
            const now = performance.now();
            if (ws && ws.readyState === WebSocket.OPEN && now - lastMoveSentAtRef.current >= 40) {
              lastMoveSentAtRef.current = now;
              ws.send(
                JSON.stringify({
                  type: 'BALL_IN_HAND_MOVE',
                  x: clampedX,
                  z: clampedZ,
                })
              );
            }
          }
        }
        renderer.syncBallsImmediate(gs.balls);
      },
      onShoot: (angle, power) => {
        pullPowerRef.current = 0;
        isPullingRef.current = false;
        setPullPower(0);
        setIsPulling(false);
        executeLocalOrRemoteShot(angle, power);
      },
      screenToTable: (cx, cy) => renderer.screenToTable(cx, cy),
    });
    inputRef.current = input;

    // Expose read-only test/calibration hook on window for automated Playwright accuracy checks
    (window as unknown as { __poolDebug?: unknown }).__poolDebug = {
      getSnapshot: () => ({
        phase: gameStateRef.current.phase,
        activeSlot: gameStateRef.current.activeSlot,
        yourSlot: yourSlotRef.current,
        aimAngle: inputRef.current?.getAngle() ?? aimAngleRef.current,
        isPlayingTimeline: Boolean(activeTimelineRef.current),
        waitingShot: waitingShotRef.current,
        balls: gameStateRef.current.balls.map((b) => ({
          id: b.id,
          x: b.x,
          z: b.z,
          pocketed: b.pocketed,
          pocketId: b.pocketId,
        })),
      }),
      tableToScreen: (x: number, z: number) => renderer.tableToScreen(x, z),
    };

    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const gs = gameStateRef.current;
      const activeTl = activeTimelineRef.current;

      if (activeTl) {
        activeTl.elapsed += dt;
        const { timeline } = activeTl;

        // Trigger synchronized collision / pocket audio events
        while (activeTl.nextEventIdx < timeline.events.length) {
          const ev = timeline.events[activeTl.nextEventIdx];
          if (ev.t <= activeTl.elapsed) {
            audio.playSimEvent(ev);
            activeTl.nextEventIdx++;
          } else {
            break;
          }
        }

        sampleTimelineAt(timeline.keyframes, activeTl.elapsed, posesRef.current);
        renderer.applyTimelinePoses(posesRef.current, dt);

        renderer.setAimState({
          visible: false,
          cueX: 0,
          cueZ: 0,
          angle: 0,
          power: 0,
          tipX: 0,
          tipY: 0,
          guide: null,
          ballInHandMode: false,
          ballInHandValid: true,
          showKitchen: false,
        });

        if (activeTl.elapsed >= timeline.duration + 0.08) {
          activeTimelineRef.current = null;
          waitingShotRef.current = false;
          gameStateRef.current = timeline.nextState;
          lastValidCuePosRef.current = {
            x: timeline.nextState.balls[0].x,
            z: timeline.nextState.balls[0].z,
          };
          ballInHandValidRef.current = true;
          renderer.syncBallsImmediate(timeline.nextState.balls);
          setGameState(timeline.nextState);
          setIsPlayingTimeline(false);
        }
      } else {
        // Static aiming / ball-in-hand state
        const cue = gs.balls[0];
        const myTurn =
          mode === 'practice' || gs.activeSlot === yourSlotRef.current;
        const canAimPhase =
          gs.phase === 'AIMING' ||
          gs.phase === 'BREAK_PLACEMENT' ||
          gs.phase === 'BALL_IN_HAND';

        if (!cue.pocketed && canAimPhase && !waitingShotRef.current) {
          let showAngle = aimAngleRef.current;
          let showPower = pullPowerRef.current;
          let showTipX = tipRef.current.x;
          let showTipY = tipRef.current.y;

          if (!myTurn && oppAimRef.current.active) {
            // Smoothly interpolate opponent's remote cue aim
            const opp = oppAimRef.current;
            let delta = opp.targetAngle - opp.angle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            opp.angle += delta * Math.min(1, dt * 14);
            opp.power += (opp.targetPower - opp.power) * Math.min(1, dt * 14);
            showAngle = opp.angle;
            showPower = opp.power;
            showTipX = opp.tipX;
            showTipY = opp.tipY;
          }

          const activePlayerGroup = gs.players[gs.activeSlot]?.group ?? null;
          const legalSet = new Set(
            getLegalTargetBallIds(gs.balls, activePlayerGroup, gs.isBreakShot)
          );
          const guide =
            myTurn || oppAimRef.current.active
              ? computeAimGuide(gs.balls, showAngle, showTipY, legalSet)
              : null;

          renderer.setAimState({
            visible: myTurn || oppAimRef.current.active,
            cueX: cue.x,
            cueZ: cue.z,
            angle: showAngle,
            power: showPower,
            tipX: showTipX,
            tipY: showTipY,
            guide,
            ballInHandMode:
              myTurn &&
              (gs.phase === 'BALL_IN_HAND' || gs.phase === 'BREAK_PLACEMENT'),
            ballInHandValid: ballInHandValidRef.current,
            showKitchen:
              myTurn &&
              gs.breakBehindHeadString &&
              (gs.phase === 'BALL_IN_HAND' || gs.phase === 'BREAK_PLACEMENT'),
          });
        } else {
          renderer.setAimState({
            visible: false,
            cueX: cue?.x ?? 0,
            cueZ: cue?.z ?? 0,
            angle: 0,
            power: 0,
            tipX: 0,
            tipY: 0,
            guide: null,
            ballInHandMode: false,
            ballInHandValid: true,
            showKitchen: false,
          });
        }
      }

      renderer.renderFrame(dt);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      input.dispose();
      renderer.dispose();
      delete (window as unknown as { __poolDebug?: unknown }).__poolDebug;
    };
  }, [executeLocalOrRemoteShot, mode, sendAimUpdate, tryBeginTimelinePlayback]);

  // WebSocket multiplayer room synchronization
  useEffect(() => {
    if (mode !== 'online' || !roomCode) return;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (cancelled) return;
        const token = getOrCreateTabSessionToken();
        ws.send(
          JSON.stringify({
            type: 'JOIN_ROOM',
            code: roomCode,
            playerName,
            sessionToken: token,
          })
        );
      });

      ws.addEventListener('message', (event) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerWsMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'ROOM_JOINED': {
            setRoomError(null);
            setYourSlot(msg.yourSlot);
            yourSlotRef.current = msg.yourSlot;
            setRoomMeta({
              name: msg.name,
              visibility: msg.visibility,
              turnTimerSec: msg.turnTimerSec,
            });
            setRematchVotes(msg.rematchVotes);
            gameStateRef.current = msg.gameState;
            lastValidCuePosRef.current = {
              x: msg.gameState.balls[0].x,
              z: msg.gameState.balls[0].z,
            };
            rendererRef.current?.syncBallsImmediate(msg.gameState.balls);
            setGameState(msg.gameState);
            break;
          }
          case 'ROOM_STATE': {
            oppAimRef.current.active = false;
            waitingShotRef.current = false;
            setRematchVotes(msg.rematchVotes);
            if (!activeTimelineRef.current) {
              gameStateRef.current = msg.gameState;
              lastValidCuePosRef.current = {
                x: msg.gameState.balls[0].x,
                z: msg.gameState.balls[0].z,
              };
              rendererRef.current?.syncBallsImmediate(msg.gameState.balls);
              setGameState(msg.gameState);
            } else {
              // Preserve authoritative match/connection state changes while shot playback finishes
              const nextSt = activeTimelineRef.current.timeline.nextState;
              nextSt.players = msg.gameState.players;
              if (msg.gameState.phase === 'GAME_OVER') {
                nextSt.phase = msg.gameState.phase;
                nextSt.winnerSlot = msg.gameState.winnerSlot;
                nextSt.winReason = msg.gameState.winReason;
                nextSt.turnDeadlineAt = null;
              }
            }
            break;
          }
          case 'OPPONENT_AIM': {
            if (msg.slot === yourSlotRef.current) break;
            if (!oppAimRef.current.active) {
              oppAimRef.current.angle = msg.angle;
              oppAimRef.current.power = msg.power;
            }
            oppAimRef.current.active = true;
            oppAimRef.current.targetAngle = msg.angle;
            oppAimRef.current.targetPower = msg.power;
            oppAimRef.current.tipX = msg.tipX;
            oppAimRef.current.tipY = msg.tipY;
            if (msg.cueBallPos) {
              gameStateRef.current.balls[0].x = msg.cueBallPos.x;
              gameStateRef.current.balls[0].z = msg.cueBallPos.z;
              rendererRef.current?.syncBallsImmediate(gameStateRef.current.balls);
            }
            break;
          }
          case 'OPPONENT_BALL_IN_HAND': {
            if (msg.slot === yourSlotRef.current) break;
            gameStateRef.current.balls[0].x = msg.x;
            gameStateRef.current.balls[0].z = msg.z;
            rendererRef.current?.syncBallsImmediate(gameStateRef.current.balls);
            break;
          }
          case 'SHOT_TIMELINE': {
            oppAimRef.current.active = false;
            const tl: PendingTimeline = {
              shotInput: msg.shotInput,
              duration: msg.duration,
              keyframes: msg.keyframes,
              events: msg.events,
              nextState: msg.nextState,
            };
            pendingTimelineRef.current = tl;

            if (msg.shooterSlot === yourSlotRef.current) {
              tryBeginTimelinePlayback();
            } else {
              // Opponent shot: trigger brief strike swing before playback
              waitingShotRef.current = true;
              strikeDoneRef.current = false;
              rendererRef.current?.triggerStrikeAnimation(
                msg.shotInput.power,
                () => {
                  audioRef.current?.playCueStrike(msg.shotInput.power);
                  strikeDoneRef.current = true;
                  tryBeginTimelinePlayback();
                }
              );
            }
            break;
          }
          case 'PLAYER_CONNECTION': {
            if (!msg.connected) {
              setRematchVotes([false, false]);
            }
            const applyConn = (prev: GameStateSnapshot): GameStateSnapshot => {
              const p = prev.players[msg.slot];
              if (!p) return prev;
              const nextPlayers: GameStateSnapshot['players'] = [
                prev.players[0] ? { ...prev.players[0] } : null,
                prev.players[1] ? { ...prev.players[1] } : null,
              ];
              nextPlayers[msg.slot] = { ...p, connected: msg.connected };
              return { ...prev, players: nextPlayers };
            };
            gameStateRef.current = applyConn(gameStateRef.current);
            if (activeTimelineRef.current) {
              activeTimelineRef.current.timeline.nextState = applyConn(
                activeTimelineRef.current.timeline.nextState
              );
            }
            setGameState(applyConn);
            break;
          }
          case 'REMATCH_UPDATE': {
            setRematchVotes(msg.rematchVotes);
            break;
          }
          case 'ERROR': {
            waitingShotRef.current = false;
            setRoomError(msg.message);
            break;
          }
        }
      });

      ws.addEventListener('close', () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [mode, playerName, roomCode, tryBeginTimelinePlayback]);

  const handleTipChange = (nx: number, ny: number) => {
    tipRef.current = { x: nx, y: ny };
    setTipX(nx);
    setTipY(ny);
    sendAimUpdate();
  };

  const handleCameraChange = (preset: CameraPreset) => {
    setCameraPreset(preset);
    rendererRef.current?.setCameraPreset(preset);
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
  };

  const handleRequestRematch = () => {
    if (mode === 'online') {
      wsRef.current?.send(JSON.stringify({ type: 'REQUEST_REMATCH' }));
    }
  };

  const handleResetPractice = () => {
    if (mode !== 'practice' || activeTimelineRef.current) return;
    const fresh = createInitialGameState(
      [
        { slot: 0, id: 'p0', name: playerName || 'Treino', group: null, connected: true },
        null,
      ],
      Date.now(),
      true
    );
    waitingShotRef.current = false;
    gameStateRef.current = fresh;
    lastValidCuePosRef.current = { x: fresh.balls[0].x, z: fresh.balls[0].z };
    ballInHandValidRef.current = true;
    rendererRef.current?.syncBallsImmediate(fresh.balls);
    setGameState(fresh);
  };

  const handleLeaveRoom = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
    }
    router.push('/');
  };

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#060a0e]">
      <GameHud
        mode={mode}
        roomCode={roomCode}
        roomName={roomMeta.name}
        visibility={roomMeta.visibility}
        turnTimerSec={roomMeta.turnTimerSec}
        yourSlot={yourSlot}
        gameState={gameState}
        isPlayingTimeline={isPlayingTimeline}
        pullPower={pullPower}
        isPulling={isPulling}
        tipX={tipX}
        tipY={tipY}
        cameraPreset={cameraPreset}
        muted={muted}
        rematchVotes={rematchVotes}
        onTipChange={handleTipChange}
        onCameraChange={handleCameraChange}
        onToggleMute={handleToggleMute}
        onRequestRematch={handleRequestRematch}
        onResetPractice={handleResetPractice}
        onLeaveRoom={handleLeaveRoom}
      >
        <div
          ref={canvasHostRef}
          data-testid="pool-canvas-host"
          className="h-full w-full"
        />
      </GameHud>

      {roomError && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/95 px-4 py-3 text-sm text-rose-100 shadow-2xl"
        >
          <span>{roomError}</span>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-lg bg-rose-500 px-3 py-1 text-xs font-bold text-white hover:bg-rose-400"
          >
            Voltar ao Lobby
          </button>
        </div>
      )}
    </div>
  );
}
