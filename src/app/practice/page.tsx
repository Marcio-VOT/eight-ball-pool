'use client';

import { PoolTableView } from '@/components/PoolTableView';
import { useSavedNickname } from '@/game/useSavedNickname';

export default function PracticePage() {
  const name = useSavedNickname('Jogador');

  return <PoolTableView mode="practice" playerName={name} />;
}
