import crypto from 'node:crypto';
import {
  clampShotInput,
  findSafeCueBallSpot,
  isValidCueBallPlacement,
  simulateShot,
} from '@/engine/physics';
import { createInitialGameState, evaluateShotOutcome } from '@/engine/rules';
import type {
  GameStateSnapshot,
  PlayerSlot,
  ShotInput,
  ShotKeyframe,
  SimEvent,
} from '@/engine/types';
import type {
  CreateRoomPayload,
  PublicRoomInfo,
  RoomVisibility,
  TurnTimerSec,
} from '@/shared/protocol';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_GRACE_MS = 60_000;
const FINISHED_ROOM_TTL_MS = 15 * 60_000;

export interface RoomRecord {
  code: string;
  name: string;
  visibility: RoomVisibility;
  turnTimerSec: TurnTimerSec;
  createdAt: number;
  lastActivityAt: number;
  starterSlot: 0 | 1;
  shotLockUntil: number;
  slotTokens: [string | null, string | null];
  disconnectedAt: [number | null, number | null];
  rematchVotes: [boolean, boolean];
  gameState: GameStateSnapshot;
}

export type JoinRoomResult =
  | { ok: true; room: RoomRecord; slot: 0 | 1; sessionToken: string }
  | { ok: false; code: 'ROOM_NOT_FOUND' | 'ROOM_FULL'; message: string };

export type ShootResult =
  | {
      ok: true;
      room: RoomRecord;
      shooterSlot: 0 | 1;
      shotInput: ShotInput;
      duration: number;
      keyframes: ShotKeyframe[];
      events: SimEvent[];
      nextState: GameStateSnapshot;
    }
  | { ok: false; code: string; message: string };

export class RoomStore {
  private rooms = new Map<string, RoomRecord>();

  private generateCode(): string {
    for (let attempt = 0; attempt < 32; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  createRoom(payload: CreateRoomPayload): {
    room: RoomRecord;
    hostSessionToken: string;
    invitePath: string;
  } {
    const code = this.generateCode();
    const hostToken = payload.sessionToken || crypto.randomUUID();
    const hostPlayer: PlayerSlot = {
      slot: 0,
      id: 'p0',
      name: payload.hostName,
      group: null,
      connected: false,
    };

    const now = Date.now();
    const room: RoomRecord = {
      code,
      name: payload.name,
      visibility: payload.visibility,
      turnTimerSec: payload.turnTimerSec,
      createdAt: now,
      lastActivityAt: now,
      starterSlot: 0,
      shotLockUntil: 0,
      slotTokens: [hostToken, null],
      disconnectedAt: [now, null],
      rematchVotes: [false, false],
      gameState: createInitialGameState([hostPlayer, null], now),
    };

    this.rooms.set(code, room);
    return {
      room,
      hostSessionToken: hostToken,
      invitePath: `/room/${code}`,
    };
  }

  getRoom(code: string): RoomRecord | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  listPublicRooms(): PublicRoomInfo[] {
    const list: PublicRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public') continue;
      const p0 = room.gameState.players[0];
      const p1 = room.gameState.players[1];
      const playerCount = (p0 ? 1 : 0) + (p1 ? 1 : 0);
      const status: PublicRoomInfo['status'] =
        room.gameState.phase === 'GAME_OVER'
          ? 'finished'
          : playerCount === 2
            ? 'playing'
            : 'waiting';
      list.push({
        code: room.code,
        name: room.name,
        hostName: p0?.name ?? p1?.name ?? 'Anfitrião',
        playerCount,
        maxPlayers: 2,
        status,
        turnTimerSec: room.turnTimerSec,
        createdAt: room.createdAt,
      });
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }

  getRoomPublicMeta(code: string): PublicRoomInfo | null {
    const room = this.getRoom(code);
    if (!room) return null;
    const p0 = room.gameState.players[0];
    const p1 = room.gameState.players[1];
    const playerCount = (p0 ? 1 : 0) + (p1 ? 1 : 0);
    const status: PublicRoomInfo['status'] =
      room.gameState.phase === 'GAME_OVER'
        ? 'finished'
        : playerCount === 2
          ? 'playing'
          : 'waiting';
    return {
      code: room.code,
      name: room.name,
      hostName: p0?.name ?? p1?.name ?? 'Anfitrião',
      playerCount,
      maxPlayers: 2,
      status,
      turnTimerSec: room.turnTimerSec,
      createdAt: room.createdAt,
    };
  }

  joinRoom(rawCode: string, playerName: string, sessionToken: string): JoinRoomResult {
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: 'Sala não encontrada ou já encerrada.',
      };
    }

    const now = Date.now();
    room.lastActivityAt = now;

    // 1. Reconnect existing session token
    for (const slot of [0, 1] as const) {
      if (room.slotTokens[slot] === sessionToken && room.gameState.players[slot]) {
        const player = room.gameState.players[slot]!;
        player.connected = true;
        if (playerName.trim().length >= 2) {
          player.name = playerName.trim().slice(0, 24);
        }
        room.disconnectedAt[slot] = null;
        return { ok: true, room, slot, sessionToken };
      }
    }

    // 2. Claim open slot
    const openSlot: 0 | 1 | null =
      room.gameState.players[0] === null
        ? 0
        : room.gameState.players[1] === null
          ? 1
          : null;

    if (openSlot === null) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        message: 'Esta sala já está lotada (2/2 jogadores).',
      };
    }

    room.slotTokens[openSlot] = sessionToken;
    room.disconnectedAt[openSlot] = null;
    room.gameState.players[openSlot] = {
      slot: openSlot,
      id: `p${openSlot}`,
      name: playerName.trim().slice(0, 24),
      group: null,
      connected: true,
    };

    // Start match when both slots are occupied
    if (
      room.gameState.players[0] !== null &&
      room.gameState.players[1] !== null &&
      room.gameState.phase === 'WAITING_FOR_PLAYERS'
    ) {
      room.gameState.phase = 'BREAK_PLACEMENT';
      room.gameState.turnDeadlineAt =
        room.turnTimerSec > 0 ? now + room.turnTimerSec * 1000 : null;
    }

    return { ok: true, room, slot: openSlot, sessionToken };
  }

  markDisconnected(code: string, slot: 0 | 1): RoomRecord | null {
    const room = this.getRoom(code);
    if (!room) return null;
    const player = room.gameState.players[slot];
    if (!player) return null;
    player.connected = false;
    room.disconnectedAt[slot] = Date.now();
    return room;
  }

  leaveRoom(code: string, slot: 0 | 1): { deleted: boolean; room: RoomRecord | null } {
    const room = this.getRoom(code);
    if (!room) return { deleted: false, room: null };

    if (room.gameState.phase === 'WAITING_FOR_PLAYERS') {
      room.gameState.players[slot] = null;
      room.slotTokens[slot] = null;
      room.disconnectedAt[slot] = null;
      if (!room.gameState.players[0] && !room.gameState.players[1]) {
        this.rooms.delete(room.code);
        return { deleted: true, room: null };
      }
      return { deleted: false, room };
    }

    // Active match: forfeit to remaining player if game not over yet
    if (room.gameState.phase !== 'GAME_OVER') {
      const winnerSlot: 0 | 1 = slot === 0 ? 1 : 0;
      const leaverName = room.gameState.players[slot]?.name ?? 'Adversário';
      room.gameState.phase = 'GAME_OVER';
      room.gameState.winnerSlot = winnerSlot;
      room.gameState.winReason = `${leaverName} saiu da sala.`;
      room.gameState.turnDeadlineAt = null;
    }
    const player = room.gameState.players[slot];
    if (player) {
      player.connected = false;
    }
    room.slotTokens[slot] = null;
    room.rematchVotes = [false, false];
    room.disconnectedAt[slot] = Date.now();

    const p0Conn = Boolean(room.gameState.players[0]?.connected);
    const p1Conn = Boolean(room.gameState.players[1]?.connected);
    if (!p0Conn && !p1Conn) {
      this.rooms.delete(room.code);
      return { deleted: true, room: null };
    }
    return { deleted: false, room };
  }

  moveBallInHand(code: string, slot: 0 | 1, x: number, z: number): boolean {
    const room = this.getRoom(code);
    if (!room) return false;
    const gs = room.gameState;
    if (gs.activeSlot !== slot) return false;
    if (gs.phase !== 'BALL_IN_HAND' && gs.phase !== 'BREAK_PLACEMENT') return false;
    if (Date.now() < room.shotLockUntil) return false;

    if (!isValidCueBallPlacement(gs.balls, x, z, gs.breakBehindHeadString)) {
      return false;
    }
    gs.balls[0].x = x;
    gs.balls[0].z = z;
    gs.balls[0].pocketed = false;
    gs.balls[0].pocketId = null;
    room.lastActivityAt = Date.now();
    return true;
  }

  executeShot(code: string, slot: 0 | 1, rawInput: ShotInput): ShootResult {
    const room = this.getRoom(code);
    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND', message: 'Sala não encontrada.' };
    }

    const now = Date.now();
    const gs = room.gameState;

    if (
      gs.phase !== 'BREAK_PLACEMENT' &&
      gs.phase !== 'AIMING' &&
      gs.phase !== 'BALL_IN_HAND'
    ) {
      return { ok: false, code: 'INVALID_PHASE', message: 'Não é possível tacar agora.' };
    }

    if (gs.activeSlot !== slot) {
      return { ok: false, code: 'NOT_YOUR_TURN', message: 'Aguarde sua vez de jogar.' };
    }

    if (now < room.shotLockUntil) {
      return {
        ok: false,
        code: 'SHOT_IN_PROGRESS',
        message: 'Aguarde as bolas pararem completamente.',
      };
    }

    const shotInput = clampShotInput(rawInput);

    // Validate optional final cue ball placement
    if (shotInput.cueBallPos) {
      if (gs.phase !== 'BALL_IN_HAND' && gs.phase !== 'BREAK_PLACEMENT') {
        shotInput.cueBallPos = undefined;
      } else if (
        !isValidCueBallPlacement(
          gs.balls,
          shotInput.cueBallPos.x,
          shotInput.cueBallPos.z,
          gs.breakBehindHeadString
        )
      ) {
        return {
          ok: false,
          code: 'INVALID_CUE_POS',
          message: 'Posição inválida para a bola branca.',
        };
      }
    }

    const simResult = simulateShot(gs.balls, shotInput);
    const nextState = evaluateShotOutcome(gs, simResult, { practiceMode: false });

    const simDurationMs = Math.ceil(simResult.duration * 1000);
    room.shotLockUntil = now + simDurationMs + 150;
    room.lastActivityAt = now;

    if (room.turnTimerSec > 0 && nextState.phase !== 'GAME_OVER') {
      nextState.turnDeadlineAt = room.shotLockUntil + room.turnTimerSec * 1000;
    } else {
      nextState.turnDeadlineAt = null;
    }

    room.gameState = nextState;
    room.rematchVotes = [false, false];

    return {
      ok: true,
      room,
      shooterSlot: slot,
      shotInput,
      duration: simResult.duration,
      keyframes: simResult.keyframes,
      events: simResult.events,
      nextState,
    };
  }

  requestRematch(code: string, slot: 0 | 1): { room: RoomRecord; restarted: boolean } | null {
    const room = this.getRoom(code);
    if (!room) return null;
    if (room.gameState.phase !== 'GAME_OVER') return null;
    if (!room.gameState.players[0]?.connected || !room.gameState.players[1]?.connected) return null;

    room.rematchVotes[slot] = true;
    room.lastActivityAt = Date.now();

    if (room.rematchVotes[0] && room.rematchVotes[1]) {
      room.starterSlot = room.starterSlot === 0 ? 1 : 0;
      const p0: PlayerSlot = { ...room.gameState.players[0], group: null };
      const p1: PlayerSlot = { ...room.gameState.players[1], group: null };
      const now = Date.now();
      const fresh = createInitialGameState([p0, p1], now);
      fresh.activeSlot = room.starterSlot;
      fresh.turnDeadlineAt =
        room.turnTimerSec > 0 ? now + room.turnTimerSec * 1000 : null;
      room.gameState = fresh;
      room.rematchVotes = [false, false];
      room.shotLockUntil = 0;
      return { room, restarted: true };
    }

    return { room, restarted: false };
  }

  sweepTimersAndRooms(now = Date.now()): {
    timedOutRooms: RoomRecord[];
    lobbyChanged: boolean;
  } {
    const timedOutRooms: RoomRecord[] = [];
    let lobbyChanged = false;

    for (const [code, room] of this.rooms.entries()) {
      // 1. Turn timer expiration
      const gs = room.gameState;
      if (
        gs.turnDeadlineAt !== null &&
        now >= gs.turnDeadlineAt &&
        now >= room.shotLockUntil &&
        (gs.phase === 'AIMING' ||
          gs.phase === 'BALL_IN_HAND' ||
          gs.phase === 'BREAK_PLACEMENT')
      ) {
        const prevSlot = gs.activeSlot;
        const nextSlot: 0 | 1 = prevSlot === 0 ? 1 : 0;
        const safePos = findSafeCueBallSpot(gs.balls, gs.breakBehindHeadString);
        gs.balls[0].x = safePos.x;
        gs.balls[0].z = safePos.z;
        gs.balls[0].pocketed = false;
        gs.activeSlot = nextSlot;
        gs.phase = 'BALL_IN_HAND';
        gs.lastFoul = {
          bySlot: prevSlot,
          reason: 'NO_BALL_HIT',
          message: 'Tempo esgotado! Bola na mão para o adversário.',
        };
        gs.turnNumber += 1;
        gs.turnDeadlineAt =
          room.turnTimerSec > 0 ? now + room.turnTimerSec * 1000 : null;
        timedOutRooms.push(room);
      }

      // 2. Disconnect grace & idle cleanup
      const p0 = gs.players[0];
      const p1 = gs.players[1];
      const bothDisconnected =
        (!p0 || !p0.connected) && (!p1 || !p1.connected);

      if (bothDisconnected) {
        const lastDc = Math.max(
          room.disconnectedAt[0] ?? room.createdAt,
          room.disconnectedAt[1] ?? room.createdAt
        );
        if (now - lastDc > ROOM_IDLE_GRACE_MS) {
          this.rooms.delete(code);
          if (room.visibility === 'public') lobbyChanged = true;
          continue;
        }
      }

      // Forfeit if one player stayed disconnected > ROOM_IDLE_GRACE_MS during active game
      for (const slot of [0, 1] as const) {
        const p = gs.players[slot];
        const dcAt = room.disconnectedAt[slot];
        if (
          p &&
          !p.connected &&
          dcAt !== null &&
          now - dcAt > ROOM_IDLE_GRACE_MS &&
          gs.phase !== 'WAITING_FOR_PLAYERS' &&
          gs.phase !== 'GAME_OVER'
        ) {
          gs.phase = 'GAME_OVER';
          gs.winnerSlot = slot === 0 ? 1 : 0;
          gs.winReason = `${p.name} perdeu a conexão por tempo excedido.`;
          gs.turnDeadlineAt = null;
          timedOutRooms.push(room);
          if (room.visibility === 'public') lobbyChanged = true;
        }
      }

      if (
        gs.phase === 'GAME_OVER' &&
        now - room.lastActivityAt > FINISHED_ROOM_TTL_MS
      ) {
        this.rooms.delete(code);
        if (room.visibility === 'public') lobbyChanged = true;
      }
    }

    return { timedOutRooms, lobbyChanged };
  }
}

declare global {
  var __poolRoomStore: RoomStore | undefined;
}

export function getRoomStore(): RoomStore {
  if (!globalThis.__poolRoomStore) {
    globalThis.__poolRoomStore = new RoomStore();
  }
  return globalThis.__poolRoomStore;
}
