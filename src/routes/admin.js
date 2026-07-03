// Admin endpoints — not rate-limited themselves
//
//   POST   /admin/clients          — upsert a client config
//   GET    /admin/clients          — list all clients
//   GET    /admin/clients/:key     — get one client
//   DELETE /admin/clients/:key     — remove client and Redis bucket

import { upsertClient, getClient, getAllClients, deleteClient } from '../db/config_store.js';
import { cacheClientConfig, getRedis } from '../db/redis_client.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'secret';

async function adminAuth(req, reply) {
  const header = req.headers['x-admin-secret'];
  if (header !== ADMIN_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', adminAuth);

  // Upsert client
  fastify.post('/admin/clients', {
    schema: {
      body: {
        type: 'object',
        required: ['client_key'],
        properties: {
          client_key:  { type: 'string' },
          algorithm:   { type: 'string', enum: ['token_bucket', 'sliding_window'] },
          capacity:    { type: 'number', minimum: 1 },
          refill_rate: { type: 'number', minimum: 0.01 },
          window_ms:   { type: 'number', minimum: 100 },
          limit_count: { type: 'number', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const config = req.body;

    // Persist to SQLite
    upsertClient(config);

    // Push to Redis immediately so the change takes effect without restart
    await cacheClientConfig({
      ...config,
      algorithm:   config.algorithm   ?? 'token_bucket',
      capacity:    config.capacity    ?? 100,
      refill_rate: config.refill_rate ?? 10,
      window_ms:   config.window_ms   ?? 1000,
      limit_count: config.limit_count ?? 100,
    });

    return reply.code(200).send({ ok: true, client_key: config.client_key });
  });

  // List all
  fastify.get('/admin/clients', async (_req, reply) => {
    return reply.send(getAllClients());
  });

  // Get one
  fastify.get('/admin/clients/:key', async (req, reply) => {
    const c = getClient(req.params.key);
    if (!c) return reply.code(404).send({ error: 'Not found' });
    return reply.send(c);
  });

  // Delete
  fastify.delete('/admin/clients/:key', async (req, reply) => {
    const key = req.params.key;
    deleteClient(key);
    // Remove both bucket types from Redis
    const r = getRedis();
    await r.del(`cfg:${key}`, `tb:${key}`, `sw:${key}`);
    return reply.send({ ok: true });
  });
}
