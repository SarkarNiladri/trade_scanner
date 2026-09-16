const TOKEN = process.env.TELEGRAM_TOKEN || '';
const CHAT  = process.env.TELEGRAM_CHAT_ID || '';

export async function sendTelegram(signal) {
  if (!TOKEN || !CHAT) {
    console.log('[telegram] not configured — skipping');
    return;
  }

  const icon  = signal.signal === 'BUY' ? '🟢' : '🔴';
  const entry = signal.entry;
  const tgt   = signal.target;
  const sl    = signal.stop_loss;
  const pctT  = ((tgt - entry) / entry * 100).toFixed(2);
  const pctS  = ((sl - entry) / entry * 100).toFixed(2);

  const text = [
    `${icon} *${signal.signal} SIGNAL — ${signal.symbol}*`,
    '',
    `Entry  : ₹${entry.toFixed(2)}`,
    `Target : ₹${tgt.toFixed(2)}  (${pctT}%)`,
    `SL     : ₹${sl.toFixed(2)}  (${pctS}%)`,
    `Score  : ${signal.score}/13`,
    `RSI    : ${signal.rsi}`,
    `ADX    : ${signal.adx}`,
    `Candle : ${signal.candle}`,
    '',
    signal.reasons || '',
  ].join('\n');

  try {
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'Markdown' }),
    });
    if (!resp.ok) console.error('[telegram] failed:', await resp.text());
  } catch (e) {
    console.error('[telegram] error:', e.message);
  }
}

export async function notifyOutcome(trade, outcome, pnlPct) {
  if (!TOKEN || !CHAT) return;
  const icon = outcome === 'WIN' ? '✅' : '❌';
  const text = [
    `${icon} *${outcome} — ${trade.symbol} ${trade.signal}*`,
    '',
    `Entry  : ₹${Number(trade.entry).toFixed(2)}`,
    `Target : ₹${Number(trade.target).toFixed(2)}`,
    `SL     : ₹${Number(trade.stop_loss).toFixed(2)}`,
    `P&L    : ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
  ].join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'Markdown' }),
    });
  } catch (e) {
    console.error('[telegram] outcome error:', e.message);
  }
}