// This manages a single ioredis connection and loads Lua scripts via SCRIPT LOAD
// so they run as atomic EVALSHA calls on every request.

import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALGO_DIR  = path.join(__dirname, '../algorithms');

let redis  = null;
export const scripts = {};   // { token_bucket: sha1, sliding_window: sha1 }

export async function initRedis() {
  redis = new Redis({
    host:           process.env.REDIS_HOST     || '127.0.0.1',
    port:    parseInt(process.env.REDIS_PORT   || '6379'),
    password:       process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  redis.on('error', (err) => console.error('[redis] error', err.message));

  // Load Lua scripts
  for (const name of ['token_bucket', 'sliding_window']) {
    const src = fs.readFileSync(path.join(ALGO_DIR, `${name}.lua`), 'utf8');
    scripts[name] = await redis.script('LOAD', src);
    console.log(`[redis] loaded ${name} → ${scripts[name]}`);
  }

  return redis;
}

export function getRedis() {
  if (!redis) throw new Error('Redis not initialised');
  return redis;
}

// Warm Redis with all persisted client configs (called after DB init)
export async function warmConfigCache(clients) {
  const r = getRedis();
  const pipeline = r.pipeline();
  for (const c of clients) {
    pipeline.hset(`cfg:${c.client_key}`,
      'algorithm',   c.algorithm,
      'capacity',    c.capacity,
      'refill_rate', c.refill_rate,
      'window_ms',   c.window_ms,
      'limit_count', c.limit_count,
    );
  }
  await pipeline.exec();
  console.log(`[redis] warmed ${clients.length} client config(s)`);
}

// Push a single config to Redis (called on admin upsert)
export async function cacheClientConfig(config) {
  const r = getRedis();
  await r.hset(`cfg:${config.client_key}`,
    'algorithm',   config.algorithm,
    'capacity',    config.capacity,
    'refill_rate', config.refill_rate,
    'window_ms',   config.window_ms,
    'limit_count', config.limit_count,
  );
}

// Default config if client not found
export const DEFAULT_CONFIG = {
  algorithm:   'token_bucket',
  capacity:    60,
  refill_rate: 10,
  window_ms:   1000,
  limit_count: 60,
};

export async function getClientConfig(clientKey) {
  const r = getRedis();
  const raw = await r.hgetall(`cfg:${clientKey}`);
  if (!raw || !raw.algorithm) return { ...DEFAULT_CONFIG };
  return {
    algorithm:   raw.algorithm,
    capacity:    parseInt(raw.capacity),
    refill_rate: parseFloat(raw.refill_rate),
    window_ms:   parseInt(raw.window_ms),
    limit_count: parseInt(raw.limit_count),
  };
}