import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { basicAuth } from 'hono/basic-auth';
import pg from 'pg';
import { DASHBOARD_HTML } from './dashboard.js';

// Ingest + stats API for Paul AI GEO Analyzer.
//
// Privacy contract (mirrors the extension):
// - The payload contains NO URLs, no page content, nothing URL-derived.
// - IPs are used in-memory for rate limiting only and are never persisted.
// - installId is a random UUID generated client-side (pseudonymous).

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const VALID_LANGS = new Set(['en', 'de', 'fr', 'es', 'pt', 'it']);
const VALID_RATINGS = new Set(['excellent', 'good', 'moderate', 'poor']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REC_KEY_RE = /^[a-z0-9_]{1,40}$/;
const CATEGORY_RE = /^[a-zA-Z]{1,30}$/;

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id BIGSERIAL PRIMARY KEY,
      install_id UUID NOT NULL,
      version TEXT NOT NULL,
      lang TEXT NOT NULL,
      score REAL NOT NULL,
      max_score REAL NOT NULL,
      rating_level TEXT NOT NULL,
      categories JSONB NOT NULL,
      recommendations TEXT[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses (created_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_install ON analyses (install_id);
  `);
}

// --- Rate limiting: in-memory, per IP, no persistence -----------------------

const RATE_LIMIT = 120; // requests per hour per IP
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(ip);
  }
}, 600_000).unref();

// --- Payload validation ------------------------------------------------------

interface IngestPayload {
  installId: string;
  version: string;
  lang: string;
  score: number;
  maxScore: number;
  ratingLevel: string;
  categories: Record<string, number>;
  recommendations: string[];
}

function validate(body: unknown): IngestPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.installId !== 'string' || !UUID_RE.test(b.installId)) return null;
  if (typeof b.version !== 'string' || b.version.length > 20) return null;
  if (typeof b.lang !== 'string' || !VALID_LANGS.has(b.lang)) return null;
  if (typeof b.ratingLevel !== 'string' || !VALID_RATINGS.has(b.ratingLevel)) return null;
  if (typeof b.score !== 'number' || !isFinite(b.score) || b.score < 0 || b.score > 100) return null;
  if (typeof b.maxScore !== 'number' || !isFinite(b.maxScore) || b.maxScore <= 0 || b.maxScore > 100) return null;

  if (typeof b.categories !== 'object' || b.categories === null) return null;
  const categories = b.categories as Record<string, unknown>;
  const catEntries = Object.entries(categories);
  if (catEntries.length === 0 || catEntries.length > 12) return null;
  for (const [key, value] of catEntries) {
    if (!CATEGORY_RE.test(key)) return null;
    if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 5) return null;
  }

  if (!Array.isArray(b.recommendations) || b.recommendations.length > 50) return null;
  for (const rec of b.recommendations) {
    if (typeof rec !== 'string' || !REC_KEY_RE.test(rec)) return null;
  }

  return {
    installId: b.installId,
    version: b.version,
    lang: b.lang,
    score: b.score,
    maxScore: b.maxScore,
    ratingLevel: b.ratingLevel,
    categories: categories as Record<string, number>,
    recommendations: b.recommendations as string[],
  };
}

// --- Stats with in-memory cache ----------------------------------------------

interface Stats {
  totalAnalyses: number;
  uniqueInstalls: number;
  avgScore: number;
  maxScore: number;
  ratingDistribution: Record<string, number>;
  topRecommendations: { key: string; count: number; pct: number }[];
  categoryAverages: Record<string, number>;
  updatedAt: string;
}

let statsCache: { data: Stats; expiresAt: number } | null = null;
const STATS_TTL_MS = 10 * 60 * 1000;

async function computeStats(): Promise<Stats> {
  const [totals, ratings, recs, cats] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total, count(DISTINCT install_id)::int AS installs,
              coalesce(avg(score), 0) AS avg_score, coalesce(max(max_score), 30) AS max_score
       FROM analyses`
    ),
    pool.query(`SELECT rating_level, count(*)::int AS n FROM analyses GROUP BY rating_level`),
    pool.query(
      `SELECT r AS key, count(*)::int AS n
       FROM analyses, unnest(recommendations) AS r
       GROUP BY r ORDER BY n DESC LIMIT 15`
    ),
    pool.query(
      `SELECT key, avg(value::float) AS avg
       FROM analyses, jsonb_each_text(categories)
       GROUP BY key`
    ),
  ]);

  const total = totals.rows[0].total as number;
  return {
    totalAnalyses: total,
    uniqueInstalls: totals.rows[0].installs,
    avgScore: Math.round(Number(totals.rows[0].avg_score) * 10) / 10,
    maxScore: Number(totals.rows[0].max_score),
    ratingDistribution: Object.fromEntries(ratings.rows.map((r) => [r.rating_level, r.n])),
    topRecommendations: recs.rows.map((r) => ({
      key: r.key,
      count: r.n,
      pct: total > 0 ? Math.round((r.n / total) * 1000) / 10 : 0,
    })),
    categoryAverages: Object.fromEntries(
      cats.rows.map((r) => [r.key, Math.round(Number(r.avg) * 10) / 10])
    ),
    updatedAt: new Date().toISOString(),
  };
}

// --- History (time series, derived from created_at) --------------------------

interface HistoryPoint {
  day: string; // YYYY-MM-DD
  analyses: number;
  avgScore: number | null; // null on days with no analyses
}

// Daily buckets with gap-filling via generate_series, so the chart stays
// continuous even on days without any analysis. No snapshot job needed — the
// full history lives in the raw rows' created_at.
async function computeHistory(days: number): Promise<HistoryPoint[]> {
  const res = await pool.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            coalesce(a.cnt, 0)::int AS analyses,
            a.avg_score AS avg_score
       FROM generate_series(
              now()::date - ($1::int - 1) * interval '1 day',
              now()::date,
              interval '1 day'
            ) AS d
       LEFT JOIN (
         SELECT date_trunc('day', created_at)::date AS day,
                count(*)::int AS cnt,
                round(avg(score)::numeric, 1) AS avg_score
           FROM analyses
          WHERE created_at >= now()::date - ($1::int - 1) * interval '1 day'
          GROUP BY 1
       ) a ON a.day = d::date
      ORDER BY d`,
    [days]
  );
  return res.rows.map((r) => ({
    day: r.day,
    analyses: r.analyses,
    avgScore: r.avg_score === null ? null : Number(r.avg_score),
  }));
}

// --- App ----------------------------------------------------------------------

const app = new Hono();
app.use('*', cors()); // ACAO * — payloads are anonymous, stats are public

app.get('/health', (c) => c.json({ ok: true }));

// The bare domain is what Coolify links to, and the service has no landing
// page of its own — send it to the dashboard rather than Hono's 404. The
// Basic Auth guard below still applies once the redirect lands.
app.get('/', (c) => c.redirect('/dashboard'));

app.post('/v1/analyses', async (c) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  if (rateLimited(ip)) return c.json({ error: 'rate_limited' }, 429);

  let body: unknown;
  try {
    const raw = await c.req.text();
    if (raw.length > 4096) return c.json({ error: 'too_large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const payload = validate(body);
  if (!payload) return c.json({ error: 'invalid_payload' }, 400);

  await pool.query(
    `INSERT INTO analyses (install_id, version, lang, score, max_score, rating_level, categories, recommendations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      payload.installId,
      payload.version,
      payload.lang,
      payload.score,
      payload.maxScore,
      payload.ratingLevel,
      JSON.stringify(payload.categories),
      payload.recommendations,
    ]
  );

  return c.json({ ok: true }, 201);
});

app.get('/v1/stats', async (c) => {
  if (!statsCache || statsCache.expiresAt < Date.now()) {
    statsCache = { data: await computeStats(), expiresAt: Date.now() + STATS_TTL_MS };
  }
  c.header('Cache-Control', 'public, max-age=600');
  return c.json(statsCache.data);
});

app.get('/v1/stats/history', async (c) => {
  const raw = parseInt(c.req.query('days') || '90', 10);
  const days = isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 90;
  const points = await computeHistory(days);
  c.header('Cache-Control', 'public, max-age=600');
  return c.json({ days, points });
});

// Private dashboard page, guarded by HTTP Basic Auth. Credentials come from
// env (never hardcoded); if they're missing we fail closed (503) rather than
// expose the page. Only the page is protected — /v1/stats[/history] stay open
// (they're anonymous aggregates the public StatsSection already consumes).
const DASH_USER = process.env.DASHBOARD_USER;
const DASH_PASS = process.env.DASHBOARD_PASSWORD;

app.use('/dashboard', async (c, next) => {
  if (!DASH_USER || !DASH_PASS) {
    return c.text('Dashboard auth not configured', 503);
  }
  return basicAuth({ username: DASH_USER, password: DASH_PASS })(c, next);
});
app.get('/dashboard', (c) => c.html(DASHBOARD_HTML));

const port = parseInt(process.env.PORT || '3000', 10);

migrate()
  .then(() => {
    serve({ fetch: app.fetch, port });
    console.log(`geo-analytics-api listening on :${port}`);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
