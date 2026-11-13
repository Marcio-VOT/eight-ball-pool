import {
  CUE_BREAK_DEFAULT_X,
  CUE_BREAK_DEFAULT_Z,
  getBallGroup,
} from './constants';
import {
  cloneBalls,
  createStandardRack,
  findFreeFootSpot,
  findSafeCueBallSpot,
} from './physics';
import type {
  BallState,
  FoulReason,
  GameStateSnapshot,
  PlayerGroup,
  PlayerSlot,
  ShotSimulationResult,
} from './types';

export function createInitialGameState(
  players: [PlayerSlot | null, PlayerSlot | null],
  seed = Date.now(),
  practiceMode = false
): GameStateSnapshot {
  const ready = practiceMode || (players[0] !== null && players[1] !== null);
  return {
    phase: ready ? 'BREAK_PLACEMENT' : 'WAITING_FOR_PLAYERS',
    isBreakShot: true,
    breakBehindHeadString: true,
    activeSlot: 0,
    winnerSlot: null,
    winReason: null,
    lastFoul: null,
    turnNumber: 1,
    players: [
      players[0] ? { ...players[0], group: null } : null,
      players[1] ? { ...players[1], group: null } : null,
    ],
    balls: createStandardRack(seed),
    turnDeadlineAt: null,
  };
}

export function countRemainingForGroup(
  balls: readonly BallState[],
  group: PlayerGroup
): number {
  if (!group) return 7;
  const target = group === 'solids' ? 'solid' : 'stripe';
  let count = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b.pocketed && b.group === target) count++;
  }
  return count;
}

export function getLegalTargetBallIds(
  balls: readonly BallState[],
  group: PlayerGroup,
  isBreakShot: boolean
): number[] {
  if (isBreakShot) {
    return balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
  }
  if (!group) {
    return balls
      .filter((b) => !b.pocketed && b.id !== 0 && b.id !== 8)
      .map((b) => b.id);
  }
  const rem = countRemainingForGroup(balls, group);
  if (rem === 0) {
    return balls.some((b) => !b.pocketed && b.id === 8) ? [8] : [];
  }
  const target = group === 'solids' ? 'solid' : 'stripe';
  return balls.filter((b) => !b.pocketed && b.group === target).map((b) => b.id);
}

function makeFoulMessage(reason: FoulReason): string {
  switch (reason) {
    case 'SCRATCH':
      return 'Falta: bola branca encaçapada (bola na mão para o adversário).';
    case 'NO_BALL_HIT':
      return 'Falta: a bola branca não tocou em nenhuma bola.';
    case 'WRONG_BALL_FIRST':
      return 'Falta: primeiro toque em bola proibida para a sua vez.';
    case 'NO_RAIL_AFTER_CONTACT':
      return 'Falta: nenhuma bola encaçapada nem tocou na tabela após o contato.';
    case 'EARLY_8_BALL':
      return 'Derrota: Bola 8 encaçapada antes de limpar seu grupo.';
    case '8_BALL_SCRATCH':
      return 'Derrota: falta ao encaçapar a Bola 8.';
    case 'INVALID_BREAK_8_BALL':
      return 'Bola 8 na abertura: reposicionada no ponto do pé.';
  }
}

export function evaluateShotOutcome(
  prevState: GameStateSnapshot,
  simResult: ShotSimulationResult,
  options: { practiceMode?: boolean } = {}
): GameStateSnapshot {
  const practiceMode = Boolean(options.practiceMode);
  const nextBalls = cloneBalls(simResult.finalBalls);
  const activeSlot = prevState.activeSlot;
  const opponentSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;

  const players: [PlayerSlot | null, PlayerSlot | null] = [
    prevState.players[0] ? { ...prevState.players[0] } : null,
    prevState.players[1] ? { ...prevState.players[1] } : null,
  ];

  const activePlayer = players[activeSlot];
  const opponentPlayer = players[opponentSlot];
  const activeGroup: PlayerGroup = activePlayer?.group ?? null;

  const cueScratch = simResult.pocketedIds.includes(0);
  const eightPocketed = simResult.pocketedIds.includes(8);
  const objectPocketed = simResult.pocketedIds.filter((id) => id !== 0 && id !== 8);

  // 1. Break shot evaluation
  if (prevState.isBreakShot) {
    let reSpottedEight = false;
    if (eightPocketed) {
      const eightBall = nextBalls.find((b) => b.id === 8);
      if (eightBall) {
        const spot = findFreeFootSpot(nextBalls);
        eightBall.pocketed = false;
        eightBall.pocketId = null;
        eightBall.x = spot.x;
        eightBall.z = spot.z;
        reSpottedEight = true;
      }
    }

    const legalBreak = objectPocketed.length > 0 || simResult.railContactTotal >= 4;
    let foulReason: FoulReason | null = null;
    if (cueScratch) {
      foulReason = 'SCRATCH';
    } else if (!legalBreak) {
      foulReason = 'NO_RAIL_AFTER_CONTACT';
    }

    if (cueScratch) {
      const cueBall = nextBalls[0];
      const safe = findSafeCueBallSpot(nextBalls, true);
      cueBall.pocketed = false;
      cueBall.pocketId = null;
      cueBall.x = safe.x;
      cueBall.z = safe.z;
    }

    if (practiceMode) {
      return {
        ...prevState,
        phase: cueScratch ? 'BALL_IN_HAND' : 'AIMING',
        isBreakShot: false,
        breakBehindHeadString: cueScratch,
        activeSlot: 0,
        lastFoul: foulReason
          ? { bySlot: 0, reason: foulReason, message: makeFoulMessage(foulReason) }
          : reSpottedEight
            ? {
                bySlot: 0,
                reason: 'INVALID_BREAK_8_BALL',
                message: makeFoulMessage('INVALID_BREAK_8_BALL'),
              }
            : null,
        turnNumber: prevState.turnNumber + 1,
        players,
        balls: nextBalls,
      };
    }

    if (foulReason) {
      return {
        ...prevState,
        phase: 'BALL_IN_HAND',
        isBreakShot: false,
        breakBehindHeadString: true,
        activeSlot: opponentSlot,
        lastFoul: {
          bySlot: activeSlot,
          reason: foulReason,
          message:
            foulReason === 'NO_RAIL_AFTER_CONTACT'
              ? 'Abertura fraca: bola na mão atrás da linha para o adversário.'
              : makeFoulMessage(foulReason),
        },
        turnNumber: prevState.turnNumber + 1,
        players,
        balls: nextBalls,
      };
    }

    // Legal break without scratch: table stays OPEN; breaker continues if object ball dropped
    const keepTurn = objectPocketed.length > 0;
    return {
      ...prevState,
      phase: 'AIMING',
      isBreakShot: false,
      breakBehindHeadString: false,
      activeSlot: keepTurn ? activeSlot : opponentSlot,
      lastFoul: reSpottedEight
        ? {
            bySlot: activeSlot,
            reason: 'INVALID_BREAK_8_BALL',
            message: makeFoulMessage('INVALID_BREAK_8_BALL'),
          }
        : null,
      turnNumber: prevState.turnNumber + 1,
      players,
      balls: nextBalls,
    };
  }

  // 2. Standard shot evaluation
  const remainingOwnBefore = countRemainingForGroup(prevState.balls, activeGroup);
  const isShootingForEight = activeGroup !== null && remainingOwnBefore === 0;

  let foulReason: FoulReason | null = null;
  if (simResult.firstHitBallId === null) {
    foulReason = 'NO_BALL_HIT';
  } else {
    const firstGroup = getBallGroup(simResult.firstHitBallId);
    if (activeGroup === null) {
      if (simResult.firstHitBallId === 8) {
        foulReason = 'WRONG_BALL_FIRST';
      }
    } else if (isShootingForEight) {
      if (simResult.firstHitBallId !== 8) {
        foulReason = 'WRONG_BALL_FIRST';
      }
    } else {
      const targetGroup = activeGroup === 'solids' ? 'solid' : 'stripe';
      if (firstGroup !== targetGroup) {
        foulReason = 'WRONG_BALL_FIRST';
      }
    }
  }

  if (cueScratch) {
    foulReason = 'SCRATCH';
  } else if (
    foulReason === null &&
    simResult.pocketedIds.length === 0 &&
    !simResult.railContactAfterFirstHit
  ) {
    foulReason = 'NO_RAIL_AFTER_CONTACT';
  }

  // 3. Check 8-ball pocketed outcome
  if (eightPocketed) {
    if (cueScratch) {
      const cueBall = nextBalls[0];
      const safe = findSafeCueBallSpot(nextBalls, false);
      cueBall.pocketed = false;
      cueBall.pocketId = null;
      cueBall.x = safe.x;
      cueBall.z = safe.z;
    }

    if (practiceMode) {
      const eightBall = nextBalls.find((b) => b.id === 8);
      if (eightBall) {
        const spot = findFreeFootSpot(nextBalls);
        eightBall.pocketed = false;
        eightBall.pocketId = null;
        eightBall.x = spot.x;
        eightBall.z = spot.z;
      }
      return {
        ...prevState,
        phase: cueScratch ? 'BALL_IN_HAND' : 'AIMING',
        breakBehindHeadString: false,
        activeSlot: 0,
        lastFoul: foulReason
          ? { bySlot: 0, reason: foulReason, message: makeFoulMessage(foulReason) }
          : null,
        turnNumber: prevState.turnNumber + 1,
        players,
        balls: nextBalls,
      };
    }

    if (!isShootingForEight) {
      return {
        ...prevState,
        phase: 'GAME_OVER',
        winnerSlot: opponentSlot,
        winReason: `${activePlayer?.name ?? 'Jogador'} encaçapou a Bola 8 antes da hora.`,
        lastFoul: {
          bySlot: activeSlot,
          reason: 'EARLY_8_BALL',
          message: makeFoulMessage('EARLY_8_BALL'),
        },
        turnNumber: prevState.turnNumber + 1,
        players,
        balls: nextBalls,
      };
    }

    if (foulReason !== null) {
      return {
        ...prevState,
        phase: 'GAME_OVER',
        winnerSlot: opponentSlot,
        winReason: `${activePlayer?.name ?? 'Jogador'} cometeu falta na Bola 8.`,
        lastFoul: {
          bySlot: activeSlot,
          reason: '8_BALL_SCRATCH',
          message: makeFoulMessage('8_BALL_SCRATCH'),
        },
        turnNumber: prevState.turnNumber + 1,
        players,
        balls: nextBalls,
      };
    }

    return {
      ...prevState,
      phase: 'GAME_OVER',
      winnerSlot: activeSlot,
      winReason: `${activePlayer?.name ?? 'Jogador'} venceu ao encaçapar a Bola 8!`,
      lastFoul: null,
      turnNumber: prevState.turnNumber + 1,
      players,
      balls: nextBalls,
    };
  }

  // 4. Assign Solids / Stripes if table was open and legal pot occurred
  let assignedGroupNow = activeGroup;
  if (activeGroup === null && foulReason === null && objectPocketed.length > 0 && !practiceMode) {
    const firstBallGroup = getBallGroup(objectPocketed[0]);
    if (firstBallGroup === 'solid' || firstBallGroup === 'stripe') {
      assignedGroupNow = firstBallGroup === 'solid' ? 'solids' : 'stripes';
      if (activePlayer) activePlayer.group = assignedGroupNow;
      if (opponentPlayer) {
        opponentPlayer.group = assignedGroupNow === 'solids' ? 'stripes' : 'solids';
      }
    }
  }

  // 5. Restore cue ball on scratch
  if (cueScratch) {
    const cueBall = nextBalls[0];
    const safe = findSafeCueBallSpot(nextBalls, false);
    cueBall.pocketed = false;
    cueBall.pocketId = null;
    cueBall.x = safe.x;
    cueBall.z = safe.z;
  }

  if (practiceMode) {
    return {
      ...prevState,
      phase: cueScratch ? 'BALL_IN_HAND' : 'AIMING',
      breakBehindHeadString: false,
      activeSlot: 0,
      lastFoul: foulReason
        ? { bySlot: 0, reason: foulReason, message: makeFoulMessage(foulReason) }
        : null,
      turnNumber: prevState.turnNumber + 1,
      players,
      balls: nextBalls,
    };
  }

  if (foulReason !== null) {
    return {
      ...prevState,
      phase: 'BALL_IN_HAND',
      breakBehindHeadString: false,
      activeSlot: opponentSlot,
      lastFoul: {
        bySlot: activeSlot,
        reason: foulReason,
        message: makeFoulMessage(foulReason),
      },
      turnNumber: prevState.turnNumber + 1,
      players,
      balls: nextBalls,
    };
  }

  // 6. Keep turn if active player legally potted one of their target balls
  const targetBallGroup = assignedGroupNow === 'solids' ? 'solid' : 'stripe';
  const pottedOwn =
    assignedGroupNow !== null &&
    objectPocketed.some((id) => getBallGroup(id) === targetBallGroup);

  return {
    ...prevState,
    phase: 'AIMING',
    breakBehindHeadString: false,
    activeSlot: pottedOwn ? activeSlot : opponentSlot,
    lastFoul: null,
    turnNumber: prevState.turnNumber + 1,
    players,
    balls: nextBalls,
  };
}

export function resetCueBallToBreakDefault(balls: BallState[]): void {
  const cue = balls[0];
  cue.pocketed = false;
  cue.pocketId = null;
  cue.x = CUE_BREAK_DEFAULT_X;
  cue.z = CUE_BREAK_DEFAULT_Z;
  cue.vx = 0;
  cue.vz = 0;
  cue.wx = 0;
  cue.wy = 0;
  cue.wz = 0;
}
