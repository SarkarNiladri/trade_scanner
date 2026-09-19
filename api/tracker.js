import * as XLSX from 'xlsx';
import { getTrades, getAllTrades, resetWeek, resolveOpenTrades } from './_lib/tracker.js';

// ─── Excel export helpers ────────────────────────────────────────────
function rsiZone(rsi) {
  if (rsi < 35) return 0;
  if (rsi < 50) return 1;
  if (rsi < 65) return 2;
  return 3;
}

function buildRow(t) {
  const hour = Number.isFinite(t.hour) ? t.hour
    : (t.time ? parseInt(String(t.time).split(':')[0], 10) : 12);

  const entry = Number(t.entry);
  const sl    = Number(t.stop_loss);
  const tgt   = Number(t.target);
  const slPct  = entry > 0 ? Math.abs(entry - sl)  / entry * 100 : 0;
  const tgtPct = entry > 0 ? Math.abs(tgt - entry) / entry * 100 : 0;

  const label = t.outcome === 'WIN' ? 1 : t.outcome === 'LOSS' ? 0 : '';

  return {
    symbol:    t.symbol,
    date:      t.date,
    time:      t.time,
    hour,
    signal:    t.signal,
    entry,
    target:    tgt,
    stop_loss: sl,
    score:     Number(t.score),
    adx:       Number(t.adx),
    rsi:       Number(t.rsi),
    is_sell:   t.signal === 'SELL' ? 1 : 0,
    is_hour_10: hour === 10 ? 1 : 0,
    is_hour_11: hour === 11 ? 1 : 0,
    is_hour_12: hour === 12 ? 1 : 0,
    is_hour_13: hour === 13 ? 1 : 0,
    adx_strong: Number(t.adx) >= 40 ? 1 : 0,
    adx_very:   Number(t.adx) >= 55 ? 1 : 0,
    score_high: Number(t.score) >= 11 ? 1 : 0,
    rsi_zone:   rsiZone(Number(t.rsi)),
    sl_pct:     Math.round(slPct * 100) / 100,
    tgt_pct:    Math.round(tgtPct * 100) / 100,
    outcome:     t.outcome || 'OPEN',
    pnl_pct:     t.pnl_pct ?? '',
    resolved_at: t.resolved_at || '',
    source:      t.source || 'yfinance',
    label,
  };
}

function buildWorkbook(trades) {
  const rows = trades.map(buildRow);
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Signals');

  const trainRows = rows.filter(r => r.label === 0 || r.label === 1);
  if (trainRows.length) {
    const wsTrain = XLSX.utils.json_to_sheet(trainRows);
    XLSX.utils.book_append_sheet(wb, wsTrain, 'Training');
  }

  const wins   = rows.filter(r => r.label === 1).length;
  const losses = rows.filter(r => r.label === 0).length;
  const open   = rows.filter(r => r.label === '').length;
  const wr = (wins + losses) > 0 ? wins / (wins + losses) * 100 : 0;

  const summary = [
    { metric: 'Total signals',   value: rows.length },
    { metric: 'Wins',            value: wins },
    { metric: 'Losses',          value: losses },
    { metric: 'Open',            value: open },
    { metric: 'Win rate %',      value: Math.round(wr * 100) / 100 },
    { metric: 'Exported at',     value: new Date().toISOString() },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  return wb;
}

// ─── Route handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = req.query.action;

  if (req.method === 'POST') {
    if (action === 'reset')   { await resetWeek();                    return res.status(200).json({ ok: true }); }
    if (action === 'resolve') { const r = await resolveOpenTrades();  return res.status(200).json({ ok: true, ...r }); }
    return res.status(400).json({ error: 'unknown action' });
  }

  if (action === 'export') {
    try {
      const trades = await getTrades();
      if (!trades.length) return res.status(404).json({ error: 'No trades to export yet' });
      const wb = buildWorkbook(trades);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const filename = `swingscan_signals_${stamp}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(buf);
    } catch (e) {
      console.error('[tracker] export failed:', e);
      return res.status(500).json({ error: 'Export failed: ' + e.message });
    }
  }

  if (action === 'export-all') {
    try {
      const trades = await getAllTrades();
      if (!trades.length) return res.status(404).json({ error: 'No trades in archive yet' });
      const wb = buildWorkbook(trades);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const filename = `swingscan_archive_${stamp}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(buf);
    } catch (e) {
      console.error('[tracker] archive export failed:', e);
      return res.status(500).json({ error: 'Archive export failed: ' + e.message });
    }
  }

  const trades = await getTrades();
  const wins   = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const open   = trades.filter(t => t.outcome === 'OPEN').length;

  res.status(200).json({ trades, total: trades.length, wins, losses, open });
}