import { analyzeStock, getNiftyTrend } from './_lib/strategy.js';
import { addTrade, hasNotified, markNotified } from './_lib/tracker.js';
import { sendTelegram } from './_lib/telegram.js';

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    let niftyTrend = req.query.nifty_trend;
    if (!niftyTrend || niftyTrend === 'undefined') {
      niftyTrend = (await getNiftyTrend()).trend;
    }

    const signal = await analyzeStock(symbol, niftyTrend);

    if (signal) {
      await addTrade(signal);
      const fp = `${signal.symbol}|${signal.signal}|${signal.entry}|${signal.target}|${signal.stop_loss}`;
      if (!(await hasNotified(fp))) {
        await sendTelegram(signal);
        await markNotified(fp);
      }
    }

    res.status(200).json({ symbol, signal });
  } catch (e) {
    console.error('[scan]', e);
    res.status(500).json({ symbol, signal: null, error: String(e.message || e) });
  }
}