(function () {
  const state = { password: localStorage.getItem('swingscan_api_pwd') || '' };

  function auth(url) {
    if (!state.password) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}api_key=${encodeURIComponent(state.password)}`;
  }

  async function j(url, opts) {
    const resp = await fetch(auth(url), opts);
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  window.api = {
    setPassword(p) { state.password = p; localStorage.setItem('swingscan_api_pwd', p); },

    async getStatus()       { return j('/api/status'); },
    async getSymbols()      { return j('/api/symbols'); },
    async getNiftyTrend()   { const s = await j('/api/status'); return { nifty_trend: s.nifty_trend, nifty_adx: s.nifty_adx }; },
    async scanSymbol(sym, trend) {
      return j(`/api/scan?symbol=${encodeURIComponent(sym)}&nifty_trend=${encodeURIComponent(trend || '')}`);
    },
    async getSentiment()    { return j('/api/sentiment'); },
    async forceSentiment()  { return j('/api/sentiment', { method: 'POST' }); },
    async getTrades()       { return j('/api/tracker'); },
    async resetTrades()     { return j('/api/tracker?action=reset', { method: 'POST' }); },
    async resolveTrades()   { return j('/api/tracker?action=resolve', { method: 'POST' }); },
  };
})();