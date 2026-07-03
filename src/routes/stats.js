// GET /stats — returns per-client allow/deny counters for the dashboard.
// Counters are kept in Redis as lightweight INCR keys, reset every minute.

import { getRedis } from '../db/redis_client.js';
import { getAllClients } from '../db/config_store.js';

// Called from the limiter to increment counters
export async function recordDecision(clientKey, allowed) {
  const r      = getRedis();
  const bucket = Math.floor(Date.now() / 60000);// 1-min bucket
  const prefix = `stats:${bucket}:${clientKey}`;
  const field  = allowed ? 'allow' : 'deny';
  await r.hincrby(prefix, field, 1);
  await r.expire(prefix, 120);// keep 2 buckets
}

export async function statsRoute(fastify) {
  fastify.get('/stats', async (_req, reply) => {
    const r       = getRedis();
    const clients = getAllClients().map(c => c.client_key);

    // Pull current and previous 1-min bucket
    const now  = Math.floor(Date.now() / 60000);
    const keys = [];
    for (const ck of clients) {
      keys.push(`stats:${now}:${ck}`, `stats:${now - 1}:${ck}`);
    }

    const results = [];
    for (const ck of clients) {
      const cur  = await r.hgetall(`stats:${now}:${ck}`)   || {};
      const prev = await r.hgetall(`stats:${now - 1}:${ck}`) || {};
      results.push({
        client_key: ck,
        allow: (parseInt(cur.allow  || 0) + parseInt(prev.allow  || 0)),
        deny:  (parseInt(cur.deny   || 0) + parseInt(prev.deny   || 0)),
      });
    }
    return reply.send(results);
  });
}
