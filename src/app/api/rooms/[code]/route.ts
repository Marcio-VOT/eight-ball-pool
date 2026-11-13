import { NextResponse } from 'next/server';
import { getRoomStore } from '@/server/roomStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const store = getRoomStore();
  const meta = store.getRoomPublicMeta(code);

  if (!meta) {
    return NextResponse.json(
      { error: 'Sala não encontrada ou já encerrada.' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { room: meta },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
