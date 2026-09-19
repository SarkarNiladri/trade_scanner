// scripts/test-indicators.js
// Hand-computed reference values. If any of these fail, every signal in
// production is built on wrong numbers.

import {
  ema, rsi, macd, bbands, atr, adx,
} from '../api/_lib/indicators.js';

let pass = 0, fail = 0;

function approx(a, b, tol = 1e-4) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol;
}

function check(name, actual, expected, tol = 1e-4) {
  // Booleans: direct comparison
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    if (actual === expected) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}\n     got:      ${actual}\n     expected: ${expected}`); }
    return;
  }
  const ok = approx(actual, expected, tol);
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else    { fail++; console.log(`  ❌ ${name}\n     got:      ${actual}\n     expected: ${expected}`); }
}

console.log('\n─── EMA ─────────────────────────────────────────');
{
  // EMA(3) on [1,2,3,4,5], alpha = 2/(3+1) = 0.5, seeded with first value
  const out = ema([1, 2, 3, 4, 5], 3);
  // e0=1, e1=1.5, e2=2.25, e3=3.125, e4=4.0625
  check('EMA(3)[0]', out[0], 1);
  check('EMA(3)[1]', out[1], 1.5);
  check('EMA(3)[2]', out[2], 2.25);
  check('EMA(3)[3]', out[3], 3.125);
  check('EMA(3)[4]', out[4], 4.0625);

  // Constant input → constant output
  const c = ema([5, 5, 5, 5, 5], 3);
  check('EMA on constant series', c[4], 5);
}

console.log('\n─── RSI ─────────────────────────────────────────');
{
  // RSI(3) on [10, 11, 10.5, 11.5, 12]
  //   deltas:   +1, -0.5, +1, +0.5
  //   period=3: gains = 1 + 0 + 1 = 2, losses = 0 + 0.5 + 0 = 0.5
  //   avgG = 2/3, avgL = 0.5/3, RS = 4
  //   RSI = 100 - 100/(1+4) = 80
  const out = rsi([10, 11, 10.5, 11.5, 12], 3);
  check('RSI(3)[3]', out[3], 80, 1e-2);

  // Constant rising → RSI = 100
  const rising = Array.from({ length: 20 }, (_, i) => i + 1);
  check('RSI on monotone rise', rsi(rising, 14)[19], 100);

  // Constant falling → RSI = 0
  const falling = Array.from({ length: 20 }, (_, i) => 20 - i);
  check('RSI on monotone fall', rsi(falling, 14)[19], 0);
}

console.log('\n─── MACD ────────────────────────────────────────');
{
  // MACD line = EMA(12) - EMA(26), signal = EMA(9) of line, hist = line - signal
  const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 5);
  const { macd: line, signal, hist } = macd(closes);
  const idx = 99;
  check('MACD hist = line - signal',
    hist[idx], line[idx] - signal[idx], 1e-8);
  check('MACD line length', line.length, closes.length);
}

console.log('\n─── Bollinger Bands ─────────────────────────────');
{
  // BB(3, 2) on [1, 2, 3]
  //   mean = 2, var = (1+0+1)/3 = 0.6667, std = 0.8165
  //   upper = 2 + 2*0.8165 = 3.633
  //   lower = 2 - 2*0.8165 = 0.367
  const { upper, mid, lower } = bbands([1, 2, 3], 3, 2);
  check('BB mid[2]',   mid[2],   2);
  check('BB upper[2]', upper[2], 3.632993, 1e-4);
  check('BB lower[2]', lower[2], 0.367007, 1e-4);

  // Bands on constant series → all equal
  const c = bbands([5, 5, 5, 5, 5], 3, 2);
  check('BB on constant series', c.upper[4], 5);
  check('BB on constant series lower', c.lower[4], 5);
}

console.log('\n─── ATR ─────────────────────────────────────────');
{
  const n = 10;

  // Flat series with TR = 1 everywhere (no gap from prev close)
  // high=1.5, low=0.5, close=1 → TR = max(1, 0.5, 0.5) = 1
  const h1 = Array.from({ length: n }, () => 1.5);
  const l1 = Array.from({ length: n }, () => 0.5);
  const c1 = Array.from({ length: n }, () => 1);
  const out1 = atr(h1, l1, c1, 3);
  check('ATR on flat series (TR=1)', out1[9], 1);

  // Flat series with TR = 2 everywhere
  // high=3, low=1, close=2 → TR = max(2, 1, 1) = 2
  const h2 = Array.from({ length: n }, () => 3);
  const l2 = Array.from({ length: n }, () => 1);
  const c2 = Array.from({ length: n }, () => 2);
  const out2 = atr(h2, l2, c2, 3);
  check('ATR on flat series (TR=2)', out2[9], 2);

  // Trending series — TR inflated by gap from previous close
  // high=i+1.5, low=i+0.5, close=i+1
  // TR[0]=1, TR[1..]=max(1, 1.5, 0.5)=1.5, converges to 1.5
  const h3 = Array.from({ length: n }, (_, i) => i + 1.5);
  const l3 = Array.from({ length: n }, (_, i) => i + 0.5);
  const c3 = Array.from({ length: n }, (_, i) => i + 1);
  const out3 = atr(h3, l3, c3, 3);
  check('ATR on trending series → ~1.5', out3[9], 1.49, 0.02);
}

console.log('\n─── ADX ─────────────────────────────────────────');
{
  // Strong uptrend → high ADX (>40)
  const n = 100;
  const strongHighs  = Array.from({ length: n }, (_, i) => i + 1.5);
  const strongLows   = Array.from({ length: n }, (_, i) => i + 0.5);
  const strongCloses = Array.from({ length: n }, (_, i) => i + 1);
  const strongADX = adx(strongHighs, strongLows, strongCloses, 14);
  check('ADX > 40 on strong trend',
    strongADX[99] > 40, true);

  // Choppy: prices oscillate within a tight band
  const chopHighs  = Array.from({ length: n }, (_, i) => 100.5 + Math.sin(i));
  const chopLows   = Array.from({ length: n }, (_, i) => 99.5 + Math.sin(i));
  const chopCloses = Array.from({ length: n }, (_, i) => 100 + Math.sin(i));
  const chopADX = adx(chopHighs, chopLows, chopCloses, 14);
  check('ADX < 25 on choppy series',
    chopADX[99] < 25, true);

  // First 14 entries are NaN (warmup)
  check('ADX warmup', Number.isNaN(strongADX[5]), true);
}

console.log('\n─────────────────────────────────────────────────');
console.log(`Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);