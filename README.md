# SwingScan (Vercel Edition)

AI-assisted swing trading scanner for NSE (Nifty 100). Vercel-native:
Node.js serverless backend + vanilla HTML/JS frontend.

## Features
- 15-minute candle scanning with multi-factor scoring (EMA, ADX, RSI, MACD, BB, ATR, volume, S/R, candles)
- Nifty trend gate + daily timeframe confirmation
- Claude Haiku market/sector sentiment from RSS headlines
- Telegram alerts with deduplication
- Weekly trade tracker (Vercel KV, with in-memory fallback)
- Auto-scan via UptimeRobot keep-alive pings
- Dark/light theme UI

## Deployment

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin <your-repo-url>
git push -u origin main