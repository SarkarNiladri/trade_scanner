export const SYMBOLS_100 = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
  "LT","AXISBANK","ASIANPAINT","MARUTI","WIPRO","HCLTECH","ULTRACEMCO","BAJFINANCE","NESTLEIND","TITAN",
  "TECHM","SUNPHARMA","ONGC","NTPC","POWERGRID","M&M","BAJAJFINSV","TMPV","TATASTEEL","ADANIENT",
  "JSWSTEEL","HINDALCO","COALINDIA","DRREDDY","CIPLA","DIVISLAB","GRASIM","HEROMOTOCO","EICHERMOT","BPCL",
  "BRITANNIA","INDUSINDBK","APOLLOHOSP","TATACONSUM","DABUR","PIDILITIND","SIEMENS","HAVELLS","BERGEPAINT","GODREJCP",
  "MARICO","MUTHOOTFIN","BANDHANBNK","PNB","CANBK","BANKBARODA","LUPIN","BIOCON","TORNTPHARM","IPCALAB",
  "GLAND","ALKEM","AUROPHARMA","ZYDUSLIFE","ABBOTINDIA","SANOFI","PFIZER","GLAXO","CHOLAFIN","BAJAJ-AUTO",
  "TVSMOTOR","MOTHERSON","BOSCHLTD","BALKRISIND","MRF","CUMMINSIND","ABB","BHEL","CONCOR","ADANIPORTS",
  "GMRAIRPORT","IRCTC","DMART","NYKAA","ETERNAL","PAYTM","POLICYBZR","NAVINFLUOR","SRF","AAVAS",
  "CROMPTON","VOLTAS","WHIRLPOOL","BLUESTARCO","VGUARD","HFCL","RVNL","IRFC","RAILTEL","HUDCO"
];

export const SECTOR_MAP = {
  HDFCBANK:"Banking",ICICIBANK:"Banking",KOTAKBANK:"Banking",AXISBANK:"Banking",SBIN:"Banking",
  PNB:"Banking",CANBK:"Banking",BANDHANBNK:"Banking",INDUSINDBK:"Banking",
  TCS:"IT",INFY:"IT",WIPRO:"IT",HCLTECH:"IT",TECHM:"IT",
  SUNPHARMA:"Pharma",DRREDDY:"Pharma",CIPLA:"Pharma",DIVISLAB:"Pharma",LUPIN:"Pharma",
  BIOCON:"Pharma",GLAND:"Pharma",ALKEM:"Pharma",ABBOTINDIA:"Pharma",SANOFI:"Pharma",
  PFIZER:"Pharma",GLAXO:"Pharma",TORNTPHARM:"Pharma",IPCALAB:"Pharma",
  MARUTI:"Auto","M&M":"Auto",HEROMOTOCO:"Auto",EICHERMOT:"Auto",TVSMOTOR:"Auto",
  "BAJAJ-AUTO":"Auto",MOTHERSON:"Auto",BOSCHLTD:"Auto",BALKRISIND:"Auto",MRF:"Auto",
  HINDUNILVR:"FMCG",ITC:"FMCG",NESTLEIND:"FMCG",BRITANNIA:"FMCG",DABUR:"FMCG",
  MARICO:"FMCG",TATACONSUM:"FMCG",GODREJCP:"FMCG",PIDILITIND:"FMCG",
  ONGC:"Energy",BPCL:"Energy",NTPC:"Energy",POWERGRID:"Energy",COALINDIA:"Energy",ADANIENT:"Energy",
  TATASTEEL:"Metals",JSWSTEEL:"Metals",HINDALCO:"Metals",
  BAJFINANCE:"Finance",BAJAJFINSV:"Finance",MUTHOOTFIN:"Finance",CHOLAFIN:"Finance",AAVAS:"Finance",
  LT:"Infra",ULTRACEMCO:"Infra",BHEL:"Infra",ADANIPORTS:"Infra",HUDCO:"Infra",RAILTEL:"Infra"
};

export function getSector(symbol) {
  return SECTOR_MAP[symbol.toUpperCase()] || "General";
}

// ——— Direct Yahoo Finance fetcher (no yahoo-finance2) ———
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Range mapping — Yahoo caps 15m to 60 days
function rangeFor(interval, days) {
  if (interval === '15m') {
    if (days <= 5)  return '5d';
    if (days <= 30) return '1mo';
    return '60d';
  }
  // daily
  if (days <= 30)  return '1mo';
  if (days <= 90)  return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  return '2y';
}

// Small in-memory cache so repeated scans don't hammer Yahoo
const CACHE = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

export async function fetchCandles(symbol, interval = '15m', days = 60) {
  const ticker = symbol.startsWith('^') ? symbol : `${symbol}.NS`;
  const cacheKey = `${ticker}|${interval}`;
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.t < CACHE_TTL) return hit.data;

  const range = rangeFor(interval, days);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!resp.ok) {
      console.error(`[yahoo] ${symbol} ${interval}: HTTP ${resp.status} ${resp.statusText}`);
      return [];
    }

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const ts = result.timestamp;
    const q  = result.indicators?.quote?.[0];
    if (!ts || !q) return [];

    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null) continue;
      out.push({
        date:   new Date(ts[i] * 1000),
        open:   q.open[i],
        high:   q.high[i],
        low:    q.low[i],
        close:  q.close[i],
        volume: q.volume[i] || 0,
      });
    }

    CACHE.set(cacheKey, { t: now, data: out });
    return out;
  } catch (e) {
    console.error(`[yahoo] ${symbol} ${interval}:`, e.message);
    return [];
  }
}