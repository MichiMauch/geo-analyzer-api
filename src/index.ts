import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { initDb, insertAnalysis, getAllAnalyses, getAnalysesByUrl, findRecentDuplicate } from './db.js';

const app = new Hono();

// Config
const API_SECRET = process.env.API_SECRET || 'd7fd0a8f603b27df21e6f5325147a1f02039e4127101c5be756c42187b9df76e';
const RATE_LIMIT_MAX = 5;           // max requests per window per IP
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const DEDUP_WINDOW_MINUTES = 60; // 1 hour

// In-memory rate limiter (per-IP sliding window)
const rateLimitStore = new Map<string, number[]>();

function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0].trim()
    || c.req.header('x-real-ip')
    || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(ip) || []).filter((t) => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return true;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of rateLimitStore) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, recent);
  }
}, RATE_LIMIT_WINDOW_MS);

// CORS
app.use('*', cors());

// Health check (public)
app.get('/', (c) => c.json({ status: 'ok', service: 'geo-analyzer-api' }));

// POST /api/analyses — protected endpoint
app.post('/api/analyses', async (c) => {
  // 1. Origin check — only allow Chrome extension origins
  const origin = c.req.header('origin') || '';
  if (!origin.startsWith('chrome-extension://')) {
    return c.json({ error: 'Invalid origin' }, 403);
  }

  // 2. Shared-secret check
  const providedSecret = c.req.header('x-api-key');
  if (providedSecret !== API_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // 3. Rate limiting per IP
  const ip = getClientIp(c);
  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded (5 requests/minute)' }, 429);
  }

  const body = await c.req.json();

  // 4. Validate payload
  const { url, timestamp, totalScore, categories, extensionVersion } = body;

  if (!url || typeof url !== 'string' || url.length > 2000) {
    return c.json({ error: 'url is required' }, 400);
  }
  if (!timestamp || typeof timestamp !== 'string') {
    return c.json({ error: 'timestamp is required' }, 400);
  }
  if (typeof totalScore !== 'number' || totalScore < 0 || totalScore > 25) {
    return c.json({ error: 'totalScore must be 0-25' }, 400);
  }
  if (!categories || typeof categories !== 'object') {
    return c.json({ error: 'categories is required' }, 400);
  }

  const catKeys = ['contentClarity', 'answerability', 'trustSources', 'machineReadability', 'aiCitation'];
  for (const key of catKeys) {
    if (typeof categories[key] !== 'number' || categories[key] < 0 || categories[key] > 5) {
      return c.json({ error: `categories.${key} must be 0-5` }, 400);
    }
  }

  // 5. Deduplication — reject if same URL+score posted recently
  if (findRecentDuplicate(url, totalScore, DEDUP_WINDOW_MINUTES)) {
    return c.json({ error: 'Duplicate: same URL+score within last hour' }, 409);
  }

  insertAnalysis({
    url,
    timestamp,
    totalScore,
    contentClarity: categories.contentClarity,
    answerability: categories.answerability,
    trustSources: categories.trustSources,
    machineReadability: categories.machineReadability,
    aiCitation: categories.aiCitation,
    extensionVersion: extensionVersion || 'unknown',
  });

  return c.json({ ok: true }, 201);
});

// List all analyses (protected with secret)
app.get('/api/analyses', (c) => {
  const providedSecret = c.req.header('x-api-key') || c.req.query('key');
  if (providedSecret !== API_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const url = c.req.query('url');
  const limit = parseInt(c.req.query('limit') || '100', 10);

  const analyses = url ? getAnalysesByUrl(url, limit) : getAllAnalyses(limit);
  return c.json(analyses);
});

// Initialize database and start server
initDb();

const port = parseInt(process.env.PORT || '3000', 10);
console.log(`GEO Analyzer API running on port ${port}`);

serve({ fetch: app.fetch, port });
