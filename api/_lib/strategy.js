import { fetchCandles } from './data.js';
import { ema, rsi, macd, bbands, atr, adx } from './indicators.js';

// ─── Configuration ─────────────────────────────────────────────────────
const CFG = {
  RSI_PERIOD: 14, BB_PERIOD: 20, BB_STD: 2,
  EMA_SHORT: 20, EMA_LONG: 50,
  ADX_PERIOD: 14, ADX_THRESHOLD: 25,
  ATR_PERIOD: 14,
  SR_ZONE_PCT: 0.015, RISK_REWARD: 2.0,
  MIN_SCORE: 9, ATR_MULT: 1.5,
  MIN_CANDLE_BODY: 0.40, VOL_LOOKBACK: 3,
  COUNTER_TREND_PENALTY: 2, SCORE9_ADX_MIN: 30,
};

// ─── Support / Resistance ──────────────────────────────────────────────
function findSRLevels(candles, close) {
  const levels = [];
  const n = candles.length;
  const w = 5;
  for (let i = w; i < n - w; i++) {
    let isH = true, isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isH = false;
      if (candles[j].low  <= candles[i].low)  isL = false;
    }
    if (isH) levels.push(candles[i].high);
    if (isL) levels.push(candles[i].low);
  }
  const recent = candles.slice(-100);
  if (recent.length) {
    levels.push(Math.max(...recent.map(x => x.high)));
    levels.push(Math.min(...recent.map(x => x.low)));
  }
  for (const base of [50, 100]) {
    const b = Math.round(close / base) * base;
    for (const off of [-base, 0, base]) levels.push(b + off);
  }
  const zone = close * CFG.SR_ZONE_PCT;
  const nearSupport = levels.some(l => l > 0 && l <= close && Math.abs(close - l) <= zone);
  const nearResist  = levels.some(l => l > 0 && l >= close && Math.abs(close - l) <= zone);
  return { nearSupport, nearResist };
}

// ─── Candlestick Patterns ──────────────────────────────────────────────
function detectCandlePattern(candles) {
  if (candles.length < 3) return { bullish: false, bearish: false, name: '—' };
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  const o3 = c3.open, h3 = c3.high, l3 = c3.low, c3c = c3.close;
  const o2 = c2.open, h2 = c2.high, l2 = c2.low, c2c = c2.close;
  const o1 = c1.open, h1 = c1.high, l1 = c1.low, c1c = c1.close;

  const body3 = Math.abs(c3c - o3);
  const range3 = h3 - l3 || 0.001;
  const upW3 = h3 - Math.max(c3c, o3);
  const loW3 = Math.min(c3c, o3) - l3;

  const hammer       = loW3 >= 2 * body3 && upW3 <= 0.1 * range3 && body3 > 0;
  const bullEngulf   = c2c < o2 && c3c > o3 && o3 <= c2c && c3c >= o2;
  const morningStar  = c1c < o1 && Math.abs(c2c - o2) < 0.3 * (h2 - l2 || 0.001) && c3c > o3 && c3c > (o1 + c1c) / 2;
  const shootStar    = upW3 >= 2 * body3 && loW3 <= 0.1 * range3 && body3 > 0;
  const bearEngulf   = c2c > o2 && c3c < o3 && o3 >= c2c && c3c <= o2;
  const eveningStar  = c1c > o1 && Math.abs(c2c - o2) < 0.3 * (h2 - l2 || 0.001) && c3c < o3 && c3c < (o1 + c1c) / 2;

  const bullish = hammer || bullEngulf || morningStar;
  const bearish = shootStar || bearEngulf || eveningStar;

  let name = '—';
  if (hammer)           name = 'Hammer';
  else if (bullEngulf)  name = 'Bullish Engulfing';
  else if (morningStar) name = 'Morning Star';
  else if (shootStar)   name = 'Shooting Star';
  else if (bearEngulf)  name = 'Bearish Engulfing';
  else if (eveningStar) name = 'Evening Star';

  return { bullish, bearish, name };
}

// ═══════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS — no I/O, safe to call from backtester with historical data
// ═══════════════════════════════════════════════════════════════════════

// ─── Pure: Nifty trend from daily candles ─────────────────────────────
export function computeNiftyTrend(niftyDailyCandles) {
  if (!niftyDailyCandles || niftyDailyCandles.length < 55) {
    return { trend: 'neutral', adx: 0 };
  }
  const closes = niftyDailyCandles.map(x => x.close);
  const highs  = niftyDailyCandles.map(x => x.high);
  const lows   = niftyDailyCandles.map(x => x.low);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const a   = adx(highs, lows, closes, 14);
  const i   = niftyDailyCandles.length - 1;
  const c   = closes[i];
  let trend = 'neutral';
  if (c > e20[i] && e20[i] > e50[i]) trend = 'bullish';
  else if (c < e20[i] && e20[i] < e50[i]) trend = 'bearish';
  return { trend, adx: Math.round((a[i] || 0) * 10) / 10 };
}

// ─── Pure: daily metrics from daily candles ───────────────────────────
export function computeDailyData(dailyCandles) {
  if (!dailyCandles || dailyCandles.length < 55) {
    return { trend: 'neutral', atr: 0, rsi: 50, emaBull: false };
  }
  const closes = dailyCandles.map(x => x.close);
  const highs  = dailyCandles.map(x => x.high);
  const lows   = dailyCandles.map(x => x.low);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r   = rsi(closes, 14);
  const a   = atr(highs, lows, closes, 14);
  const i = dailyCandles.length - 1;
  const c = closes[i];
  let trend = 'neutral';
  if (c > e20[i] && e20[i] > e50[i]) trend = 'bullish';
  else if (c < e20[i] && e20[i] < e50[i]) trend = 'bearish';
  return {
    trend,
    atr: Number.isFinite(a[i]) ? a[i] : 0,
    rsi: Number.isFinite(r[i]) ? r[i] : 50,
    emaBull: e20[i] > e50[i],
  };
}

// ─── Pure: signal from candles + daily + trend ────────────────────────
export function evaluateSignal(symbol, df, daily, niftyTrend) {
  if (!df || df.length < CFG.EMA_LONG + 20) return null;

  const closes = df.map(x => x.close);
  const highs  = df.map(x => x.high);
  const lows   = df.map(x => x.low);
  const vols   = df.map(x => x.volume);

  const rsiArr  = rsi(closes, CFG.RSI_PERIOD);
  const { hist } = macd(closes);
  const bb       = bbands(closes, CFG.BB_PERIOD, CFG.BB_STD);
  const eShort   = ema(closes, CFG.EMA_SHORT);
  const eLong    = ema(closes, CFG.EMA_LONG);
  const adxArr   = adx(highs, lows, closes, CFG.ADX_PERIOD);
  const atrArr   = atr(highs, lows, closes, CFG.ATR_PERIOD);

  const i = df.length - 1;
  const last = df[i];
  const prevClose = df[i - 1].close;

  const close  = last.close;
  const open_  = last.open;
  const high_  = last.high;
  const low_   = last.low;
  const volume = last.volume;

  const rsiVal   = rsiArr[i]  ?? 50;
  const macdH    = hist[i]    ?? 0;
  const prevM    = hist[i-1]  ?? 0;
  const bbLower  = bb.lower[i] ?? close;
  const bbUpper  = bb.upper[i] ?? close;
  const bbMid    = bb.mid[i]   ?? close;
  const bbWidth  = bbMid > 0 ? (bbUpper - bbLower) / bbMid : 0.02;
  const avgBBW   = (() => {
    const w = [];
    for (let k = Math.max(0, i - 49); k <= i; k++) {
      if (Number.isFinite(bb.upper[k]) && Number.isFinite(bb.lower[k]) && bb.mid[k] > 0) {
        w.push((bb.upper[k] - bb.lower[k]) / bb.mid[k]);
      }
    }
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0.02;
  })();
  const emaShort = eShort[i] ?? close;
  const emaLong  = eLong[i]  ?? close;
  const adxVal   = adxArr[i] ?? 0;
  const atr15    = atrArr[i] ?? close * 0.005;

  const avgVol = (() => {
    const start = Math.max(0, i - 519);
    const arr = vols.slice(start, i + 1);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 1;
  })();
  const volRatio = avgVol > 0 ? volume / avgVol : 0;

  // GATE 1 — ADX mandatory
  if (!(adxVal >= CFG.ADX_THRESHOLD)) return null;

  const emaBullish = emaShort > emaLong;
  const emaBearish = !emaBullish;

  // GATE 1C — MACD direction aligns with EMA
  if (emaBullish && !(macdH > 0)) return null;
  if (emaBearish && !(macdH < 0)) return null;

  // GATE 2 — candle body
  const range = high_ - low_;
  const body  = Math.abs(close - open_);
  if (range > 0 && body / range < CFG.MIN_CANDLE_BODY) return null;

  // GATE 3 — volume above avg in >= 2 of last 3 candles
  const avgVolShort = (() => {
    const start = Math.max(0, i - 25);
    const arr = vols.slice(start, i + 1);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 1;
  })();
  const recent = vols.slice(Math.max(0, i - CFG.VOL_LOOKBACK), i);
  const aboveCount = recent.filter(v => v > avgVolShort).length;
  if (aboveCount < 2) return null;

  // ── SCORING ──
  let buyScore = 0, sellScore = 0;
  const reasons = [];

  if (emaBullish) { buyScore  += 3; reasons.push('EMA bullish'); }
  else            { sellScore += 3; reasons.push('EMA bearish'); }

  if (emaBullish) buyScore  += 2; else sellScore += 2;
  reasons.push(`ADX(${adxVal.toFixed(0)})`);

  if (emaBullish) {
    if (rsiVal >= 35 && rsiVal <= 55) { buyScore += 2; reasons.push(`RSI(${rsiVal.toFixed(0)}) pullback`); }
    else if (rsiVal < 35)             { buyScore += 1; reasons.push(`RSI(${rsiVal.toFixed(0)}) oversold`); }
    else if (rsiVal > 72)             { buyScore -= 1; }
  } else {
    if (rsiVal >= 45 && rsiVal <= 65) { sellScore += 2; reasons.push(`RSI(${rsiVal.toFixed(0)}) pullback`); }
    else if (rsiVal > 65)             { sellScore += 1; reasons.push(`RSI(${rsiVal.toFixed(0)}) overbought`); }
    else if (rsiVal < 28)             { sellScore -= 1; }
  }

  if (macdH > 0 && prevM <= 0)      { buyScore  += 2; if (emaBullish) reasons.push('MACD cross up'); }
  else if (macdH < 0 && prevM >= 0) { sellScore += 2; if (emaBearish) reasons.push('MACD cross down'); }
  else if (macdH > 0)               { buyScore  += 1; if (emaBullish) reasons.push('MACD bullish'); }
  else if (macdH < 0)               { sellScore += 1; if (emaBearish) reasons.push('MACD bearish'); }

  // High-volume against direction = reject
  if (emaBullish && volume > avgVolShort * 1.5 && close < prevClose) return null;
  if (emaBearish && volume > avgVolShort * 1.5 && close > prevClose) return null;

  const volPenalty = aboveCount < 1;
  if (emaBullish) {
    if (volRatio >= 2.0)      { buyScore  += 2; reasons.push(`Vol ${volRatio.toFixed(1)}x surge`); }
    else if (volRatio >= 1.5) { buyScore  += 1; reasons.push(`Vol ${volRatio.toFixed(1)}x`); }
    else if (volPenalty)      buyScore  -= 1;
  } else {
    if (volRatio >= 2.0)      { sellScore += 2; reasons.push(`Vol ${volRatio.toFixed(1)}x surge`); }
    else if (volRatio >= 1.5) { sellScore += 1; reasons.push(`Vol ${volRatio.toFixed(1)}x`); }
    else if (volPenalty)      sellScore -= 1;
  }

  // Optional: S/R + candle + BB squeeze (cap 2)
  let opt = 0;
  const { nearSupport, nearResist } = findSRLevels(df, close);
  if (nearSupport && emaBullish) { opt += 1; reasons.push('Near support'); }
  if (nearResist  && emaBearish) { opt += 1; reasons.push('Near resistance'); }

  const { bullish: bullC, bearish: bearC, name: cName } = detectCandlePattern(df);
  if (bullC && emaBullish)      { opt += 1; reasons.push(cName); }
  else if (bearC && emaBearish) { opt += 1; reasons.push(cName); }

  if (bbWidth < avgBBW * 0.75) { opt += 1; reasons.push('BB squeeze'); }
  opt = Math.min(opt, 2);
  if (emaBullish) buyScore  += opt;
  else            sellScore += opt;

  // Overextension penalty
  const emaDistPct = Math.abs(close - emaShort) / emaShort * 100;
  if (emaDistPct > 3.0) {
    if (emaBullish) buyScore  -= 1;
    else            sellScore -= 1;
    reasons.push(`Extended ${emaDistPct.toFixed(1)}% from EMA`);
  }

  let signal = null, score = 0;
  if (buyScore >= CFG.MIN_SCORE)       { signal = 'BUY';  score = buyScore; }
  else if (sellScore >= CFG.MIN_SCORE) { signal = 'SELL'; score = sellScore; }
  else return null;

  // Score 9 needs ADX >= 30
  if (score === CFG.MIN_SCORE && adxVal < CFG.SCORE9_ADX_MIN) return null;

  // Daily confirmation
  const penalties = [];

  if (signal === 'BUY'  && daily.trend === 'bearish') { score -= 2; penalties.push('Daily bearish(-2)'); }
  if (signal === 'SELL' && daily.trend === 'bullish') { score -= 2; penalties.push('Daily bullish(-2)'); }

  if (signal === 'BUY'  && daily.rsi < 45) { score -= 1; penalties.push(`Daily RSI weak(${daily.rsi.toFixed(0)})`); }
  if (signal === 'SELL' && daily.rsi > 55) { score -= 1; penalties.push(`Daily RSI strong(${daily.rsi.toFixed(0)})`); }

  // Nifty counter-trend threshold
  let buyThresh = CFG.MIN_SCORE, sellThresh = CFG.MIN_SCORE;
  if (niftyTrend === 'bullish') sellThresh = CFG.MIN_SCORE + CFG.COUNTER_TREND_PENALTY;
  if (niftyTrend === 'bearish') buyThresh  = CFG.MIN_SCORE + CFG.COUNTER_TREND_PENALTY;

  if (signal === 'BUY'  && score < buyThresh)  { penalties.push(`Nifty ${niftyTrend} — BUY needs ${buyThresh}+ (has ${score})`); score = 0; }
  if (signal === 'SELL' && score < sellThresh) { penalties.push(`Nifty ${niftyTrend} — SELL needs ${sellThresh}+ (has ${score})`); score = 0; }

  if (penalties.length) reasons.push('Penalties: ' + penalties.join(', '));

  if (score < CFG.MIN_SCORE) return null;

  // SL from blended ATR
  const effectiveATR = daily.atr > 0
    ? 0.6 * daily.atr + 0.4 * (atr15 * 4)
    : atr15 * 3;

  const minSL = close * 0.005;
  const maxSL = close * 0.025;
  const slDist = Math.min(Math.max(CFG.ATR_MULT * effectiveATR, minSL), maxSL);

  let stopLoss, target;
  if (signal === 'BUY') {
    stopLoss = close - slDist;
    target   = close + slDist * CFG.RISK_REWARD;
  } else {
    stopLoss = close + slDist;
    target   = close - slDist * CFG.RISK_REWARD;
  }

  const risk = Math.abs(close - stopLoss);
  const reward = Math.abs(target - close);
  if (risk === 0 || reward / risk < CFG.RISK_REWARD * 0.9) return null;

  return {
    symbol,
    signal,
    entry:     Math.round(close * 100) / 100,
    target:    Math.round(target * 100) / 100,
    stop_loss: Math.round(stopLoss * 100) / 100,
    score,
    rsi:  Math.round(rsiVal * 10) / 10,
    adx:  Math.round(adxVal * 10) / 10,
    vol_ratio: Math.round(volRatio * 10) / 10,
    daily_atr: Math.round(effectiveATR * 100) / 100,
    daily_rsi: Math.round(daily.rsi * 10) / 10,
    candle: (signal === 'BUY' && bullC) || (signal === 'SELL' && bearC) ? cName : '—',
    reasons: reasons.join(' | '),
    time: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 19) + ' IST',
    current_price: Math.round(close * 100) / 100,
    data_source: 'yfinance',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ASYNC WRAPPERS — fetch data then call the pure functions
// ═══════════════════════════════════════════════════════════════════════

export async function getNiftyTrend() {
  try {
    const df = await fetchCandles('^NSEI', '1d', 120);
    return computeNiftyTrend(df);
  } catch {
    return { trend: 'neutral', adx: 0 };
  }
}

async function getStockDailyData(symbol) {
  try {
    const df = await fetchCandles(symbol, '1d', 120);
    return computeDailyData(df);
  } catch {
    return { trend: 'neutral', atr: 0, rsi: 50, emaBull: false };
  }
}

export async function analyzeStock(symbol, niftyTrend) {
  try {
    const df = await fetchCandles(symbol, '15m', 60);
    if (!df || df.length < CFG.EMA_LONG + 20) return null;
    const daily = await getStockDailyData(symbol);
    return evaluateSignal(symbol, df, daily, niftyTrend);
  } catch (e) {
    console.error(`[strategy] ${symbol}:`, e.message);
    return null;
  }
}