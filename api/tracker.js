import { getTrades, resetWeek, resolveOpenTrades } from './_lib/tracker.js';

export default async function handler(req, res) {
  const action = req.query.action;

  if (req.method === 'POST') {
    if (action === 'reset')   { await resetWeek();        return res.status(200).json({ ok: true }); }
    if (action === 'resolve') { const r = await resolveOpenTrades(); return res.status(200).json({ ok: true, ...r }); }
    return res.status(400).json({ error: 'unknown action' });
  }

  const trades = await getTrades();
  const wins   = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const open   = trades.filter(t => t.outcome === 'OPEN').length;

  res.status(200).json({ trades, total: trades.length, wins, losses, open });
}