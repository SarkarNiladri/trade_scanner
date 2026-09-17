import { getCached, refreshSentiment } from './_lib/sentiment.js';

// Try to load Vercel's waitUntil; fall back to fire-and-forget in local dev.
let waitUntil = (promise) => { promise.catch(() => {}); };
try {
  const mod = await import('@vercel/functions');
  if (typeof mod.waitUntil === 'function') waitUntil = mod.waitUntil;
} catch (_) {
  console.log('[sentiment] @vercel/functions not available, using fallback');
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    waitUntil(
      refreshSentiment()
        .then(r => console.log('[sentiment] refresh complete:', Object.keys(r.sectors || {}).length, 'sectors'))
        .catch(e => console.error('[sentiment] refresh failed:', e.message))
    );
    return res.status(202).json({ status: 'refresh_triggered' });
  }

  try {
    const cached = await getCached();
    res.status(200).json(cached);
  } catch (e) {
    console.error('[sentiment] getCached failed:', e);
    res.status(200).json({
      updated_at: null,
      market: { sentiment: 'NEUTRAL', confidence: 50, reason: 'Error: ' + e.message, headlines: [] },
      sectors: {},
    });
  }
}