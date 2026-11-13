export type BallGroup = 'solid' | 'stripe' | 'eight' | 'cue';

export type PlayerGroup = 'solids' | 'stripes' | null;

export type FoulReason =
  | 'SCRATCH'
  | 'NO_BALL_HIT'
  | 'WRONG_BALL_FIRST'
  | 'NO_RAIL_AFTER_CONTACT'
  | 'EARLY_8_BALL'
  | '8_BALL_SCRATCH'
  | 'INVALID_BREAK_8_BALL';

export type GamePhase =
  | 'WAITING_FOR_PLAYERS'
  | 'BREAK_PLACEMENT'
  | 'AIMING'
  | 'SIMULATING'
  | 'BALL_IN_HAND'
  | 'GAME_OVER';

export interface BallState {
  id: number; // 0 = cue, 1..7 = solids, 8 = eight, 9..15 = stripes
  group: BallGroup;
  x: number;
  z: number;
  vx: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  pocketed: boolean;
  pocketId: number | null;
}

export interface CushionSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit normal pointing inward toward the playing surface */
  nx: number;
  nz: number;
  isJaw: boolean;
}

export interface PocketSpec {
  id: number;
  name: string;
  x: number;
  z: number;
  dropRadius: number;
  isCorner: boolean;
}

export interface ShotInput {
  angle: number; // radians in XZ plane: vx dir = cos(angle), vz dir = sin(angle)
  power: number; // [0.02 .. 1.0]
  tipX: number; // [-MAX_TIP_OFFSET .. +MAX_TIP_OFFSET] (+ = right english)
  tipY: number; // [-MAX_TIP_OFFSET .. +MAX_TIP_OFFSET] (+ = follow / topspin, - = draw / backspin)
  cueBallPos?: { x: number; z: number };
}

export interface SimEvent {
  t: number;
  type: 'BALL_HIT' | 'CUSHION_HIT' | 'POCKET_DROP';
  ballId: number;
  otherBallId?: number;
  pocketId?: number;
  speed: number;
  x: number;
  z: number;
}

export interface KeyframeBall {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  pocketed: number; // 0 or 1 for compact transport
}

export interface ShotKeyframe {
  t: number;
  balls: KeyframeBall[];
}

export interface ShotSimulationResult {
  duration: number;
  keyframes: ShotKeyframe[];
  events: SimEvent[];
  finalBalls: BallState[];
  firstHitBallId: number | null;
  pocketedIds: number[];
  railContactAfterFirstHit: boolean;
  railContactTotal: number;
}

export interface PlayerSlot {
  slot: 0 | 1;
  id: string;
  name: string;
  group: PlayerGroup;
  connected: boolean;
}

export interface GameStateSnapshot {
  phase: GamePhase;
  isBreakShot: boolean;
  breakBehindHeadString: boolean;
  activeSlot: 0 | 1;
  winnerSlot: 0 | 1 | null;
  winReason: string | null;
  lastFoul: {
    bySlot: 0 | 1;
    reason: FoulReason;
    message: string;
  } | null;
  turnNumber: number;
  players: [PlayerSlot | null, PlayerSlot | null];
  balls: BallState[];
  turnDeadlineAt: number | null;
}
