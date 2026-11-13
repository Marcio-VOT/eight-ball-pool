import {
  BALL_DIAMETER,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_THROW_FRICTION,
  CUE_BREAK_DEFAULT_X,
  CUE_BREAK_DEFAULT_Z,
  CUSHION_RESTITUTION,
  CUSHION_SEGMENTS,
  CUSHION_SPIN_GRIP,
  FIXED_DT,
  FOOT_SPOT_X,
  FOOT_SPOT_Z,
  getBallGroup,
  GRAVITY,
  HEAD_STRING_X,
  KEYFRAME_INTERVAL,
  LINEAR_SHOT_SPAN,
  MAX_SHOT_SPEED,
  MAX_SIM_SECONDS,
  MAX_TIP_OFFSET,
  MIN_SHOT_SPEED,
  MU_ROLL,
  MU_SLIDE,
  MU_SPIN,
  PLAY_HALF_LENGTH,
  PLAY_HALF_WIDTH,
  POCKETS,
  POWER_EXPONENT,
  STOP_SPIN_EPS,
  STOP_VEL_EPS,
  SUB_STEPS,
} from './constants';
import { DeterministicRng } from './prng';
import type {
  BallState,
  KeyframeBall,
  ShotInput,
  ShotKeyframe,
  ShotSimulationResult,
  SimEvent,
} from './types';

export function cloneBalls(balls: readonly BallState[]): BallState[] {
  return balls.map((b) => ({ ...b }));
}

export function createStandardRack(seed = 1): BallState[] {
  const rng = new DeterministicRng(seed);
  const solids = rng.shuffle([2, 3, 4, 5, 6, 7]);
  const stripes = rng.shuffle([9, 10, 11, 12, 13, 14, 15]);

  // Back corners must be 1 solid and 1 stripe
  const cornerSolid = solids.pop()!;
  const cornerStripe = stripes.pop()!;
  const backCorners = rng.next() < 0.5 ? [cornerSolid, cornerStripe] : [cornerStripe, cornerSolid];

  const middlePool = rng.shuffle([...solids, ...stripes]);

  const spacing = BALL_DIAMETER + 0.00004;
  const rowStep = spacing * Math.sqrt(3) * 0.5;

  const balls: BallState[] = [
    {
      id: 0,
      group: 'cue',
      x: CUE_BREAK_DEFAULT_X,
      z: CUE_BREAK_DEFAULT_Z,
      vx: 0,
      vz: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      pocketed: false,
      pocketId: null,
    },
  ];

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      let id: number;
      if (row === 0 && col === 0) {
        id = 1;
      } else if (row === 2 && col === 1) {
        id = 8;
      } else if (row === 4 && col === 0) {
        id = backCorners[0];
      } else if (row === 4 && col === 4) {
        id = backCorners[1];
      } else {
        id = middlePool.pop()!;
      }

      const x = FOOT_SPOT_X + row * rowStep + rng.range(-0.000008, 0.000008);
      const z = FOOT_SPOT_Z + (col - row * 0.5) * spacing + rng.range(-0.000008, 0.000008);

      balls.push({
        id,
        group: getBallGroup(id),
        x,
        z,
        vx: 0,
        vz: 0,
        wx: 0,
        wy: 0,
        wz: 0,
        pocketed: false,
        pocketId: null,
      });
    }
  }

  balls.sort((a, b) => a.id - b.id);
  return balls;
}

export function clampShotInput(input: ShotInput): ShotInput {
  const power = Math.max(0.02, Math.min(1, Number.isFinite(input.power) ? input.power : 0.5));
  let tipX = Number.isFinite(input.tipX) ? input.tipX : 0;
  let tipY = Number.isFinite(input.tipY) ? input.tipY : 0;
  const tipMag = Math.hypot(tipX, tipY);
  if (tipMag > MAX_TIP_OFFSET) {
    const scale = MAX_TIP_OFFSET / tipMag;
    tipX *= scale;
    tipY *= scale;
  }
  const angle = Number.isFinite(input.angle) ? input.angle : 0;
  return {
    angle,
    power,
    tipX,
    tipY,
    cueBallPos: input.cueBallPos,
  };
}

export function powerToSpeed(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  const nonLinearSpan = Math.max(0, MAX_SHOT_SPEED - MIN_SHOT_SPEED - LINEAR_SHOT_SPAN);
  return MIN_SHOT_SPEED + LINEAR_SHOT_SPAN * p + nonLinearSpan * Math.pow(p, POWER_EXPONENT);
}

export function isValidCueBallPlacement(
  balls: readonly BallState[],
  x: number,
  z: number,
  behindHeadString: boolean
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const margin = BALL_RADIUS + 0.001;
  if (x < -PLAY_HALF_LENGTH + margin || x > PLAY_HALF_LENGTH - margin) return false;
  if (z < -PLAY_HALF_WIDTH + margin || z > PLAY_HALF_WIDTH - margin) return false;
  if (behindHeadString && x > HEAD_STRING_X) return false;

  const minDistSq = (BALL_DIAMETER + 0.0005) ** 2;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.id === 0 || b.pocketed) continue;
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < minDistSq) return false;
  }
  return true;
}

export function findSafeCueBallSpot(
  balls: readonly BallState[],
  behindHeadString: boolean
): { x: number; z: number } {
  if (isValidCueBallPlacement(balls, HEAD_STRING_X, 0, behindHeadString)) {
    return { x: HEAD_STRING_X, z: 0 };
  }
  const maxX = behindHeadString ? HEAD_STRING_X : PLAY_HALF_LENGTH - BALL_RADIUS - 0.02;
  const minX = -PLAY_HALF_LENGTH + BALL_RADIUS + 0.02;
  const maxZ = PLAY_HALF_WIDTH - BALL_RADIUS - 0.02;

  for (let r = 0.02; r < 1.5; r += 0.03) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const cx = Math.max(minX, Math.min(maxX, HEAD_STRING_X + Math.cos(ang) * r));
      const cz = Math.max(-maxZ, Math.min(maxZ, Math.sin(ang) * r));
      if (isValidCueBallPlacement(balls, cx, cz, behindHeadString)) {
        return { x: cx, z: cz };
      }
    }
  }

  for (let x = minX; x <= maxX; x += 0.04) {
    for (let z = -maxZ; z <= maxZ; z += 0.04) {
      if (isValidCueBallPlacement(balls, x, z, behindHeadString)) {
        return { x, z };
      }
    }
  }

  return { x: HEAD_STRING_X, z: 0 };
}

export function findFreeFootSpot(balls: readonly BallState[]): { x: number; z: number } {
  const minDistSq = (BALL_DIAMETER + 0.001) ** 2;
  for (let offset = 0; offset <= 0.5; offset += 0.005) {
    const x = FOOT_SPOT_X + offset;
    if (x > PLAY_HALF_LENGTH - BALL_RADIUS - 0.01) break;
    let blocked = false;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.pocketed) continue;
      const dx = x - b.x;
      const dz = FOOT_SPOT_Z - b.z;
      if (dx * dx + dz * dz < minDistSq) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { x, z: FOOT_SPOT_Z };
  }
  return { x: FOOT_SPOT_X, z: FOOT_SPOT_Z };
}

function applyCueStrike(cueBall: BallState, input: ShotInput): void {
  const speed = powerToSpeed(input.power);
  const dx = Math.cos(input.angle);
  const dz = Math.sin(input.angle);

  cueBall.pocketed = false;
  cueBall.pocketId = null;
  cueBall.vx = dx * speed;
  cueBall.vz = dz * speed;

  // Follow/Draw: natural rolling has spinFactor = 1 around upper tip region without extreme slingshot
  const spinFactor = 1.5 * input.tipY;
  cueBall.wx = dz * (speed / BALL_RADIUS) * spinFactor;
  cueBall.wz = -dx * (speed / BALL_RADIUS) * spinFactor;

  // Side English around vertical +Y axis (controlled, non-excessive spin)
  cueBall.wy = 0.85 * input.tipX * (speed / BALL_RADIUS);
}

function snapshotKeyframeBalls(balls: readonly BallState[]): KeyframeBall[] {
  const out: KeyframeBall[] = new Array(balls.length);
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    out[i] = {
      id: b.id,
      x: b.x,
      z: b.z,
      vx: b.vx,
      vz: b.vz,
      wx: b.wx,
      wy: b.wy,
      wz: b.wz,
      pocketed: b.pocketed ? 1 : 0,
    };
  }
  return out;
}

function checkPockets(
  balls: BallState[],
  simTime: number,
  events: SimEvent[],
  pocketedIds: number[]
): void {
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed) continue;
    for (let pIdx = 0; pIdx < POCKETS.length; pIdx++) {
      const p = POCKETS[pIdx];
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      if (dx * dx + dz * dz <= p.dropRadius * p.dropRadius) {
        const speed = Math.hypot(b.vx, b.vz);
        b.pocketed = true;
        b.pocketId = p.id;
        b.x = p.x;
        b.z = p.z;
        b.vx = 0;
        b.vz = 0;
        b.wx = 0;
        b.wy = 0;
        b.wz = 0;
        pocketedIds.push(b.id);
        events.push({
          t: simTime,
          type: 'POCKET_DROP',
          ballId: b.id,
          pocketId: p.id,
          speed,
          x: p.x,
          z: p.z,
        });
        break;
      }
    }
  }
}

function resolveBallPairImpulse(
  a: BallState,
  b: BallState,
  nx: number,
  nz: number,
  simTime: number,
  events: SimEvent[],
  emitEvent: boolean
): boolean {
  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return false;

  const jn = -(1 + BALL_RESTITUTION) * vn * 0.5;
  a.vx -= jn * nx;
  a.vz -= jn * nz;
  b.vx += jn * nx;
  b.vz += jn * nz;

  // Subtle collision-induced throw along contact tangent
  const tx = -nz;
  const tz = nx;
  const vt = rvx * tx + rvz * tz + (a.wy + b.wy) * BALL_RADIUS * 0.25;
  const maxJt = BALL_THROW_FRICTION * Math.abs(jn);
  let jt = -0.15 * vt;
  if (jt > maxJt) jt = maxJt;
  else if (jt < -maxJt) jt = -maxJt;

  a.vx -= jt * tx;
  a.vz -= jt * tz;
  b.vx += jt * tx;
  b.vz += jt * tz;

  const impactSpeed = -vn;
  if (emitEvent && impactSpeed > 0.03) {
    events.push({
      t: simTime,
      type: 'BALL_HIT',
      ballId: a.id,
      otherBallId: b.id,
      speed: impactSpeed,
      x: (a.x + b.x) * 0.5,
      z: (a.z + b.z) * 0.5,
    });
  }
  return true;
}

const CLUSTER_GAP_SQ = (BALL_DIAMETER + 0.00045) ** 2;

function hasSimultaneousNeighbors(
  balls: readonly BallState[],
  idxA: number,
  idxB: number
): boolean {
  const a = balls[idxA];
  const b = balls[idxB];
  for (let i = 0; i < balls.length; i++) {
    if (i === idxA || i === idxB) continue;
    const c = balls[i];
    if (c.pocketed) continue;
    const da = (c.x - a.x) * (c.x - a.x) + (c.z - a.z) * (c.z - a.z);
    if (da <= CLUSTER_GAP_SQ) return true;
    const db = (c.x - b.x) * (c.x - b.x) + (c.z - b.z) * (c.z - b.z);
    if (db <= CLUSTER_GAP_SQ) return true;
  }
  return false;
}

/**
 * Symmetric Jacobi multi-contact impulse solver: eliminates sequential Newton's-cradle
 * bias in dense racks while preserving exact linear momentum conservation and passivity.
 */
function resolveTouchingClusters(
  balls: BallState[],
  simTime: number,
  events: SimEvent[],
  state: { firstHitBallId: number | null; railAfterHit: boolean }
): void {
  const nBalls = balls.length;
  const dvx = new Float64Array(nBalls);
  const dvz = new Float64Array(nBalls);
  const degree = new Uint8Array(nBalls);

  for (let pass = 0; pass < 22; pass++) {
    dvx.fill(0);
    dvz.fill(0);
    degree.fill(0);

    // First pass finds how many approaching simultaneous contacts each ball participates in
    for (let i = 0; i < nBalls; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < nBalls; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > CLUSTER_GAP_SQ) continue;
        const d = Math.sqrt(dSq);
        const nx = d > 1e-9 ? dx / d : 1;
        const nz = d > 1e-9 ? dz / d : 0;
        const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (vn < -1e-4) {
          degree[i]++;
          degree[j]++;
        }
      }
    }

    let anyImpulsed = false;
    for (let i = 0; i < nBalls; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < nBalls; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > CLUSTER_GAP_SQ) continue;
        const d = Math.sqrt(dSq);
        const nx = d > 1e-9 ? dx / d : 1;
        const nz = d > 1e-9 ? dz / d : 0;
        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn >= -1e-4) continue;

        anyImpulsed = true;
        if (state.firstHitBallId === null) {
          if (a.id === 0) state.firstHitBallId = b.id;
          else if (b.id === 0) state.firstHitBallId = a.id;
        }

        const maxDeg = Math.max(degree[i], degree[j]);
        const weight = 2 / (1 + Math.sqrt(Math.max(1, maxDeg)));
        const jn = -(1 + BALL_RESTITUTION) * vn * 0.5 * weight;

        const tx = -nz;
        const tz = nx;
        const vt = rvx * tx + rvz * tz + (a.wy + b.wy) * BALL_RADIUS * 0.25;
        const maxJt = BALL_THROW_FRICTION * Math.abs(jn);
        let jt = -0.15 * vt * weight;
        if (jt > maxJt) jt = maxJt;
        else if (jt < -maxJt) jt = -maxJt;

        const jx = jn * nx + jt * tx;
        const jz = jn * nz + jt * tz;

        dvx[i] -= jx;
        dvz[i] -= jz;
        dvx[j] += jx;
        dvz[j] += jz;

        const impactSpeed = -vn;
        if (pass === 0 && impactSpeed > 0.03) {
          events.push({
            t: simTime,
            type: 'BALL_HIT',
            ballId: a.id,
            otherBallId: b.id,
            speed: impactSpeed,
            x: (a.x + b.x) * 0.5,
            z: (a.z + b.z) * 0.5,
          });
        }
      }
    }

    if (!anyImpulsed) break;

    // Exact linear passivity guard: prevents parallel Jacobi over-relaxation from creating kinetic energy
    let vDotDv = 0;
    let dvSq = 0;
    for (let i = 0; i < nBalls; i++) {
      vDotDv += balls[i].vx * dvx[i] + balls[i].vz * dvz[i];
      dvSq += dvx[i] * dvx[i] + dvz[i] * dvz[i];
    }
    let scale = 1;
    if (dvSq > 1e-12 && 2 * vDotDv + dvSq > 0) {
      scale = Math.max(0, Math.min(1, (-2 * vDotDv) / dvSq * 0.99));
    }

    for (let i = 0; i < nBalls; i++) {
      if (dvx[i] !== 0 || dvz[i] !== 0) {
        balls[i].vx += dvx[i] * scale;
        balls[i].vz += dvz[i] * scale;
      }
    }
  }
}

function separateOverlaps(balls: BallState[]): void {
  const diam = BALL_DIAMETER;
  const diamSq = diam * diam;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.pocketed) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < diamSq - 1e-10) {
          const d = Math.sqrt(dSq);
          const nx = d > 1e-9 ? dx / d : 1;
          const nz = d > 1e-9 ? dz / d : 0;
          const pen = (diam - d) * 0.505;
          a.x -= nx * pen;
          a.z -= nz * pen;
          b.x += nx * pen;
          b.z += nz * pen;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function resolveCushionSegments(
  balls: BallState[],
  simTime: number,
  events: SimEvent[],
  state: { firstHitBallId: number | null; railAfterHit: boolean; railTotal: number }
): void {
  const rSq = BALL_RADIUS * BALL_RADIUS;

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed) continue;

    for (let s = 0; s < CUSHION_SEGMENTS.length; s++) {
      const seg = CUSHION_SEGMENTS[s];
      const abx = seg.bx - seg.ax;
      const abz = seg.bz - seg.az;
      const abLenSq = abx * abx + abz * abz;
      let t = ((b.x - seg.ax) * abx + (b.z - seg.az) * abz) / abLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const cx = seg.ax + abx * t;
      const cz = seg.az + abz * t;
      const dx = b.x - cx;
      const dz = b.z - cz;
      const dSq = dx * dx + dz * dz;

      if (dSq < rSq) {
        const d = Math.sqrt(dSq);
        const nx = d > 1e-9 ? dx / d : seg.nx;
        const nz = d > 1e-9 ? dz / d : seg.nz;

        // Ignore contact from backside of pocket jaws
        if (nx * seg.nx + nz * seg.nz < -0.25) continue;

        // Push ball outside capsule boundary
        b.x = cx + nx * BALL_RADIUS;
        b.z = cz + nz * BALL_RADIUS;

        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= (1 + CUSHION_RESTITUTION) * vn * nx;
          b.vz -= (1 + CUSHION_RESTITUTION) * vn * nz;

          // Side-english throw off cushion along tangent t = (-nz, nx)
          const tx = -nz;
          const tz = nx;
          const vSlipT = b.vx * tx + b.vz * tz + b.wy * BALL_RADIUS;
          const maxJt = 0.25 * (1 + CUSHION_RESTITUTION) * Math.abs(vn);
          let jt = -CUSHION_SPIN_GRIP * vSlipT;
          if (jt > maxJt) jt = maxJt;
          else if (jt < -maxJt) jt = -maxJt;

          b.vx += jt * tx;
          b.vz += jt * tz;
          b.wy += (1.1 * jt) / BALL_RADIUS;

          state.railTotal++;
          if (state.firstHitBallId !== null) {
            state.railAfterHit = true;
          }

          const impactSpeed = -vn;
          if (impactSpeed > 0.04) {
            events.push({
              t: simTime,
              type: 'CUSHION_HIT',
              ballId: b.id,
              speed: impactSpeed,
              x: cx,
              z: cz,
            });
          }
        }
      }
    }
  }
}

function applyClothFriction(balls: BallState[], dt: number): boolean {
  let anyMoving = false;
  const maxSpinDw = ((5 * MU_SPIN * GRAVITY) / (2 * BALL_RADIUS)) * dt;

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed) continue;

    // 1. Sliding vs Rolling friction
    const vcx = b.vx + b.wz * BALL_RADIUS;
    const vcz = b.vz - b.wx * BALL_RADIUS;
    const vcMag = Math.hypot(vcx, vcz);

    let remainingDt = dt;

    if (vcMag > 1e-5) {
      // Exact linear dv to kill slip (3.5 = 1 + 5/2 for solid sphere)
      const dvToRoll = vcMag / 3.5;
      const slideAccel = MU_SLIDE * GRAVITY;
      const timeToRoll = dvToRoll / slideAccel;

      if (timeToRoll <= remainingDt) {
        const invVc = 1 / vcMag;
        const ux = vcx * invVc;
        const uz = vcz * invVc;
        b.vx -= ux * dvToRoll;
        b.vz -= uz * dvToRoll;
        // Snap exact pure roll
        b.wx = b.vz / BALL_RADIUS;
        b.wz = -b.vx / BALL_RADIUS;
        remainingDt -= timeToRoll;
      } else {
        const dv = slideAccel * remainingDt;
        const invVc = 1 / vcMag;
        const ux = vcx * invVc;
        const uz = vcz * invVc;
        b.vx -= ux * dv;
        b.vz -= uz * dv;
        const dOmega = (2.5 * dv) / BALL_RADIUS;
        b.wx += uz * dOmega;
        b.wz -= ux * dOmega;
        remainingDt = 0;
      }
    }

    // 2. Pure rolling friction for remaining time
    if (remainingDt > 0) {
      const speed = Math.hypot(b.vx, b.vz);
      const rollDv = MU_ROLL * GRAVITY * remainingDt;
      if (speed <= rollDv || speed < STOP_VEL_EPS) {
        b.vx = 0;
        b.vz = 0;
        b.wx = 0;
        b.wz = 0;
      } else {
        const scale = (speed - rollDv) / speed;
        b.vx *= scale;
        b.vz *= scale;
        b.wx = b.vz / BALL_RADIUS;
        b.wz = -b.vx / BALL_RADIUS;
      }
    } else if (Math.hypot(b.vx, b.vz) < STOP_VEL_EPS && Math.hypot(b.wx, b.wz) < STOP_SPIN_EPS) {
      b.vx = 0;
      b.vz = 0;
      b.wx = 0;
      b.wz = 0;
    }

    // 3. Spin decay around Y axis (slow/stationary balls damp pivot spin faster so they don't twirl in place)
    const speedSq = b.vx * b.vx + b.vz * b.vz;
    const isStationary = speedSq === 0;
    const spinStepDw = isStationary
      ? maxSpinDw * 8
      : speedSq < 0.35 * 0.35
        ? maxSpinDw * 4
        : maxSpinDw;
    if (Math.abs(b.wy) <= spinStepDw || Math.abs(b.wy) < STOP_SPIN_EPS) {
      b.wy = 0;
    } else {
      b.wy -= Math.sign(b.wy) * spinStepDw;
    }

    if (
      b.vx !== 0 ||
      b.vz !== 0 ||
      b.wx !== 0 ||
      b.wy !== 0 ||
      b.wz !== 0
    ) {
      anyMoving = true;
    }
  }

  return anyMoving;
}

export function simulateShot(
  initialBalls: readonly BallState[],
  rawInput: ShotInput
): ShotSimulationResult {
  const input = clampShotInput(rawInput);
  const balls = cloneBalls(initialBalls);

  const cueBall = balls[0];
  if (input.cueBallPos) {
    cueBall.x = input.cueBallPos.x;
    cueBall.z = input.cueBallPos.z;
  }
  applyCueStrike(cueBall, input);

  const events: SimEvent[] = [];
  const pocketedIds: number[] = [];
  const keyframes: ShotKeyframe[] = [{ t: 0, balls: snapshotKeyframeBalls(balls) }];

  const state = {
    firstHitBallId: null as number | null,
    railAfterHit: false,
    railTotal: 0,
  };

  const dtSub = FIXED_DT / SUB_STEPS;
  const maxTicks = Math.ceil(MAX_SIM_SECONDS / FIXED_DT);
  let simTime = 0;
  let nextKeyframeAt = KEYFRAME_INTERVAL;

  for (let tick = 0; tick < maxTicks; tick++) {
    let anyMoving = false;

    for (let sub = 0; sub < SUB_STEPS; sub++) {
      // Continuous TOI within dtSub
      let dtRem = dtSub;

      for (let iter = 0; iter < 64 && dtRem > 1e-9; iter++) {
        let earliestT = dtRem;
        let hitA = -1;
        let hitB = -1;

        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          if (a.pocketed) continue;
          for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            if (b.pocketed) continue;

            const dpx = b.x - a.x;
            const dpz = b.z - a.z;
            const dvx = b.vx - a.vx;
            const dvz = b.vz - a.vz;

            const bDot = dpx * dvx + dpz * dvz;
            if (bDot >= 0) continue; // Moving apart or parallel

            const c = dpx * dpx + dpz * dpz - BALL_DIAMETER * BALL_DIAMETER;
            if (c <= 1e-9) {
              earliestT = 0;
              hitA = i;
              hitB = j;
              break;
            }

            const aDot = dvx * dvx + dvz * dvz;
            if (aDot < 1e-12) continue;

            const disc = bDot * bDot - aDot * c;
            if (disc < 0) continue;

            const tHit = (-bDot - Math.sqrt(disc)) / aDot;
            if (tHit >= 0 && tHit < earliestT) {
              earliestT = tHit;
              hitA = i;
              hitB = j;
            }
          }
          if (earliestT === 0) break;
        }

        if (earliestT > 0) {
          for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (b.pocketed) continue;
            b.x += b.vx * earliestT;
            b.z += b.vz * earliestT;
          }
          simTime += earliestT;
          dtRem -= earliestT;
        }

        if (hitA >= 0 && hitB >= 0) {
          if (earliestT === 0) {
            resolveTouchingClusters(balls, simTime, events, state);
            // Tiny micro-step to break zero-time loop if cluster remains touching
            const micro = Math.min(dtRem, 1e-5);
            if (micro > 0) {
              for (let i = 0; i < balls.length; i++) {
                const b = balls[i];
                if (b.pocketed) continue;
                b.x += b.vx * micro;
                b.z += b.vz * micro;
              }
              simTime += micro;
              dtRem -= micro;
            }
          } else if (hasSimultaneousNeighbors(balls, hitA, hitB)) {
            resolveTouchingClusters(balls, simTime, events, state);
          } else {
            const a = balls[hitA];
            const b = balls[hitB];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const d = Math.hypot(dx, dz);
            const nx = d > 1e-9 ? dx / d : 1;
            const nz = d > 1e-9 ? dz / d : 0;
            const hit = resolveBallPairImpulse(a, b, nx, nz, simTime, events, true);
            if (hit && state.firstHitBallId === null) {
              if (a.id === 0) state.firstHitBallId = b.id;
              else if (b.id === 0) state.firstHitBallId = a.id;
            }
          }
        } else {
          break;
        }
      }

      separateOverlaps(balls);
      resolveCushionSegments(balls, simTime, events, state);
      checkPockets(balls, simTime, events, pocketedIds);
      anyMoving = applyClothFriction(balls, dtSub);
    }

    if (simTime + 1e-9 >= nextKeyframeAt || !anyMoving) {
      keyframes.push({ t: simTime, balls: snapshotKeyframeBalls(balls) });
      nextKeyframeAt += KEYFRAME_INTERVAL;
    }

    if (!anyMoving) {
      break;
    }
  }

  // Ensure all balls come strictly to rest at end of simulation
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    b.vx = 0;
    b.vz = 0;
    b.wx = 0;
    b.wy = 0;
    b.wz = 0;
  }

  return {
    duration: simTime,
    keyframes,
    events,
    finalBalls: balls,
    firstHitBallId: state.firstHitBallId,
    pocketedIds,
    railContactAfterFirstHit: state.railAfterHit,
    railContactTotal: state.railTotal,
  };
}
