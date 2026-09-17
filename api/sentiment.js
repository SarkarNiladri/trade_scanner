import { waitUntil } from '@vercel/functions';
import { getCached, refreshSentiment } from './_lib/sentiment.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    waitUntil(
      refreshSentiment()
        .then(r => console.log('[sentiment] refresh complete:', Object.keys(r.sectors || {}).length, 'sectors'))
        .catch(e => console.error('[sentiment] refresh failed:', e.message))
    );
    return res.status(202).json({ status: 'refresh_triggered' });
  }
  res.status(200).json(await getCached());
}