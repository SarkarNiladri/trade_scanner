export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? v * k + prev * (1 - k) : v;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(NaN);
  if (n <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) =>
    Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : NaN);
  const sigFull = ema(line, signal);
  const hist = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(sigFull[i]) ? v - sigFull[i] : NaN);
  return { macd: line, signal: sigFull, hist };
}

export function bbands(closes, period = 20, std = 2) {
  const n = closes.length;
  const upper = new Array(n).fill(NaN);
  const mid   = new Array(n).fill(NaN);
  const lower = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    const win = closes.slice(i - period + 1, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / period;
    const v = win.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    const sd = Math.sqrt(v);
    upper[i] = m + std * sd;
    mid[i]   = m;
    lower[i] = m - std * sd;
  }
  return { upper, mid, lower };
}

export function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const tr = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = highs[i] - lows[i]; continue; }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  const out = new Array(n).fill(NaN);
  if (n < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const tr      = new Array(n).fill(0);
  const plusDM  = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = highs[i] - lows[i]; continue; }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    if (up > down && up > 0)     plusDM[i]  = up;
    if (down > up && down > 0)   minusDM[i] = down;
  }

  const sTR    = new Array(n).fill(NaN);
  const sPlus  = new Array(n).fill(NaN);
  const sMinus = new Array(n).fill(NaN);
  if (n <= period) return new Array(n).fill(NaN);

  let sumTR = 0, sumP = 0, sumM = 0;
  for (let i = 1; i <= period; i++) { sumTR += tr[i]; sumP += plusDM[i]; sumM += minusDM[i]; }
  sTR[period]    = sumTR;
  sPlus[period]  = sumP;
  sMinus[period] = sumM;

  for (let i = period + 1; i < n; i++) {
    sTR[i]    = sTR[i - 1]    - sTR[i - 1] / period    + tr[i];
    sPlus[i]  = sPlus[i - 1]  - sPlus[i - 1] / period  + plusDM[i];
    sMinus[i] = sMinus[i - 1] - sMinus[i - 1] / period + minusDM[i];
  }

  const pDI = new Array(n).fill(NaN);
  const mDI = new Array(n).fill(NaN);
  const dx  = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    pDI[i] = sTR[i] > 0 ? 100 * sPlus[i]  / sTR[i] : 0;
    mDI[i] = sTR[i] > 0 ? 100 * sMinus[i] / sTR[i] : 0;
    const s = pDI[i] + mDI[i];
    dx[i] = s > 0 ? 100 * Math.abs(pDI[i] - mDI[i]) / s : 0;
  }

  const out = new Array(n).fill(NaN);
  let acc = 0, cnt = 0;
  for (let i = period; i < n; i++) {
    if (!Number.isFinite(dx[i])) continue;
    if (cnt < period - 1) { acc += dx[i]; cnt++; continue; }
    if (cnt === period - 1) { acc += dx[i]; out[i] = acc / period; cnt++; continue; }
    out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
  }
  return out;
}