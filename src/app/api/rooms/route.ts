import { NextResponse } from 'next/server';
import { getRoomStore } from '@/server/roomStore';
import { CreateRoomSchema } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const store = getRoomStore();
  return NextResponse.json(
    { rooms: store.listPublicRooms() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Corpo JSON inválido.' },
      { status: 400 }
    );
  }

  const parsed = CreateRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const store = getRoomStore();
  const { room, hostSessionToken, invitePath } = store.createRoom(parsed.data);

  if (room.visibility === 'public') {
    globalThis.__poolBroadcastLobby?.();
  }

  return NextResponse.json(
    {
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      turnTimerSec: room.turnTimerSec,
      invitePath,
      hostSessionToken,
    },
    { status: 201 }
  );
}
