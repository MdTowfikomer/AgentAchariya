import { NextResponse } from 'next/server';
import { Pool } from 'pg';

/**
 * Call analytics.
 *
 * Reads the rows the agent writes when each call ends. Everything here is
 * counters and timings — no transcript, no phone number, no student content.
 * Nothing on this endpoint would embarrass anyone if it leaked.
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
    const totals = await db().query(`
      SELECT
        count(*)                                              AS total,
        count(*) FILTER (WHERE outcome = 'success')           AS successful,
        count(*) FILTER (WHERE outcome = 'failed')            AS failed,
        count(*) FILTER (WHERE outcome IS NULL)               AS in_progress,
        coalesce(sum(concepts_taught), 0)                     AS concepts_taught,
        coalesce(sum(problems_given), 0)                      AS problems_given,
        coalesce(sum(escalations), 0)                         AS escalations,
        coalesce(round(avg(duration_s) FILTER (WHERE duration_s > 0)), 0) AS avg_duration_s
      FROM calls
    `);

    const failures = await db().query(`
      SELECT failure_type, count(*) AS n
      FROM calls WHERE outcome = 'failed' AND failure_type IS NOT NULL
      GROUP BY failure_type ORDER BY n DESC
    `);

    const channels = await db().query(`
      SELECT channel,
             count(*) AS n,
             count(*) FILTER (WHERE outcome = 'success') AS successful
      FROM calls GROUP BY channel
    `);

    // Deliberately narrow: no student name, no transcript, no phone number.
    const recent = await db().query(`
      SELECT id, channel, language, started_at, duration_s, outcome, failure_type,
             concepts_taught, problems_given, escalations, turns
      FROM calls ORDER BY started_at DESC LIMIT 15
    `);

    return NextResponse.json({
      totals: totals.rows[0],
      failures: failures.rows,
      channels: channels.rows,
      recent: recent.rows,
    });
  } catch (err) {
    // The table only exists after the first call completes.
    if (String(err).includes('does not exist')) {
      return NextResponse.json({
        totals: {
          total: 0,
          successful: 0,
          failed: 0,
          in_progress: 0,
          concepts_taught: 0,
          problems_given: 0,
          escalations: 0,
          avg_duration_s: 0,
        },
        failures: [],
        channels: [],
        recent: [],
      });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
