import { describe, expect, it } from 'vitest';
import { RoomStore } from '../roomStore';

describe('RoomStore Multiplayer & Concurrency Guarantees', () => {
  it('isolates private rooms from the public lobby listing while keeping them joinable by code', () => {
    const store = new RoomStore();
    const pub = store.createRoom({
      name: 'Sala Aberta',
      hostName: 'Lucas',
      visibility: 'public',
      turnTimerSec: 45,
      sessionToken: 'token-host-pub',
    });
    const priv = store.createRoom({
      name: 'Sala Secreta',
      hostName: 'Mari',
      visibility: 'private',
      turnTimerSec: 30,
      sessionToken: 'token-host-priv',
    });

    const publicList = store.listPublicRooms();
    expect(publicList.map((r) => r.code)).toContain(pub.room.code);
    expect(publicList.map((r) => r.code)).not.toContain(priv.room.code);

    // Private room is still discoverable via direct invite metadata & joinable by code
    expect(store.getRoomPublicMeta(priv.room.code)?.name).toBe('Sala Secreta');
    const joinGuest = store.joinRoom(priv.room.code, 'Joao', 'token-guest-1');
    expect(joinGuest.ok).toBe(true);
    if (joinGuest.ok) {
      expect(joinGuest.slot).toBe(1);
    }
  });

  it('prevents a third player from joining a full room and restores disconnected player via sessionToken', () => {
    const store = new RoomStore();
    const created = store.createRoom({
      name: 'Mesa 1v1',
      hostName: 'Host',
      visibility: 'public',
      turnTimerSec: 45,
      sessionToken: 'host-tok-1',
    });
    const code = created.room.code;

    const hostJoin = store.joinRoom(code, 'Host', 'host-tok-1');
    expect(hostJoin.ok).toBe(true);
    if (hostJoin.ok) expect(hostJoin.slot).toBe(0);

    const p2Join = store.joinRoom(code, 'Player2', 'p2-tok-1');
    expect(p2Join.ok).toBe(true);
    if (p2Join.ok) expect(p2Join.slot).toBe(1);

    // 3rd player race must be rejected
    const p3Join = store.joinRoom(code, 'Intruder', 'p3-tok-1');
    expect(p3Join.ok).toBe(false);
    if (!p3Join.ok) expect(p3Join.code).toBe('ROOM_FULL');

    // Disconnect and reconnect Player 2 using their sessionToken
    store.markDisconnected(code, 1);
    expect(store.getRoom(code)?.gameState.players[1]?.connected).toBe(false);

    const p2Reconnect = store.joinRoom(code, 'Player2', 'p2-tok-1');
    expect(p2Reconnect.ok).toBe(true);
    if (p2Reconnect.ok) {
      expect(p2Reconnect.slot).toBe(1);
      expect(p2Reconnect.room.gameState.players[1]?.connected).toBe(true);
    }
  });

  it('enforces turn ownership, shot lock during playback, and timer expiration foul', () => {
    const store = new RoomStore();
    const { room } = store.createRoom({
      name: 'Competitiva',
      hostName: 'P1',
      visibility: 'public',
      turnTimerSec: 30,
      sessionToken: 'tok-p1',
    });
    store.joinRoom(room.code, 'P1', 'tok-p1');
    store.joinRoom(room.code, 'P2', 'tok-p2');

    // Slot 1 cannot shoot on slot 0's break
    const outOfTurn = store.executeShot(room.code, 1, {
      angle: 0,
      power: 0.8,
      tipX: 0,
      tipY: 0,
    });
    expect(outOfTurn.ok).toBe(false);
    if (!outOfTurn.ok) expect(outOfTurn.code).toBe('NOT_YOUR_TURN');

    // Valid break by slot 0
    const breakShot = store.executeShot(room.code, 0, {
      angle: 0.01,
      power: 0.9,
      tipX: 0,
      tipY: 0.1,
    });
    expect(breakShot.ok).toBe(true);

    // Immediate second shot while locked must fail
    const activeSlot = room.gameState.activeSlot;
    const rapidShot = store.executeShot(room.code, activeSlot, {
      angle: 0,
      power: 0.5,
      tipX: 0,
      tipY: 0,
    });
    expect(rapidShot.ok).toBe(false);
    if (!rapidShot.ok) expect(rapidShot.code).toBe('SHOT_IN_PROGRESS');

    // Simulate turn timer expiry after shotLockUntil
    room.shotLockUntil = 0;
    room.gameState.turnDeadlineAt = 1000;
    const swept = store.sweepTimersAndRooms(2000);
    expect(swept.timedOutRooms).toHaveLength(1);
    expect(room.gameState.phase).toBe('BALL_IN_HAND');
    expect(room.gameState.activeSlot).toBe(activeSlot === 0 ? 1 : 0);
  });

  it('disables rematch and cleans up slots cleanly when a player leaves the room', () => {
    const store = new RoomStore();
    const { room } = store.createRoom({
      name: 'Rematch Guard',
      hostName: 'Host',
      visibility: 'public',
      turnTimerSec: 45,
      sessionToken: 'tok-host',
    });
    store.joinRoom(room.code, 'Host', 'tok-host');
    store.joinRoom(room.code, 'Guest', 'tok-guest');

    // Guest explicitly leaves during active game -> Host wins, Guest cannot vote or rejoin, rematch unavailable
    const resLeave1 = store.leaveRoom(room.code, 1);
    expect(resLeave1.deleted).toBe(false);
    expect(room.gameState.phase).toBe('GAME_OVER');
    expect(room.gameState.winnerSlot).toBe(0);
    expect(room.gameState.players[1]?.connected).toBe(false);
    expect(room.rematchVotes).toEqual([false, false]);
    expect(store.requestRematch(room.code, 0)).toBeNull();

    // Host leaves too -> room removed cleanly
    const resLeave0 = store.leaveRoom(room.code, 0);
    expect(resLeave0.deleted).toBe(true);
    expect(store.getRoom(room.code)).toBeUndefined();
  });
});
