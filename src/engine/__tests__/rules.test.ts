import { describe, expect, it } from 'vitest';
import { createInitialGameState, evaluateShotOutcome } from '../rules';
import type { BallState, PlayerSlot, ShotSimulationResult } from '../types';

function emptyBalls(): BallState[] {
  const arr: BallState[] = [];
  for (let id = 0; id <= 15; id++) {
    arr.push({
      id,
      group: id === 0 ? 'cue' : id === 8 ? 'eight' : id <= 7 ? 'solid' : 'stripe',
      x: id === 0 ? -0.4 : 0.2 + id * 0.06,
      z: 0,
      vx: 0,
      vz: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      pocketed: false,
      pocketId: null,
    });
  }
  return arr;
}

function makeSimResult(overrides: Partial<ShotSimulationResult>): ShotSimulationResult {
  const finalBalls = overrides.finalBalls ?? emptyBalls();
  return {
    duration: 1.0,
    keyframes: [],
    events: [],
    finalBalls,
    firstHitBallId: 1,
    pocketedIds: [],
    railContactAfterFirstHit: true,
    railContactTotal: 4,
    ...overrides,
  };
}

const twoPlayers: [
  { slot: 0; id: string; name: string; group: null; connected: boolean },
  { slot: 1; id: string; name: string; group: null; connected: boolean },
] = [
  { slot: 0, id: 'p0', name: 'Alice', group: null, connected: true },
  { slot: 1, id: 'p1', name: 'Bob', group: null, connected: true },
];

describe('WPA 8-Ball Rules State Machine', () => {
  it('keeps table OPEN after a legal break that pockets a ball, and retains turn', () => {
    const initial = createInitialGameState(twoPlayers, 1);
    const balls = emptyBalls();
    balls[2].pocketed = true;
    balls[2].pocketId = 1;

    const next = evaluateShotOutcome(
      initial,
      makeSimResult({ finalBalls: balls, pocketedIds: [2], railContactTotal: 6 })
    );

    expect(next.isBreakShot).toBe(false);
    expect(next.phase).toBe('AIMING');
    expect(next.activeSlot).toBe(0);
    expect(next.players[0]?.group).toBeNull();
    expect(next.players[1]?.group).toBeNull();
  });

  it('awards BALL_IN_HAND behind head string if break scratches', () => {
    const initial = createInitialGameState(twoPlayers, 1);
    const balls = emptyBalls();
    balls[0].pocketed = true;
    balls[0].pocketId = 0;

    const next = evaluateShotOutcome(
      initial,
      makeSimResult({ finalBalls: balls, pocketedIds: [0], railContactTotal: 5 })
    );

    expect(next.phase).toBe('BALL_IN_HAND');
    expect(next.breakBehindHeadString).toBe(true);
    expect(next.activeSlot).toBe(1);
    expect(next.lastFoul?.reason).toBe('SCRATCH');
    expect(next.balls[0].pocketed).toBe(false);
    expect(next.balls[0].x).toBeLessThanOrEqual(-0.56 + 1e-6);
  });

  it('re-spots 8-ball if pocketed on the break without ending the match', () => {
    const initial = createInitialGameState(twoPlayers, 1);
    const balls = emptyBalls();
    balls[8].pocketed = true;
    balls[8].pocketId = 4;

    const next = evaluateShotOutcome(
      initial,
      makeSimResult({ finalBalls: balls, pocketedIds: [8], railContactTotal: 8 })
    );

    expect(next.phase).toBe('AIMING');
    expect(next.winnerSlot).toBeNull();
    expect(next.balls[8].pocketed).toBe(false);
  });

  it('assigns solids/stripes on first legal non-break pot when table is open', () => {
    const initial = {
      ...createInitialGameState(twoPlayers, 1),
      phase: 'AIMING' as const,
      isBreakShot: false,
      breakBehindHeadString: false,
    };
    const balls = emptyBalls();
    balls[11].pocketed = true;
    balls[11].pocketId = 2;

    const next = evaluateShotOutcome(
      initial,
      makeSimResult({ finalBalls: balls, firstHitBallId: 11, pocketedIds: [11] })
    );

    expect(next.players[0]?.group).toBe('stripes');
    expect(next.players[1]?.group).toBe('solids');
    expect(next.activeSlot).toBe(0);
    expect(next.lastFoul).toBeNull();
  });

  it('detects WRONG_BALL_FIRST, NO_BALL_HIT, and NO_RAIL_AFTER_CONTACT fouls', () => {
    const state = {
      ...createInitialGameState(twoPlayers, 1),
      phase: 'AIMING' as const,
      isBreakShot: false,
      breakBehindHeadString: false,
      players: [
        { ...twoPlayers[0], group: 'solids' as const },
        { ...twoPlayers[1], group: 'stripes' as const },
      ] as [typeof twoPlayers[0] & { group: 'solids' }, typeof twoPlayers[1] & { group: 'stripes' }],
    };

    const wrongBall = evaluateShotOutcome(
      state,
      makeSimResult({ firstHitBallId: 12, pocketedIds: [], railContactAfterFirstHit: true })
    );
    expect(wrongBall.phase).toBe('BALL_IN_HAND');
    expect(wrongBall.activeSlot).toBe(1);
    expect(wrongBall.lastFoul?.reason).toBe('WRONG_BALL_FIRST');

    const noHit = evaluateShotOutcome(
      state,
      makeSimResult({ firstHitBallId: null, pocketedIds: [], railContactAfterFirstHit: false })
    );
    expect(noHit.lastFoul?.reason).toBe('NO_BALL_HIT');

    const noRail = evaluateShotOutcome(
      state,
      makeSimResult({ firstHitBallId: 2, pocketedIds: [], railContactAfterFirstHit: false })
    );
    expect(noRail.lastFoul?.reason).toBe('NO_RAIL_AFTER_CONTACT');
  });

  it('handles premature 8-ball loss, scratch on 8-ball loss, and clean 8-ball victory', () => {
    const baseBalls = emptyBalls();
    const stateNotCleared = {
      ...createInitialGameState(twoPlayers, 1),
      phase: 'AIMING' as const,
      isBreakShot: false,
      breakBehindHeadString: false,
      balls: baseBalls,
      players: [
        { ...twoPlayers[0], group: 'solids' as const },
        { ...twoPlayers[1], group: 'stripes' as const },
      ] as [PlayerSlot, PlayerSlot],
    };

    // Early 8-ball -> opponent wins
    const earlyBalls = emptyBalls();
    earlyBalls[8].pocketed = true;
    const early = evaluateShotOutcome(
      stateNotCleared,
      makeSimResult({ finalBalls: earlyBalls, firstHitBallId: 1, pocketedIds: [8] })
    );
    expect(early.phase).toBe('GAME_OVER');
    expect(early.winnerSlot).toBe(1);

    // Clear all solids first
    const clearedBalls = emptyBalls();
    for (let id = 1; id <= 7; id++) clearedBalls[id].pocketed = true;
    const stateOnEight = { ...stateNotCleared, balls: clearedBalls };

    // Scratch while pocketing 8 -> opponent wins
    const eightScratchBalls = emptyBalls();
    for (let id = 1; id <= 7; id++) eightScratchBalls[id].pocketed = true;
    eightScratchBalls[8].pocketed = true;
    eightScratchBalls[0].pocketed = true;
    const scratchEight = evaluateShotOutcome(
      stateOnEight,
      makeSimResult({ finalBalls: eightScratchBalls, firstHitBallId: 8, pocketedIds: [8, 0] })
    );
    expect(scratchEight.phase).toBe('GAME_OVER');
    expect(scratchEight.winnerSlot).toBe(1);

    // Clean 8-ball -> active player wins
    const winBalls = emptyBalls();
    for (let id = 1; id <= 7; id++) winBalls[id].pocketed = true;
    winBalls[8].pocketed = true;
    const win = evaluateShotOutcome(
      stateOnEight,
      makeSimResult({ finalBalls: winBalls, firstHitBallId: 8, pocketedIds: [8] })
    );
    expect(win.phase).toBe('GAME_OVER');
    expect(win.winnerSlot).toBe(0);
  });
});
