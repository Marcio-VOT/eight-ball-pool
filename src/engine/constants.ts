import type { BallGroup, CushionSegment, PocketSpec } from './types';

// Standard 8-ft tournament playing surface in meters (2:1 aspect ratio)
export const PLAY_HALF_LENGTH = 1.12; // 2.24m total length
export const PLAY_HALF_WIDTH = 0.56; // 1.12m total width

// Standard 2.25-inch (57.15mm) pool ball
export const BALL_RADIUS = 0.028575;
export const BALL_DIAMETER = BALL_RADIUS * 2;
export const BALL_MASS = 0.17;

// Table spots
export const HEAD_STRING_X = -PLAY_HALF_LENGTH * 0.5; // -0.56
export const FOOT_SPOT_X = PLAY_HALF_LENGTH * 0.5; // +0.56
export const FOOT_SPOT_Z = 0;
export const CUE_BREAK_DEFAULT_X = HEAD_STRING_X;
export const CUE_BREAK_DEFAULT_Z = 0;

// Physics parameters tuned for natural tournament cloth & phenolic balls
export const GRAVITY = 9.81;
export const MU_SLIDE = 0.22;
export const MU_ROLL = 0.04;
export const MU_SPIN = 0.075;

export const BALL_RESTITUTION = 0.945;
export const CUSHION_RESTITUTION = 0.82;
export const CUSHION_SPIN_GRIP = 0.15;
export const BALL_THROW_FRICTION = 0.035;

export const MIN_SHOT_SPEED = 0.48;
export const LINEAR_SHOT_SPAN = 0.88;
export const MAX_SHOT_SPEED = 6.9;
export const POWER_EXPONENT = 2.85;
export const MAX_TIP_OFFSET = 0.6; // Fraction of BALL_RADIUS

export const FIXED_DT = 1 / 120;
export const SUB_STEPS = 4;
export const KEYFRAME_INTERVAL = 1 / 30;
export const MAX_SIM_SECONDS = 18;

export const STOP_VEL_EPS = 0.0045;
export const STOP_SPIN_EPS = 0.18;

// Pocket openings & rail geometry
const HL = PLAY_HALF_LENGTH;
const HW = PLAY_HALF_WIDTH;
const R = BALL_RADIUS;

export const CORNER_OPEN = 3.05 * R; // ~0.08715m -> ~123mm diagonal corner mouth
export const SIDE_OPEN = 2.35 * R; // ~0.06715m -> ~134mm side mouth
const SIDE_THROAT_HALF = 1.65 * R;
const JAW_DEPTH = 0.072;
const CORNER_JAW_OUT = 0.068;
const CORNER_JAW_IN = 0.008;

function makeSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  inwardTargetX: number,
  inwardTargetZ: number,
  isJaw: boolean
): CushionSegment {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  // Candidate normals perpendicular to AB
  let nx = -dz / len;
  let nz = dx / len;
  const mx = (ax + bx) * 0.5;
  const mz = (az + bz) * 0.5;
  const toCenterDot = (inwardTargetX - mx) * nx + (inwardTargetZ - mz) * nz;
  if (toCenterDot < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { ax, az, bx, bz, nx, nz, isJaw };
}

export const CUSHION_SEGMENTS: readonly CushionSegment[] = [
  // Top rail (left & right of side pocket)
  makeSegment(-HL + CORNER_OPEN, -HW, -SIDE_OPEN, -HW, 0, 0, false),
  makeSegment(SIDE_OPEN, -HW, HL - CORNER_OPEN, -HW, 0, 0, false),

  // Bottom rail (left & right of side pocket)
  makeSegment(-HL + CORNER_OPEN, HW, -SIDE_OPEN, HW, 0, 0, false),
  makeSegment(SIDE_OPEN, HW, HL - CORNER_OPEN, HW, 0, 0, false),

  // Left & Right rails
  makeSegment(-HL, -HW + CORNER_OPEN, -HL, HW - CORNER_OPEN, 0, 0, false),
  makeSegment(HL, -HW + CORNER_OPEN, HL, HW - CORNER_OPEN, 0, 0, false),

  // Top-Mid side pocket jaws
  makeSegment(-SIDE_OPEN, -HW, -SIDE_THROAT_HALF, -HW - JAW_DEPTH, 0, -HW - JAW_DEPTH * 0.5, true),
  makeSegment(SIDE_OPEN, -HW, SIDE_THROAT_HALF, -HW - JAW_DEPTH, 0, -HW - JAW_DEPTH * 0.5, true),

  // Bottom-Mid side pocket jaws
  makeSegment(-SIDE_OPEN, HW, -SIDE_THROAT_HALF, HW + JAW_DEPTH, 0, HW + JAW_DEPTH * 0.5, true),
  makeSegment(SIDE_OPEN, HW, SIDE_THROAT_HALF, HW + JAW_DEPTH, 0, HW + JAW_DEPTH * 0.5, true),

  // Top-Left corner pocket jaws
  makeSegment(-HL + CORNER_OPEN, -HW, -HL + CORNER_JAW_IN, -HW - CORNER_JAW_OUT, -HL - 0.03, -HW - 0.03, true),
  makeSegment(-HL, -HW + CORNER_OPEN, -HL - CORNER_JAW_OUT, -HW + CORNER_JAW_IN, -HL - 0.03, -HW - 0.03, true),

  // Top-Right corner pocket jaws
  makeSegment(HL - CORNER_OPEN, -HW, HL - CORNER_JAW_IN, -HW - CORNER_JAW_OUT, HL + 0.03, -HW - 0.03, true),
  makeSegment(HL, -HW + CORNER_OPEN, HL + CORNER_JAW_OUT, -HW + CORNER_JAW_IN, HL + 0.03, -HW - 0.03, true),

  // Bottom-Right corner pocket jaws
  makeSegment(HL - CORNER_OPEN, HW, HL - CORNER_JAW_IN, HW + CORNER_JAW_OUT, HL + 0.03, HW + 0.03, true),
  makeSegment(HL, HW - CORNER_OPEN, HL + CORNER_JAW_OUT, HW - CORNER_JAW_IN, HL + 0.03, HW + 0.03, true),

  // Bottom-Left corner pocket jaws
  makeSegment(-HL + CORNER_OPEN, HW, -HL + CORNER_JAW_IN, HW + CORNER_JAW_OUT, -HL - 0.03, HW + 0.03, true),
  makeSegment(-HL, HW - CORNER_OPEN, -HL - CORNER_JAW_OUT, HW - CORNER_JAW_IN, -HL - 0.03, HW + 0.03, true),
];

export const POCKETS: readonly PocketSpec[] = [
  { id: 0, name: 'Canto Sup. Esq.', x: -HL - 0.03, z: -HW - 0.03, dropRadius: 1.66 * R, isCorner: true },
  { id: 1, name: 'Canto Sup. Dir.', x: HL + 0.03, z: -HW - 0.03, dropRadius: 1.66 * R, isCorner: true },
  { id: 2, name: 'Canto Inf. Dir.', x: HL + 0.03, z: HW + 0.03, dropRadius: 1.66 * R, isCorner: true },
  { id: 3, name: 'Canto Inf. Esq.', x: -HL - 0.03, z: HW + 0.03, dropRadius: 1.66 * R, isCorner: true },
  { id: 4, name: 'Meio Superior', x: 0, z: -HW - 0.038, dropRadius: 1.62 * R, isCorner: false },
  { id: 5, name: 'Meio Inferior', x: 0, z: HW + 0.038, dropRadius: 1.62 * R, isCorner: false },
];

export function getBallGroup(id: number): BallGroup {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  if (id >= 1 && id <= 7) return 'solid';
  return 'stripe';
}

export const BALL_COLORS: Record<number, string> = {
  0: '#f7f4ec',
  1: '#f0b917',
  2: '#1d4ed8',
  3: '#dc2626',
  4: '#6d28d9',
  5: '#ea580c',
  6: '#15803d',
  7: '#7f1d1d',
  8: '#18181b',
  9: '#f0b917',
  10: '#1d4ed8',
  11: '#dc2626',
  12: '#6d28d9',
  13: '#ea580c',
  14: '#15803d',
  15: '#7f1d1d',
};
