import { waitUntil } from '@vercel/functions';
import { SYMBOLS_100 } from './_lib/data.js';
import { analyzeStock, getNiftyTrend } from './_lib/strategy.js';
import { addTrade, hasNotified, markNotified } from './_lib/tracker.js';
import { sendTelegram } from './_lib/telegram.js';

const BATCH = 5;

function marketIsOpen() {
  const now = new Date(Date.now() + new Date().getTimezoneOffset() * 60_000 + 5.5 * 3600_000);
  const d = now.getUTCDay();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return d >= 1 && d <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

export default async function handler(req, res) {
  if (!marketIsOpen()) {
    return res.status(200).json({ status: 'market_closed' });
  }

  const start = Math.max(0, parseInt(req.query.start, 10) || 0);
  const end   = Math.min(start + BATCH, SYMBOLS_100.length);
  const { trend } = await getNiftyTrend();

  let signals = 0;
  for (let i = start; i < end; i++) {
    try {
      const sig = await analyzeStock(SYMBOLS_100[i], trend);
      if (!sig) continue;
      signals++;
      await addTrade(sig);
      const fp = `${sig.symbol}|${sig.signal}|${sig.entry}|${sig.target}|${sig.stop_loss}`;
      if (!(await hasNotified(fp))) {
        await sendTelegram(sig);
        await markNotified(fp);
      }
    } catch (e) {
      console.error(`[cron] ${SYMBOLS_100[i]}:`, e.message);
    }
  }

  // Chain next batch in background — waitUntil keeps the function alive
  if (end < SYMBOLS_100.length) {
    const url = `https://${req.headers.host}/api/cron?start=${end}`;
    waitUntil(fetch(url).catch(() => {}));
  }

  res.status(200).json({ start, end, total: SYMBOLS_100.length, signals });
}