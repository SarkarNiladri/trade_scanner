import { getCached, refreshSentiment } from './_lib/sentiment.js';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    refreshSentiment().catch(e => console.error('[sentiment]', e));
    return res.status(202).json({ status: 'refresh_triggered' });
  }
  res.status(200).json(await getCached());
}