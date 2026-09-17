import { getSector } from './data.js';
import { kvGetJSON, kvSetJSON } from './kv.js';

const KEY = 'sentiment:cache';
const TTL = 3 * 3600;   // 3 hours — sentiment doesn't change fast enough to justify shorter

const SECTOR_FEEDS = {
  MARKET:  "https://news.google.com/rss/search?q=India+stock+market+Sensex+Nifty+BSE+NSE&hl=en-IN&gl=IN&ceid=IN:en",
  Banking: "https://news.google.com/rss/search?q=India+banking+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  IT:      "https://news.google.com/rss/search?q=India+IT+technology+stocks+Infosys+TCS+NSE&hl=en-IN&gl=IN&ceid=IN:en",
  Pharma:  "https://news.google.com/rss/search?q=India+pharma+healthcare+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  Auto:    "https://news.google.com/rss/search?q=India+automobile+auto+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  Energy:  "https://news.google.com/rss/search?q=India+energy+power+oil+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  FMCG:    "https://news.google.com/rss/search?q=India+FMCG+consumer+goods+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  Metals:  "https://news.google.com/rss/search?q=India+metals+mining+steel+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
  Finance: "https://news.google.com/rss/search?q=India+NBFC+finance+stocks+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en",
};

function stripCDATA(s) {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function parseRSS(xml, max = 5) {
  const titles = [];
  const re = /<item[\s>][\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null && titles.length < max) {
    const t = /<title>([\s\S]*?)<\/title>/.exec(m[0]);
    if (t) {
      const txt = stripCDATA(t[1]);
      if (txt.length > 10) titles.push(txt);
    }
  }
  return titles;
}

async function fetchHeadlines(url, max = 5) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SwingScan/2.0)' },
    });
    if (!resp.ok) return [];
    return parseRSS(await resp.text(), max);
  } catch (e) {
    console.error('[sentiment] feed:', e.message);
    return [];
  }
}

// ——— ONE OpenAI call for ALL sectors ———
async function classifyAll(headlinesBySector) {
  const key = process.env.OPENAI_API_KEY;

  const fallback = {};
  for (const name of Object.keys(headlinesBySector)) {
    fallback[name] = {
      sentiment: 'NEUTRAL',
      confidence: 50,
      reason: key ? 'Parse error' : 'OpenAI not configured',
      headlines: headlinesBySector[name],
    };
  }

  if (!key) return fallback;

  const sections = Object.entries(headlinesBySector)
    .map(([name, hs]) => `### ${name}\n${hs.length ? hs.map(h => `- ${h}`).join('\n') : '(no headlines)'}`)
    .join('\n\n');

  const prompt =
    `You are classifying Indian stock market sentiment for multiple sectors.\n\n` +
    `For each section below, decide BULLISH, BEARISH, or NEUTRAL, assign a 0-100 confidence, ` +
    `and give a one-line reason (max 10 words).\n\n` +
    `${sections}\n\n` +
    `Reply with ONLY this JSON shape (no markdown, no extra text):\n` +
    `{\n` +
    `  "MARKET":  { "sentiment": "BULLISH|BEARISH|NEUTRAL", "confidence": 0-100, "reason": "..." },\n` +
    `  "Banking": { "sentiment": "...", "confidence": ..., "reason": "..." },\n` +
    `  "IT":      { ... },\n` +
    `  ...one entry per section above...\n` +
    `}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 800,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a financial sentiment classifier. Reply with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      console.error('[sentiment] openai:', resp.status, await resp.text());
      return fallback;
    }

    const data = await resp.json();
    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);

    const out = {};
    for (const name of Object.keys(headlinesBySector)) {
      const row = parsed[name] || {};
      const sent = ['BULLISH', 'BEARISH', 'NEUTRAL'].includes(row.sentiment) ? row.sentiment : 'NEUTRAL';
      out[name] = {
        sentiment: sent,
        confidence: Math.max(0, Math.min(100, parseInt(row.confidence, 10) || 50)),
        reason: row.reason || '',
        headlines: headlinesBySector[name],
      };
    }
    return out;
  } catch (e) {
    console.error('[sentiment] openai parse:', e.message);
    return fallback;
  }
}

export async function getCached() {
  const cached = await kvGetJSON(KEY);
  if (cached && cached._updated && Date.now() - cached._updated < TTL * 1000) {
    return {
      updated_at: new Date(cached._updated).toISOString(),
      market: cached.market,
      sectors: cached.sectors,
    };
  }
  return {
    updated_at: null,
    market: { sentiment: 'NEUTRAL', confidence: 50, reason: 'Not yet analyzed', headlines: [] },
    sectors: {},
  };
}

export async function refreshSentiment() {
  // Fetch all headlines in parallel
  const allNames = Object.keys(SECTOR_FEEDS);
  const allHeadlines = await Promise.all(
    allNames.map(name => fetchHeadlines(SECTOR_FEEDS[name], name === 'MARKET' ? 8 : 5))
  );

  const headlinesBySector = {};
  allNames.forEach((name, i) => { headlinesBySector[name] = allHeadlines[i]; });

  // ONE OpenAI call for everything
  const classified = await classifyAll(headlinesBySector);

  const market = classified.MARKET;
  const sectors = {};
  for (const name of allNames) {
    if (name === 'MARKET') continue;
    sectors[name] = classified[name];
  }

  const payload = { _updated: Date.now(), market, sectors };
  await kvSetJSON(KEY, payload, { ex: TTL * 2 });
  return { market, sectors };
}

export async function getSentimentForStock(symbol) {
  const cached = await kvGetJSON(KEY);
  if (!cached) return { market: 'NEUTRAL', sector: 'NEUTRAL', sectorName: getSector(symbol) };
  const sectorName = getSector(symbol);
  return {
    market: cached.market?.sentiment || 'NEUTRAL',
    sector: cached.sectors?.[sectorName]?.sentiment || 'NEUTRAL',
    sectorName,
  };
}