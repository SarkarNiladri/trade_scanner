import { Redis } from '@upstash/redis';

const url   = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const hasKv = !!(url && token);

const redis = hasKv ? new Redis({ url, token }) : null;

// In-memory fallback when KV is not configured (local dev without KV)
const mem = new Map();
let warned = false;

function warnOnce() {
  if (!warned && !hasKv) {
    console.log('[kv] Upstash not configured — using in-memory fallback');
    warned = true;
  }
}

export async function kvGet(key) {
  warnOnce();
  if (redis) {
    try { return await redis.get(key); }
    catch (e) { console.error('[kv] get:', e.message); return null; }
  }
  return mem.get(key) ?? null;
}

export async function kvSet(key, value, opts) {
  warnOnce();
  if (redis) {
    try {
      if (opts?.ex) return await redis.set(key, value, { ex: opts.ex });
      return await redis.set(key, value);
    } catch (e) { console.error('[kv] set:', e.message); return null; }
  }
  mem.set(key, value);
}

export async function kvDel(key) {
  warnOnce();
  if (redis) {
    try { return await redis.del(key); }
    catch (e) { console.error('[kv] del:', e.message); return null; }
  }
  mem.delete(key);
}

export async function kvGetJSON(key, fallback = null) {
  const v = await kvGet(key);
  if (v == null) return fallback;
  // Upstash auto-parses JSON on read; @vercel/kv returns strings.
  // Handle both cases.
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function kvSetJSON(key, value, opts) {
  // Store as JSON string so both Upstash and in-memory behave identically
  return kvSet(key, JSON.stringify(value), opts);
}