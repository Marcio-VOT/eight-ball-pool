import { describe, expect, it } from 'vitest';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  MAX_TIP_OFFSET,
  PLAY_HALF_LENGTH,
  PLAY_HALF_WIDTH,
  POCKETS,
} from '../constants';
import { createStandardRack, simulateShot } from '../physics';
import { computeAimGuide } from '../../game/aimGuide';
import type { BallState } from '../types';

function makeEmptyTableWithBalls(custom: Array<Partial<BallState> & { id: number; x: number; z: number }>): BallState[] {
  const balls: BallState[] = [];
  for (let id = 0; id <= 15; id++) {
    const match = custom.find((c) => c.id === id);
    balls.push({
      id,
      group: id === 0 ? 'cue' : id === 8 ? 'eight' : id <= 7 ? 'solid' : 'stripe',
      x: match ? match.x : 0,
      z: match ? match.z : 0,
      vx: 0,
      vz: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      pocketed: match ? Boolean(match.pocketed) : true,
      pocketId: match?.pocketId ?? (match ? null : 0),
    });
  }
  return balls;
}

describe('Physics Engine Invariants', () => {
  it('builds a valid 16-ball rack with zero overlaps and standard 8-ball placement', () => {
    const balls = createStandardRack(42);
    expect(balls).toHaveLength(16);
    expect(balls.every((b) => !b.pocketed)).toBe(true);

    // Zero overlaps
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].z - balls[j].z);
        expect(d).toBeGreaterThanOrEqual(BALL_DIAMETER - 1e-6);
      }
    }

    // Ball 8 should be near row 2 center (FOOT_SPOT_X + 2 * rowStep)
    const eight = balls[8];
    expect(Math.abs(eight.z)).toBeLessThan(0.001);
    expect(eight.x).toBeGreaterThan(0.56 + BALL_DIAMETER);
  });

  it('handles full-power break deterministically without tunneling or overlaps', () => {
    const rackA = createStandardRack(12345);
    const rackB = createStandardRack(12345);

    const shot = { angle: 0.008, power: 1.0, tipX: 0.1, tipY: 0.15 };
    const resA = simulateShot(rackA, shot);
    const resB = simulateShot(rackB, shot);

    // Determinism
    expect(resA.finalBalls).toEqual(resB.finalBalls);
    expect(resA.pocketedIds).toEqual(resB.pocketedIds);
    expect(resA.railContactTotal).toBeGreaterThanOrEqual(6);
    expect(resA.duration).toBeGreaterThan(1.0);

    // No overlaps and strictly in bounds across ALL keyframes
    for (const kf of resA.keyframes) {
      for (let i = 0; i < kf.balls.length; i++) {
        const a = kf.balls[i];
        if (a.pocketed === 1) continue;
        // Must stay inside table boundary (allowing pocket throat funnel depth)
        expect(Math.abs(a.x)).toBeLessThanOrEqual(PLAY_HALF_LENGTH + 0.06);
        expect(Math.abs(a.z)).toBeLessThanOrEqual(PLAY_HALF_WIDTH + 0.06);

        for (let j = i + 1; j < kf.balls.length; j++) {
          const b = kf.balls[j];
          if (b.pocketed === 1) continue;
          const dist = Math.hypot(a.x - b.x, a.z - b.z);
          expect(dist).toBeGreaterThanOrEqual(BALL_DIAMETER - 0.001);
        }
      }
    }

    // All balls rest at end and stay inside table + pocket throat envelope without rail penetration
    for (const b of resA.finalBalls) {
      expect(b.vx).toBe(0);
      expect(b.vz).toBe(0);
      if (!b.pocketed) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(PLAY_HALF_LENGTH + 0.04);
        expect(Math.abs(b.z)).toBeLessThanOrEqual(PLAY_HALF_WIDTH + 0.04);
        if (Math.abs(b.z) < PLAY_HALF_WIDTH - 0.09) {
          expect(Math.abs(b.x)).toBeLessThanOrEqual(PLAY_HALF_LENGTH - BALL_RADIUS + 0.002);
        }
        if (Math.abs(b.x) < PLAY_HALF_LENGTH - 0.09 && Math.abs(b.x) > 0.07) {
          expect(Math.abs(b.z)).toBeLessThanOrEqual(PLAY_HALF_WIDTH - BALL_RADIUS + 0.002);
        }
      }
    }
  });

  it('allows a rail-hugging ball to roll cleanly past the side pocket without dropping', () => {
    const balls = makeEmptyTableWithBalls([
      { id: 0, x: -0.45, z: -PLAY_HALF_WIDTH + BALL_RADIUS + 0.001 },
    ]);
    const res = simulateShot(balls, { angle: 0, power: 0.34, tipX: 0, tipY: 0.4 });
    expect(res.pocketedIds).not.toContain(0);
    expect(res.finalBalls[0].pocketed).toBe(false);
    expect(res.finalBalls[0].x).toBeGreaterThan(0.2);
  });

  it('pockets a ball cleanly aimed into a corner pocket', () => {
    const corner = POCKETS[1]; // Top-Right
    const targetX = PLAY_HALF_LENGTH - 0.35;
    const targetZ = -PLAY_HALF_WIDTH + 0.35;
    const angleToPocket = Math.atan2(corner.z - targetZ, corner.x - targetX);
    const cueX = targetX - Math.cos(angleToPocket) * 0.45;
    const cueZ = targetZ - Math.sin(angleToPocket) * 0.45;

    const balls = makeEmptyTableWithBalls([
      { id: 0, x: cueX, z: cueZ },
      { id: 1, x: targetX, z: targetZ },
    ]);

    const res = simulateShot(balls, { angle: angleToPocket, power: 0.55, tipX: 0, tipY: 0 });
    expect(res.pocketedIds).toContain(1);
    expect(res.finalBalls[1].pocketed).toBe(true);
    expect(res.finalBalls[1].pocketId).toBe(1);
  });

  it('applies Draw (backspin), Stun, and Follow (topspin) physically accurately', () => {
    // Line up ball 1 toward Top-Right corner pocket on a shallow diagonal clear of side pocket
    const pocket = POCKETS[1];
    const targetX = 0.78;
    const targetZ = -0.32;
    const angle = Math.atan2(pocket.z - targetZ, pocket.x - targetX);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const cueX = targetX - ux * 0.34;
    const cueZ = targetZ - uz * 0.34;

    const makePair = () =>
      makeEmptyTableWithBalls([
        { id: 0, x: cueX, z: cueZ },
        { id: 1, x: targetX, z: targetZ },
      ]);

    const stunRes = simulateShot(makePair(), { angle, power: 0.65, tipX: 0, tipY: 0 });
    const drawRes = simulateShot(makePair(), {
      angle,
      power: 0.65,
      tipX: 0,
      tipY: -MAX_TIP_OFFSET,
    });
    const followRes = simulateShot(makePair(), {
      angle,
      power: 0.65,
      tipX: 0,
      tipY: MAX_TIP_OFFSET,
    });

    // Object ball 1 must be pocketed in all three shots
    expect(stunRes.pocketedIds).toContain(1);
    expect(drawRes.pocketedIds).toContain(1);
    expect(followRes.pocketedIds).toContain(1);

    // Draw pulls cue ball backward behind its starting spot along -dir
    const drawAdvance = (drawRes.finalBalls[0].x - cueX) * ux + (drawRes.finalBalls[0].z - cueZ) * uz;
    expect(drawRes.finalBalls[0].pocketed).toBe(false);
    expect(drawAdvance).toBeLessThan(0.05);

    // Stun stops cue ball near impact point without scratching
    expect(stunRes.finalBalls[0].pocketed).toBe(false);
    const stunToTarget = Math.hypot(stunRes.finalBalls[0].x - targetX, stunRes.finalBalls[0].z - targetZ);
    expect(stunToTarget).toBeLessThan(0.22);

    // Follow drives cue ball forward all the way into the pocket!
    expect(followRes.finalBalls[0].pocketed).toBe(true);
  });

  it('applies Left and Right English on perpendicular cushion rebounds', () => {
    const startX = 0.45; // Away from the middle side pocket at x=0
    const makeCue = () =>
      makeEmptyTableWithBalls([{ id: 0, x: startX, z: 0 }]);

    // Shoot straight up toward top rail (-PI/2)
    const rightEng = simulateShot(makeCue(), {
      angle: -Math.PI / 2,
      power: 0.6,
      tipX: MAX_TIP_OFFSET,
      tipY: 0,
    });
    const leftEng = simulateShot(makeCue(), {
      angle: -Math.PI / 2,
      power: 0.6,
      tipX: -MAX_TIP_OFFSET,
      tipY: 0,
    });

    expect(rightEng.finalBalls[0].x).toBeGreaterThan(startX + 0.08);
    expect(leftEng.finalBalls[0].x).toBeLessThan(startX - 0.08);
  });

  it('gives playable distance on weak shots and compact target direction guide', () => {
    const balls = makeEmptyTableWithBalls([
      { id: 0, x: -0.6, z: 0 },
      { id: 1, x: 0.2, z: 0 },
    ]);

    const weakShot = simulateShot(balls.map((b) => ({ ...b, pocketed: b.id !== 0 })), {
      angle: 0,
      power: 0.1,
      tipX: 0,
      tipY: 0,
    });
    expect(weakShot.finalBalls[0].x - -0.6).toBeGreaterThan(0.25);

    const guide = computeAimGuide(balls, 0, 0, new Set([1]));
    expect(guide).not.toBeNull();
    if (guide) {
      expect(guide.hitType).toBe('ball');
      expect(guide.targetStart).not.toBeNull();
      expect(guide.targetEnd).not.toBeNull();
      if (guide.targetEnd) {
        const distFromTargetCenter = Math.hypot(
          guide.targetEnd.x - balls[1].x,
          guide.targetEnd.z - balls[1].z
        );
        expect(distFromTargetCenter).toBeLessThanOrEqual(0.125);
      }
    }
  });
});
