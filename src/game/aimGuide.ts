import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHION_SEGMENTS,
} from '@/engine/constants';
import type { BallState } from '@/engine/types';

export interface AimGuideResult {
  cueStart: { x: number; z: number };
  ghostPos: { x: number; z: number };
  hitType: 'ball' | 'cushion';
  hitBallId: number | null;
  isLegalTarget: boolean;
  targetStart: { x: number; z: number } | null;
  targetEnd: { x: number; z: number } | null;
  cuePostEnd: { x: number; z: number } | null;
}

function raySegmentHitDistance(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number | null {
  const sx = bx - ax;
  const sz = bz - az;
  const denom = dx * sz - dz * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qpx = ax - ox;
  const qpz = az - oz;
  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * dz - qpz * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

function rayCircleHitDistance(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  cx: number,
  cz: number,
  radius: number
): { t: number; nx: number; nz: number } | null {
  const fx = ox - cx;
  const fz = oz - cz;
  const b = fx * dx + fz * dz;
  if (b >= 0) return null; // Target behind ray
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const hx = ox + dx * t;
  const hz = oz + dz * t;
  const nx = (hx - cx) / radius;
  const nz = (hz - cz) / radius;
  return { t, nx, nz };
}

function clampRayMaxDistance(
  balls: readonly BallState[],
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  ignoreBallIds: ReadonlySet<number>
): number {
  let limit = maxDist;

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.pocketed || ignoreBallIds.has(b.id)) continue;
    const hit = rayCircleHitDistance(ox, oz, dx, dz, b.x, b.z, BALL_DIAMETER);
    if (hit && hit.t < limit) {
      limit = Math.max(BALL_RADIUS, hit.t);
    }
  }

  for (let s = 0; s < CUSHION_SEGMENTS.length; s++) {
    const seg = CUSHION_SEGMENTS[s];
    if (dx * seg.nx + dz * seg.nz >= 0) continue;
    const tSeg = raySegmentHitDistance(
      ox,
      oz,
      dx,
      dz,
      seg.ax + seg.nx * BALL_RADIUS,
      seg.az + seg.nz * BALL_RADIUS,
      seg.bx + seg.nx * BALL_RADIUS,
      seg.bz + seg.nz * BALL_RADIUS
    );
    if (tSeg !== null && tSeg < limit) {
      limit = Math.max(BALL_RADIUS, tSeg);
    }
  }

  return limit;
}

export function computeAimGuide(
  balls: readonly BallState[],
  angle: number,
  tipY: number,
  legalTargetIds: ReadonlySet<number>
): AimGuideResult | null {
  const cue = balls[0];
  if (!cue || cue.pocketed) return null;

  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const ox = cue.x;
  const oz = cue.z;

  let bestT = Infinity;
  let hitType: 'ball' | 'cushion' = 'cushion';
  let hitBall: BallState | null = null;
  let hitNormal = { x: -dx, z: -dz };

  // 1. Check all unpocketed object balls (swept sphere of radius 2R)
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.id === 0 || b.pocketed) continue;
    const hit = rayCircleHitDistance(ox, oz, dx, dz, b.x, b.z, BALL_DIAMETER);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      hitType = 'ball';
      hitBall = b;
      hitNormal = { x: hit.nx, z: hit.nz };
    }
  }

  // 2. Check all cushion & jaw segments inflated by BALL_RADIUS
  for (let s = 0; s < CUSHION_SEGMENTS.length; s++) {
    const seg = CUSHION_SEGMENTS[s];
    // Only test inward-facing side
    if (dx * seg.nx + dz * seg.nz >= 0) continue;

    // Offset segment inward by BALL_RADIUS along segment normal
    const offAx = seg.ax + seg.nx * BALL_RADIUS;
    const offAz = seg.az + seg.nz * BALL_RADIUS;
    const offBx = seg.bx + seg.nx * BALL_RADIUS;
    const offBz = seg.bz + seg.nz * BALL_RADIUS;

    const tSeg = raySegmentHitDistance(ox, oz, dx, dz, offAx, offAz, offBx, offBz);
    if (tSeg !== null && tSeg < bestT) {
      bestT = tSeg;
      hitType = 'cushion';
      hitBall = null;
      hitNormal = { x: seg.nx, z: seg.nz };
    }

    // Also test rounded knuckle caps at segment endpoints
    for (const [ex, ez] of [
      [seg.ax, seg.az],
      [seg.bx, seg.bz],
    ]) {
      const hitCap = rayCircleHitDistance(ox, oz, dx, dz, ex, ez, BALL_RADIUS);
      if (
        hitCap &&
        hitCap.t < bestT &&
        hitCap.nx * seg.nx + hitCap.nz * seg.nz >= -0.2
      ) {
        bestT = hitCap.t;
        hitType = 'cushion';
        hitBall = null;
        hitNormal = { x: hitCap.nx, z: hitCap.nz };
      }
    }
  }

  if (!Number.isFinite(bestT)) {
    bestT = 1.5;
  }

  const ghostX = ox + dx * bestT;
  const ghostZ = oz + dz * bestT;
  const cueRayStartDist = Math.min(BALL_RADIUS * 1.02, bestT * 0.5);
  const cueStart = {
    x: ox + dx * cueRayStartDist,
    z: oz + dz * cueRayStartDist,
  };

  if (hitType === 'ball' && hitBall) {
    // Normal pointing from ghost ball center to object ball center
    const tx = hitBall.x - ghostX;
    const tz = hitBall.z - ghostZ;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = tx / tLen;
    const nz = tz / tLen;

    const impactDot = Math.max(0, dx * nx + dz * nz);
    const maxTargetLen = BALL_RADIUS + (0.045 + 0.035 * impactDot);
    const clampedTargetLen = clampRayMaxDistance(
      balls,
      hitBall.x,
      hitBall.z,
      nx,
      nz,
      maxTargetLen,
      new Set([0, hitBall.id])
    );

    // Post-contact cue ball tangent deflection + subtle follow/draw spin preview
    const tanX = dx - impactDot * nx;
    const tanZ = dz - impactDot * nz;
    const spinBias = tipY * 0.42 * impactDot;
    const defX = tanX + spinBias * nx;
    const defZ = tanZ + spinBias * nz;
    const defMag = Math.hypot(defX, defZ);

    let cuePostEnd: { x: number; z: number } | null = null;
    if (defMag > 0.03) {
      const postUx = defX / defMag;
      const postUz = defZ / defMag;
      const desiredPostLen = Math.min(0.095, BALL_RADIUS + 0.025 + defMag * 0.038);
      const clampedPostLen = clampRayMaxDistance(
        balls,
        ghostX,
        ghostZ,
        postUx,
        postUz,
        desiredPostLen,
        new Set([0, hitBall.id])
      );
      if (clampedPostLen > BALL_RADIUS * 1.12) {
        cuePostEnd = {
          x: ghostX + postUx * clampedPostLen,
          z: ghostZ + postUz * clampedPostLen,
        };
      }
    }

    const targetStartDist = Math.min(BALL_RADIUS * 0.98, clampedTargetLen * 0.5);
    return {
      cueStart,
      ghostPos: { x: ghostX, z: ghostZ },
      hitType: 'ball',
      hitBallId: hitBall.id,
      isLegalTarget: legalTargetIds.has(hitBall.id),
      targetStart: {
        x: hitBall.x + nx * targetStartDist,
        z: hitBall.z + nz * targetStartDist,
      },
      targetEnd: {
        x: hitBall.x + nx * clampedTargetLen,
        z: hitBall.z + nz * clampedTargetLen,
      },
      cuePostEnd,
    };
  }

  // Cushion reflection preview
  const vn = dx * hitNormal.x + dz * hitNormal.z;
  const refX = dx - 2 * vn * hitNormal.x;
  const refZ = dz - 2 * vn * hitNormal.z;
  const refLen = Math.hypot(refX, refZ) || 1;
  const refUx = refX / refLen;
  const refUz = refZ / refLen;
  const clampedBounce = clampRayMaxDistance(
    balls,
    ghostX + refUx * 0.004,
    ghostZ + refUz * 0.004,
    refUx,
    refUz,
    0.11,
    new Set([0])
  );

  return {
    cueStart,
    ghostPos: { x: ghostX, z: ghostZ },
    hitType: 'cushion',
    hitBallId: null,
    isLegalTarget: true,
    targetStart: null,
    targetEnd: null,
    cuePostEnd: {
      x: ghostX + refUx * clampedBounce,
      z: ghostZ + refUz * clampedBounce,
    },
  };
}
