import { NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * The human side of Day 7.
 *
 * Reads the escalations Nova filed. Same Neon database the agent writes to, so
 * a request appears here seconds after the student agrees to send it.
 */

let pool: Pool | null = null;

function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing');
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

export const revalidate = 0;

export async function GET() {
  try {
    const { rows } = await db().query(
      `SELECT ref, student, reason, urgency, summary, already_tried,
              language, follow_up, status, created_at, updated_at
       FROM escalations
       ORDER BY
         CASE urgency WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
                      WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 50`
    );
    return NextResponse.json({ requests: rows });
  } catch (err) {
    // Table only exists once Nova files its first escalation.
    if (String(err).includes('does not exist')) {
      return NextResponse.json({ requests: [] });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Move a request along: open -> in_progress -> resolved. */
export async function POST(req: Request) {
  const { ref, status } = await req.json();
  if (!ref || !['open', 'in_progress', 'resolved'].includes(status)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  await db().query('UPDATE escalations SET status = $1, updated_at = now() WHERE ref = $2', [
    status,
    ref,
  ]);
  return NextResponse.json({ ok: true });
}
