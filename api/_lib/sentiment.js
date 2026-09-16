import { getSector } from './data.js';
import { kvGetJSON, kvSetJSON } from './kv.js';

const KEY = 'sentiment:cache';
const TTL = 1800;

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

function parseRSS(xml, max = 6) {
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

async function fetchHeadlines(url, max = 6) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SwingScan/2.0)' },
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    return parseRSS(xml, max);
  } catch (e) {
    console.error('[sentiment] feed:', e.message);
    return [];
  }
}

// ——— OpenAI sentiment classifier ———
async function callLLM(headlines, context) {
  if (!headlines.length) {
    return { sentiment: 'NEUTRAL', confidence: 50, reason: 'No headlines', headlines: [] };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { sentiment: 'NEUTRAL', confidence: 50, reason: 'OpenAI not configured', headlines };
  }

  const prompt =
    `Analyze these Indian stock market headlines for ${context} sentiment.\n` +
    `Headlines:\n` + headlines.map(h => `- ${h}`).join('\n') +
    `\n\nReply ONLY with valid JSON (no markdown):\n` +
    `{"sentiment": "BULLISH|BEARISH|NEUTRAL", "confidence": 0-100, "reason": "one line max 10 words"}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 120,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a financial sentiment classifier. Reply with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[sentiment] openai:', resp.status, errText);
      return { sentiment: 'NEUTRAL', confidence: 50, reason: `API ${resp.status}`, headlines };
    }

    const data = await resp.json();
    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(text);
    if (!['BULLISH', 'BEARISH', 'NEUTRAL'].includes(parsed.sentiment)) {
      parsed.sentiment = 'NEUTRAL';
    }
    parsed.confidence = Math.max(0, Math.min(100, parseInt(parsed.confidence, 10) || 50));
    parsed.headlines = headlines;
    return parsed;
  } catch (e) {
    console.error('[sentiment] openai parse:', e.message);
    return { sentiment: 'NEUTRAL', confidence: 50, reason: 'Parse error', headlines };
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
  const marketHeadlines = await fetchHeadlines(SECTOR_FEEDS.MARKET, 8);
  const market = await callLLM(marketHeadlines, 'overall Indian stock market');

  const sectors = {};
  for (const [name, url] of Object.entries(SECTOR_FEEDS)) {
    if (name === 'MARKET') continue;
    const h = await fetchHeadlines(url, 6);
    sectors[name] = await callLLM(h, `Indian ${name} sector stocks`);
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