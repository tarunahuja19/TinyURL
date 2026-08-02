# 🚀 Redis Lua Scripting: The Atomic Counter

When building a high-performance rate limiter, you face a major challenge: how to count requests over a rolling 60-second window without consuming massive amounts of memory, and how to do it without race conditions.

This guide breaks down how we solve this using **Redis Lua scripting** and the **Sliding Window Counter** algorithm.

---

## ⏳ The Sliding Window Counter Algorithm

Instead of tracking every single click's timestamp (which eats RAM), we divide time into fixed chunks (e.g., 60-second windows) and estimate the rolling count using a simple, clever formula.

### The Analogy: The Two-Box Sliding Scale 📦
Imagine you want to know how many requests arrived in the **last 60 seconds**.
Right now, you are **15 seconds** into the **Current Minute**. 

The last 60 seconds spans:
1. The last **45 seconds** of the **Previous Minute** (weight: `45/60 = 0.75`).
2. The first **15 seconds** of the **Current Minute** (weight: `100%`).

```
◀────────── The Last 60-Second Sliding Window (Rolling) ──────────▶
[      Previous Minute (60s)     ] [       Current Minute (60s)      ]
├───────────────────────┿━━━━━━━━┼━━━━━━━━━━━━━━━━┿─────────────────┤
                        │        │                │
                (45s weight)   (Now)         (45s left)
                        │◄──────►│
                          15s elapsed
```

**The Formula:**
$$\text{Estimated Count} = (\text{Previous Count} \times \text{Weight}) + \text{Current Count}$$

---

## 🔍 Line-by-Line Code Walkthrough

Here is the exact Lua script (`sliding_window_counter.lua`) translated into plain English:

### Step 1: Read Inputs
Redis sends inputs as arrays: `KEYS` (keys to touch) and `ARGV` (configuration values).
```lua
local base_key = KEYS[1]       -- e.g. "ratelimit:shorten:1.2.3.4"
local now = tonumber(ARGV[1])        -- Current timestamp in seconds
local window_size = tonumber(ARGV[2])-- Window size (e.g., 60)
local limit = tonumber(ARGV[3])      -- Max requests allowed (e.g., 10)
```

### Step 2: Identify the Time Windows
We figure out which time buckets we are in.
```lua
local current_window = math.floor(now / window_size)   -- e.g. timestamp 1735000015 -> window 28916666
local previous_window = current_window - 1

local current_key = base_key .. ":" .. current_window  -- Redis key: "ratelimit:shorten:1.2.3.4:28916666"
local previous_key = base_key .. ":" .. previous_window
```

### Step 3: Fetch Current Counts from Redis
We ask Redis for the counts. If they don't exist yet, we treat them as `0`.
```lua
local current_count = tonumber(redis.call("GET", current_key)) or 0
local previous_count = tonumber(redis.call("GET", previous_key)) or 0
```

### Step 4: Calculate the Rolling Estimate
We calculate how far we are into the current window and apply our weighted formula.
```lua
local elapsed_in_current = now % window_size
local weight = (window_size - elapsed_in_current) / window_size
local estimated_count = (previous_count * weight) + current_count
```

### Step 5: Check Limit & Block
If the estimate is too high, we block the request and return the time left until the current window resets.
```lua
if estimated_count >= limit then
  local retry_after = window_size - elapsed_in_current
  return {0, math.ceil(retry_after)} -- [Remaining Requests, Retry After Seconds]
end
```

### Step 6: Log & Return Remaining
If within the limit, we increment the current count, update expiration (2x window size to cleanup old keys), and return the remaining slots.
```lua
redis.call("INCR", current_key)
redis.call("EXPIRE", current_key, window_size * 2)

local remaining = limit - estimated_count - 1
if remaining < 0 then remaining = 0 end

return {math.floor(remaining), 0} -- [Remaining Requests, Retry After = 0]
```

---

## ⚡ Why Lua? The Atomicity Guarantee

Why not run this logic in Node.js? **Race conditions.**

Imagine a user has 9 requests used (limit 10) and fires two requests at the exact same millisecond:

```
❌ WITHOUT LUA (Node.js GET + INCR)
Node (Req 1) ─── GET counter (returns 9) ──────────────────────────┐
Node (Req 2) ─── GET counter (returns 9) ──────────────────┐       │
                                                           ▼       ▼
                                                       Both check: "9 < 10, ALLOW!"
                                                           │       │
Node (Req 1) ─── INCR counter (now 10) ────────────────────┼───────┘
Node (Req 2) ─── INCR counter (now 11) ────────────────────┘
⚠️ The limit of 10 was bypassed!
```

```
✅ WITH LUA (Atomic Execution)
Client 1 ─── EVAL script ───► [ Redis runs entire script to completion ] ───► ALLOW (Count=10)
Client 2 ───────────────────► [ (Queued, waits until script finished) ]  ───► REJECT (Count=10, hit 429)
```

Because Redis runs commands on a **single main thread**, executing a Lua script guarantees that no other requests can read or write data in the middle of your check-and-increment steps. 

---

## 📜 Redis Lua Rules & Gotchas

### 1. `KEYS` vs `ARGV` (The Golden Sharding Rule)
When calling a script from Node, we pass keys and values separately:
```javascript
await redis.eval(script, 1, key, now, windowSeconds, limit);
//                        │   │    └──────┬──────┘
//                    numkeys KEYS[1]   ARGV[1], ARGV[2], ARGV[3]
```
* **`KEYS[1]`** contains the actual database key name.
* **`ARGV`** contains helper arguments (numbers, strings).

> [!IMPORTANT]
> **Why?** Redis clusters shard data across multiple nodes based on key names. Redis needs to know which keys a script will touch *before* running it so it can direct the script to the right node. Never construct key names entirely dynamically out of `ARGV` without passing the base key name in `KEYS`.

### 2. `redis.call` vs `redis.pcall`
* **`redis.call`**: Runs a Redis command. If the command fails, the script aborts immediately and throws an error back to JS.
* **`redis.pcall`**: (Protected call) If the command fails, it returns a table containing the error instead of crashing. 
* *We use `redis.call` because if Redis is failing, we want our rate limiter to abort loudly rather than silently operating on broken counters.*

### 3. `EVALSHA` (Script Caching)
Sending the full Lua source code over the network on every request wastes bandwidth. 
* Under the hood, `ioredis` loads the script once using `SCRIPT LOAD`, receives a **SHA1 hash**, and runs it using `EVALSHA <hash>`.
* If Redis restarts and loses the cache, it returns a `NOSCRIPT` error, and `ioredis` automatically falls back to sending the full script again.

### 4. The Single Thread Gotcha: Do Not Block!
Since scripts run atomically by blocking the single execution thread, **a slow script freezes your entire database**.
* Keep scripts ultra-fast: only do basic arithmetic, `GET`s, and `INCR`s.
* Avoid massive loops, sorting large arrays, or using expensive commands like `KEYS *`.

---

## 🛠️ Testing the Lua Script Directly

You can debug your Lua script directly in your terminal using `redis-cli`, completely bypassing Node.js:

```bash
docker exec -it url-shortener-redis redis-cli --eval /path/to/sliding_window_counter.lua ratelimit:test , 1735000000 60 10
```

> [!NOTE]
> The space and comma (`,`) in the command separates your `KEYS` from your `ARGV`. Everything before the comma goes into `KEYS[]`, everything after goes into `ARGV[]`.