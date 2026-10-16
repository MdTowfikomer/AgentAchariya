import { NextResponse } from 'next/server';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

// don't cache the results
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    const agentName = process.env.AGENT_NAME;

    if (!livekitUrl) {
      throw new Error('LIVEKIT_URL is not defined in environment');
    }
    if (!apiKey) {
      throw new Error('LIVEKIT_API_KEY is not defined in environment');
    }
    if (!apiSecret) {
      throw new Error('LIVEKIT_API_SECRET is not defined in environment');
    }

    // Parse room config from request body (if provided).
    const body = await req.json().catch(() => ({}));
    let roomConfig: RoomConfiguration | undefined;
    if (body?.room_config) {
      roomConfig = RoomConfiguration.fromJson(body.room_config, { ignoreUnknownFields: true });
    } else if (agentName) {
      // When AGENT_NAME is set, configure explicit agent dispatch so the named
      // agent worker picks up the job when a user joins the room.
      roomConfig = RoomConfiguration.fromJson(
        { agents: [{ agentName }] },
        { ignoreUnknownFields: true }
      );
    }

    // Generate participant token
    const participantName = 'user';
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = `voice_assistant_room_${Math.floor(Math.random() * 10_000)}`;

    // The interface language the student picked; the agent starts in it.
    const cookie = req.headers.get('cookie') ?? '';
    const lang = /(?:^|; )nova_lang=([a-z]{2})/.exec(cookie)?.[1] ?? 'en';
    // Set just before "continue chat": the agent waits for the old history.
    const resume = /(?:^|; )nova_resume=1/.test(cookie) ? '1' : '0';

    const participantToken = await createParticipantToken(
      {
        identity: participantIdentity,
        name: participantName,
        attributes: { language: lang, resume },
      },
      roomName,
      apiKey,
      apiSecret,
      roomConfig
    );

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: livekitUrl,
      roomName,
      participantName,
      participantToken,
    };
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error('Error generating token from endpoint /api/token:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  apiKey: string,
  apiSecret: string,
  roomConfig?: RoomConfiguration
): Promise<string> {
  const at = new AccessToken(apiKey, apiSecret, {
    ...userInfo,
    // Long enough for a full class plus reconnects; 15 minutes cut classes off.
    ttl: '3h',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (roomConfig) {
    at.roomConfig = roomConfig;
  }

  return at.toJwt();
}
