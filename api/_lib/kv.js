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

// Atomic set-if-not-exists with TTL — used for locks
export async function kvSetNX(key, value, exSec = 5) {
  warnOnce();
  if (redis) {
    try {
      const result = await redis.set(key, value, { nx: true, ex: exSec });
      return result === 'OK';
    } catch (e) {
      console.error('[kv] setnx:', e.message);
      return false;
    }
  }
  // In-memory: JS is single-threaded so this is atomic within one instance
  if (mem.has(key)) return false;
  mem.set(key, value);
  setTimeout(() => mem.delete(key), exSec * 1000);
  return true;
}

export async function withLock(lockKey, fn, { ttl = 5, maxAttempts = 20 } = {}) {
  const key = `lock:${lockKey}`;
  for (let i = 0; i < maxAttempts; i++) {
    const got = await kvSetNX(key, '1', ttl);
    if (got) {
      try { return await fn(); }
      finally { await kvDel(key); }
    }
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
  }
  throw new Error(`withLock: could not acquire lock for ${lockKey}`);
}