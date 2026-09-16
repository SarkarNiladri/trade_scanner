import { kv } from '@vercel/kv';

const hasKv = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const mem = new Map();
let warned = false;

function warnOnce() {
  if (!warned && !hasKv) {
    console.log('[kv] Vercel KV not configured — using in-memory fallback');
    warned = true;
  }
}

export async function kvGet(key) {
  warnOnce();
  if (hasKv) {
    try { return await kv.get(key); }
    catch (e) { console.error('[kv] get:', e.message); return null; }
  }
  return mem.get(key) ?? null;
}

export async function kvSet(key, value, opts) {
  warnOnce();
  if (hasKv) {
    try {
      return opts?.ex ? await kv.set(key, value, { ex: opts.ex }) : await kv.set(key, value);
    } catch (e) { console.error('[kv] set:', e.message); return null; }
  }
  mem.set(key, value);
}

export async function kvDel(key) {
  warnOnce();
  if (hasKv) {
    try { return await kv.del(key); }
    catch (e) { console.error('[kv] del:', e.message); return null; }
  }
  mem.delete(key);
}

export async function kvGetJSON(key, fallback = null) {
  const v = await kvGet(key);
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function kvSetJSON(key, value, opts) {
  return kvSet(key, JSON.stringify(value), opts);
}