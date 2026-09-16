import { SYMBOLS_100 } from './_lib/data.js';
import { getNiftyTrend } from './_lib/strategy.js';

function istNow() {
  return new Date(Date.now() + new Date().getTimezoneOffset() * 60_000 + 5.5 * 3600_000);
}

function marketIsOpen() {
  const now = istNow();
  const d = now.getUTCDay();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return d >= 1 && d <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

export default async function handler(req, res) {
  let nifty = { trend: 'neutral', adx: 0 };
  try { nifty = await getNiftyTrend(); } catch (e) {}

  const now = istNow();
  res.status(200).json({
    market_open: marketIsOpen(),
    ist_time: now.toISOString(),
    nifty_trend: nifty.trend,
    nifty_adx: nifty.adx,
    symbols_count: SYMBOLS_100.length,
    config: { min_score: 9, risk_reward: 2.0, min_candle_body: 0.40, adx_threshold: 25 },
  });
}