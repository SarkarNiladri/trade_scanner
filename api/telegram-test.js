export default async function handler(req, res) {
  const token = process.env.TELEGRAM_TOKEN || '';
  const chat  = process.env.TELEGRAM_CHAT_ID || '';

  if (!token || !chat) {
    return res.status(200).json({
      ok: false,
      reason: 'Missing env vars',
      token_set: !!token,
      chat_set: !!chat,
      token_prefix: token ? token.slice(0, 8) + '...' : null,
      token_len: token.length,
      chat_value: chat || null,
    });
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: '✅ SwingScan test from Vercel',
      }),
    });
    const data = await r.json();
    return res.status(200).json({
      ok: r.ok,
      token_prefix: token.slice(0, 8) + '...',
      token_len: token.length,
      chat_value: chat,
      response: data,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}