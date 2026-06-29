import { NextResponse } from 'next/server';
import { getPublicKey, isPushConfigured } from '@/services/webPush';

// Public VAPID key for the browser to subscribe with. Served at request time
// (not via NEXT_PUBLIC_ build inlining) so it survives env changes without a rebuild.
export async function GET() {
  return NextResponse.json({
    configured: isPushConfigured(),
    publicKey: getPublicKey(),
  });
}
