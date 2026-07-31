-- KEYS[1] = base key, e.g. "ratelimit:shorten:1.2.3.4"
-- ARGV[1] = current unix time in seconds
-- ARGV[2] = window size in seconds
-- ARGV[3] = max requests allowed per window

local base_key = KEYS[1]
local now = tonumber(ARGV[1])
local window_size = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local current_window = math.floor(now / window_size)
local previous_window = current_window - 1

local current_key = base_key .. ":" .. current_window
local previous_key = base_key .. ":" .. previous_window

local current_count = tonumber(redis.call("GET", current_key)) or 0
local previous_count = tonumber(redis.call("GET", previous_key)) or 0

local elapsed_in_current = now % window_size
local weight = (window_size - elapsed_in_current) / window_size
local estimated_count = (previous_count * weight) + current_count

if estimated_count >= limit then
  -- rejected: return remaining=0 and seconds until the current window rolls over
  local retry_after = window_size - elapsed_in_current
  return {0, math.ceil(retry_after)}
end

redis.call("INCR", current_key)
redis.call("EXPIRE", current_key, window_size * 2)

local remaining = limit - estimated_count - 1
if remaining < 0 then remaining = 0 end

return {math.floor(remaining), 0}