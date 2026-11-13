import { z } from 'zod';
import { MAX_TIP_OFFSET } from '@/engine/constants';
import type {
  GameStateSnapshot,
  ShotInput,
  ShotKeyframe,
  SimEvent,
} from '@/engine/types';

export const RoomVisibilitySchema = z.enum(['public', 'private']);
export type RoomVisibility = z.infer<typeof RoomVisibilitySchema>;

export const TurnTimerSchema = z.union([z.literal(0), z.literal(30), z.literal(45)]);
export type TurnTimerSec = z.infer<typeof TurnTimerSchema>;

export const CreateRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Nome da sala precisa de pelo menos 2 caracteres.')
    .max(36, 'Nome da sala deve ter no máximo 36 caracteres.')
    .default('Mesa Clássica'),
  hostName: z
    .string()
    .trim()
    .min(2, 'Seu apelido precisa de pelo menos 2 caracteres.')
    .max(24, 'Seu apelido deve ter no máximo 24 caracteres.'),
  visibility: RoomVisibilitySchema.default('public'),
  turnTimerSec: TurnTimerSchema.default(45),
  sessionToken: z.string().min(8).max(128).optional(),
});

export type CreateRoomPayload = z.infer<typeof CreateRoomSchema>;

export interface PublicRoomInfo {
  code: string;
  name: string;
  hostName: string;
  playerCount: number;
  maxPlayers: 2;
  status: 'waiting' | 'playing' | 'finished';
  turnTimerSec: TurnTimerSec;
  createdAt: number;
}

const FiniteNumber = z.number().finite();

export const ShotInputSchema = z.object({
  angle: FiniteNumber,
  power: FiniteNumber.min(0.02).max(1),
  tipX: FiniteNumber.min(-MAX_TIP_OFFSET).max(MAX_TIP_OFFSET),
  tipY: FiniteNumber.min(-MAX_TIP_OFFSET).max(MAX_TIP_OFFSET),
  cueBallPos: z
    .object({
      x: FiniteNumber,
      z: FiniteNumber,
    })
    .optional(),
});

export const ClientWsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SUBSCRIBE_LOBBY') }),
  z.object({ type: z.literal('UNSUBSCRIBE_LOBBY') }),
  z.object({
    type: z.literal('JOIN_ROOM'),
    code: z.string().trim().min(4).max(12),
    playerName: z.string().trim().min(2).max(24),
    sessionToken: z.string().min(8).max(128),
  }),
  z.object({
    type: z.literal('AIM_UPDATE'),
    angle: FiniteNumber,
    power: FiniteNumber.min(0).max(1),
    tipX: FiniteNumber.min(-MAX_TIP_OFFSET).max(MAX_TIP_OFFSET),
    tipY: FiniteNumber.min(-MAX_TIP_OFFSET).max(MAX_TIP_OFFSET),
    cueBallPos: z.object({ x: FiniteNumber, z: FiniteNumber }).optional(),
  }),
  z.object({
    type: z.literal('BALL_IN_HAND_MOVE'),
    x: FiniteNumber,
    z: FiniteNumber,
  }),
  z.object({
    type: z.literal('SHOOT'),
    shot: ShotInputSchema,
  }),
  z.object({ type: z.literal('REQUEST_REMATCH') }),
  z.object({ type: z.literal('LEAVE_ROOM') }),
  z.object({ type: z.literal('PING') }),
]);

export type ClientWsMessage = z.infer<typeof ClientWsMessageSchema>;

export type ServerWsMessage =
  | { type: 'LOBBY_ROOMS'; rooms: PublicRoomInfo[] }
  | {
      type: 'ROOM_JOINED';
      code: string;
      name: string;
      visibility: RoomVisibility;
      turnTimerSec: TurnTimerSec;
      yourSlot: 0 | 1;
      sessionToken: string;
      gameState: GameStateSnapshot;
      rematchVotes: [boolean, boolean];
    }
  | {
      type: 'ROOM_STATE';
      gameState: GameStateSnapshot;
      rematchVotes: [boolean, boolean];
    }
  | {
      type: 'OPPONENT_AIM';
      slot: 0 | 1;
      angle: number;
      power: number;
      tipX: number;
      tipY: number;
      cueBallPos?: { x: number; z: number };
    }
  | {
      type: 'OPPONENT_BALL_IN_HAND';
      slot: 0 | 1;
      x: number;
      z: number;
    }
  | {
      type: 'SHOT_TIMELINE';
      shooterSlot: 0 | 1;
      shotInput: ShotInput;
      duration: number;
      keyframes: ShotKeyframe[];
      events: SimEvent[];
      nextState: GameStateSnapshot;
    }
  | {
      type: 'PLAYER_CONNECTION';
      slot: 0 | 1;
      connected: boolean;
    }
  | {
      type: 'REMATCH_UPDATE';
      rematchVotes: [boolean, boolean];
    }
  | {
      type: 'ERROR';
      code: string;
      message: string;
    }
  | { type: 'PONG' };
