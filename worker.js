/**
 * Macro Ops — Cloudflare Worker
 * Proxies Yahoo Finance v8 chart API to bypass CORS
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export default {
  async fetch(request, env, ctx) {

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ── Health check ──
    if (url.pathname === '/health') {
      return json({ status: 'ok', ts: Date.now() });
    }

    // ── Batch endpoint: POST /batch  { tickers: ["GC=F","SPY",...] } ──
    if (url.pathname === '/batch' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      const tickers = body?.tickers;
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return json({ error: 'tickers array required' }, 400);
      }

      const results = await Promise.all(tickers.map(t => fetchTicker(t)));

      const out = {};
      tickers.forEach((t, i) => {
        if (results[i]) out[t] = results[i];
      });

      return json(out);
    }

    // ── Single ticker: GET /quote?t=GC%3DF ──
    if (url.pathname === '/quote') {
      const t = url.searchParams.get('t');
      if (!t) return json({ error: 't param required' }, 400);
      const d = await fetchTicker(t);
      if (!d) return json({ error: 'No data' }, 404);
      return json(d);
    }

    return json({ error: 'Use POST /batch or GET /quote?t=TICKER' }, 404);
  }
};

async function fetchTicker(ticker) {
  const yahooUrl = `${YAHOO_BASE}${encodeURIComponent(ticker)}?interval=1d&range=2d`;
  try {
    const res = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MacroOpsBot/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? meta.previousClose;
    const prev  = meta.chartPreviousClose  ?? meta.previousClose;
    if (price == null) return null;
    return {
      price,
      prev,
      chg: price - prev,
      pct: ((price - prev) / prev) * 100,
    };
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
