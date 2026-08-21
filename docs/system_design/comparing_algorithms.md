# 📊 The Complete Guide to Rate Limiting Algorithms

> *"Every rate limiter answers the same question: 'Has this client made too many requests recently?' But they answer it in radically different ways. A Token Bucket hands out drink vouchers. A Leaky Bucket forces a constant drip. A Sliding Window Log writes down every timestamp. A Sliding Window Counter uses two counters and clever math. Each trades precision, memory, burst tolerance, and complexity."*

This guide teaches you **everything** about the four major rate limiting algorithms — how each one counts, the exact data structures they use, when each one wins, complete Lua implementations, and why your TinyURL chose the Sliding Window Counter.

---

## 📖 Table of Contents

1. [Chapter 1: The Problem All Four Algorithms Solve](#chapter-1-the-problem)
2. [Chapter 2: Fixed Window Counter — The Simplest (and Broken) Approach](#chapter-2-fixed-window)
3. [Chapter 3: Token Bucket — The Drink Voucher System](#chapter-3-token-bucket)
4. [Chapter 4: Leaky Bucket — The Funnel That Smooths Everything](#chapter-4-leaky-bucket)
5. [Chapter 5: Sliding Window Log — The Perfect Ledger](#chapter-5-sliding-window-log)
6. [Chapter 6: Sliding Window Counter — Your TinyURL's Choice](#chapter-6-sliding-window-counter)
7. [Chapter 7: The Deep Comparison — All Five Algorithms](#chapter-7-deep-comparison)
8. [Chapter 8: Burst Tolerance — The Key Differentiator](#chapter-8-burst)
9. [Chapter 9: Memory Consumption — The Scalability Killer](#chapter-9-memory)
10. [Chapter 10: When to Switch Algorithms — Decision Framework](#chapter-10-when-to-switch)
11. [Chapter 11: Hybrid Approaches — Combining Algorithms](#chapter-11-hybrid)
12. [Chapter 12: Quick Reference Cheat Sheet](#chapter-12-cheat-sheet)

---

<a id="chapter-1-the-problem"></a>
## 📕 Chapter 1: The Problem All Four Algorithms Solve

### The Core Question

```
  GIVEN:
  • A client identifier (IP address, API key, etc.)
  • A time window (60 seconds)
  • A limit (10 requests)

  DECIDE:
  Should request #N be ALLOWED or REJECTED?

  EVERY algorithm must answer this question.
  They differ in HOW they track the history of requests.
```

### The Five Approaches at a Glance

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  ALGORITHM              │ WHAT IT TRACKS           │ ONE WORD      │
  │─────────────────────────│──────────────────────────│───────────────│
  │  Fixed Window Counter   │ Count per fixed interval │ "SIMPLE"      │
  │  Token Bucket           │ Available tokens         │ "BURSTY"      │
  │  Leaky Bucket           │ Queue size               │ "SMOOTH"      │
  │  Sliding Window Log     │ Every request timestamp  │ "PERFECT"     │
  │  Sliding Window Counter │ Two window counters      │ "EFFICIENT"   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-2-fixed-window"></a>
## 📗 Chapter 2: Fixed Window Counter — The Simplest (and Broken) Approach

### 🪟 The Classroom Clock Analogy

```
  The teacher allows 10 bathroom breaks per hour.
  The hour resets every time the clock hits :00.

  10:00 ────────────────── 11:00 ────────────────── 12:00
  [  0 breaks used so far  ] [   0 breaks (counter reset!)  ]
```

### How It Works

```
  Key:    ratelimit:{ip}:{window_number}
  Value:  integer counter

  window_number = math.floor(current_time / 60)

  On each request:
  1. INCR the counter for the current window
  2. If counter > limit → REJECT
  3. Set EXPIRE so the key auto-deletes after the window

  Redis operations: 1 INCR + 1 EXPIRE = 2 commands
  Memory per client: 1 key with 1 integer
```

### The Boundary Burst Problem 💀

```
  Limit: 10 requests per 60-second window

  TIME:   10:00:00 ──────────────── 10:01:00 ──────────────── 10:02:00
  WINDOW: [       Window A        ] [       Window B         ]
                                   ↑
                         BOUNDARY (counter resets!)

  Attack pattern:
  • 10:00:55 → Send 10 requests (Window A counter = 10, at limit)
  • 10:01:00 → Counter RESETS to 0!
  • 10:01:05 → Send 10 more requests (Window B counter = 10, at limit)

  RESULT: 20 requests in a 10-second span (10:00:55 → 10:01:05)
  The limit was 10 per 60 seconds, but the attacker got 20 through
  by straddling the boundary! 💀

  ┌── Visualized ──────────────────────────────────────────────────────┐
  │                                                                     │
  │  10:00:00          10:00:55  10:01:05          10:02:00            │
  │  ├──────────────────┿━━━━━━━━┿━━━━━━━━━━━━━━━━━┤                  │
  │                     │10 reqs │10 reqs│                              │
  │                     │        │       │                              │
  │                     └── 20 requests in 10 seconds! ──┘            │
  │                         But each window shows "10". Legal! 💀     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  THIS is why the Fixed Window Counter is not recommended.
  The Sliding Window Counter fixes this exact problem.
```

---

<a id="chapter-3-token-bucket"></a>
## 📘 Chapter 3: Token Bucket — The Drink Voucher System

### 🪙 The Analogy

```
  You have a bucket that holds up to 10 drink vouchers (tokens).
  A waiter drops 1 new voucher into your bucket every 6 seconds.
  To order a drink (make a request), you hand over 1 voucher.

  If your bucket is empty → "Sorry, no vouchers left!" (REJECTED)
  If your bucket has vouchers → Take one, enjoy! (ALLOWED)

  KEY PROPERTY: If you've been quiet for a while,
  your bucket fills up to the maximum (10).
  Then you can order 10 drinks in rapid succession! 🍻
  After that burst, you wait for vouchers to refill.
```

### The Algorithm Step by Step

```
  STATE: { tokens: number, last_refill_time: timestamp }

  On each request:
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  1. Calculate time elapsed since last refill                       │
  │     elapsed = now - last_refill_time                               │
  │                                                                     │
  │  2. Calculate new tokens to add                                    │
  │     new_tokens = elapsed × refill_rate                             │
  │     (Example: 30 seconds × 1 token/6 sec = 5 new tokens)         │
  │                                                                     │
  │  3. Refill bucket (cap at maximum capacity)                        │
  │     tokens = min(capacity, tokens + new_tokens)                    │
  │                                                                     │
  │  4. Check if tokens available                                      │
  │     if tokens < 1 → REJECT (bucket empty)                        │
  │     else → tokens = tokens - 1, ALLOW                             │
  │                                                                     │
  │  5. Update state                                                    │
  │     last_refill_time = now                                         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Lua Implementation

```lua
-- Token Bucket in Redis Lua
local key = KEYS[1]
local capacity = tonumber(ARGV[1])      -- Max tokens (e.g., 10)
local refill_rate = tonumber(ARGV[2])   -- Tokens per second (e.g., 0.167 = 10/60)
local now = tonumber(ARGV[3])           -- Current timestamp

local tokens_key = key .. ":tokens"
local ts_key = key .. ":ts"

-- Read current state
local tokens = tonumber(redis.call("GET", tokens_key)) or capacity
local last_refill = tonumber(redis.call("GET", ts_key)) or now

-- Refill tokens based on elapsed time
local elapsed = now - last_refill
local refill = elapsed * refill_rate
tokens = math.min(capacity, tokens + refill)

if tokens < 1 then
    -- Empty bucket! Reject.
    redis.call("SET", tokens_key, tokens)
    redis.call("SET", ts_key, now)
    redis.call("EXPIRE", tokens_key, math.ceil(capacity / refill_rate) + 1)
    redis.call("EXPIRE", ts_key, math.ceil(capacity / refill_rate) + 1)
    return {0, math.ceil((1 - tokens) / refill_rate)}  -- {remaining, retry_after}
end

-- Consume a token
tokens = tokens - 1
redis.call("SET", tokens_key, tokens)
redis.call("SET", ts_key, now)
redis.call("EXPIRE", tokens_key, math.ceil(capacity / refill_rate) + 1)
redis.call("EXPIRE", ts_key, math.ceil(capacity / refill_rate) + 1)

return {math.floor(tokens), 0}  -- {remaining, retry_after=0 means allowed}
```

### Burst Behavior — The Defining Feature

```
  ┌── SCENARIO: User was idle for 5 minutes ───────────────────────────┐
  │                                                                     │
  │  Capacity: 10 tokens. Refill rate: 10 tokens / 60 seconds.        │
  │  After 5 minutes idle: bucket is FULL (10 tokens).                │
  │                                                                     │
  │  Request 1:  tokens = 10 → 9.  ALLOWED ✅                         │
  │  Request 2:  tokens = 9  → 8.  ALLOWED ✅                         │
  │  Request 3:  tokens = 8  → 7.  ALLOWED ✅                         │
  │  ...                                                                │
  │  Request 10: tokens = 1  → 0.  ALLOWED ✅                         │
  │  Request 11: tokens = 0. REJECTED ❌ (wait 6 seconds for refill)  │
  │                                                                     │
  │  ALL 10 requests allowed in < 1 second! That's a BURST. 💥       │
  │                                                                     │
  │  IS THIS GOOD?                                                     │
  │  ✅ YES for APIs: Loading a dashboard fires 8 API calls at once.  │
  │     Users shouldn't be blocked for normal multi-request behavior. │
  │  ❌ NO for databases: 10 simultaneous DB writes can cause spikes. │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Who Uses Token Bucket?

```
  • AWS API Gateway (default algorithm)
  • Stripe API
  • GitHub API
  • Google Cloud API
  • Most public REST APIs
  
  WHY: Public APIs serve developers who make bursty requests.
  A page load might fire 5 parallel API calls.
  Token Bucket allows this burst without penalty.
```

---

<a id="chapter-4-leaky-bucket"></a>
## 📙 Chapter 4: Leaky Bucket — The Funnel That Smooths Everything

### 💧 The Analogy

```
  You have a funnel on the bar. Guests pour drink orders (requests)
  into the top as fast as they want.

  The funnel has a HOLE at the bottom that drips at a constant rate:
  exactly 1 drink every 6 seconds. No faster. No slower.

  If guests pour faster than the drip rate → funnel overflows → REJECTED
  If guests pour slower → funnel never fills → ALLOWED

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │    Requests pour in (variable rate)                              │
  │         │ │ │ │ │                                                │
  │         ▼ ▼ ▼ ▼ ▼                                                │
  │      ╭─────────────╮                                             │
  │      │  ▓ ▓ ▓ ▓ ▓  │  Queue (max size = capacity)              │
  │      │  ▓ ▓ ▓ ▓    │  If queue is full → OVERFLOW → REJECT     │
  │      │  ▓ ▓ ▓      │                                            │
  │      ╰──────┬──────╯                                             │
  │             │                                                     │
  │             💧  Processed at constant rate                       │
  │             │   (1 request every 6 seconds)                      │
  │             ▼                                                     │
  │        Server processes request                                  │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  KEY PROPERTY: Output rate is ALWAYS constant.
  No bursts. No spikes. Perfect smooth traffic. 📈───────
```

### Leaky Bucket vs Token Bucket — The Core Difference

```
  TOKEN BUCKET:  Controls the AVERAGE rate, ALLOWS bursts.
  LEAKY BUCKET:  Controls the INSTANTANEOUS rate, PREVENTS bursts.

  ┌── Token Bucket Traffic Pattern ────────────────────────────────────┐
  │                                                                     │
  │  Requests/sec                                                      │
  │  │                                                                  │
  │  │  █████                                                          │
  │  │  █████       █████                                              │
  │  │  █████       █████                                              │
  │  │──█████───────█████──────────────────── average rate             │
  │  │              █████                                              │
  │  │                                                                  │
  │  └──────────────────────────────────────── Time                    │
  │     ↑ Burst!    ↑ Burst!   ↑ Quiet                                │
  │     (allowed)   (allowed)  (refilling)                             │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── Leaky Bucket Traffic Pattern ────────────────────────────────────┐
  │                                                                     │
  │  Requests/sec                                                      │
  │  │                                                                  │
  │  │────────────────────────────────────── constant rate             │
  │  │  ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██                               │
  │  │                                                                  │
  │  └──────────────────────────────────────── Time                    │
  │     Perfectly smooth. No spikes ever.                              │
  └─────────────────────────────────────────────────────────────────────┘
```

### When Leaky Bucket Wins

```
  ✅ BEST FOR:
  • Database write queues (smooth INSERT rate to protect PostgreSQL)
  • Message processing (constant consumer rate for Kafka/RabbitMQ)
  • Network traffic shaping (ISPs controlling bandwidth)
  • Any system where SPIKES are dangerous

  ❌ WRONG FOR:
  • Public APIs (users expect burst capability)
  • Interactive applications (dashboard loads feel sluggish)
  • Your TinyURL (a user clicking 5 links quickly is normal behavior)
```

---

<a id="chapter-5-sliding-window-log"></a>
## 📒 Chapter 5: Sliding Window Log — The Perfect Ledger

### 📖 The Analogy

```
  A bouncer with a notebook. Every time someone enters, the bouncer
  writes down the EXACT timestamp:

  ┌── LOGBOOK ──────────────────────────┐
  │  12:01:05.123  IP: 1.2.3.4         │
  │  12:01:12.456  IP: 1.2.3.4         │
  │  12:01:14.789  IP: 1.2.3.4         │
  │  12:01:22.012  IP: 1.2.3.4         │
  │  12:01:35.345  IP: 1.2.3.4         │
  │  ...                                │
  └─────────────────────────────────────┘

  When a new request arrives at 12:02:10:
  1. Cross out everything older than 60 seconds (before 12:01:10)
  2. Count remaining entries
  3. If count >= limit → REJECT
  4. If count < limit → ALLOW, write new timestamp
```

### Lua Implementation

```lua
-- Sliding Window Log in Redis Lua
-- Uses a Sorted Set (ZSET) where:
--   score = timestamp
--   member = unique request ID (timestamp + random)

local key = KEYS[1]
local now = tonumber(ARGV[1])          -- Current time in milliseconds
local window = tonumber(ARGV[2])       -- Window size (e.g., 60000 ms)
local limit = tonumber(ARGV[3])        -- Max requests per window

-- Step 1: Remove all entries older than the window
redis.call("ZREMRANGEBYSCORE", key, 0, now - window)

-- Step 2: Count remaining entries
local count = redis.call("ZCARD", key)

if count >= limit then
    return {0, 0}  -- REJECTED
end

-- Step 3: Add this request's timestamp
redis.call("ZADD", key, now, now .. ":" .. math.random(1, 1000000))

-- Step 4: Set expiry for cleanup
redis.call("EXPIRE", key, math.ceil(window / 1000))

return {limit - count - 1, 1}  -- {remaining, allowed}
```

### Why It's 100% Accurate

```
  ┌── SCENARIO: The Boundary Problem ──────────────────────────────────┐
  │                                                                     │
  │  Fixed Window fails at window boundaries (20 requests in 10s).    │
  │  Sliding Window Log does NOT have this problem:                    │
  │                                                                     │
  │  10:00:55 → 10 requests logged. Count = 10. AT LIMIT.            │
  │  10:01:05 → New request arrives.                                   │
  │              Prune entries before 10:00:05.                        │
  │              The 10 entries from 10:00:55 are STILL IN the window!│
  │              Count = 10. REJECTED! ✅                              │
  │                                                                     │
  │  10:01:55 → New request arrives.                                   │
  │              Prune entries before 10:00:55.                        │
  │              All 10 entries from 10:00:55 just FELL OUT!          │
  │              Count = 0. ALLOWED! ✅                                │
  │                                                                     │
  │  There's no "boundary." The window slides continuously.           │
  │  Every request is evaluated against the exact last 60 seconds.    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Memory Problem — Why It's Expensive

```
  ┌── MEMORY ANALYSIS ─────────────────────────────────────────────────┐
  │                                                                     │
  │  Each entry in the Sorted Set:                                    │
  │  • Score (timestamp): 8 bytes                                      │
  │  • Member (unique ID): ~30 bytes                                   │
  │  • ZSET overhead per entry: ~70 bytes                              │
  │  Total per entry: ~108 bytes                                       │
  │                                                                     │
  │  With limit = 100 requests/minute per client:                     │
  │  Memory per client: 100 × 108 = 10,800 bytes = ~10.5 KB          │
  │                                                                     │
  │  With 100,000 unique IPs:                                          │
  │  Total memory: 100,000 × 10.5 KB = ~1 GB! 💀                    │
  │                                                                     │
  │  Compare with Sliding Window Counter:                              │
  │  2 keys × ~100 bytes = 200 bytes per client                      │
  │  100,000 IPs × 200 bytes = ~20 MB                                 │
  │  That's 50x less memory! ⚡                                       │
  │                                                                     │
  │  PLUS: ZREMRANGEBYSCORE is O(log(N) + M) per request,            │
  │  where M = number of pruned entries. At high traffic,             │
  │  this becomes a significant CPU cost inside atomic Lua.           │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-6-sliding-window-counter"></a>
## 📔 Chapter 6: Sliding Window Counter — Your TinyURL's Choice

### 📦 The Two-Box Estimate

```
  Instead of logging EVERY timestamp (expensive!), keep just TWO counters:
  • Box A: How many requests in the PREVIOUS window
  • Box B: How many requests in the CURRENT window

  Estimate = (Box A × weight) + Box B

  Where weight = how much of the previous window overlaps with
                 our rolling 60-second lookback.

  ◄──── The last 60 seconds ────►

  [  Previous Window (60s)  ] [  Current Window (60s)  ]
  ├─────────────┿━━━━━━━━━━━┼━━━━━━━━━━┿──────────────┤
                │ 45 seconds│15 seconds│
                │ weight=75%│ 100%     │
                │           │          │
                │ Box A: 8  │ Box B: 3 │
                │ × 0.75    │ × 1.0    │
                │ = 6       │ = 3      │
                │           │          │
                └───────────┘          │
                  Estimate = 6 + 3 = 9 │
```

### Why It's "Approximate" (And Why That's OK)

```
  THE APPROXIMATION:
  The Sliding Window Counter ASSUMES that requests in the previous window
  were UNIFORMLY distributed across the window.

  EXAMPLE WHERE IT'S SLIGHTLY WRONG:
  Previous window: 10 requests, all at the very START of the window.
  Current position: 15 seconds into current window.
  Weight: 0.75 (75% of previous window overlaps).

  Our estimate: 10 × 0.75 = 7.5 from previous window.
  REALITY: All 10 requests were at the start — NONE of them are
           actually in our last-60-second lookback!
  TRUTH: 0 from previous window.
  ERROR: 7.5 overcounted.

  BUT: In practice, with high-traffic APIs, requests are
  roughly evenly distributed (many clients, random arrival times).
  The approximation error is typically < 1%.

  ┌── ACCURACY COMPARISON ─────────────────────────────────────────────┐
  │                                                                     │
  │  Algorithm               │ Accuracy     │ Memory per client        │
  │──────────────────────────│──────────────│──────────────────────────│
  │  Fixed Window Counter    │ ~50% (broken)│ 1 integer (8 bytes)     │
  │  Sliding Window Counter  │ ~99%         │ 2 integers (16 bytes) ✅│
  │  Sliding Window Log      │ 100% exact   │ N entries (~10 KB)      │
  │                                                                     │
  │  1% error with 50x less memory. That's the trade-off. ✅          │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Why Your TinyURL Chose This

```
  ✅ Ultra-low memory: 2 Redis keys per client (~200 bytes total)
  ✅ Fast: 2× GET + 1× INCR + 1× EXPIRE = 4 O(1) commands
  ✅ Accurate enough: ~99% accuracy at high traffic
  ✅ No boundary problem: Weighted estimate smooths window edges
  ✅ Simple Lua: 36 lines, executes in ~0.01 ms
  ✅ Auto-cleanup: EXPIRE handles garbage collection
```

---

<a id="chapter-7-deep-comparison"></a>
## 📚 Chapter 7: The Deep Comparison — All Five Algorithms

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                    ALL FIVE ALGORITHMS COMPARED                        │
  │                                                                        │
  │  METRIC           │ Fixed   │ Token   │ Leaky   │ SW Log  │ SW Counter│
  │                    │ Window  │ Bucket  │ Bucket  │         │ (YOURS!)  │
  │────────────────────│─────────│─────────│─────────│─────────│───────────│
  │  Accuracy          │ Low 💀  │ Exact   │ Exact   │ 100% ✅ │ ~99%      │
  │  Boundary problem  │ YES 💀  │ No      │ No      │ No      │ No ✅      │
  │  Allows bursts     │ Yes     │ YES ✅  │ No      │ No      │ Mostly No │
  │  Memory/client     │ 8 B     │ 16 B    │ Variable│ ~10 KB  │ 16 B ✅   │
  │  Redis operations  │ 2       │ 4       │ 2-3     │ 3-4     │ 4 ✅      │
  │  CPU complexity    │ O(1)    │ O(1)    │ O(1)    │ O(logN) │ O(1) ✅   │
  │  Data structure    │ String  │ String×2│ List    │ ZSET    │ String×2  │
  │  Traffic shaping   │ No      │ No      │ YES ✅  │ No      │ No        │
  │  Exact metering    │ No      │ No      │ No      │ YES ✅  │ No        │
  │  Implementation    │ Trivial │ Simple  │ Medium  │ Medium  │ Simple ✅  │
  │                                                                        │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-8-burst"></a>
## 📖 Chapter 8: Burst Tolerance — The Key Differentiator

```
  Burst tolerance is what separates the algorithms most visibly.

  SCENARIO: A user loads a dashboard page that fires 8 API calls
  simultaneously. Limit is 10 per minute.

  TOKEN BUCKET:
  "You have 10 tokens. 8 calls? Sure, here are 8 tokens."
  Result: All 8 pass instantly. 2 tokens left. ✅ Great UX!

  LEAKY BUCKET:
  "Queue drains at 1 per 6 seconds. 8 calls? I'll queue them."
  Result: Call 1 passes now. Call 2 in 6 seconds. Call 8 in 42 seconds.
  User stares at a half-loaded dashboard for 42 seconds! 💀 Terrible UX!

  SLIDING WINDOW LOG:
  "8 entries logged. Count = 8. Under limit of 10."
  Result: All 8 pass instantly. ✅ Good, but expensive memory.

  SLIDING WINDOW COUNTER:
  "Current count = 8. Estimate = 8. Under limit."
  Result: All 8 pass instantly. ✅ Good, cheap memory.

  ┌── FOR YOUR URL SHORTENER ──────────────────────────────────────────┐
  │                                                                     │
  │  Redirects (GET): User clicks multiple links quickly while        │
  │  browsing. That's bursty but normal. Any algorithm works.         │
  │                                                                     │
  │  Shortening (POST): User submits one URL at a time.              │
  │  Not bursty. Sliding Window Counter is perfect.                   │
  │                                                                     │
  │  If you added a "bulk import" feature (10 URLs at once),         │
  │  you'd want Token Bucket to allow that burst.                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-9-memory"></a>
## 📃 Chapter 9: Memory Consumption — The Scalability Killer

```
  At 100,000 unique client IPs with limit = 100 requests/minute:

  ┌── MEMORY COMPARISON ──────────────────────────────────────────────┐
  │                                                                    │
  │  Algorithm               │ Per Client │ 100K Clients │ 1M Clients│
  │──────────────────────────│────────────│──────────────│───────────│
  │  Fixed Window Counter    │ ~100 B     │ 10 MB        │ 100 MB   │
  │  Token Bucket            │ ~200 B     │ 20 MB        │ 200 MB   │
  │  Sliding Window Counter  │ ~200 B     │ 20 MB ✅      │ 200 MB ✅│
  │  Leaky Bucket (queue)    │ ~5 KB*     │ 500 MB       │ 5 GB     │
  │  Sliding Window Log      │ ~10 KB     │ 1 GB 💀      │ 10 GB 💀│
  │                                                                    │
  │  * Leaky Bucket depends on queue size; worst case shown           │
  │                                                                    │
  │  At 1M clients, Sliding Window Log needs 10 GB of Redis RAM!    │
  │  At $5-10/GB, that's $50-100/month JUST for rate limiting.      │
  │  Sliding Window Counter does the same job with 200 MB ($1-2).   │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-10-when-to-switch"></a>
## 🔀 Chapter 10: When to Switch Algorithms — Decision Framework

```
  ┌── DECISION TREE ───────────────────────────────────────────────────┐
  │                                                                     │
  │  Do users need BURST capability?                                   │
  │  ├── YES (API with dashboard loads, batch operations)             │
  │  │   └── TOKEN BUCKET ✅                                           │
  │  │                                                                  │
  │  └── NO                                                            │
  │      ├── Do you need EXACT request counts for billing?            │
  │      │   ├── YES (charging per API call, SLA enforcement)         │
  │      │   │   └── SLIDING WINDOW LOG ✅ (accept the memory cost)   │
  │      │   │                                                         │
  │      │   └── NO                                                    │
  │      │       ├── Do you need to SMOOTH traffic to protect DB?     │
  │      │       │   ├── YES (database write queue, message broker)   │
  │      │       │   │   └── LEAKY BUCKET ✅                           │
  │      │       │   │                                                 │
  │      │       │   └── NO (general API protection)                  │
  │      │       │       └── SLIDING WINDOW COUNTER ✅ (your choice!)  │
  │      │       │                                                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Real-World Algorithm Choices

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  COMPANY / PRODUCT    │ ALGORITHM           │ WHY                │
  │───────────────────────│─────────────────────│────────────────────│
  │  Stripe API           │ Token Bucket        │ Developers need    │
  │                       │                     │ burst for page load│
  │                       │                     │                    │
  │  GitHub API           │ Token Bucket        │ CI/CD makes many   │
  │                       │                     │ calls in bursts    │
  │                       │                     │                    │
  │  Nginx (limit_req)    │ Leaky Bucket        │ Traffic shaping,   │
  │                       │                     │ smooth request flow│
  │                       │                     │                    │
  │  AWS API Gateway      │ Token Bucket        │ Cloud API standard │
  │                       │                     │                    │
  │  Cloudflare           │ Sliding Window      │ DDoS defense needs │
  │                       │ (variant)           │ smooth accounting  │
  │                       │                     │                    │
  │  Your TinyURL ✅       │ Sliding Window      │ Low memory, high   │
  │                       │ Counter             │ accuracy, simple   │
  │                       │                     │                    │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-11-hybrid"></a>
## 📕 Chapter 11: Hybrid Approaches — Combining Algorithms

```
  Real production systems often COMBINE algorithms at different layers:

  ┌── TIER 1: Nginx (Leaky Bucket) ────────────────────────────────────┐
  │  limit_req zone=api_limit rate=50r/s burst=20 nodelay;            │
  │  → Smooths traffic. No client exceeds 50 RPS regardless of tier. │
  └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌── TIER 2: App (Sliding Window Counter) ────────────────────────────┐
  │  POST /api/shorten: 10/min (business logic protection)           │
  │  GET /:shortkey: 100/min (lighter protection)                    │
  └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌── TIER 3: Per-Tenant (Token Bucket) ───────────────────────────────┐
  │  Free users: 10 tokens, refill 10/minute                          │
  │  Premium users: 1000 tokens, refill 1000/minute                   │
  │  → Token Bucket allows bursts, which premium clients expect.     │
  └─────────────────────────────────────────────────────────────────────┘

  Each tier uses the BEST algorithm for its purpose:
  • Leaky Bucket at the edge (traffic shaping, DDoS defense)
  • Sliding Window Counter at app level (memory-efficient per-route)
  • Token Bucket for user tiers (burst-friendly, fair quotas)
```

---

<a id="chapter-12-cheat-sheet"></a>
## 📋 Chapter 12: Quick Reference Cheat Sheet

### Algorithm Selection — One-Line Summary

| Algorithm | Best For | One Sentence |
|:--|:--|:--|
| **Fixed Window** | Nothing (broken) | Don't use it. Boundary burst problem makes it unreliable. |
| **Token Bucket** | Public APIs, bursty clients | "Accumulate tokens over time, spend them in bursts." |
| **Leaky Bucket** | Traffic shaping, DB protection | "Process requests at a constant rate, reject overflow." |
| **Sliding Window Log** | Billing, exact metering | "Log every timestamp, prune old ones, count what's left." |
| **Sliding Window Counter** | High-traffic APIs (yours!) | "Two counters + weighted estimate. Cheap and accurate." |

---

## 🎓 Final Mental Model

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Every rate limiting algorithm is a different way to answer:    │
  │  "How many requests in the last N seconds?"                     │
  │                                                                  │
  │  Token Bucket:  "I don't count time. I count TOKENS."          │
  │  Leaky Bucket:  "I don't count requests. I control FLOW RATE." │
  │  SW Log:        "I remember EVERY request. Perfect memory."     │
  │  SW Counter:    "I remember TWO numbers. Good enough memory."  │
  │                                                                  │
  │  Your choice depends on three questions:                        │
  │  1. Do users need bursts? → Token Bucket                       │
  │  2. Do you need exact counts? → Sliding Window Log             │
  │  3. Do you need cheap + accurate? → Sliding Window Counter ✅  │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

*This guide is part of the TinyURL system design documentation. See also: [Rate Limiting Topologies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/rate_limiting_topologies.md) · [Edge-Level Gateway Filtering](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/edge_level_gateway_filtering.md) · [Redis Lua Scripting](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/redis_lua_scripting.md)*
