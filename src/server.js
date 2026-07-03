import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initRedis, warmConfigCache } from './db/redis_client.js';
import { initDb, getAllClients } from './db/config_store.js';
import { checkRoute }  from './routes/check.js';
import { adminRoutes } from './routes/admin.js';
import { statsRoute }  from './routes/stats.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH_HTML = readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function build() {
  const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  await fastify.register(cors, { origin: true });

  // Boot order matters: DB -> Redis -> warm cache -> register routes
  await initDb();
  await initRedis();
  await warmConfigCache(getAllClients());

  await fastify.register(checkRoute);
  await fastify.register(adminRoutes);
  await fastify.register(statsRoute);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // Dashboard
  fastify.get('/dashboard', async (_req, reply) => {
    reply.type('text/html').send(DASH_HTML);
  });

  return fastify;
}

const app = await build();
await app.listen({ port: PORT, host: HOST });
console.log(`\n🚦 Rate Limiter running on http://${HOST}:${PORT}\n`);