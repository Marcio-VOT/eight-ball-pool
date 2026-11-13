'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BALL_COLORS } from '@/engine/constants';
import { countRemainingForGroup } from '@/engine/rules';
import type { BallState, GameStateSnapshot, PlayerGroup } from '@/engine/types';
import type { CameraPreset } from '@/game/renderer3d';
import type { RoomVisibility, TurnTimerSec } from '@/shared/protocol';
import { CueContactWidget } from './CueContactWidget';

interface GameHudProps {
  mode: 'online' | 'practice';
  roomCode?: string;
  roomName?: string;
  visibility?: RoomVisibility;
  turnTimerSec?: TurnTimerSec;
  yourSlot: 0 | 1;
  gameState: GameStateSnapshot;
  isPlayingTimeline: boolean;
  pullPower: number;
  isPulling: boolean;
  tipX: number;
  tipY: number;
  cameraPreset: CameraPreset;
  muted: boolean;
  rematchVotes: [boolean, boolean];
  onTipChange: (tipX: number, tipY: number) => void;
  onCameraChange: (preset: CameraPreset) => void;
  onToggleMute: () => void;
  onRequestRematch: () => void;
  onResetPractice?: () => void;
  onLeaveRoom?: () => void;
  children: React.ReactNode;
}

function BallBadge({ id, pocketed }: { id: number; pocketed: boolean }) {
  const color = BALL_COLORS[id] ?? '#999';
  const isStripe = id >= 9;
  return (
    <div
      title={`Bola ${id}${pocketed ? ' (encaçapada)' : ''}`}
      data-ball-id={id}
      data-pocketed={pocketed ? 'true' : 'false'}
      className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border text-[10px] font-extrabold shadow-sm transition-all ${
        pocketed
          ? 'scale-90 border-[#6b4f2a]/20 opacity-25 grayscale'
          : 'border-[#c6953e]/50 opacity-100'
      }`}
      style={{
        backgroundColor: isStripe ? '#f1e7ce' : color,
      }}
    >
      {isStripe && (
        <span
          className="pointer-events-none absolute inset-x-0 top-[23%] bottom-[23%]"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="relative z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#f4ebd4] font-serif text-[9px] font-bold leading-none text-[#18100a]">
        {id}
      </span>
    </div>
  );
}

function PlayerCard({
  slot,
  name,
  connected,
  group,
  balls,
  isActiveTurn,
  isYou,
  secondsLeft,
}: {
  slot: 0 | 1;
  name: string;
  connected: boolean;
  group: PlayerGroup;
  balls: readonly BallState[];
  isActiveTurn: boolean;
  isYou: boolean;
  secondsLeft: number | null;
}) {
  const ids =
    group === 'solids'
      ? [1, 2, 3, 4, 5, 6, 7]
      : group === 'stripes'
        ? [9, 10, 11, 12, 13, 14, 15]
        : [];
  const remainingCount = group ? countRemainingForGroup(balls, group) : null;
  const onEightBall = group !== null && remainingCount === 0;
  const eightPocketed = balls[8]?.pocketed ?? false;

  return (
    <div
      data-testid={`player-card-${slot}`}
      className={`flex flex-1 flex-col gap-1.5 rounded-xl px-3.5 py-2.5 transition ${
        isActiveTurn
          ? 'border border-[#dfb25e]/85 bg-gradient-to-b from-[#2f1e12] to-[#21140b] shadow-[inset_0_1px_0_rgba(243,214,162,0.18),0_6px_18px_rgba(0,0,0,0.45)]'
          : 'leather-inlay opacity-85'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              connected ? 'bg-[#56b881]' : 'bg-[#dfb25e] animate-pulse'
            }`}
            title={connected ? 'Conectado' : 'Reconectando...'}
          />
          <span className="truncate font-display text-sm font-bold text-[#f8eedb]">
            {name}
            {isYou && (
              <span className="ml-1.5 rounded border border-[#c6953e]/40 bg-[#170f09] px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase text-[#dfb25e]">
                Você
              </span>
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isActiveTurn && secondsLeft !== null && (
            <span
              data-testid="turn-timer"
              className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${
                secondsLeft <= 10
                  ? 'border border-[#e57965]/40 bg-[#4c1c14] text-[#ffd7cf]'
                  : 'border border-[#c6953e]/35 bg-[#170f09] text-[#dfb25e]'
              }`}
            >
              {secondsLeft}s
            </span>
          )}
          <span
            data-testid={`player-${slot}-group`}
            className="rounded border border-[#8a5f38]/40 bg-[#150d08] px-2 py-0.5 text-[11px] font-semibold text-[#cbb693]"
          >
            {group === 'solids'
              ? 'Sólidas (1–7)'
              : group === 'stripes'
                ? 'Listradas (9–15)'
                : 'Mesa Aberta'}
          </span>
        </div>
      </div>

      {/* Ball counter row */}
      <div className="flex min-h-[26px] items-center justify-between gap-2">
        {group ? (
          <>
            <div className="flex items-center gap-1">
              {ids.map((id) => (
                <BallBadge
                  key={id}
                  id={id}
                  pocketed={balls[id]?.pocketed ?? false}
                />
              ))}
              {onEightBall && (
                <div className="ml-1 flex items-center gap-1 border-l border-[#8a5f38]/40 pl-1.5">
                  <BallBadge id={8} pocketed={eightPocketed} />
                </div>
              )}
            </div>
            <span
              data-testid={`player-${slot}-remaining`}
              className="text-xs font-bold tabular-nums text-[#f3e8d2]"
            >
              {onEightBall
                ? 'Na Bola 8'
                : `${7 - (remainingCount ?? 0)}/7 • Restam ${remainingCount}`}
            </span>
          </>
        ) : (
          <div className="flex w-full items-center justify-between gap-2 text-xs text-[#baa482]">
            <span>Encaçape uma bola legal para definir o grupo</span>
            <span
              data-testid={`player-${slot}-remaining`}
              className="shrink-0 font-mono text-[#dfd0b2]"
            >
              {balls.filter((b) => !b.pocketed && b.id !== 0 && b.id !== 8).length} de grupo
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GameHud({
  mode,
  roomCode,
  roomName,
  visibility,
  yourSlot,
  gameState,
  isPlayingTimeline,
  pullPower,
  isPulling,
  tipX,
  tipY,
  cameraPreset,
  muted,
  rematchVotes,
  onTipChange,
  onCameraChange,
  onToggleMute,
  onRequestRematch,
  onResetPractice,
  onLeaveRoom,
  children,
}: GameHudProps) {
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const gameOverDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!gameState.turnDeadlineAt || isPlayingTimeline) return;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [gameState.turnDeadlineAt, isPlayingTimeline]);

  useEffect(() => {
    const dlg = gameOverDialogRef.current;
    if (!dlg) return;
    if (gameState.phase === 'GAME_OVER' && !isPlayingTimeline) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
      dlg.returnValue = '';
    }
  }, [gameState.phase, isPlayingTimeline]);

  const secondsLeft =
    gameState.turnDeadlineAt && !isPlayingTimeline
      ? Math.max(0, Math.ceil((gameState.turnDeadlineAt - nowMs) / 1000))
      : null;

  const isYourTurn =
    mode === 'practice' ||
    (gameState.activeSlot === yourSlot &&
      gameState.phase !== 'WAITING_FOR_PLAYERS' &&
      gameState.phase !== 'GAME_OVER');

  const inviteUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/room/${roomCode}`
      : '';

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard denied
    }
  };

  const p0 = gameState.players[0];
  const p1 = gameState.players[1];

  const getStatusText = () => {
    if (isPlayingTimeline) return 'Tacada em andamento...';
    if (gameState.phase === 'WAITING_FOR_PLAYERS') {
      return 'Aguardando segundo jogador entrar na sala...';
    }
    if (gameState.phase === 'GAME_OVER') {
      return gameState.winReason ?? 'Partida encerrada';
    }
    const actorName = gameState.players[gameState.activeSlot]?.name ?? 'Jogador';
    if (gameState.phase === 'BREAK_PLACEMENT') {
      return isYourTurn
        ? 'Sua saída! Arraste a bola branca na área marcada ou clique e puxe para dar o break.'
        : `${actorName} está preparando a tacada de saída...`;
    }
    if (gameState.phase === 'BALL_IN_HAND') {
      return isYourTurn
        ? 'Bola na mão! Arraste a bola branca para posicionar e depois mire para tacar.'
        : `${actorName} está posicionando a bola branca (bola na mão)...`;
    }
    return isYourTurn
      ? 'Sua vez — Mova o mouse para mirar, clique e puxe para definir a força.'
      : `Vez de ${actorName}`;
  };

  const yourRematchVote = rematchVotes[yourSlot];
  const voteCount = (rematchVotes[0] ? 1 : 0) + (rematchVotes[1] ? 1 : 0);
  const oppSlot: 0 | 1 = yourSlot === 0 ? 1 : 0;
  const opponent = mode === 'online' ? gameState.players[oppSlot] : null;
  const opponentConnected = Boolean(opponent?.connected);

  return (
    <div className="rustic-room-bg flex h-dvh w-screen flex-col overflow-hidden select-none">
      {/* Top Mahogany Scoreboard Rail */}
      <header className="z-20 shrink-0 border-b border-[#6b4f2a]/45 bg-gradient-to-b from-[#23150c] to-[#170e08] px-3 py-2 shadow-[0_6px_20px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {mode === 'online' ? (
                <>
                  <span className="font-display text-sm font-bold text-[#dfb25e]">
                    {roomName || 'Mesa Online'}
                  </span>
                  <span className="rounded border border-[#8a5f38]/50 bg-[#120b06] px-1.5 py-0.5 font-mono text-[11px] text-[#f3e8d2]">
                    {roomCode}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      visibility === 'private'
                        ? 'border border-[#c6953e]/35 bg-[#332011] text-[#dfb25e]'
                        : 'border border-[#288057]/45 bg-[#123826] text-[#8ee3b4]'
                    }`}
                  >
                    {visibility === 'private' ? 'Privada' : 'Pública'}
                  </span>
                  {inviteUrl && (
                    <button
                      type="button"
                      onClick={copyInvite}
                      data-testid="copy-invite-btn"
                      className="wood-btn rounded-md px-2 py-0.5 font-semibold text-[#dfb25e]"
                    >
                      {copied ? 'Link copiado!' : 'Copiar convite'}
                    </button>
                  )}
                </>
              ) : (
                <span className="font-display text-sm font-bold text-[#dfb25e]">
                  Modo Treino (Solo)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <div
                className="leather-inlay flex items-center rounded-lg p-0.5"
                role="group"
                aria-label="Ângulo da câmera"
              >
                {(
                  [
                    ['classic', '2.5D Clássica'],
                    ['angled', '2.5D Ângulo'],
                    ['top', 'Topo 90°'],
                  ] as const
                ).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onCameraChange(preset)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                      cameraPreset === preset
                        ? 'bg-[#c6953e] font-bold text-[#170e06] shadow'
                        : 'text-[#cbb693] hover:text-[#f8eedb]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onToggleMute}
                className="wood-btn rounded-lg px-2.5 py-1 text-[11px] font-medium"
              >
                {muted ? 'Som: OFF' : 'Som: ON'}
              </button>

              {mode === 'practice' && onResetPractice && (
                <button
                  type="button"
                  onClick={onResetPractice}
                  data-testid="reset-practice-btn"
                  className="wood-btn rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[#dfb25e]"
                >
                  Reorganizar Mesa
                </button>
              )}

              {mode === 'online' && onLeaveRoom ? (
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  data-testid="leave-room-btn"
                  className="rounded-lg border border-[#e57965]/40 bg-[#491913] px-2.5 py-1 text-[11px] font-semibold text-[#ffd7cf] transition hover:bg-[#5e2119]"
                >
                  Sair
                </button>
              ) : (
                <Link
                  href="/"
                  className="wood-btn rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                >
                  Voltar ao Lobby
                </Link>
              )}
            </div>
          </div>

          {/* Player Scoreboards */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PlayerCard
              slot={0}
              name={p0?.name ?? 'Jogador 1'}
              connected={p0?.connected ?? false}
              group={p0?.group ?? null}
              balls={gameState.balls}
              isActiveTurn={
                gameState.phase !== 'WAITING_FOR_PLAYERS' &&
                gameState.phase !== 'GAME_OVER' &&
                gameState.activeSlot === 0
              }
              isYou={mode === 'practice' || yourSlot === 0}
              secondsLeft={gameState.activeSlot === 0 ? secondsLeft : null}
            />
            {mode === 'online' ? (
              <PlayerCard
                slot={1}
                name={p1?.name ?? 'Aguardando oponente...'}
                connected={p1?.connected ?? false}
                group={p1?.group ?? null}
                balls={gameState.balls}
                isActiveTurn={
                  gameState.phase !== 'WAITING_FOR_PLAYERS' &&
                  gameState.phase !== 'GAME_OVER' &&
                  gameState.activeSlot === 1
                }
                isYou={yourSlot === 1}
                secondsLeft={gameState.activeSlot === 1 ? secondsLeft : null}
              />
            ) : (
              <div className="leather-inlay flex items-center justify-between gap-3 rounded-xl px-3.5 py-2 text-xs text-[#cbb693]">
                <div className="flex flex-wrap items-center gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((id) => (
                    <BallBadge
                      key={id}
                      id={id}
                      pocketed={gameState.balls[id]?.pocketed ?? false}
                    />
                  ))}
                </div>
                <span
                  data-testid="practice-pocketed-count"
                  className="shrink-0 rounded border border-[#8a5f38]/40 bg-[#1e130b] px-2.5 py-1 font-mono font-bold text-[#dfb25e]"
                >
                  {gameState.balls.filter((b) => b.pocketed && b.id !== 0).length}/15
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Center Unobstructed 2.5D Table Stage */}
      <main className="relative min-h-0 w-full flex-1">
        {children}

        {/* Floating Brass-Trimmed Turn / Foul Plaque */}
        <div className="pointer-events-none absolute inset-x-0 top-1.5 z-10 flex flex-wrap items-center justify-center gap-2 px-3">
          <div
            data-testid="game-status-banner"
            className="rounded-lg border border-[#9a6e28]/55 bg-[#191009]/92 px-4 py-1 text-xs font-medium text-[#f3e8d2] shadow-lg"
          >
            {getStatusText()}
          </div>
          {gameState.lastFoul && !isPlayingTimeline && (
            <div
              data-testid="foul-banner"
              className="flex items-center gap-1.5 rounded-lg border border-[#e57965]/50 bg-[#3a150f]/95 px-3.5 py-1 text-xs font-semibold text-[#ffd7cf] shadow-lg"
            >
              <span aria-hidden="true">⚠</span>
              <span>{gameState.lastFoul.message}</span>
            </div>
          )}
        </div>

        {/* Center Waiting / Invite Overlay */}
        {mode === 'online' && gameState.phase === 'WAITING_FOR_PLAYERS' && (
          <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-[#0a0503]/55 p-4 backdrop-blur-[2px]">
            <div className="wood-panel flex max-w-md flex-col items-center gap-3 rounded-2xl p-6 text-center">
              <div className="rounded border border-[#c6953e]/40 bg-[#170f09] px-3 py-1 text-xs font-semibold text-[#dfb25e]">
                Sala {visibility === 'private' ? 'Privada' : 'Pública'} Criada
              </div>
              <h2 className="font-display text-xl font-bold text-[#f8eedb]">
                Aguardando o segundo jogador
              </h2>
              <p className="text-sm text-[#cbb693]">
                Compartilhe o código abaixo ou envie o link de convite para iniciar a
                partida.
              </p>
              <div className="leather-inlay flex items-center gap-2 rounded-xl px-5 py-2.5">
                <span
                  data-testid="waiting-room-code"
                  className="font-mono text-2xl font-bold tracking-widest text-[#dfb25e]"
                >
                  {roomCode}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={copyInvite}
                  className="brass-btn rounded-lg px-4 py-2 text-sm font-bold"
                >
                  {copied ? 'Link Copiado!' : 'Copiar Link de Convite'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Mahogany & Leather Controls Strip */}
      <footer className="z-20 shrink-0 border-t border-[#6b4f2a]/45 bg-gradient-to-t from-[#23150c] to-[#170e08] px-3 py-2 shadow-[0_-6px_20px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          {/* Power Gauge */}
          <div className="leather-inlay flex flex-col gap-1.5 rounded-xl px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="font-semibold uppercase tracking-wider text-[#baa482]">
                Força da Tacada
              </span>
              <span
                data-testid="power-percent"
                className="font-mono font-bold tabular-nums text-[#f8eedb]"
              >
                {Math.round(pullPower * 100)}%
              </span>
            </div>
            <div className="h-3 w-48 overflow-hidden rounded-full border border-[#6b4f2a]/50 bg-[#0e0805] sm:w-64">
              <div
                className="h-full transition-[width] duration-75"
                style={{
                  width: `${Math.round(pullPower * 100)}%`,
                  background:
                    pullPower > 0.75
                      ? 'linear-gradient(90deg, #288057, #c6953e, #c04432)'
                      : pullPower > 0.4
                        ? 'linear-gradient(90deg, #288057, #c6953e)'
                        : '#288057',
                }}
              />
            </div>
            <span className="text-[11px] text-[#baa482]">
              {isPulling
                ? pullPower < 0.025
                  ? 'Solte agora para cancelar'
                  : 'Solte o mouse para tacar (Botão direito/Esc cancela)'
                : 'Clique e arraste para trás para controlar a força'}
            </span>
          </div>

          <div className="hidden flex-col items-center gap-0.5 text-center text-[11px] text-[#baa482] lg:flex">
            <span className="font-semibold text-[#dfd0b2]">Controles do Mouse</span>
            <span>
              Mover = mirar direto • Arrastar = força • Botão dir.+mover / Shift / Roda =
              sub-pixel
            </span>
          </div>

          <CueContactWidget
            tipX={tipX}
            tipY={tipY}
            disabled={gameState.phase === 'GAME_OVER'}
            onChange={onTipChange}
          />
        </div>
      </footer>

      {/* Native Modal Dialog for Game Over */}
      <dialog
        ref={gameOverDialogRef}
        aria-labelledby="gameover-title"
        className="wood-panel pointer-events-auto m-auto w-full max-w-md rounded-2xl p-6 text-[#f3e8d2]"
        onCancel={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="rounded border border-[#c6953e]/40 bg-[#170f09] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#dfb25e]">
            {mode === 'online' && !opponentConnected ? 'Oponente Saiu' : 'Fim de Jogo'}
          </span>
          <h2
            id="gameover-title"
            className="font-display text-2xl font-bold text-[#f8eedb]"
          >
            {gameState.winnerSlot === yourSlot ? 'Você Venceu!' : 'Partida Encerrada'}
          </h2>
          <p className="text-sm text-[#cbb693]">{gameState.winReason}</p>
          {mode === 'online' && !opponentConnected && (
            <p
              data-testid="opponent-left-notice"
              className="rounded-xl border border-[#c6953e]/35 bg-[#2a1b10] px-3 py-2 text-xs text-[#dfb25e]"
            >
              O outro jogador saiu da sala. Volte ao lobby para entrar em uma nova partida.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {mode === 'online' && opponentConnected && (
              <button
                type="button"
                disabled={yourRematchVote}
                onClick={onRequestRematch}
                autoFocus
                data-testid="rematch-btn"
                className="brass-btn rounded-lg px-5 py-2.5 text-sm font-bold"
              >
                {yourRematchVote
                  ? `Aguardando oponente (${voteCount}/2)`
                  : `Revanche (${voteCount}/2)`}
              </button>
            )}
            {mode === 'practice' && onResetPractice && (
              <button
                type="button"
                onClick={onResetPractice}
                autoFocus
                className="brass-btn rounded-lg px-5 py-2.5 text-sm font-bold"
              >
                Jogar Novamente
              </button>
            )}
            {onLeaveRoom ? (
              <button
                type="button"
                onClick={onLeaveRoom}
                autoFocus={mode === 'online' && !opponentConnected}
                data-testid="leave-gameover-btn"
                className={
                  mode === 'online' && !opponentConnected
                    ? 'brass-btn rounded-lg px-5 py-2.5 text-sm font-bold'
                    : 'wood-btn rounded-lg px-4 py-2.5 text-sm font-semibold'
                }
              >
                Voltar ao Lobby
              </button>
            ) : (
              <Link
                href="/"
                className="wood-btn rounded-lg px-4 py-2.5 text-sm font-semibold"
              >
                Voltar ao Lobby
              </Link>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
