import { NextResponse } from 'next/server';

/**
 * Lightweight liveness probe for Docker / reverse-proxy health checks.
 * Does not touch the database or upstream API.
 */
export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'hector-web' },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
