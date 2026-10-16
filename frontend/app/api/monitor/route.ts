import { NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

/**
 * Finds the phone call that is happening right now and returns credentials to
 * watch it.
 *
 * Day 6 moved the conversation onto a phone, which left the screen blank —
 * there was nothing to look at while Nova talked to someone's mobile. This
 * endpoint lets a browser join the outbound room as a silent observer so the
 * call can be watched: who is speaking, the live transcript, the code and
 * flowcharts Nova pushes.
 *
 * The observer publishes nothing. It can only listen.
 */

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export const revalidate = 0;

export async function GET() {
  if (!API_KEY || !API_SECRET || !LIVEKIT_URL) {
    return NextResponse.json({ error: 'LiveKit env vars missing' }, { status: 500 });
  }

  const host = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
  const rooms = await new RoomServiceClient(host, API_KEY, API_SECRET).listRooms();

  // outbound.py names every call room nova-outbound-*. Newest wins, so
  // starting a second call switches the monitor to it automatically.
  const call = rooms
    .filter((r) => r.name.startsWith('nova-outbound-'))
    .sort((a, b) => Number(b.creationTime) - Number(a.creationTime))[0];

  if (!call) {
    return NextResponse.json({ waiting: true });
  }

  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: `monitor-${Math.floor(Math.random() * 100000)}`,
    name: 'monitor',
  });
  at.addGrant({
    room: call.name,
    roomJoin: true,
    canSubscribe: true,
    // A watcher, not a participant. No mic, no camera, no data.
    canPublish: false,
    canPublishData: false,
  });

  return NextResponse.json({
    serverUrl: LIVEKIT_URL,
    roomName: call.name,
    participantName: 'monitor',
    participantToken: await at.toJwt(),
  });
}
