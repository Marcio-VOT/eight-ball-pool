import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientWsMessageSchema, type ServerWsMessage } from '@/shared/protocol';
import { getRoomStore } from './roomStore';

interface ClientMeta {
  ws: WebSocket;
  subscribedLobby: boolean;
  roomCode: string | null;
  slot: 0 | 1 | null;
  sessionToken: string | null;
  alive: boolean;
}

declare global {
  var __poolBroadcastLobby: (() => void) | undefined;
}

function send(ws: WebSocket, msg: ServerWsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientMeta>();
  const roomSubscribers = new Map<string, Set<ClientMeta>>();
  const store = getRoomStore();

  const broadcastLobby = () => {
    const rooms = store.listPublicRooms();
    const payload = JSON.stringify({ type: 'LOBBY_ROOMS', rooms } satisfies ServerWsMessage);
    for (const meta of clients.values()) {
      if (meta.subscribedLobby && meta.ws.readyState === WebSocket.OPEN) {
        meta.ws.send(payload);
      }
    }
  };

  globalThis.__poolBroadcastLobby = broadcastLobby;

  const broadcastToRoom = (
    code: string,
    msg: ServerWsMessage,
    exclude?: ClientMeta
  ) => {
    const subs = roomSubscribers.get(code);
    if (!subs) return;
    const raw = JSON.stringify(msg);
    for (const meta of subs) {
      if (meta !== exclude && meta.ws.readyState === WebSocket.OPEN) {
        meta.ws.send(raw);
      }
    }
  };

  const detachFromRoom = (meta: ClientMeta, isExplicitLeave: boolean) => {
    const code = meta.roomCode;
    const slot = meta.slot;
    if (!code) return;

    const subs = roomSubscribers.get(code);
    if (subs) {
      subs.delete(meta);
      if (subs.size === 0) roomSubscribers.delete(code);
    }

    meta.roomCode = null;
    meta.slot = null;

    if (slot === null) return;

    // Check if another active socket already replaced this slot (e.g. fast F5 reconnect)
    const remainingSubs = roomSubscribers.get(code);
    if (remainingSubs) {
      for (const other of remainingSubs) {
        if (other.slot === slot) return;
      }
    }

    if (isExplicitLeave) {
      const { deleted, room } = store.leaveRoom(code, slot);
      if (!deleted && room) {
        broadcastToRoom(code, {
          type: 'ROOM_STATE',
          gameState: room.gameState,
          rematchVotes: room.rematchVotes,
        });
      }
      broadcastLobby();
    } else {
      const room = store.markDisconnected(code, slot);
      if (room) {
        broadcastToRoom(code, {
          type: 'PLAYER_CONNECTION',
          slot,
          connected: false,
        });
      }
    }
  };

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/ws') {
      // Allow Next.js dev HMR upgrades to pass through untouched
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const meta: ClientMeta = {
      ws,
      subscribedLobby: false,
      roomCode: null,
      slot: null,
      sessionToken: null,
      alive: true,
    };
    clients.set(ws, meta);

    ws.on('pong', () => {
      meta.alive = true;
    });

    ws.on('message', (rawData) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawData.toString());
      } catch {
        send(ws, { type: 'ERROR', code: 'BAD_JSON', message: 'JSON inválido.' });
        return;
      }

      const parsed = ClientWsMessageSchema.safeParse(parsedJson);
      if (!parsed.success) {
        send(ws, {
          type: 'ERROR',
          code: 'BAD_MESSAGE',
          message: 'Formato de mensagem inválido.',
        });
        return;
      }

      const msg = parsed.data;
      switch (msg.type) {
        case 'PING': {
          send(ws, { type: 'PONG' });
          break;
        }
        case 'SUBSCRIBE_LOBBY': {
          meta.subscribedLobby = true;
          send(ws, { type: 'LOBBY_ROOMS', rooms: store.listPublicRooms() });
          break;
        }
        case 'UNSUBSCRIBE_LOBBY': {
          meta.subscribedLobby = false;
          break;
        }
        case 'JOIN_ROOM': {
          if (meta.roomCode) {
            detachFromRoom(meta, false);
          }
          const res = store.joinRoom(msg.code, msg.playerName, msg.sessionToken);
          if (!res.ok) {
            send(ws, { type: 'ERROR', code: res.code, message: res.message });
            return;
          }

          // Close any stale socket holding the same slot/session
          let subs = roomSubscribers.get(res.room.code);
          if (!subs) {
            subs = new Set();
            roomSubscribers.set(res.room.code, subs);
          }
          for (const existing of [...subs]) {
            if (existing.slot === res.slot && existing !== meta) {
              subs.delete(existing);
              existing.roomCode = null;
              existing.slot = null;
              existing.ws.close(4001, 'Substituído por nova conexão');
            }
          }

          meta.roomCode = res.room.code;
          meta.slot = res.slot;
          meta.sessionToken = res.sessionToken;
          subs.add(meta);

          send(ws, {
            type: 'ROOM_JOINED',
            code: res.room.code,
            name: res.room.name,
            visibility: res.room.visibility,
            turnTimerSec: res.room.turnTimerSec,
            yourSlot: res.slot,
            sessionToken: res.sessionToken,
            gameState: res.room.gameState,
            rematchVotes: res.room.rematchVotes,
          });

          broadcastToRoom(
            res.room.code,
            {
              type: 'ROOM_STATE',
              gameState: res.room.gameState,
              rematchVotes: res.room.rematchVotes,
            },
            meta
          );
          broadcastLobby();
          break;
        }
        case 'AIM_UPDATE': {
          if (!meta.roomCode || meta.slot === null) return;
          const room = store.getRoom(meta.roomCode);
          if (!room || room.gameState.activeSlot !== meta.slot) return;
          broadcastToRoom(
            meta.roomCode,
            {
              type: 'OPPONENT_AIM',
              slot: meta.slot,
              angle: msg.angle,
              power: msg.power,
              tipX: msg.tipX,
              tipY: msg.tipY,
              cueBallPos: msg.cueBallPos,
            },
            meta
          );
          break;
        }
        case 'BALL_IN_HAND_MOVE': {
          if (!meta.roomCode || meta.slot === null) return;
          const moved = store.moveBallInHand(meta.roomCode, meta.slot, msg.x, msg.z);
          if (!moved) return;
          broadcastToRoom(
            meta.roomCode,
            {
              type: 'OPPONENT_BALL_IN_HAND',
              slot: meta.slot,
              x: msg.x,
              z: msg.z,
            },
            meta
          );
          break;
        }
        case 'SHOOT': {
          if (!meta.roomCode || meta.slot === null) return;
          const res = store.executeShot(meta.roomCode, meta.slot, msg.shot);
          if (!res.ok) {
            send(ws, { type: 'ERROR', code: res.code, message: res.message });
            return;
          }
          broadcastToRoom(res.room.code, {
            type: 'SHOT_TIMELINE',
            shooterSlot: res.shooterSlot,
            shotInput: res.shotInput,
            duration: res.duration,
            keyframes: res.keyframes,
            events: res.events,
            nextState: res.nextState,
          });
          if (res.nextState.phase === 'GAME_OVER') {
            broadcastLobby();
          }
          break;
        }
        case 'REQUEST_REMATCH': {
          if (!meta.roomCode || meta.slot === null) return;
          const res = store.requestRematch(meta.roomCode, meta.slot);
          if (!res) return;
          if (res.restarted) {
            broadcastToRoom(res.room.code, {
              type: 'ROOM_STATE',
              gameState: res.room.gameState,
              rematchVotes: res.room.rematchVotes,
            });
            broadcastLobby();
          } else {
            broadcastToRoom(res.room.code, {
              type: 'REMATCH_UPDATE',
              rematchVotes: res.room.rematchVotes,
            });
          }
          break;
        }
        case 'LEAVE_ROOM': {
          detachFromRoom(meta, true);
          break;
        }
      }
    });

    ws.on('close', () => {
      detachFromRoom(meta, false);
      clients.delete(ws);
    });
  });

  // Periodic heartbeat & room/timer sweep
  const timer = setInterval(() => {
    for (const meta of clients.values()) {
      if (!meta.alive) {
        meta.ws.terminate();
        continue;
      }
      meta.alive = false;
      if (meta.ws.readyState === WebSocket.OPEN) {
        meta.ws.ping();
      }
    }

    const { timedOutRooms, lobbyChanged } = store.sweepTimersAndRooms();
    for (const room of timedOutRooms) {
      broadcastToRoom(room.code, {
        type: 'ROOM_STATE',
        gameState: room.gameState,
        rematchVotes: room.rematchVotes,
      });
    }
    if (lobbyChanged) {
      broadcastLobby();
    }
  }, 1000);

  wss.on('close', () => {
    clearInterval(timer);
  });

  return wss;
}
