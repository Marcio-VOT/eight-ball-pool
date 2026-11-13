'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getOrCreateTabSessionToken,
  getWebSocketUrl,
  saveNickname,
} from '@/game/session';
import { useSavedNickname } from '@/game/useSavedNickname';
import type {
  PublicRoomInfo,
  RoomVisibility,
  ServerWsMessage,
  TurnTimerSec,
} from '@/shared/protocol';

export function LobbyClient() {
  const router = useRouter();
  const savedNickname = useSavedNickname('Jogador');
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const nickname = nicknameDraft ?? savedNickname;
  const [rooms, setRooms] = useState<PublicRoomInfo[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // Join by code state
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningCode, setJoiningCode] = useState(false);

  // Create room modal state
  const createDialogRef = useRef<HTMLDialogElement | null>(null);
  const [roomName, setRoomName] = useState('Mesa Clássica');
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [turnTimerSec, setTurnTimerSec] = useState<TurnTimerSec>(45);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch('/api/rooms', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { rooms?: PublicRoomInfo[] }) => {
        if (active && Array.isArray(data.rooms)) {
          setRooms(data.rooms);
        }
      })
      .catch(() => {
        // WS will populate if REST fails briefly
      })
      .finally(() => {
        if (active) setLoadingRooms(false);
      });

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      if (!active) return;
      ws = new WebSocket(getWebSocketUrl());
      ws.addEventListener('open', () => {
        if (!active) return;
        setWsConnected(true);
        ws?.send(JSON.stringify({ type: 'SUBSCRIBE_LOBBY' }));
      });
      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ServerWsMessage;
          if (msg.type === 'LOBBY_ROOMS') {
            setRooms(msg.rooms);
            setLoadingRooms(false);
          }
        } catch {
          // ignore
        }
      });
      ws.addEventListener('close', () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connectWs, 2000);
      });
    };

    connectWs();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // Safari fallback for <dialog closedby="any">
  useEffect(() => {
    const dlg = createDialogRef.current;
    if (!dlg) return;

    const handleClose = () => {
      dlg.returnValue = '';
    };
    dlg.addEventListener('close', handleClose);

    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => dlg.removeEventListener('close', handleClose);
    }

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dlg.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) dlg.close();
    };

    dlg.addEventListener('pointerdown', onDown);
    dlg.addEventListener('pointerup', onUp);
    return () => {
      dlg.removeEventListener('close', handleClose);
      dlg.removeEventListener('pointerdown', onDown);
      dlg.removeEventListener('pointerup', onUp);
    };
  }, []);

  const ensureNickname = (): string | null => {
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      return null;
    }
    saveNickname(trimmed);
    return trimmed;
  };

  const openCreateModal = () => {
    setCreateError(null);
    createDialogRef.current?.showModal();
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const validNick = ensureNickname();
    if (!validNick) {
      setCreateError('Informe seu apelido (mínimo 2 caracteres) no topo do salão.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const sessionToken = getOrCreateTabSessionToken();
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roomName.trim() || 'Mesa Clássica',
          hostName: validNick,
          visibility,
          turnTimerSec,
          sessionToken,
        }),
      });
      const data = (await res.json()) as {
        code?: string;
        error?: string;
      };
      if (!res.ok || !data.code) {
        setCreateError(data.error ?? 'Não foi possível criar a sala.');
        return;
      }
      createDialogRef.current?.close();
      router.push(`/room/${data.code}`);
    } catch {
      setCreateError('Erro de conexão ao criar a sala.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joiningCode) return;
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setJoinError('Digite o código da sala (ex: X7K2M9).');
      return;
    }
    const validNick = ensureNickname();
    if (!validNick) {
      setJoinError('Informe um apelido com pelo menos 2 caracteres.');
      return;
    }

    setJoiningCode(true);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setJoinError('Sala não encontrada ou já encerrada.');
        return;
      }
      const data = (await res.json()) as { room: PublicRoomInfo };
      if (data.room.playerCount >= 2) {
        setJoinError('Esta sala já está lotada (2/2).');
        return;
      }
      router.push(`/room/${data.room.code}`);
    } catch {
      setJoinError('Falha ao verificar a sala.');
    } finally {
      setJoiningCode(false);
    }
  };

  const handleJoinPublicRoom = (code: string) => {
    const validNick = ensureNickname();
    if (!validNick) {
      setJoinError('Informe seu apelido antes de entrar na mesa.');
      return;
    }
    router.push(`/room/${code}`);
  };

  return (
    <div className="rustic-room-bg min-h-screen text-[#f3e8d2]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-7 sm:px-6 lg:py-10">
        {/* Carved Wood Parlor Signboard Header */}
        <header className="wood-panel relative flex flex-col gap-6 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#c6953e] bg-[#16100b] font-display text-lg font-bold text-[#f3e8d2] shadow-inner"
              >
                8
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dfb25e]">
                  Salão Clássico de Bilhar
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-[#cbb693]">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 rounded-full ${
                      wsConnected
                        ? 'bg-[#56b881]'
                        : 'bg-[#dfb25e] animate-pulse'
                    }`}
                  />
                  {wsConnected ? 'Salão conectado' : 'Conectando ao salão...'}
                </span>
              </div>
            </div>

            <h1 className="font-display text-3xl font-bold tracking-tight text-[#f8eedb] sm:text-4xl">
              8 Ball Pool
            </h1>
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-[#cbb693]">
              Mesas em madeira nobre, física de pano e efeito no taco em tempo real.
              Abra uma mesa no salão ou pratique suas tacadas sozinho.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex w-full flex-col gap-1 sm:w-60">
              <label
                htmlFor="player-nickname"
                className="text-xs font-semibold uppercase tracking-wider text-[#cbb693]"
              >
                Seu Apelido <span aria-hidden="true">*</span>
              </label>
              <input
                id="player-nickname"
                name="nickname"
                type="text"
                required
                minLength={2}
                maxLength={24}
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={nickname}
                onChange={(e) => {
                  setNicknameDraft(e.target.value);
                  if (e.target.value.trim().length >= 2) {
                    saveNickname(e.target.value);
                  }
                }}
                className="leather-inlay w-full rounded-lg px-3.5 py-2.5 text-base font-medium text-[#f8eedb] outline-none transition focus:border-[#dfb25e] sm:text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={openCreateModal}
                data-testid="open-create-room-btn"
                className="brass-btn rounded-lg px-4 py-2.5 text-sm font-bold"
              >
                + Criar Sala
              </button>
              <Link
                href="/practice"
                data-testid="open-practice-btn"
                className="rounded-lg border border-[#c6953e]/45 bg-[#154e35] px-4 py-2.5 text-sm font-semibold text-[#f3e8d2] shadow-md transition hover:bg-[#1b6142]"
              >
                Modo Treino (Solo)
              </Link>
            </div>
          </div>
        </header>

        {/* Main Content Grid: Public Ledger + Join by Code */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Public Rooms Ledger */}
          <section
            aria-labelledby="public-rooms-heading"
            className="wood-panel flex flex-col gap-4 rounded-2xl p-5 lg:col-span-2"
          >
            <div className="flex items-center justify-between border-b border-[#6b4f2a]/40 pb-3">
              <div>
                <h2
                  id="public-rooms-heading"
                  className="font-display text-xl font-bold text-[#f8eedb]"
                >
                  Mesas Abertas
                </h2>
                <p className="text-xs text-[#baa482]">
                  Quadro atualizado automaticamente quando jogadores abrem novas salas
                </p>
              </div>
              <span
                data-testid="public-rooms-count"
                className="leather-inlay rounded-md px-3 py-1 font-mono text-xs font-semibold text-[#dfb25e]"
              >
                {rooms.length} {rooms.length === 1 ? 'mesa' : 'mesas'}
              </span>
            </div>

            {loadingRooms ? (
              <div className="leather-inlay rounded-xl p-8 text-center text-sm text-[#baa482]">
                Verificando mesas disponíveis...
              </div>
            ) : rooms.length === 0 ? (
              <div
                data-testid="empty-lobby-state"
                className="leather-inlay flex flex-col items-center gap-3 rounded-xl p-8 text-center"
              >
                <p className="text-sm text-[#cbb693]">
                  Nenhuma mesa pública aberta no salão neste momento.
                </p>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="wood-btn rounded-lg px-4 py-2 text-xs font-bold text-[#dfb25e]"
                >
                  Abrir primeira mesa
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="public-rooms-list">
                {rooms.map((r) => {
                  const full = r.playerCount >= 2;
                  return (
                    <li
                      key={r.code}
                      data-room-code={r.code}
                      className="leather-inlay flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:border-[#dfb25e]/60"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2.5">
                          <span className="truncate font-display text-base font-bold text-[#f8eedb]">
                            {r.name}
                          </span>
                          <span className="rounded border border-[#c6953e]/35 bg-[#2a1b10] px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-[#dfb25e]">
                            {r.code}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#baa482]">
                          <span>Anfitrião: {r.hostName}</span>
                          <span aria-hidden="true">•</span>
                          <span>
                            {r.turnTimerSec === 0
                              ? 'Sem relógio'
                              : `Turno ${r.turnTimerSec}s`}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span
                            className={
                              r.status === 'waiting'
                                ? 'font-semibold text-[#6ee7b7]'
                                : 'font-semibold text-[#dfb25e]'
                            }
                          >
                            {r.status === 'waiting'
                              ? '• Livre (1/2)'
                              : r.status === 'playing'
                                ? '• Em Jogo (2/2)'
                                : '• Encerrada'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={full}
                        onClick={() => handleJoinPublicRoom(r.code)}
                        className="brass-btn rounded-lg px-4 py-2 text-xs font-bold"
                      >
                        {full ? 'Lotada' : 'Entrar'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Join by Code Card */}
          <aside className="wood-panel flex flex-col gap-4 rounded-2xl p-5">
            <div className="border-b border-[#6b4f2a]/40 pb-3">
              <h2 className="font-display text-xl font-bold text-[#f8eedb]">
                Mesa Reservada
              </h2>
              <p className="text-xs text-[#baa482]">
                Possui um código de convite? Entre direto na partida.
              </p>
            </div>

            <form onSubmit={handleJoinByCode} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="join-code-input"
                  className="text-xs font-semibold uppercase tracking-wider text-[#cbb693]"
                >
                  Código da Sala <span aria-hidden="true">*</span>
                </label>
                <input
                  id="join-code-input"
                  name="roomCode"
                  type="text"
                  required
                  minLength={4}
                  maxLength={12}
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="EX: X7K2M9"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setJoinError(null);
                  }}
                  className="leather-inlay rounded-lg px-3.5 py-2.5 font-mono text-base uppercase tracking-widest text-[#f8eedb] placeholder:text-[#7e694f] outline-none transition focus:border-[#dfb25e] sm:text-sm"
                />
              </div>

              {joinError && (
                <p
                  role="alert"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#e57965]"
                >
                  <span aria-hidden="true">⚠</span>
                  <span>{joinError}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={joiningCode}
                data-testid="join-by-code-btn"
                className="wood-btn rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                {joiningCode ? 'Verificando...' : 'Entrar na Sala'}
              </button>
            </form>

            <div className="leather-inlay mt-auto rounded-xl p-3.5 text-xs">
              <p className="mb-1 font-semibold text-[#dfb25e]">Nota de Convite</p>
              <p className="leading-relaxed text-[#baa482]">
                Mesas criadas como <strong className="text-[#f3e8d2]">Privadas</strong>{' '}
                não aparecem no quadro aberto. Use{' '}
                <strong className="text-[#f3e8d2]">Copiar convite</strong> dentro da
                mesa para chamar seu oponente.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* Native Accessible Modal Dialog for Creating a Room */}
      <dialog
        ref={createDialogRef}
        closedby="any"
        aria-labelledby="create-room-title"
        className="wood-panel m-auto w-full max-w-md rounded-2xl p-6 text-[#f3e8d2]"
      >
        <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-[#6b4f2a]/40 pb-3">
            <h2
              id="create-room-title"
              className="font-display text-xl font-bold text-[#f8eedb]"
            >
              Abrir Nova Mesa
            </h2>
            <button
              type="button"
              aria-label="Fechar janela"
              onClick={() => createDialogRef.current?.close()}
              className="wood-btn rounded-lg px-2.5 py-1 text-sm text-[#cbb693]"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="room-name-input"
              className="text-xs font-semibold uppercase tracking-wider text-[#cbb693]"
            >
              Nome da Sala <span aria-hidden="true">*</span>
            </label>
            <input
              id="room-name-input"
              name="roomName"
              type="text"
              required
              minLength={2}
              maxLength={36}
              autoFocus
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="leather-inlay rounded-lg px-3.5 py-2.5 text-base text-[#f8eedb] outline-none focus:border-[#dfb25e] sm:text-sm"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#cbb693]">
              Visibilidade
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="leather-inlay flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm has-[:checked]:border-[#dfb25e] has-[:checked]:bg-[#2e1e12]">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                <span>Pública (Salão)</span>
              </label>
              <label className="leather-inlay flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm has-[:checked]:border-[#dfb25e] has-[:checked]:bg-[#2e1e12]">
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                <span>Privada (Convite)</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#cbb693]">
              Tempo por Jogada
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {([
                [45, '45 seg'],
                [30, '30 seg'],
                [0, 'Sem limite'],
              ] as const).map(([sec, label]) => (
                <label
                  key={sec}
                  className="leather-inlay flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold has-[:checked]:border-[#dfb25e] has-[:checked]:bg-[#2e1e12]"
                >
                  <input
                    type="radio"
                    name="turnTimerSec"
                    value={sec}
                    checked={turnTimerSec === sec}
                    onChange={() => setTurnTimerSec(sec)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {createError && (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs font-semibold text-[#e57965]"
            >
              <span aria-hidden="true">⚠</span>
              <span>{createError}</span>
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => createDialogRef.current?.close()}
              className="wood-btn rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={creating}
              data-testid="submit-create-room-btn"
              className="brass-btn rounded-lg px-5 py-2 text-sm font-bold"
            >
              {creating ? 'Criando...' : 'Criar e Entrar'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
