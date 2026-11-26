
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

const KEY_ARCHIVE = 'trades:archive';
const BAR_MS = 15 * 60_000;
// Bumped when the grading logic changes; trades graded by an older version
// (or never graded by this one) are re-checked once.
const GRADER_VERSION = 2;

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

// One trade per symbol + direction + IST day. The old id included the entry
// price, which changes on every scan, so one setup was logged many times.
function tradeId(symbol, side, istDate) {
  return `${symbol}_${side}_${istDate}`;
}

function istDateNow() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

// Entry time in ms. Trades saved before this fix have no entry_ts, so rebuild
// it from their IST date + time fields.
function entryTs(t) {
  if (Number.isFinite(t.entry_ts)) return t.entry_ts;
  const hhmmss = String(t.time || '').slice(0, 8);
  const ts = Date.parse(`${t.date}T${hhmmss}+05:30`);
  return Number.isFinite(ts) ? ts : null;
}

// Returns true if a new trade was added, false if this setup is already logged today.
export async function addTrade(signal) {
  await ensureCurrentWeek();
  return withLock('trades', async () => {
    const trades = (await kvGetJSON(KEY_TRADES, [])) || [];
    const date = istDateNow();
    const id = tradeId(signal.symbol, signal.signal, date);
    if (trades.some(t => t.id === id || (t.symbol === signal.symbol && t.signal === signal.signal && t.date === date))) {
      return false;
    }

    const entry = Number(signal.entry);
    const sl    = Number(signal.stop_loss);
    const tgt   = Number(signal.target);
    const now   = Date.now();

    trades.push({
      id,
      symbol: signal.symbol,
      signal: signal.signal,
      entry, target: tgt, stop_loss: sl,
      score: signal.score,
      adx: signal.adx,
      rsi: signal.rsi,
      hour: new Date(now + 5.5 * 3600_000).getUTCHours(),
      sl_pct:  entry > 0 ? Math.round(Math.abs(entry - sl) / entry * 10000) / 100 : 0,
      tgt_pct: entry > 0 ? Math.round(Math.abs(tgt - entry) / entry * 10000) / 100 : 0,
      source: 'yfinance',
      time: signal.time,
      date,
      entry_ts: now,
      grader: GRADER_VERSION,
      outcome: 'OPEN',
      resolved_at: null,
      pnl_pct: null,
      exit: null,
    });

    await kvSetJSON(KEY_TRADES, trades);
    return true;
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

// Pure: grade one trade against 15m candles. Only candles that START after the
// entry time and have fully CLOSED are used. The old code scanned the last
// ~260 candles, including days before the signal, so a BUY in an uptrend was
// almost always marked LOSS by an earlier, lower close.
export function gradeTrade(t, candles, now = Date.now()) {
  const ts = entryTs(t);
  if (ts == null) return null;
  for (const c of candles) {
    const start = c.date instanceof Date ? c.date.getTime() : new Date(c.date).getTime();
    if (start < ts) continue;               // before / during the entry bar
    if (start + BAR_MS > now) break;        // still forming
    // If one candle hits both levels we can't know which came first: count it
    // as a loss (conservative). SL is on close, target on wick, as before.
    if (t.signal === 'BUY') {
      if (c.close <= t.stop_loss) return { outcome: 'LOSS', exit: t.stop_loss, pnl: (t.stop_loss - t.entry) / t.entry * 100, at: start };
      if (c.high  >= t.target)    return { outcome: 'WIN',  exit: t.target,    pnl: (t.target - t.entry) / t.entry * 100,    at: start };
    } else {
      if (c.close >= t.stop_loss) return { outcome: 'LOSS', exit: t.stop_loss, pnl: (t.entry - t.stop_loss) / t.entry * 100, at: start };
      if (c.low   <= t.target)    return { outcome: 'WIN',  exit: t.target,    pnl: (t.entry - t.target) / t.entry * 100,    at: start };
    }
  }
  return null;
}

export async function resolveOpenTrades() {
  return withLock('trades', async () => {
    const trades = await getTrades();
    // Open trades, plus anything graded by the old (buggy) logic.
    const todo = trades.filter(t => t.outcome === 'OPEN' || (t.grader || 1) < GRADER_VERSION);
    if (!todo.length) return { checked: 0, resolved: 0, regraded: 0 };

    let resolvedCount = 0, regraded = 0;

    for (const t of todo) {
      try {
        const df = await fetchCandles(t.symbol, '15m', 10);
        if (!df.length) continue;

        const wasClosed = t.outcome !== 'OPEN';
        const r = gradeTrade(t, df);
        t.grader = GRADER_VERSION;
        if (wasClosed) regraded++;

        if (r) {
          const changed = t.outcome !== r.outcome;
          t.outcome = r.outcome;
          t.exit = Math.round(r.exit * 100) / 100;
          t.pnl_pct = Math.round(r.pnl * 100) / 100;
          t.resolved_at = new Date(r.at + BAR_MS + 5.5 * 3600_000).toISOString().slice(11, 19) + ' IST';
          if (!wasClosed) {
            resolvedCount++;
            notifyOutcome(t, r.outcome, r.pnl).catch(() => {});
          } else if (changed) {
            resolvedCount++;
          }
        } else {
          // Not hit yet (an old LOSS that was never really hit goes back to OPEN).
          t.outcome = 'OPEN';
          t.exit = null; t.pnl_pct = null; t.resolved_at = null;
        }
      } catch (e) {
        console.error(`[tracker] ${t.symbol}:`, e.message);
      }
    }

    await kvSetJSON(KEY_TRADES, trades);
    return { checked: todo.length, resolved: resolvedCount, regraded };
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