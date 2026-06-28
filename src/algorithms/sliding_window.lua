-- Sliding Window Algorithm (atomic Lua script)
-- Uses a sorted set: member = request_id, score = timestamp_ms
-- KEYS[1] = window key
-- ARGV[1] = window_ms  (window size in ms, e.g. 1000 for 1s)
-- ARGV[2] = limit      (max requests in window)
-- ARGV[3] = now_ms
-- ARGV[4] = request_id (unique ID so members don't collide)
--
-- Returns: { allowed (0|1), count_in_window, reset_ms }

local key        = KEYS[1]
local window_ms  = tonumber(ARGV[1])
local limit      = tonumber(ARGV[2])
local now_ms     = tonumber(ARGV[3])
local req_id     = ARGV[4]

local cutoff = now_ms - window_ms

-- Drop timestamps older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count current
local count = redis.call('ZCARD', key)

local allowed = 0
if count < limit then
  -- Add this request
  redis.call('ZADD', key, now_ms, req_id)
  count   = count + 1
  allowed = 1
end

-- TTL = window size (auto-expire idle keys)
redis.call('PEXPIRE', key, window_ms + 1000)

-- Reset = oldest entry in window + window_ms
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_ms = now_ms + window_ms
if #oldest > 0 then
  reset_ms = tonumber(oldest[2]) + window_ms
end

return { allowed, count, reset_ms }