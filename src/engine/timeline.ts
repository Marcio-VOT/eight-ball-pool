import type { KeyframeBall, ShotKeyframe } from './types';

export interface InterpolatedBallPose {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  pocketed: boolean;
}

/**
 * Evaluates C1-smooth cubic Hermite position & velocity at playback time `t`
 * across recorded 30Hz physics keyframes.
 */
export function sampleTimelineAt(
  keyframes: readonly ShotKeyframe[],
  t: number,
  outPoses: InterpolatedBallPose[]
): void {
  if (keyframes.length === 0) return;

  if (t <= keyframes[0].t || keyframes.length === 1) {
    const src = keyframes[0].balls;
    for (let i = 0; i < src.length; i++) {
      copyKeyframeBall(src[i], outPoses[i]);
    }
    return;
  }

  const lastIdx = keyframes.length - 1;
  if (t >= keyframes[lastIdx].t) {
    const src = keyframes[lastIdx].balls;
    for (let i = 0; i < src.length; i++) {
      copyKeyframeBall(src[i], outPoses[i]);
    }
    return;
  }

  // Binary search bracket [lo, lo + 1]
  let lo = 0;
  let hi = lastIdx;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (keyframes[mid].t <= t) lo = mid;
    else hi = mid;
  }

  const kf0 = keyframes[lo];
  const kf1 = keyframes[lo + 1];
  const dt = kf1.t - kf0.t;
  if (dt <= 1e-9) {
    for (let i = 0; i < kf1.balls.length; i++) {
      copyKeyframeBall(kf1.balls[i], outPoses[i]);
    }
    return;
  }

  const u = (t - kf0.t) / dt;
  const u2 = u * u;
  const u3 = u2 * u;

  // Cubic Hermite basis functions
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  for (let i = 0; i < kf0.balls.length; i++) {
    const b0 = kf0.balls[i];
    const b1 = kf1.balls[i];
    const dst = outPoses[i];
    dst.id = b0.id;

    // If ball pocketed between keyframes, snap cleanly when pocketed
    if (b0.pocketed === 1) {
      copyKeyframeBall(b1, dst);
      continue;
    }
    if (b1.pocketed === 1) {
      dst.x = b0.x + (b1.x - b0.x) * u;
      dst.z = b0.z + (b1.z - b0.z) * u;
      dst.vx = b0.vx * (1 - u);
      dst.vz = b0.vz * (1 - u);
      dst.wx = b0.wx * (1 - u);
      dst.wy = b0.wy * (1 - u);
      dst.wz = b0.wz * (1 - u);
      dst.pocketed = u > 0.85;
      continue;
    }

    dst.x = h00 * b0.x + h10 * dt * b0.vx + h01 * b1.x + h11 * dt * b1.vx;
    dst.z = h00 * b0.z + h10 * dt * b0.vz + h01 * b1.z + h11 * dt * b1.vz;
    dst.vx = b0.vx + (b1.vx - b0.vx) * u;
    dst.vz = b0.vz + (b1.vz - b0.vz) * u;
    dst.wx = b0.wx + (b1.wx - b0.wx) * u;
    dst.wy = b0.wy + (b1.wy - b0.wy) * u;
    dst.wz = b0.wz + (b1.wz - b0.wz) * u;
    dst.pocketed = false;
  }
}

function copyKeyframeBall(src: KeyframeBall, dst: InterpolatedBallPose): void {
  dst.id = src.id;
  dst.x = src.x;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vz = src.vz;
  dst.wx = src.wx;
  dst.wy = src.wy;
  dst.wz = src.wz;
  dst.pocketed = src.pocketed === 1;
}
