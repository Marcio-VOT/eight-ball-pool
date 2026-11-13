'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PoolTableView } from '@/components/PoolTableView';
import { saveNickname } from '@/game/session';
import { useSavedNickname } from '@/game/useSavedNickname';
import type { PublicRoomInfo } from '@/shared/protocol';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = String(params?.code || '').toUpperCase();

  const [checking, setChecking] = useState(true);
  const [roomInfo, setRoomInfo] = useState<PublicRoomInfo | null>(null);
  const [notFoundError, setNotFoundError] = useState<string | null>(null);

  const savedNickname = useSavedNickname('');
  const [confirmedNickname, setConfirmedNickname] = useState<string | null>(null);
  const playerName =
    confirmedNickname ?? (savedNickname.length >= 2 ? savedNickname : null);
  const [nickDraft, setNickDraft] = useState('');

  useEffect(() => {
    if (!code) return;
    let active = true;
    fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Sala não encontrada ou já encerrada.');
        }
        return (await res.json()) as { room: PublicRoomInfo };
      })
      .then((data) => {
        if (active) setRoomInfo(data.room);
      })
      .catch((err: Error) => {
        if (active) setNotFoundError(err.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [code]);

  if (checking) {
    return (
      <div className="rustic-room-bg flex min-h-screen items-center justify-center text-sm text-[#cbb693]">
        Conectando à sala {code}...
      </div>
    );
  }

  if (notFoundError || !roomInfo) {
    return (
      <div className="rustic-room-bg flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="wood-panel flex max-w-md flex-col items-center gap-4 rounded-2xl p-6">
          <h1 className="font-display text-2xl font-bold text-[#f8eedb]">
            Mesa Indisponível
          </h1>
          <p className="text-sm text-[#cbb693]">
            {notFoundError ?? 'Esta sala não existe mais ou foi encerrada.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="brass-btn rounded-lg px-5 py-2.5 text-sm font-bold"
          >
            Voltar ao Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!playerName) {
    const handleConfirmNick = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nickDraft.trim();
      if (trimmed.length < 2) return;
      saveNickname(trimmed);
      setConfirmedNickname(trimmed);
    };

    return (
      <div className="rustic-room-bg flex min-h-screen items-center justify-center p-4">
        <form
          onSubmit={handleConfirmNick}
          className="wood-panel flex w-full max-w-sm flex-col gap-4 rounded-2xl p-6"
        >
          <div className="flex flex-col gap-1 border-b border-[#6b4f2a]/40 pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#dfb25e]">
              Convite para Sala {roomInfo.code}
            </span>
            <h1 className="font-display text-xl font-bold text-[#f8eedb]">
              {roomInfo.name}
            </h1>
            <p className="text-xs text-[#baa482]">
              Anfitrião: {roomInfo.hostName} • {roomInfo.playerCount}/2 jogadores
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="invite-nickname"
              className="text-xs font-semibold uppercase tracking-wider text-[#cbb693]"
            >
              Escolha seu apelido <span aria-hidden="true">*</span>
            </label>
            <input
              id="invite-nickname"
              name="nickname"
              type="text"
              required
              minLength={2}
              maxLength={24}
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={nickDraft}
              onChange={(e) => setNickDraft(e.target.value)}
              placeholder="Ex: Lucas"
              className="leather-inlay rounded-lg px-3.5 py-2.5 text-base text-[#f8eedb] placeholder:text-[#7e694f] outline-none focus:border-[#dfb25e] sm:text-sm"
            />
          </div>

          <button
            type="submit"
            data-testid="invite-join-btn"
            className="brass-btn rounded-lg px-4 py-2.5 text-sm font-bold"
          >
            Entrar na Partida
          </button>
        </form>
      </div>
    );
  }

  return <PoolTableView mode="online" roomCode={code} playerName={playerName} />;
}
