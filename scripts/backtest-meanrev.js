// scripts/backtest-meanrev.js
// Mean reversion swing backtest on Nifty 100.
// Entry: RSI(14) < 30 AND close < lower BB(20,2)
//        AND stock EMA50 > EMA200 AND Nifty close > Nifty EMA200
// Exit: middle BB (target) OR entry - 2*ATR (stop) OR 10-day timeout
//
// Usage:
//   npm run backtest:meanrev -- --limit 20
//   npm run backtest:meanrev

import { fetchCandles, SYMBOLS_100 } from '../api/_lib/data.js';
import { ema, rsi, bbands, atr } from '../api/_lib/indicators.js';

// ─── Configuration ─────────────────────────────────────────────────────
const CFG = {
  RSI_PERIOD:        14,
  RSI_THRESHOLD:     30,      // entry RSI must be below this
  BB_PERIOD:         20,
  BB_STD:            2,
  EMA_SHORT:         50,
  EMA_LONG:          200,
  ATR_PERIOD:        14,
  ATR_STOP_MULT:     2.0,
  NIFTY_EMA_PERIOD:  200,
  MAX_HOLD_DAYS:     10,
  HISTORY_DAYS:      1825,    // ~5 years
};

// ─── Args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: null, symbols: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit')   out.limit = parseInt(args[i+1], 10);
    if (args[i] === '--symbols') out.symbols = args[i+1].split(',').map(s => s.trim().toUpperCase());
  }
  return out;
}

// ─── Date matching ─────────────────────────────────────────────────────
function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function buildNiftyLookup(niftyCandles) {
  const map = new Map();
  for (const c of niftyCandles) map.set(dateKey(c.date), c);
  return map;
}

// ─── Backtest one symbol ───────────────────────────────────────────────
async function backtestSymbol(symbol, niftyLookup) {
  const candles = await fetchCandles(symbol, '1d', CFG.HISTORY_DAYS);
  if (candles.length < CFG.EMA_LONG + 50) {
    return { symbol, trades: [], skipped: `only ${candles.length} candles` };
  }

  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  const rsiArr   = rsi(closes, CFG.RSI_PERIOD);
  const bbArr    = bbands(closes, CFG.BB_PERIOD, CFG.BB_STD);
  const emaShort = ema(closes, CFG.EMA_SHORT);
  const emaLong  = ema(closes, CFG.EMA_LONG);
  const atrArr   = atr(highs, lows, closes, CFG.ATR_PERIOD);

  const trades = [];
  let i = CFG.EMA_LONG;   // start after warmup

  while (i < candles.length - CFG.MAX_HOLD_DAYS - 1) {
    const niftyCandle = niftyLookup.get(dateKey(candles[i].date));

    const r        = rsiArr[i];
    const bbLower  = bbArr.lower[i];
    const bbMid    = bbArr.mid[i];
    const close    = closes[i];
    const e50      = emaShort[i];
    const e200     = emaLong[i];
    const atrVal   = atrArr[i];

    // Sanity: skip if indicators not ready
    if (![r, bbLower, bbMid, e50, e200, atrVal].every(Number.isFinite)) { i++; continue; }
    if (!niftyCandle) { i++; continue; }

    // Entry conditions
    const oversold       = r < CFG.RSI_THRESHOLD;
    const belowLowerBB   = close < bbLower;
    const stockUptrend   = e50 > e200;
    const niftyUptrend   = niftyCandle.close > niftyCandle.ema200;   // pre-computed
    const canEnter       = oversold && belowLowerBB && stockUptrend && niftyUptrend;

    if (!canEnter) { i++; continue; }

    // Trade geometry
    const entryPrice = close;
    const target     = bbMid;
    const stop       = entryPrice - CFG.ATR_STOP_MULT * atrVal;

    // Reject degenerate trades
    if (target <= entryPrice || stop >= entryPrice) { i++; continue; }

    // Simulate forward
    let exit = null;
    for (let j = i + 1; j < Math.min(i + 1 + CFG.MAX_HOLD_DAYS, candles.length); j++) {
      const c = candles[j].close;
      if (c <= stop)   { exit = { price: stop,   reason: 'STOP',    days: j - i }; break; }
      if (c >= target) { exit = { price: target, reason: 'TARGET',  days: j - i }; break; }
    }
    if (!exit) {
      const j = Math.min(i + CFG.MAX_HOLD_DAYS, candles.length - 1);
      exit = { price: candles[j].close, reason: 'TIMEOUT', days: j - i };
    }

    const pnlPct = (exit.price - entryPrice) / entryPrice * 100;

    trades.push({
      symbol,
      entryDate:   candles[i].date,
      entryPrice:  Math.round(entryPrice * 100) / 100,
      target:      Math.round(target * 100) / 100,
      stop:        Math.round(stop * 100) / 100,
      exitDate:    candles[i + exit.days].date,
      exitPrice:   Math.round(exit.price * 100) / 100,
      exitReason:  exit.reason,
      daysHeld:    exit.days,
      pnlPct:      Math.round(pnlPct * 100) / 100,
      rsiAtEntry:  Math.round(r * 10) / 10,
      distBelowBB: Math.round((bbLower - close) / close * 10000) / 100,
    });

    // Skip past this trade — no overlapping positions per symbol
    i += exit.days + 1;
  }

  return { symbol, trades };
}

// ─── Summary ───────────────────────────────────────────────────────────
function printSummary(allTrades, symbolsTested) {
  if (allTrades.length === 0) {
    console.log('\nNo trades generated.\n');
    return;
  }

  const wins     = allTrades.filter(t => t.pnlPct > 0);
  const losses   = allTrades.filter(t => t.pnlPct <= 0);
  const byReason = {
    TARGET:  allTrades.filter(t => t.exitReason === 'TARGET').length,
    STOP:    allTrades.filter(t => t.exitReason === 'STOP').length,
    TIMEOUT: allTrades.filter(t => t.exitReason === 'TIMEOUT').length,
  };

  const grossWin  = wins.reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const pf        = grossLoss > 0 ? grossWin / grossLoss : Infinity;
  const winRate   = wins.length / allTrades.length * 100;
  const avgWin    = wins.length ? grossWin / wins.length : 0;
  const avgLoss   = losses.length ? -grossLoss / losses.length : 0;
  const totalPnl  = allTrades.reduce((a, t) => a + t.pnlPct, 0);
  const avgPnl    = totalPnl / allTrades.length;
  const avgDays   = allTrades.reduce((a, t) => a + t.daysHeld, 0) / allTrades.length;

  // Equity curve + drawdown
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of allTrades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(' MEAN REVERSION BACKTEST — SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Symbols tested       : ${symbolsTested}`);
  console.log(` Total trades         : ${allTrades.length}`);
  console.log(` Avg hold (days)      : ${avgDays.toFixed(1)}`);
  console.log('');
  console.log(` Wins / Losses        : ${wins.length} / ${losses.length}`);
  console.log(` Win rate             : ${winRate.toFixed(1)}%`);
  console.log('');
  console.log(` Exit breakdown:`);
  console.log(`   Target hit         : ${byReason.TARGET}  (${(byReason.TARGET/allTrades.length*100).toFixed(1)}%)`);
  console.log(`   Stop hit           : ${byReason.STOP}  (${(byReason.STOP/allTrades.length*100).toFixed(1)}%)`);
  console.log(`   Timeout            : ${byReason.TIMEOUT}  (${(byReason.TIMEOUT/allTrades.length*100).toFixed(1)}%)`);
  console.log('');
  console.log(` Avg win              : +${avgWin.toFixed(2)}%`);
  console.log(` Avg loss             : ${avgLoss.toFixed(2)}%`);
  console.log(` Profit factor        : ${pf === Infinity ? '∞' : pf.toFixed(2)}`);
  console.log(` Expectancy / trade   : ${avgPnl.toFixed(2)}%`);
  console.log('');
  console.log(` Cumulative P&L       : ${totalPnl.toFixed(2)}%`);
  console.log(` Max drawdown         : ${maxDD.toFixed(2)}%`);
  console.log('');

  // Yearly breakdown — critical honesty check
  console.log('────────────────────────────────────────────────────────────');
  console.log(' By year:');
  const byYear = {};
  for (const t of allTrades) {
    const y = t.entryDate.getUTCFullYear();
    byYear[y] = byYear[y] || { count: 0, wins: 0, pnl: 0 };
    byYear[y].count++;
    if (t.pnlPct > 0) byYear[y].wins++;
    byYear[y].pnl += t.pnlPct;
  }
  for (const y of Object.keys(byYear).sort()) {
    const row = byYear[y];
    const wr = row.count ? row.wins / row.count * 100 : 0;
    console.log(`   ${y}: ${String(row.count).padStart(3)} trades  WR ${wr.toFixed(0).padStart(3)}%  P&L ${row.pnl >= 0 ? '+' : ''}${row.pnl.toFixed(1)}%`);
  }

  // RSI buckets — does deeper oversold outperform?
  console.log('');
  console.log(' By RSI at entry:');
  const buckets = [
    { lo: 0,  hi: 20,  label: '<20' },
    { lo: 20, hi: 25,  label: '20-25' },
    { lo: 25, hi: 28,  label: '25-28' },
    { lo: 28, hi: 30,  label: '28-30' },
  ];
  for (const b of buckets) {
    const rows = allTrades.filter(t => t.rsiAtEntry >= b.lo && t.rsiAtEntry < b.hi);
    if (rows.length === 0) continue;
    const w = rows.filter(t => t.pnlPct > 0).length;
    const pnl = rows.reduce((a, t) => a + t.pnlPct, 0) / rows.length;
    console.log(`   RSI ${b.label.padEnd(6)}: ${String(rows.length).padStart(3)} trades  WR ${(w/rows.length*100).toFixed(0).padStart(3)}%  Avg P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`);
  }

  // Exit reason P&L
  console.log('');
  console.log(' Avg P&L by exit reason:');
  for (const reason of ['TARGET', 'STOP', 'TIMEOUT']) {
    const rows = allTrades.filter(t => t.exitReason === reason);
    if (rows.length === 0) continue;
    const avg = rows.reduce((a, t) => a + t.pnlPct, 0) / rows.length;
    console.log(`   ${reason.padEnd(8)}: ${rows.length} trades  Avg ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`);
  }

  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const { limit, symbols } = parseArgs();
  const list = symbols || (limit ? SYMBOLS_100.slice(0, limit) : SYMBOLS_100);

  console.log('\nFetching Nifty 50 daily candles…');
  const nifty = await fetchCandles('^NSEI', '1d', CFG.HISTORY_DAYS);
  if (nifty.length < CFG.NIFTY_EMA_PERIOD + 50) {
    console.error(`Nifty has only ${nifty.length} candles — need ${CFG.NIFTY_EMA_PERIOD + 50}+`);
    process.exit(1);
  }
  console.log(`Loaded ${nifty.length} Nifty candles`);

  // Pre-compute Nifty EMA200 into the lookup
  const niftyCloses = nifty.map(c => c.close);
  const niftyEma200 = ema(niftyCloses, CFG.NIFTY_EMA_PERIOD);
  const niftyWithEma = nifty.map((c, i) => ({ ...c, ema200: niftyEma200[i] }));
  const niftyLookup = buildNiftyLookup(niftyWithEma);
  console.log(`Nifty EMA200 pre-computed\n`);

  console.log(`Backtesting ${list.length} symbols over ~5 years…\n`);

  const allTrades = [];
  let tested = 0;

  for (const symbol of list) {
    try {
      const result = await backtestSymbol(symbol, niftyLookup);
      if (result.skipped) {
        console.log(`  ${symbol.padEnd(12)} — skipped (${result.skipped})`);
      } else {
        tested++;
        allTrades.push(...result.trades);
        const w = result.trades.filter(t => t.pnlPct > 0).length;
        const l = result.trades.length - w;
        console.log(`  ${symbol.padEnd(12)} — ${String(result.trades.length).padStart(3)} trades (W:${w} L:${l})`);
      }
    } catch (e) {
      console.log(`  ${symbol.padEnd(12)} — ERROR: ${e.message}`);
    }
    // Politeness delay — Yahoo throttles aggressive bursts
    await new Promise(r => setTimeout(r, 250));
  }

  allTrades.sort((a, b) => a.entryDate - b.entryDate);
  printSummary(allTrades, tested);
}

main().catch(e => { console.error(e); process.exit(1); });