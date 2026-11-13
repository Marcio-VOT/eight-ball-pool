import { NextResponse } from 'next/server';
import { getRoomStore } from '@/server/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const store = getRoomStore();
  return NextResponse.json({
    ok: true,
    roomsActive: store.getRoomCount(),
    publicRooms: store.listPublicRooms().length,
  });
}
