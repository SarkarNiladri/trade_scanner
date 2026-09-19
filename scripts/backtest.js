// scripts/backtest.js
// Replays the strategy over the last ~60 days of 15-minute candles.
// Usage:
//   node --env-file=.env.local scripts/backtest.js
//   node --env-file=.env.local scripts/backtest.js --limit 20
//   node --env-file=.env.local scripts/backtest.js --symbols RELIANCE,TCS,INFY

import { fetchCandles, SYMBOLS_100 } from '../api/_lib/data.js';
import {
  evaluateSignal, computeDailyData, computeNiftyTrend,
} from '../api/_lib/strategy.js';

// ─── Config ─────────────────────────────────────────────────────────────
const LOOKBACK    = 100;    // candles to warm up indicators (EMA50 etc.)
const SIM_WINDOW  = 130;     // forward candles to simulate (≈1 trading day)
const SL_CONFIRM  = 'close'; // 'close' (matches live) or 'wick' (stricter)

// ─── Args ───────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { limit: null, symbols: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit')   out.limit = parseInt(args[i+1], 10);
    if (args[i] === '--symbols') out.symbols = args[i+1].split(',').map(s => s.trim().toUpperCase());
  }
  return out;
}

// ─── Simulate a signal forward ─────────────────────────────────────────
function simulateTrade(signal, candles, entryIndex) {
  const entry = signal.entry;
  const target = signal.target;
  const stop = signal.stop_loss;
  const isBuy = signal.signal === 'BUY';

  for (let j = entryIndex + 1; j < Math.min(entryIndex + 1 + SIM_WINDOW, candles.length); j++) {
    const c = candles[j];

    if (SL_CONFIRM === 'close') {
      if (isBuy && c.close <= stop) return { outcome: 'LOSS', exitPrice: stop, candles: j - entryIndex };
      if (!isBuy && c.close >= stop) return { outcome: 'LOSS', exitPrice: stop, candles: j - entryIndex };
    } else {
      if (isBuy && c.low <= stop)   return { outcome: 'LOSS', exitPrice: stop, candles: j - entryIndex };
      if (!isBuy && c.high >= stop) return { outcome: 'LOSS', exitPrice: stop, candles: j - entryIndex };
    }

    if (isBuy && c.high >= target)  return { outcome: 'WIN', exitPrice: target, candles: j - entryIndex };
    if (!isBuy && c.low <= target)  return { outcome: 'WIN', exitPrice: target, candles: j - entryIndex };
  }

  // Timeout: close at market on last candle
  const last = candles[Math.min(entryIndex + SIM_WINDOW, candles.length - 1)];
  const exitPrice = last.close;
  const pnlPct = isBuy
    ? (exitPrice - entry) / entry * 100
    : (entry - exitPrice) / entry * 100;
  return { outcome: 'TIMEOUT', exitPrice, candles: SIM_WINDOW, pnlPct };
}

function computePnl(signal, exitPrice) {
  const entry = signal.entry;
  const isBuy = signal.signal === 'BUY';
  return isBuy
    ? (exitPrice - entry) / entry * 100
    : (entry - exitPrice) / entry * 100;
}

// ─── Backtest one symbol ───────────────────────────────────────────────
async function backtestSymbol(symbol, niftyDailyCandles) {
  const candles = await fetchCandles(symbol, '15m', 60);
  const daily   = await fetchCandles(symbol, '1d', 120);

  if (candles.length < LOOKBACK + SIM_WINDOW + 5) {
    return { symbol, trades: [], skipped: 'insufficient 15m data' };
  }
  if (daily.length < 55) {
    return { symbol, trades: [], skipped: 'insufficient daily data' };
  }

  const trades = [];
  const start = LOOKBACK;
  const end   = candles.length - SIM_WINDOW - 1;

  for (let i = start; i < end; i++) {
    const candles15mCut = candles.slice(0, i + 1);
    const candleDate = candles[i].date;

    // Cut daily candles to those <= candleDate
    const dailyCut = daily.filter(d => d.date <= candleDate);
    if (dailyCut.length < 55) continue;

    // Cut nifty daily candles similarly
    const niftyCut = niftyDailyCandles.filter(d => d.date <= candleDate);
    if (niftyCut.length < 55) continue;

    const dailyData = computeDailyData(dailyCut);
    const nifty = computeNiftyTrend(niftyCut);

    const signal = evaluateSignal(symbol, candles15mCut, dailyData, nifty.trend);
    if (!signal) continue;

    // Skip signals outside the validated trading window (11:00–13:30 IST)
    const istHour = candles[i].date.getUTCHours() + 5;   // approximate
    const istMin  = candles[i].date.getUTCMinutes();
    const inWindow = (istHour > 11 || (istHour === 11 && istMin >= 0))
              && (istHour < 13  || (istHour === 13 && istMin <= 30));
    if (!inWindow) continue;

    const sim = simulateTrade(signal, candles, i);
    const pnlPct = sim.pnlPct !== undefined ? sim.pnlPct : computePnl(signal, sim.exitPrice);

    trades.push({
      entryIndex: i,
      entryTime: candles[i].date,
      signal: signal.signal,
      entry: signal.entry,
      target: signal.target,
      stop_loss: signal.stop_loss,
      score: signal.score,
      adx: signal.adx,
      rsi: signal.rsi,
      outcome: sim.outcome,
      exitPrice: sim.exitPrice,
      pnlPct: Math.round(pnlPct * 100) / 100,
      candlesHeld: sim.candles,
    });

    // Skip ahead past the trade window so we don't double-count
    i += sim.candles;
  }

  return { symbol, trades };
}

// ─── Aggregate ─────────────────────────────────────────────────────────
function printSummary(allTrades, symbolsTested) {
  const wins     = allTrades.filter(t => t.outcome === 'WIN');
  const losses   = allTrades.filter(t => t.outcome === 'LOSS');
  const timeouts = allTrades.filter(t => t.outcome === 'TIMEOUT');
  const resolved = wins.length + losses.length;

  const totalPnl = allTrades.reduce((a, t) => a + t.pnlPct, 0);
  const avgPnl   = allTrades.length ? totalPnl / allTrades.length : 0;
  const avgWin   = wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLoss  = losses.length ? losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length : 0;

  const grossWin  = wins.reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  const winRate    = resolved > 0 ? wins.length / resolved * 100 : 0;
  const expectancy = allTrades.length ? totalPnl / allTrades.length : 0;

  // Equity curve + max drawdown (assume 1 unit per trade)
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of allTrades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  const buyCount  = allTrades.filter(t => t.signal === 'BUY').length;
  const sellCount = allTrades.filter(t => t.signal === 'SELL').length;

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(' BACKTEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  console.log(` Symbols tested     : ${symbolsTested}`);
  console.log(` Total signals      : ${allTrades.length}`);
  console.log(`   BUY / SELL       : ${buyCount} / ${sellCount}`);
  console.log('');
  console.log(` Wins / Losses      : ${wins.length} / ${losses.length}`);
  console.log(` Timeouts           : ${timeouts.length}`);
  console.log(` Win rate (ex. TO)  : ${winRate.toFixed(1)}%`);
  console.log('');
  console.log(` Avg P&L per trade  : ${avgPnl.toFixed(2)}%`);
  console.log(` Avg win            : ${avgWin.toFixed(2)}%`);
  console.log(` Avg loss           : ${avgLoss.toFixed(2)}%`);
  console.log(` Profit factor      : ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
  console.log(` Expectancy         : ${expectancy.toFixed(2)}% per trade`);
  console.log('');
  console.log(` Cumulative P&L     : ${totalPnl.toFixed(2)}%`);
  console.log(` Max drawdown       : ${maxDD.toFixed(2)}%`);
  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  console.log(' Signals by score:');
  const byScore = {};
  for (const t of allTrades) {
    byScore[t.score] = byScore[t.score] || { count: 0, wins: 0 };
    byScore[t.score].count++;
    if (t.outcome === 'WIN') byScore[t.score].wins++;
  }
  for (const s of Object.keys(byScore).sort((a,b) => a-b)) {
    const row = byScore[s];
    const wr = row.count ? row.wins / row.count * 100 : 0;
    console.log(`   Score ${s}: ${row.count} trades, ${wr.toFixed(0)}% win rate`);
  }
  console.log('');
  console.log(' Signals by hour (IST):');
  const byHour = {};
  for (const t of allTrades) {
    const istMinutes = t.entryTime.getUTCHours() * 60 + t.entryTime.getUTCMinutes() + 330;
    const h = Math.floor(istMinutes / 60) % 24; // approximate IST
    byHour[h] = byHour[h] || { count: 0, wins: 0 };
    byHour[h].count++;
    if (t.outcome === 'WIN') byHour[h].wins++;
  }
  for (const h of Object.keys(byHour).sort((a,b) => a-b)) {
    const row = byHour[h];
    const wr = row.count ? row.wins / row.count * 100 : 0;
    console.log(`   ${String(h).padStart(2,'0')}:00 — ${row.count} trades, ${wr.toFixed(0)}% win rate`);
  }
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  const { limit, symbols } = parseArgs();
  const list = symbols || (limit ? SYMBOLS_100.slice(0, limit) : SYMBOLS_100);

  console.log(`\nFetching Nifty daily candles…`);
  const nifty = await fetchCandles('^NSEI', '1d', 120);
  if (nifty.length < 55) {
    console.error('Nifty daily data insufficient — aborting.');
    process.exit(1);
  }
  console.log(`Loaded ${nifty.length} Nifty daily candles`);

  console.log(`\nBacktesting ${list.length} symbol(s)…\n`);

  const allTrades = [];
  let symbolsTested = 0;

  for (const symbol of list) {
    try {
      const result = await backtestSymbol(symbol, nifty);
      if (result.skipped) {
        console.log(`  ${symbol.padEnd(12)} — skipped (${result.skipped})`);
      } else {
        symbolsTested++;
        allTrades.push(...result.trades);
        const w = result.trades.filter(t => t.outcome === 'WIN').length;
        const l = result.trades.filter(t => t.outcome === 'LOSS').length;
        const t = result.trades.filter(t => t.outcome === 'TIMEOUT').length;
        console.log(`  ${symbol.padEnd(12)} — ${result.trades.length} trades (W:${w} L:${l} TO:${t})`);
      }
    } catch (e) {
      console.log(`  ${symbol.padEnd(12)} — ERROR: ${e.message}`);
    }
    // Rate limit politeness — Yahoo throttles aggressive parallel requests
    await new Promise(r => setTimeout(r, 200));
  }

  if (allTrades.length === 0) {
    console.log('\nNo trades generated. Either the strategy is extremely selective, or the gates are too tight.');
    return;
  }

  // Sort all trades chronologically for equity curve
  allTrades.sort((a, b) => a.entryTime - b.entryTime);
  printSummary(allTrades, symbolsTested);
}

main().catch(e => { console.error(e); process.exit(1); });