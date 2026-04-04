import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { initDb, insertAnalysis, getAllAnalyses, getAnalysesByUrl } from './db.js';

const app = new Hono();

// CORS for Chrome Extension
app.use('*', cors());

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'geo-analyzer-api' }));

// Receive analysis data
app.post('/api/analyses', async (c) => {
  const body = await c.req.json();

  // Validate payload
  const { url, timestamp, totalScore, categories, extensionVersion } = body;

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required' }, 400);
  }
  if (!timestamp || typeof timestamp !== 'string') {
    return c.json({ error: 'timestamp is required' }, 400);
  }
  if (typeof totalScore !== 'number' || totalScore < 0 || totalScore > 20) {
    return c.json({ error: 'totalScore must be 0-20' }, 400);
  }
  if (!categories || typeof categories !== 'object') {
    return c.json({ error: 'categories is required' }, 400);
  }

  const catKeys = ['contentClarity', 'answerability', 'trustSources', 'machineReadability'];
  for (const key of catKeys) {
    if (typeof categories[key] !== 'number' || categories[key] < 0 || categories[key] > 5) {
      return c.json({ error: `categories.${key} must be 0-5` }, 400);
    }
  }

  insertAnalysis({
    url,
    timestamp,
    totalScore,
    contentClarity: categories.contentClarity,
    answerability: categories.answerability,
    trustSources: categories.trustSources,
    machineReadability: categories.machineReadability,
    extensionVersion: extensionVersion || 'unknown',
  });

  return c.json({ ok: true }, 201);
});

// List all analyses (simple GET for manual inspection)
app.get('/api/analyses', (c) => {
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
