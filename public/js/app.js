(function () {
  const state = {
    signals: [],
    trades: [],
    scanning: false,
    stopFlag: false,
    connected: false,
    sentimentRefreshing: false,
  };

  /* ——— Theme ——— */
  window.toggleTheme = function () {
    const isLight = document.documentElement.classList.toggle('light');
    localStorage.setItem('swingscan_theme', isLight ? 'light' : 'dark');
    document.getElementById('themeBtn').textContent = isLight ? '☀️' : '🌙';
  };

  if (localStorage.getItem('swingscan_theme') === 'light') {
    document.documentElement.classList.add('light');
    document.getElementById('themeBtn').textContent = '☀️';
  }

  /* ——— Logging ——— */
  function logAdd(msg, type = 'info') {
    const log = document.getElementById('logBody');
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
    el.textContent = `[${t}] ${msg}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  /* ——— Clock ——— */
  setInterval(() => {
    const t = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    document.getElementById('clock').textContent = t.slice(-11) + ' IST';
  }, 1000);

  /* ——— Progress ——— */
  function setScanUI(running) {
    const btn = document.getElementById('btnStartScan');
    const wrap = document.getElementById('progressWrap');
    btn.textContent = running ? '⏳ Scanning…' : '▶ Start Scan';
    btn.disabled = running;
    wrap.style.display = running ? 'block' : 'none';
    if (!running) document.getElementById('progressFill').style.width = '0%';
  }

  function updateProgress(idx, total, sigCount, symbol) {
    const pct = total > 0 ? Math.round(idx / total * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressLabel').textContent = 'Scanning ' + (symbol || '…') + '…';
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('progressSignals').textContent = sigCount + ' signal' + (sigCount !== 1 ? 's' : '');
    document.getElementById('progressStocks').textContent = idx + '/' + total + ' stocks';
  }

  /* ——— Signals table ——— */
  function renderSignals() {
    const tb = document.getElementById('signalBody');
    if (!state.signals.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">No signals yet</td></tr>';
      return;
    }
    tb.innerHTML = state.signals.map(s => `
      <tr>
        <td><strong>${s.symbol}</strong></td>
        <td><span class="tag-${s.signal.toLowerCase()}">${s.signal}</span></td>
        <td>₹${s.entry?.toFixed(2)}</td>
        <td>₹${s.current_price?.toFixed(2) ?? '—'}</td>
        <td>₹${s.target?.toFixed(2)}</td>
        <td>₹${s.stop_loss?.toFixed(2)}</td>
        <td>${s.score}/13</td>
        <td>${s.adx?.toFixed(1) ?? '—'}</td>
      </tr>
    `).join('');
  }

  /* ——— Tracker table ——— */
  function renderTrades() {
    const tb = document.getElementById('trackerBody');
    if (!state.trades.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">No trades yet</td></tr>';
      return;
    }
    tb.innerHTML = state.trades.map(t => {
      const pnlTxt = (t.pnl_pct != null)
        ? (t.pnl_pct > 0 ? '+' : '') + Number(t.pnl_pct).toFixed(2) + '%'
        : '—';
      return `
        <tr>
          <td><strong>${t.symbol}</strong></td>
          <td><span class="tag-${t.signal.toLowerCase()}">${t.signal}</span></td>
          <td>₹${Number(t.entry).toFixed(2)}</td>
          <td>₹${Number(t.target).toFixed(2)}</td>
          <td>₹${Number(t.stop_loss).toFixed(2)}</td>
          <td>${t.score}</td>
          <td><span class="outcome-${(t.outcome || 'open').toLowerCase()}">${t.outcome || 'OPEN'}</span></td>
          <td>${pnlTxt}</td>
        </tr>`;
    }).join('');
  }

  /* ——— Sentiment ——— */
  function sentimentColor(s) {
    return s === 'BULLISH' ? 'var(--success)' : s === 'BEARISH' ? 'var(--danger)' : 'var(--text-muted)';
  }
  function sentimentEmoji(s) {
    return s === 'BULLISH' ? '🟢' : s === 'BEARISH' ? '🔴' : '🟡';
  }
  function buildSentimentCard(label, data) {
    if (!data) return '';
    const color = sentimentColor(data.sentiment);
    const pct = data.confidence || 50;
    return `
      <div class="sentiment-card">
        <div class="sentiment-label">${label}</div>
        <div class="sentiment-val" style="color:${color}">
          ${sentimentEmoji(data.sentiment)} ${data.sentiment}
        </div>
        <div class="sentiment-reason">${data.reason || ''}</div>
        <div class="conf-bar"><div class="conf-fill" style="width:${pct}%;background:${color};"></div></div>
        <div style="font-size:9px;color:var(--text-weak);margin-top:3px;">${pct}% confidence</div>
      </div>`;
  }

  /* ——— Init ——— */
  async function init() {
    try {
      const status = await api.getStatus();
      state.connected = true;
      logAdd('✅ Connected', 'success');
      applyStatus(status);
      await Promise.all([loadSentiment(), fetchTracker()]);
    } catch (e) {
      state.connected = false;
      logAdd('❌ ' + e.message, 'error');
    }
  }

  function applyStatus(status) {
    const badge = document.getElementById('statusBadge');
    const txt = document.getElementById('statusText');
    const dot = document.getElementById('statusDot');
    if (status.market_open) {
      badge.classList.remove('status-closed');
      badge.classList.add('status-open');
      txt.textContent = 'Market Open';
    } else {
      badge.classList.remove('status-open');
      badge.classList.add('status-closed');
      txt.textContent = 'Market Closed';
    }
    document.getElementById('niftyBadge').textContent =
      `${(status.nifty_trend || 'neutral').toUpperCase()} · ADX ${status.nifty_adx ?? '—'}`;
  }
  function renderSentiment(data) {
  document.getElementById('sentimentUpdated').textContent =
    data.updated_at
      ? `Updated: ${new Date(data.updated_at).toLocaleString('en-IN')}`
      : 'Not loaded';

  let html = buildSentimentCard('📊 Overall Market', data.market);
  for (const [sector, sdata] of Object.entries(data.sectors || {})) {
    html += buildSentimentCard(sector, sdata);
  }
  document.getElementById('sentimentGrid').innerHTML =
    html || '<div class="sentiment-empty">No data yet</div>';
}

async function loadSentiment() {
  try {
    const data = await api.getSentiment();

    const isStale = !data.updated_at ||
      (Date.now() - new Date(data.updated_at).getTime() > 30 * 60 * 1000);

    // If cache is fresh, just render.
    if (!isStale) {
      renderSentiment(data);
      return;
    }

    // If a refresh is already in flight, skip.
    if (state.sentimentRefreshing) return;

    state.sentimentRefreshing = true;
    document.getElementById('sentimentGrid').innerHTML =
      '<div class="sentiment-empty">Analyzing headlines… (this takes ~30 seconds)</div>';

    try {
      await api.forceSentiment();
      logAdd('Sentiment refresh triggered — polling…', 'info');

      // Poll every 8s, up to 12 attempts = ~96s max
      for (let attempt = 1; attempt <= 12; attempt++) {
        await new Promise(r => setTimeout(r, 8000));
        try {
          const fresh = await api.getSentiment();
          if (fresh.updated_at) {
            logAdd('✅ Sentiment updated', 'success');
            renderSentiment(fresh);
            state.sentimentRefreshing = false;
            return;
          }
        } catch (_) { /* keep polling */ }
      }

      logAdd('⚠️ Sentiment refresh timed out — try again later', 'warn');
      renderSentiment(data);
    } finally {
      state.sentimentRefreshing = false;
    }
  } catch (e) {
    logAdd('Sentiment load error: ' + e.message, 'error');
  }
}

  async function forceSentimentRefresh() {
    try {
      await api.forceSentiment();
      logAdd('Sentiment re-analysis triggered — takes ~30s', 'info');
      setTimeout(loadSentiment, 30000);
    } catch (e) {
      logAdd('Refresh error: ' + e.message, 'error');
    }
  }

  /* ——— Scanning ——— */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function startScan() {
    if (state.scanning) return;
    if (!state.connected) await init();

    state.scanning = true;
    state.stopFlag = false;
    state.signals = [];
    renderSignals();
    setScanUI(true);

    try {
      const { symbols } = await api.getSymbols();
      const { nifty_trend } = await api.getNiftyTrend();
      logAdd(`Starting scan of ${symbols.length} symbols (Nifty: ${nifty_trend})…`, 'info');

      const queue = [...symbols];
      let scanned = 0;
      let sigCount = 0;
      const concurrency = 2;

      async function worker() {
        while (queue.length > 0 && !state.stopFlag) {
          const sym = queue.shift();
          try {
            const res = await api.scanSymbol(sym, nifty_trend);
            if (res.signal) {
              sigCount++;
              state.signals.unshift(res.signal);
              renderSignals();
              logAdd(`🎯 ${res.signal.symbol} ${res.signal.signal} | score ${res.signal.score} | ADX ${res.signal.adx}`, 'success');
            }
          } catch (e) {
            // Skip symbol-level errors silently to keep scan fast
          }
          scanned++;
          updateProgress(scanned, symbols.length, sigCount, sym);
          await sleep(150);
        }
      }

      await Promise.all(Array.from({ length: concurrency }, worker));

      if (state.stopFlag) logAdd('⏹ Scan stopped', 'warn');
      else logAdd(`✅ Scan complete — ${sigCount} signal(s)`, 'success');

      await fetchTracker();
    } catch (e) {
      logAdd('Scan error: ' + e.message, 'error');
    } finally {
      state.scanning = false;
      setScanUI(false);
    }
  }

  function stopScan() {
    state.stopFlag = true;
    logAdd('⏹ Stop requested', 'warn');
  }

  /* ——— Tracker ——— */
  async function fetchTracker() {
    try {
      const data = await api.getTrades();
      state.trades = data.trades || [];
      document.getElementById('ptTotal').textContent = data.total || 0;
      document.getElementById('ptWins').textContent = data.wins || 0;
      document.getElementById('ptLosses').textContent = data.losses || 0;
      document.getElementById('ptOpen').textContent = data.open || 0;
      const wr = data.total ? (data.wins / (data.wins + data.losses) * 100) : 0;
      document.getElementById('ptWinRate').textContent =
        (data.wins + data.losses) > 0 ? wr.toFixed(1) + '%' : '—';
      renderTrades();
    } catch (e) {
      logAdd('Tracker fetch error: ' + e.message, 'error');
    }
  }

  async function resolveTrades() {
    try {
      logAdd('Resolving open trades…', 'info');
      const r = await api.resolveTrades();
      logAdd(`Resolved ${r.resolved ?? 0} of ${r.checked ?? 0} open`, 'success');
      await fetchTracker();
    } catch (e) {
      logAdd('Resolve error: ' + e.message, 'error');
    }
  }

  async function resetTracker() {
    if (!confirm("Reset this week's trades?")) return;
    try {
      await api.resetTrades();
      await fetchTracker();
      logAdd('Week reset', 'success');
    } catch (e) {
      logAdd('Reset error: ' + e.message, 'error');
    }
  }

  async function exportSignals() {
  try {
    logAdd('Building Excel export…', 'info');

    const url = api.auth ? api.auth('/api/tracker?action=export') : '/api/tracker?action=export';
    const resp = await fetch(url);

    if (resp.status === 404) {
      logAdd('Nothing to export yet — no trades logged', 'warn');
      return;
    }
    if (!resp.ok) {
      logAdd(`Export failed: ${resp.status}`, 'error');
      return;
    }

    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'swingscan_signals.xlsx';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    logAdd(`✅ Exported ${filename}`, 'success');
  } catch (e) {
    logAdd('Export error: ' + e.message, 'error');
  }
  }

  /* ——— Tabs ——— */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === `tab-${name}`));
  }

  /* ——— Auto-refresh status every 60s ——— */
  setInterval(async () => {
    if (!state.connected) return;
    try {
      const s = await api.getStatus();
      applyStatus(s);
    } catch {}
  }, 60000);

  setInterval(() => { if (state.connected) fetchTracker(); }, 60000);

  /* ——— Expose ——— */
  window.app = {
    init, startScan, stopScan,
    loadSentiment, forceSentimentRefresh,
    fetchTracker, resolveTrades, resetTracker,exportSignals,
    switchTab,
    clearLog() { document.getElementById('logBody').innerHTML = ''; },
  };

  logAdd('SwingScan loaded — click Connect', 'info');
})();