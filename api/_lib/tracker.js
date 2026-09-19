
import { kvGetJSON, kvSetJSON, kvGet, kvSet, withLock } from './kv.js';
import { fetchCandles } from './data.js';
import { notifyOutcome } from './telegram.js';

const KEY_TRADES = 'trades:current_week';
const KEY_WEEK   = 'trades:week_start';

function mondayISO() {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const d = now.getUTCDay();
  const diff = (d + 6) % 7; // Mon=0
  now.setUTCDate(now.getUTCDate() - diff);
  return now.toISOString().slice(0, 10);
}

// api/_lib/tracker.js — replace ensureCurrentWeek with:

const KEY_ARCHIVE = 'trades:archive';

async function ensureCurrentWeek() {
  const cur = mondayISO();
  const stored = await kvGet(KEY_WEEK);
  if (stored !== cur) {
    // Roll the current week into the archive before clearing
    const current = (await kvGetJSON(KEY_TRADES, [])) || [];
    if (current.length) {
      const archive = (await kvGetJSON(KEY_ARCHIVE, [])) || [];
      await kvSetJSON(KEY_ARCHIVE, [...archive, ...current]);
      console.log(`[tracker] archived ${current.length} trades`);
    }
    await kvSet(KEY_WEEK, cur);
    await kvSetJSON(KEY_TRADES, []);
  }
}

export async function getAllTrades() {
  await ensureCurrentWeek();
  const archive = (await kvGetJSON(KEY_ARCHIVE, [])) || [];
  const current = (await kvGetJSON(KEY_TRADES, [])) || [];
  return [...archive, ...current];
}

export async function getTrades() {
  await ensureCurrentWeek();
  return (await kvGetJSON(KEY_TRADES, [])) || [];
}

export async function addTrade(signal) {
  await ensureCurrentWeek();
  return withLock('trades', async () => {
    const trades = (await kvGetJSON(KEY_TRADES, [])) || [];
    const id = `${signal.symbol}_${signal.signal}_${signal.entry}_${signal.target}_${signal.stop_loss}`;
    if (trades.some(t => t.id === id)) return;

    const entry = Number(signal.entry);
    const sl    = Number(signal.stop_loss);
    const tgt   = Number(signal.target);

    trades.push({
      id,
      symbol: signal.symbol,
      signal: signal.signal,
      entry, target: tgt, stop_loss: sl,
      score: signal.score,
      adx: signal.adx,
      rsi: signal.rsi,
      hour: new Date().getUTCHours() + 5,
      sl_pct:  entry > 0 ? Math.round(Math.abs(entry - sl) / entry * 10000) / 100 : 0,
      tgt_pct: entry > 0 ? Math.round(Math.abs(tgt - entry) / entry * 10000) / 100 : 0,
      source: 'yfinance',
      time: signal.time,
      date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
      outcome: 'OPEN',
      resolved_at: null,
      pnl_pct: null,
      exit: null,
    });

    await kvSetJSON(KEY_TRADES, trades);
  });
}

export async function resetWeek() {
  await withLock('trades', async () => {
    // Roll current trades into archive before clearing
    const current = (await kvGetJSON(KEY_TRADES, [])) || [];
    if (current.length) {
      const archive = (await kvGetJSON(KEY_ARCHIVE, [])) || [];
      await kvSetJSON(KEY_ARCHIVE, [...archive, ...current]);
      console.log(`[tracker] archived ${current.length} trades before manual reset`);
    }
    await kvSet(KEY_WEEK, mondayISO());
    await kvSetJSON(KEY_TRADES, []);
  });
}

export async function resolveOpenTrades() {
  return withLock('trades', async () => {
    const trades = await getTrades();
    const open = trades.filter(t => t.outcome === 'OPEN');
    if (!open.length) return { checked: 0, resolved: 0 };

    let resolvedCount = 0;

    for (const t of open) {
      try {
        const df = await fetchCandles(t.symbol, '15m', 10);
        if (!df.length) continue;

        const recent = df.slice(-260);
        let outcome = null, pnl = 0;

        for (const c of recent) {
          if (t.signal === 'BUY') {
            if (c.close <= t.stop_loss) { outcome = 'LOSS'; pnl = (t.stop_loss - t.entry) / t.entry * 100; break; }
            if (c.high  >= t.target)    { outcome = 'WIN';  pnl = (t.target - t.entry) / t.entry * 100;    break; }
          } else {
            if (c.close >= t.stop_loss) { outcome = 'LOSS'; pnl = (t.entry - t.stop_loss) / t.entry * 100; break; }
            if (c.low   <= t.target)    { outcome = 'WIN';  pnl = (t.entry - t.target) / t.entry * 100;    break; }
          }
        }

        if (outcome) {
          t.outcome = outcome;
          t.pnl_pct = Math.round(pnl * 100) / 100;
          t.resolved_at = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 19) + ' IST';
          resolvedCount++;
          notifyOutcome(t, outcome, pnl).catch(() => {});
        }
      } catch (e) {
        console.error(`[tracker] ${t.symbol}:`, e.message);
      }
    }

    await kvSetJSON(KEY_TRADES, trades);
    return { checked: open.length, resolved: resolvedCount };
  });
}

// ——— Notification dedupe ———
const KEY_NOTIFIED = (fp) => `notified:${fp}`;

export async function hasNotified(fp) {
  return !!(await kvGet(KEY_NOTIFIED(fp)));
}

export async function markNotified(fp) {
  await kvSet(KEY_NOTIFIED(fp), '1', { ex: 86400 });
}