-- This also runs atomically so there is no race condition
-- For every incoming request this performs the following
-- Read the current token count.
-- Calculate the refill.
-- Decide whether to allow the request.
-- Write the updated state.

-- Usually one request takes 1 token, expensive requests take more tokens.

-- Token Bucket Algorithm (atomic Lua script)
-- KEYS[1] = bucket key (e.g. "tb:client123")
-- ARGV[1] = capacity (max tokens)
-- ARGV[2] = refill_rate (tokens per second)
-- ARGV[3] = now_ms (current time in milliseconds)
-- ARGV[4] = requested tokens (usually 1) 
--
-- Returns: { allowed (0|1), tokens_remaining, reset_ms }

local key         = KEYS[1]
local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])   -- tokens/sec
local now_ms      = tonumber(ARGV[3])
local requested   = tonumber(ARGV[4]) or 1

-- Load existing state
local data = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens        = tonumber(data[1])
local last_refill   = tonumber(data[2])

if tokens == nil then
  -- First request for this client: full bucket
  tokens      = capacity
  last_refill = now_ms
end

-- Refill: add tokens proportional to elapsed time
local elapsed_sec = (now_ms - last_refill) / 1000.0
local new_tokens  = math.min(capacity, tokens + elapsed_sec * refill_rate)

-- Decide
local allowed = 0
if new_tokens >= requested then
  new_tokens = new_tokens - requested
  allowed    = 1
end

-- Persist (TTL = time to fully refill + 10s buffer)
local ttl_sec = math.ceil(capacity / refill_rate) + 10
redis.call('HMSET', key,
  'tokens',        new_tokens,
  'last_refill_ms', now_ms)
redis.call('EXPIRE', key, ttl_sec)

-- Reset time = when bucket will be full again
local deficit      = capacity - new_tokens
local reset_sec    = (refill_rate > 0) and (deficit / refill_rate) or 0
local reset_ms     = now_ms + math.ceil(reset_sec * 1000)

return { allowed, math.floor(new_tokens), reset_ms }