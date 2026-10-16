import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const revalidate = 0;

let pool: Pool | null = null;

function getPool(): Pool | null {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: dsn,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name).trim();
  const slug = decoded.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '-');

  const p = getPool();
  if (!p) {
    return NextResponse.json({
      configured: false,
      student: {
        name: decoded,
        level: 'beginner',
        topics_covered: [],
        weak_spots: [],
        language_preference: 'en',
      },
      calls: [],
    });
  }

  try {
    const studentRes = await p.query(
      'SELECT user_id, name, language_preference, facts, last_interaction FROM students WHERE user_id = $1',
      [slug]
    );

    const callsRes = await p.query(
      'SELECT id, channel, language, started_at, duration_s, outcome, concepts_taught, problems_given, turns FROM calls WHERE student = $1 ORDER BY started_at DESC LIMIT 10',
      [decoded]
    );

    const studentRow = studentRes.rows[0];
    const facts = studentRow?.facts || {};

    return NextResponse.json({
      configured: true,
      student: {
        user_id: slug,
        name: studentRow?.name || decoded,
        language_preference: studentRow?.language_preference || 'en',
        level: facts.level || 'beginner',
        topics_covered: facts.topics_covered || [],
        weak_spots: facts.weak_spots || [],
        last_interaction: studentRow?.last_interaction || null,
      },
      calls: callsRes.rows,
    });
  } catch (err) {
    console.error('Failed to fetch student progress:', err);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
