// POST /check  — the hot path, called by every guarded service.
// Body: { "client_key": "user:42" }
// Returns: 200 ALLOW or 429 DENY with standard rate-limit headers.

import { checkLimit } from '../limiter.js';

export async function checkRoute(fastify) {
  fastify.post('/check', {
    schema: {
      body: {
        type: 'object',
        required: ['client_key'],
        properties: {
          client_key: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
    },
  }, async (req, reply) => {
    const { client_key } = req.body;
    const decision = await checkLimit(client_key);

    // Standard rate-limit headers (draft-ietf-httpapi-ratelimit-headers)
    reply.header('X-RateLimit-Limit',     decision.limit);
    reply.header('X-RateLimit-Remaining', decision.remaining);
    reply.header('X-RateLimit-Reset',     decision.reset);
    reply.header('X-RateLimit-Algorithm', decision.algorithm);
    reply.header('Retry-After',           decision.allowed ? undefined : decision.reset);

    if (decision.allowed) {
      return reply.code(200).send({
        status:    'ALLOW',
        remaining: decision.remaining,
        limit:     decision.limit,
        reset:     decision.reset,
        algorithm: decision.algorithm,
      });
    } else {
      return reply.code(429).send({
        status:    'DENY',
        remaining: 0,
        limit:     decision.limit,
        reset:     decision.reset,
        algorithm: decision.algorithm,
        message:   'Rate limit exceeded',
      });
    }
  });
}
