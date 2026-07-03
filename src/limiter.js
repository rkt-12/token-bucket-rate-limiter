// Core engine: given a client_key, runs the correct atomic Lua script
// and returns a structured decision with all header fields.
// decides which rate-limiting algorithm to use, 
// executes it in Redis, and returns a standardized result

import { getRedis, scripts, getClientConfig } from './db/redis_client.js';
import { randomUUID } from 'crypto';
import { recordDecision } from './routes/stats.js';

/**
 * @param {string} clientKey
 * @returns {{ allowed: boolean, limit: number, remaining: number, reset: number, algorithm: string }}
 */
export async function checkLimit(clientKey) {
  const r      = getRedis();
  const cfg    = await getClientConfig(clientKey);
  const nowMs  = Date.now();

  const result;

  if (cfg.algorithm === 'sliding_window') {
    // KEYS[1]=window_key  ARGV: window_ms, limit, now_ms, req_id
    result = await r.evalsha(
      scripts.sliding_window,
      1,
      `sw:${clientKey}`,
      cfg.window_ms,
      cfg.limit_count,
      nowMs,
      randomUUID(),
    );
    const [allowed, count, resetMs] = result;
    const decision2 = {
      allowed:    allowed === 1,
      algorithm:  'sliding_window',
      limit:      cfg.limit_count,
      remaining:  Math.max(0, cfg.limit_count - count),
      reset:      Math.ceil(resetMs / 1000),
      reset_ms:   resetMs,
    };
    recordDecision(clientKey, decision2.allowed).catch(() => {});
    return decision2;
  } else {
    // Default: token_bucket
    // KEYS[1]=bucket_key  ARGV: capacity, refill_rate, now_ms, requested
    result = await r.evalsha(
      scripts.token_bucket,
      1,
      `tb:${clientKey}`,
      cfg.capacity,
      cfg.refill_rate,
      nowMs,
      1,
    );
    const [allowed, tokensLeft, resetMs] = result;
    const decision3 = {
      allowed:    allowed === 1,
      algorithm:  'token_bucket',
      limit:      cfg.capacity,
      remaining:  tokensLeft,
      reset:      Math.ceil(resetMs / 1000),
      reset_ms:   resetMs,
    };
    recordDecision(clientKey, decision3.allowed).catch(() => {});
    return decision3;
  }
}