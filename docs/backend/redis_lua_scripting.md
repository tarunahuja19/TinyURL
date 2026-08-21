# 🔒 The Complete Guide to Redis Lua Scripting & Atomic Execution

> *"Imagine you're at a ticket counter. You check how many tickets are left, then decide to buy one. But between CHECKING and BUYING, someone else grabs the last ticket. You checked '1 left', they bought it, now there are 0, but your code still thinks there's 1. You buy a ticket that doesn't exist. That's a race condition. Lua scripting makes the CHECK and the BUY happen in one indivisible action — nobody can sneak in between."*

This guide teaches you **everything** about Redis Lua scripting — what Lua is, why Redis embeds it, how atomic execution prevents race conditions, your TinyURL's sliding window Lua script line-by-line, the KEYS/ARGV contract, EVAL vs EVALSHA optimization, debugging techniques, advanced patterns, and the pitfalls that can freeze your entire Redis server.

---

## 📖 Table of Contents

1. [Chapter 1: What Is a Race Condition? — The Ticket Counter Problem](#chapter-1-race-condition)
2. [Chapter 2: Why Redis Commands Alone Can't Prevent Races](#chapter-2-why-not-commands)
3. [Chapter 3: What Is Lua? — The Scripting Language Inside Redis](#chapter-3-what-is-lua)
4. [Chapter 4: Atomic Execution — The Redis Single-Thread Guarantee](#chapter-4-atomic)
5. [Chapter 5: Your Sliding Window Script — Complete Walkthrough](#chapter-5-your-script)
6. [Chapter 6: The Race Condition Your Script Prevents](#chapter-6-race-prevented)
7. [Chapter 7: KEYS vs ARGV — The Sharding Contract](#chapter-7-keys-argv)
8. [Chapter 8: redis.call vs redis.pcall — Error Handling in Lua](#chapter-8-call-vs-pcall)
9. [Chapter 9: EVAL vs EVALSHA — Script Caching & Performance](#chapter-9-eval-evalsha)
10. [Chapter 10: Data Types Between JavaScript and Lua](#chapter-10-data-types)
11. [Chapter 11: The Single-Thread Gotcha — Never Block!](#chapter-11-never-block)
12. [Chapter 12: Alternative Approaches — MULTI/EXEC vs Lua](#chapter-12-alternatives)
13. [Chapter 13: Debugging & Testing Lua Scripts](#chapter-13-debugging)
14. [Chapter 14: Quick Reference Cheat Sheet](#chapter-14-cheat-sheet)

---

<a id="chapter-1-race-condition"></a>
## 📕 Chapter 1: What Is a Race Condition? — The Ticket Counter Problem

### 🎫 The Ticket Counter Story

```
  You're at a concert venue. Only 1 ticket left.
  Two people rush to the counter simultaneously.

  PERSON A:                          PERSON B:
  ─────────                          ─────────
  1. "How many tickets left?"        1. "How many tickets left?"
     Counter: "1"                       Counter: "1"

  2. "Great! I'll buy 1."           2. "Great! I'll buy 1."
     Counter: sells ticket              Counter: sells ticket
     Remaining: 0                       Remaining: -1 ← IMPOSSIBLE!

  RESULT: 2 tickets sold when only 1 existed! 💀

  The problem: Between READING the count and ACTING on it,
  the world changed. Both people read "1" and both decided to buy.
  Neither knew about the other's action.
```

### The Same Problem in Code

```javascript
// Your rate limiter WITHOUT Lua (BROKEN):

async function checkRateLimit(ip) {
    const count = await redis.get(`ratelimit:${ip}`);    // READ: "9"
    //                                                    ← OTHER REQUEST SNEAKS IN HERE
    //                                                    ← It also reads "9" and increments
    if (count < 10) {
        await redis.incr(`ratelimit:${ip}`);             // WRITE: now "11"!
        return { allowed: true };                         // Both requests were allowed!
    }
    return { allowed: false };
}

// Two requests arrive at the EXACT same millisecond.
// Both read count = 9. Both think "9 < 10, allowed!"
// Both increment. Count goes from 9 → 10 → 11.
// Limit of 10 was BYPASSED. The 11th request got through. 💀
```

### The Formal Definition

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  RACE CONDITION: A bug that occurs when the correctness of a      │
  │  program depends on the TIMING or ORDER of events that the        │
  │  program cannot control.                                           │
  │                                                                     │
  │  Specifically, a CHECK-THEN-ACT race:                              │
  │  1. CHECK a condition    (read the counter)                        │
  │  2. ACT on that condition (increment the counter)                  │
  │  If another process changes the condition between steps 1 and 2,  │
  │  the action may be based on a STALE check. ← THE BUG             │
  │                                                                     │
  │  THE FIX: Make CHECK + ACT happen as ONE INDIVISIBLE OPERATION.   │
  │  This is called ATOMICITY.                                         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-2-why-not-commands"></a>
## 📗 Chapter 2: Why Redis Commands Alone Can't Prevent Races

### Individual Commands ARE Atomic

```
  Each INDIVIDUAL Redis command is atomic:

  INCR counter    ← Atomic! Reads + increments in one step.
  GET counter     ← Atomic! One read.
  SET key value   ← Atomic! One write.

  No other command can interrupt a single INCR.
  If two INCRs happen simultaneously, Redis queues them:
  INCR → counter goes from 9 → 10
  INCR → counter goes from 10 → 11
  Both complete correctly. ✅
```

### But SEQUENCES of Commands Are NOT Atomic

```
  The problem isn't one command. It's the GAP BETWEEN commands.

  Your rate limiter needs:
  1. GET the current count           ← Command 1
  2. COMPARE against the limit       ← Not a Redis command! (in your JS)
  3. INCR the counter if under limit ← Command 2

  Between commands 1 and 3, another client's commands can interleave:

  Client A: GET → "9"
  Client B: GET → "9"           ← Sneaks in between A's GET and INCR!
  Client A: INCR → 10
  Client B: INCR → 11           ← Both passed the check! Limit bypassed! 💀

  The gap between GET and INCR is the VULNERABILITY WINDOW.
```

### Why Not Just Use INCR Alone?

```
  "Can't I just INCR and check the result?"

  INCR counter               → returns 10
  if (result <= limit) → allowed
  
  This IS atomic for simple counting! But your rate limiter is MORE complex:

  You need the SLIDING WINDOW algorithm:
  1. GET counter for CURRENT window      (command 1)
  2. GET counter for PREVIOUS window     (command 2)
  3. CALCULATE weighted estimate          (math in JS)
  4. COMPARE against limit               (logic in JS)
  5. IF allowed → INCR current window    (command 3)
  6. SET expiry on the key               (command 4)

  That's 4 Redis commands + 2 JS computations.
  Between ANY of those steps, another client can interleave.
  A single INCR can't express this algorithm.

  You need ALL 6 steps to run as ONE atomic block.
  That's what Lua scripting gives you. ⚡
```

---

<a id="chapter-3-what-is-lua"></a>
## 📘 Chapter 3: What Is Lua? — The Scripting Language Inside Redis

### Lua in 60 Seconds

```lua
-- Lua is a lightweight scripting language from Brazil (1993).
-- Redis embeds a Lua interpreter inside its server process.
-- You send Lua code TO Redis, and Redis executes it INSIDE ITSELF.

-- VARIABLES (local = scoped to this script)
local count = 42
local name = "hello"
local is_allowed = true

-- STRINGS (concatenation uses ..)
local key = "ratelimit:" .. "1.2.3.4"   -- "ratelimit:1.2.3.4"

-- NUMBERS (Lua has no integer type before 5.3, everything is a double)
local result = math.floor(1723729500 / 60)   -- 28728825

-- CONDITIONALS
if count >= 10 then
    return {0, 45}   -- {remaining, retry_after}
end

-- TABLES (Lua's arrays + dictionaries, 1-indexed!)
local data = {10, 20, 30}    -- data[1] = 10, data[2] = 20
-- ⚠️ Lua arrays start at 1, not 0!

-- CALLING REDIS FROM LUA
local val = redis.call("GET", "mykey")     -- Run any Redis command
redis.call("SET", "mykey", "myvalue")
redis.call("INCR", "counter")
redis.call("EXPIRE", "counter", 120)
```

### Why Redis Uses Lua (Not JavaScript, Not Python)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  WHY LUA SPECIFICALLY?                                             │
  │                                                                     │
  │  ✅ TINY: Lua interpreter is ~250 KB. Fits inside Redis easily.   │
  │  ✅ FAST: Lua is one of the fastest scripting languages.           │
  │  ✅ SANDBOXED: No file I/O, no network access, no os.execute().   │
  │     A Lua script CANNOT hack your server or read your files.      │
  │  ✅ SIMPLE: ~20 keywords. You can learn it in 30 minutes.        │
  │  ✅ DETERMINISTIC: Same inputs → same outputs (no random,         │
  │     no time functions that would break replication).               │
  │                                                                     │
  │  ❌ WHY NOT JavaScript? V8 is 30+ MB. Way too large.              │
  │  ❌ WHY NOT Python? CPython is 50+ MB and slow to embed.         │
  │  ❌ WHY NOT C? Too dangerous — users could crash Redis.          │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-4-atomic"></a>
## 📙 Chapter 4: Atomic Execution — The Redis Single-Thread Guarantee

### The Golden Rule

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  REDIS'S ATOMICITY GUARANTEE:                                      │
  │                                                                     │
  │  When Redis executes a Lua script, it runs the ENTIRE script      │
  │  to completion before processing ANY other command.                │
  │                                                                     │
  │  No other client's GET, SET, INCR, or any command can run         │
  │  between the lines of your Lua script.                             │
  │                                                                     │
  │  WHY: Redis processes commands on a SINGLE THREAD.                │
  │  One script runs → finishes → next command runs.                   │
  │  There's no multi-threading, no parallel execution.               │
  │  The script has EXCLUSIVE access to the entire Redis state.       │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Visualizing Atomicity

```
  WITHOUT Lua (commands from two clients interleave):
  ────────────────────────────────────────────────────
  TIME →  Redis command queue (single thread)
  
  t1: [Client A: GET ratelimit:1.2.3.4:500]     → "9"
  t2: [Client B: GET ratelimit:1.2.3.4:500]     → "9"   ← INTERLEAVED!
  t3: [Client A: INCR ratelimit:1.2.3.4:500]    → 10
  t4: [Client B: INCR ratelimit:1.2.3.4:500]    → 11    ← BYPASSED!

  Client A's GET and INCR were interrupted by Client B's GET.
  Both clients saw "9" and both incremented.


  WITH Lua (entire script runs as one block):
  ─────────────────────────────────────────────
  TIME →  Redis command queue (single thread)
  
  t1: [Client A: EVAL <lua_script>]
      ├── GET ratelimit:1.2.3.4:500  → "9"
      ├── GET ratelimit:1.2.3.4:499  → "5"
      ├── calculate: (5 × 0.75) + 9 = 12.75 → OVER LIMIT!
      └── return {0, 45}                     → REJECTED ✅
  
  t2: [Client B: EVAL <lua_script>]         ← CAN'T START until t1 finishes!
      ├── GET ratelimit:1.2.3.4:500  → "9"
      ├── GET ratelimit:1.2.3.4:499  → "5"
      ├── calculate: (5 × 0.75) + 9 = 12.75 → OVER LIMIT!
      └── return {0, 45}                     → REJECTED ✅

  Client B's script CANNOT start until Client A's script completes.
  No interleaving. No race condition. Correct behavior. ✅
```

### The Bank Analogy

```
  WITHOUT atomicity (two tellers, one account):
  ──────────────────────────────────────────────
  Teller A: "Balance is $100."     (reads account)
  Teller B: "Balance is $100."     (reads account)
  Teller A: "Withdrawing $80."    → balance = $20
  Teller B: "Withdrawing $80."    → balance = -$60 💀

  WITH atomicity (one teller, locked window):
  ────────────────────────────────────────────
  Teller A: LOCKS the window. "Balance is $100. Withdrawing $80." → $20. UNLOCKS.
  Teller B: LOCKS the window. "Balance is $20. Can't withdraw $80." → REJECTED. UNLOCKS.

  Lua scripting = locking the window for the entire transaction.
```

---

<a id="chapter-5-your-script"></a>
## 📒 Chapter 5: Your Sliding Window Script — Complete Walkthrough

### The Full Script with Deep Annotations

Your [`sliding_window_counter.lua`](file:///c:/Users/TARUN/Desktop/TinyURL/src/rate-limit/sliding_window_counter.lua):

```lua
-- ═══════════════════════════════════════════════════════════════════
-- INPUTS from Node.js (passed via redis.eval)
-- ═══════════════════════════════════════════════════════════════════
-- KEYS[1] = base key, e.g. "ratelimit:shorten:1.2.3.4"
-- ARGV[1] = current unix time in seconds (e.g. 1723729515)
-- ARGV[2] = window size in seconds (e.g. 60)
-- ARGV[3] = max requests allowed per window (e.g. 10)

local base_key = KEYS[1]
local now = tonumber(ARGV[1])           -- Convert string "1723729515" → number
local window_size = tonumber(ARGV[2])   -- Convert string "60" → number
local limit = tonumber(ARGV[3])         -- Convert string "10" → number
```

```
  WHY tonumber()?
  Redis passes ALL arguments as strings.
  "60" is a string. tonumber("60") gives you the number 60.
  Without tonumber(), math operations would fail!
```

```lua
-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Figure out which time windows we're in
-- ═══════════════════════════════════════════════════════════════════
local current_window = math.floor(now / window_size)
-- Example: math.floor(1723729515 / 60) = 28728825
-- This is the "window ID" — a unique number for each 60-second chunk

local previous_window = current_window - 1
-- The window before this one: 28728824
```

```
  TIMELINE:
  ┌──────────────────┐┌──────────────────┐┌──────────────────┐
  │ Window 28728824  ││ Window 28728825  ││ Window 28728826  │
  │ (previous)       ││ (current)        ││ (future)         │
  │ 12:27:00-12:28:00││ 12:28:00-12:29:00││ 12:29:00-12:30:00│
  └──────────────────┘└──────────────────┘└──────────────────┘
                          ↑
                        NOW (12:28:15, 15 seconds into current window)
```

```lua
-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Build Redis keys and fetch counts
-- ═══════════════════════════════════════════════════════════════════
local current_key = base_key .. ":" .. current_window
-- "ratelimit:shorten:1.2.3.4:28728825"

local previous_key = base_key .. ":" .. previous_window
-- "ratelimit:shorten:1.2.3.4:28728824"

local current_count = tonumber(redis.call("GET", current_key)) or 0
-- GET the counter for the current window. If nil → 0.

local previous_count = tonumber(redis.call("GET", previous_key)) or 0
-- GET the counter for the previous window. If nil → 0.
```

```
  WHY "or 0"?
  If the key doesn't exist, redis.call("GET", ...) returns nil (Lua's null).
  tonumber(nil) returns nil. nil >= 10 would ERROR.
  "or 0" converts nil to 0 safely.
```

```lua
-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: The Sliding Window Estimation (THE CLEVER PART!)
-- ═══════════════════════════════════════════════════════════════════
local elapsed_in_current = now % window_size
-- How many seconds have passed in the current window?
-- 1723729515 % 60 = 15 (we're 15 seconds in)

local weight = (window_size - elapsed_in_current) / window_size
-- How much of the previous window still matters?
-- (60 - 15) / 60 = 45/60 = 0.75
-- 75% of the previous window overlaps with our "last 60 seconds"

local estimated_count = (previous_count * weight) + current_count
-- Weighted estimate of requests in the last 60 seconds
-- Example: (8 * 0.75) + 3 = 6 + 3 = 9
```

```
  THE SLIDING WINDOW VISUALIZED:

  ◄──────── The last 60 seconds we care about ────────►

  [ Previous Window (60s) ][ Current Window (60s) ]
  ├───────────┿━━━━━━━━━━━┼━━━━━━━━━━┿─────────────┤
              │ 45 seconds│15 seconds│
              │ weight=75%│ weight=100%
              │           │
              │ 8 requests│ 3 requests
              │ × 0.75    │ × 1.0
              │ = 6       │ = 3
              │           │
              └───────────┘
                Total = 9 estimated requests in last 60 seconds

  This is CHEAPER than storing every request timestamp (fixed log).
  Two counters vs potentially thousands of timestamps.
  Same result, 99%+ less memory!
```

```lua
-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: Enforce the limit
-- ═══════════════════════════════════════════════════════════════════
if estimated_count >= limit then
    local retry_after = window_size - elapsed_in_current
    -- How many seconds until the current window resets?
    -- 60 - 15 = 45 seconds → "Try again in 45 seconds"
    
    return {0, math.ceil(retry_after)}
    -- Return: {remaining_requests = 0, retry_after_seconds = 45}
    -- The caller (Node.js) will send a 429 Too Many Requests response
end
```

```lua
-- ═══════════════════════════════════════════════════════════════════
-- STEP 5: Request is allowed! Increment and clean up.
-- ═══════════════════════════════════════════════════════════════════
redis.call("INCR", current_key)
-- Increment the current window counter: 3 → 4

redis.call("EXPIRE", current_key, window_size * 2)
-- Set TTL to 2× window size (120 seconds)
-- WHY 2×? We need the key to survive into the NEXT window
-- so the next window can read it as the "previous" counter.
-- After 2 windows, it's no longer needed → auto-deleted.

local remaining = limit - estimated_count - 1
-- Remaining requests: 10 - 9 - 1 = 0 (this was the last allowed)
if remaining < 0 then remaining = 0 end

return {math.floor(remaining), 0}
-- Return: {remaining = 0, retry_after = 0}
-- retry_after = 0 means "request was allowed" (convention)
```

---

<a id="chapter-6-race-prevented"></a>
## 📔 Chapter 6: The Race Condition Your Script Prevents

### The Exact Race Without Lua

```
  User 1.2.3.4 has made 9 requests (limit = 10).
  Two requests arrive at the EXACT same millisecond.

  ❌ WITHOUT LUA (Node.js GET + compare + INCR):
  ═══════════════════════════════════════════════════

  REQUEST A (thread 1):              REQUEST B (thread 2):
  ───────────────────────             ───────────────────────

  1. GET counter → "9"
                                      2. GET counter → "9"
  3. JS: 9 < 10? YES! Allow.
                                      4. JS: 9 < 10? YES! Allow.
  5. INCR counter → 10
                                      6. INCR counter → 11 ← OVER LIMIT!
  7. Return: allowed ✅
                                      8. Return: allowed ✅ ← WRONG!

  Both requests were allowed. Counter = 11. Limit was 10. 💀
  The vulnerability window was between steps 1-5 (and 2-6).
```

```
  ✅ WITH LUA (atomic script):
  ═══════════════════════════════

  REQUEST A:                          REQUEST B:
  ───────────────────                 ───────────────────

  1. EVAL lua_script                  (QUEUED — waiting for A to finish)
     ├── GET counter → "9"
     ├── GET prev    → "0"
     ├── estimate: 0×0.75 + 9 = 9
     ├── 9 < 10? YES! Allow.
     ├── INCR counter → 10
     └── return {0, 0} ← allowed ✅

                                      2. EVAL lua_script
                                         ├── GET counter → "10" ← sees A's INCR!
                                         ├── GET prev    → "0"
                                         ├── estimate: 0×0.75 + 10 = 10
                                         ├── 10 >= 10? YES! REJECT!
                                         └── return {0, 45} ← REJECTED ✅

  Request A: allowed. Request B: rejected. Counter = 10. Correct! ✅
  Request B's EVAL couldn't start until Request A's EVAL finished.
  When B reads the counter, it sees A's increment (10, not 9).
```

---

<a id="chapter-7-keys-argv"></a>
## 📚 Chapter 7: KEYS vs ARGV — The Sharding Contract

### The Rule

```
  When calling EVAL, you pass two types of arguments:

  redis.eval(script, NUM_KEYS, KEY1, KEY2, ..., ARG1, ARG2, ...)
                     ^^^^^^^^  ^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^
                     How many   Go into KEYS[]    Go into ARGV[]
                     keys follow
```

### Your Code

```javascript
// rate_limiter.js
const [remaining, retryAfter] = await redis.eval(
    script,     // The Lua source code
    1,          // Number of keys (we pass 1 key)
    key,        // KEYS[1] = "ratelimit:shorten:1.2.3.4"
    now,        // ARGV[1] = 1723729515
    windowSeconds, // ARGV[2] = 60
    limit       // ARGV[3] = 10
);
```

### Why This Separation Exists

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  In a REDIS CLUSTER, data is sharded across multiple nodes.        │
  │  Each key lives on a specific node (based on hash slot).           │
  │                                                                     │
  │  Redis MUST know which keys the script will touch BEFORE           │
  │  executing it, so it can:                                           │
  │  1. Route the script to the correct node                           │
  │  2. Verify all keys are on the SAME node (required!)               │
  │                                                                     │
  │  KEYS[] tells Redis: "This script will touch these keys."          │
  │  ARGV[] tells Redis: "These are just data values, not key names." │
  │                                                                     │
  │  ❌ BROKEN (constructs key from ARGV, Redis can't route):         │
  │  local key = ARGV[1] .. ":" .. ARGV[2]  -- Key built dynamically! │
  │  redis.call("GET", key)                  -- Redis didn't know this │
  │                                          -- key would be accessed! │
  │                                                                     │
  │  ✅ CORRECT (key passed in KEYS, Redis can route):                 │
  │  local base_key = KEYS[1]               -- Redis knows this key   │
  │  local full_key = base_key .. ":" .. ARGV[1]  -- Extension of the │
  │  redis.call("GET", full_key)            -- base key, same slot ✅  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Your script constructs keys by appending window IDs to the base key: `base_key .. ":" .. current_window`.** This works because Redis Cluster hashes only the `{tag}` portion of a key. If you ever move to Redis Cluster, wrap the base key in hash tags: `ratelimit:{shorten:1.2.3.4}` so all window keys land on the same node.

---

<a id="chapter-8-call-vs-pcall"></a>
## 📖 Chapter 8: redis.call vs redis.pcall — Error Handling in Lua

### The Two Ways to Call Redis Commands

```lua
-- redis.call: If the command fails, the ENTIRE script aborts.
local val = redis.call("GET", "mykey")
-- If Redis encounters an error (wrong type, etc.), the script STOPS.
-- The error is returned to the calling client (your Node.js code).
-- Your try/catch in JavaScript receives the error.

-- redis.pcall: If the command fails, the error is returned as a TABLE.
local result = redis.pcall("GET", "mykey")
-- If it fails, result = { err = "ERR wrong type..." }
-- The script CONTINUES running. You must check for errors manually.
```

### Which One Should You Use?

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  redis.call (YOUR CHOICE ✅):                                      │
  │  "If something goes wrong, ABORT the entire operation."           │
  │  Better for: rate limiting, counters, anything where partial       │
  │  execution would leave data in an inconsistent state.              │
  │                                                                     │
  │  redis.pcall:                                                      │
  │  "If something goes wrong, let me handle it gracefully."          │
  │  Better for: scripts that need to clean up on failure, or         │
  │  scripts that touch optional keys that might not exist.            │
  │                                                                     │
  │  YOUR RATE LIMITER uses redis.call because:                        │
  │  If GET fails → something is seriously wrong with Redis.           │
  │  The script should abort, and your Node.js catch block             │
  │  will "fail open" (allow the request through).                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-9-eval-evalsha"></a>
## 📃 Chapter 9: EVAL vs EVALSHA — Script Caching & Performance

### The Problem with EVAL

```
  Every time you call redis.eval(script, ...), you send the ENTIRE
  Lua source code over the network:

  Your script: ~1,280 bytes
  Your arguments: ~50 bytes
  Total per request: ~1,330 bytes

  At 10,000 requests/second:
  Network bandwidth: 10,000 × 1,330 = 13.3 MB/second
  Just for rate limiting! That's wasteful. 💀
```

### The EVALSHA Optimization

```
  EVALSHA sends only the script's SHA1 HASH (40 bytes) instead of
  the full source code (1,280 bytes):

  STEP 1 (once, at startup):
  SCRIPT LOAD <full_lua_source>
  → Redis stores the script and returns: "a1b2c3d4e5f6..."  (SHA1 hash)

  STEP 2 (every request):
  EVALSHA a1b2c3d4e5f6... 1 ratelimit:shorten:1.2.3.4 1723729515 60 10
  → Redis looks up the hash, finds the cached script, runs it.

  Network per request: 40 + 50 = 90 bytes (vs 1,330 bytes)
  Savings: 93% less bandwidth! ⚡

  AT 10,000 RPS:
  EVAL: 13.3 MB/s → EVALSHA: 0.9 MB/s
```

### ioredis Handles This Automatically!

```javascript
// Your code calls redis.eval(), but ioredis is smart:
const [remaining, retryAfter] = await redis.eval(
    script, 1, key, now, windowSeconds, limit
);

// Under the hood, ioredis does:
// 1. First call: SCRIPT LOAD <script> → gets SHA1 hash
// 2. All subsequent calls: EVALSHA <hash> 1 key arg1 arg2 arg3
// 3. If Redis restarts (script cache cleared):
//    EVALSHA returns NOSCRIPT error → ioredis falls back to EVAL
//    → re-caches the script automatically ✅

// You write redis.eval() but get EVALSHA performance for free!
```

---

<a id="chapter-10-data-types"></a>
## 🔀 Chapter 10: Data Types Between JavaScript and Lua

### The Type Translation Table

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  DIRECTION: JavaScript → Redis EVAL → Lua                         │
  │                                                                     │
  │  JavaScript      │ Redis Wire │ Lua                                │
  │──────────────────│────────────│────────────────────────────────────│
  │  "hello" (string)│ Bulk String│ "hello" (string)                   │
  │  42 (number)     │ Bulk String│ "42" (STRING! ⚠️ use tonumber!)   │
  │  true (boolean)  │ ???        │ NOT SUPPORTED (use 1/0)           │
  │  null/undefined  │ ???        │ NOT SUPPORTED                      │
  │  [1, 2, 3]       │ ???        │ NOT SUPPORTED (pass as args)      │
  │                                                                     │
  │  ⚠️ ALL ARGUMENTS ARRIVE AS STRINGS IN LUA!                       │
  │  That's why your script uses tonumber() on every ARGV.            │
  │                                                                     │
  │                                                                     │
  │  DIRECTION: Lua → Redis → JavaScript                               │
  │                                                                     │
  │  Lua              │ Redis Wire │ JavaScript                        │
  │───────────────────│────────────│───────────────────────────────────│
  │  "hello" (string) │ Bulk String│ "hello" (string)                  │
  │  42 (number)      │ Integer    │ 42 (number) ✅                    │
  │  {10, 20} (table) │ Array      │ [10, 20] (array) ✅               │
  │  true (boolean)   │ Integer 1  │ 1 (number, NOT true!)             │
  │  false (boolean)  │ nil        │ null ⚠️ (NOT false!)              │
  │  nil              │ nil        │ null                               │
  │                                                                     │
  │  ⚠️ Lua booleans DON'T survive the round-trip!                    │
  │  Use integers: 0 = false, 1 = true                                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Your Script's Return Value

```lua
return {math.floor(remaining), 0}
--     ^^^^^^^^^^^^^^^^^^^^^^^^^
--     Lua table with 2 numbers

-- In JavaScript:
const [remaining, retryAfter] = await redis.eval(...);
// remaining = 7 (number)
// retryAfter = 0 (number, meaning "allowed")
// retryAfter = 45 (number, meaning "rejected, try in 45 seconds")
```

---

<a id="chapter-11-never-block"></a>
## ⚠️ Chapter 11: The Single-Thread Gotcha — Never Block!

### The Danger

```
  Remember: While your Lua script runs, Redis is FROZEN.
  No other client can execute ANY command. Not GET, not SET, nothing.

  If your script takes 100 ms, Redis is blocked for 100 ms.
  At 10,000 RPS, that's 1,000 requests queued and waiting.
  User-facing latency spikes from 1 ms to 101 ms. 💀

  If your script takes 5 seconds (maybe an infinite loop bug):
  Redis's slowlog flags it.
  50,000 requests pile up in the queue.
  Clients start timing out.
  Your entire application appears to hang. 💀💀💀
```

### Rules for Fast Scripts

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  ✅ DO:                                                            │
  │  • Keep scripts TINY (< 50 lines, < 10 Redis commands)            │
  │  • Use only simple math (arithmetic, comparisons)                  │
  │  • Use GET, SET, INCR, EXPIRE (O(1) commands)                     │
  │  • Return results immediately                                      │
  │                                                                     │
  │  ❌ DON'T:                                                         │
  │  • Use KEYS * or SCAN (O(n) — scans entire database!)            │
  │  • Sort large datasets inside Lua                                  │
  │  • Run loops over thousands of keys                                │
  │  • Call SLOWLOG-triggering commands (SORT, LPOS on huge lists)    │
  │  • Use pcall in a retry loop (could loop forever)                 │
  │  • Sleep or wait (Lua has no sleep, but infinite loops exist)     │
  │                                                                     │
  │  YOUR SCRIPT:                                                      │
  │  4 Redis commands (2× GET, 1× INCR, 1× EXPIRE)                   │
  │  Basic arithmetic (floor, modulo, multiply, add)                   │
  │  Zero loops. Execution time: ~0.01 ms ← PERFECT ✅                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-12-alternatives"></a>
## 🔄 Chapter 12: Alternative Approaches — MULTI/EXEC vs Lua

### MULTI/EXEC — Redis Transactions

```
  Redis has a built-in transaction mechanism:

  MULTI                              ← Start transaction
  GET ratelimit:1.2.3.4:500
  GET ratelimit:1.2.3.4:499
  INCR ratelimit:1.2.3.4:500
  EXEC                               ← Execute all commands atomically

  But there's a CRITICAL problem:
  You can't use the RESULT of GET inside the MULTI block!

  MULTI
  GET counter                  → result comes back AFTER EXEC
  (if result < 10 then INCR)   → CAN'T DO THIS! Results aren't available yet!
  EXEC

  MULTI/EXEC is "all-or-nothing" execution,
  but NOT "read-then-decide" execution.
  You can't branch on intermediate results.
```

### WATCH — Optimistic Locking

```javascript
// WATCH + MULTI/EXEC = optimistic locking:
await redis.watch('ratelimit:1.2.3.4:500');
const count = await redis.get('ratelimit:1.2.3.4:500');

if (parseInt(count) < 10) {
    const multi = redis.multi();
    multi.incr('ratelimit:1.2.3.4:500');
    const result = await multi.exec();
    
    if (result === null) {
        // WATCH detected that another client modified the key
        // between WATCH and EXEC → transaction ABORTED
        // RETRY the entire operation from the top!
    }
}
```

### Lua vs MULTI/EXEC vs WATCH

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  APPROACH     │ Atomic? │ Read-then-decide? │ Retry needed?        │
  │───────────────│─────────│───────────────────│──────────────────────│
  │  Individual   │ Per cmd │ ❌ No             │ ❌ No                │
  │  commands     │         │ (race conditions) │                      │
  │               │         │                   │                      │
  │  MULTI/EXEC   │ ✅ Yes  │ ❌ No             │ ❌ No                │
  │               │         │ (can't branch)    │                      │
  │               │         │                   │                      │
  │  WATCH +      │ ✅ Yes  │ ✅ Yes            │ ✅ Yes (on conflict) │
  │  MULTI/EXEC   │         │ (optimistic lock) │ (complex retry logic)│
  │               │         │                   │                      │
  │  LUA SCRIPT   │ ✅ Yes  │ ✅ Yes            │ ❌ No ✅              │
  │               │         │ (full control!)   │ (always succeeds)    │
  │               │         │                   │                      │
  │  WINNER for your rate limiter: LUA SCRIPT ✅                      │
  │  • Atomic ✅                                                       │
  │  • Can read, compute, decide, and write ✅                         │
  │  • No retry logic needed ✅                                        │
  │  • Simplest correct implementation ✅                               │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-13-debugging"></a>
## 🔬 Chapter 13: Debugging & Testing Lua Scripts

### Testing Directly in redis-cli

```bash
# Connect to your Redis container:
docker exec -it TinyURL-Redis redis-cli

# Run the script directly (no Node.js needed!):
EVAL "local c = tonumber(redis.call('GET', KEYS[1])) or 0; return c" 1 ratelimit:test:1.2.3.4:500
# Returns: (integer) 0  (key doesn't exist yet)

# Test your full script:
docker exec -it TinyURL-Redis redis-cli --eval /path/to/script.lua ratelimit:test , 1723729515 60 10
#                                                                   ^^^^^^^^^^^^   ^^^^^^^^^^^^^
#                                                                   KEYS           ARGV
#                                                            (space comma space separates them)

# Simulate multiple requests:
# Request 1: should be allowed
EVAL "<your_script>" 1 ratelimit:test 1723729515 60 10
# → 1) (integer) 9    2) (integer) 0  ← allowed, 9 remaining

# Request 2: should be allowed
EVAL "<your_script>" 1 ratelimit:test 1723729516 60 10
# → 1) (integer) 8    2) (integer) 0  ← allowed, 8 remaining

# ... repeat 8 more times ...

# Request 11: should be REJECTED
EVAL "<your_script>" 1 ratelimit:test 1723729525 60 10
# → 1) (integer) 0    2) (integer) 35 ← REJECTED! Retry in 35 seconds
```

### Checking Script Execution Time

```bash
# Check Redis slow log for scripts that took too long:
SLOWLOG GET 10
# Shows the 10 slowest commands. If your EVAL appears here, it's too slow!

# Monitor all commands in real-time (development only!):
MONITOR
# Shows every command Redis processes — useful for seeing EVALSHA in action
```

---

<a id="chapter-14-cheat-sheet"></a>
## 📋 Chapter 14: Quick Reference Cheat Sheet

### Lua Syntax Quick Reference

```lua
-- Variables
local x = 42                           -- Number
local s = "hello"                      -- String
local n = nil                          -- Null

-- Strings
local key = "prefix:" .. "suffix"      -- Concatenation (..)
local len = #s                          -- String length

-- Math
math.floor(3.7)                        -- 3
math.ceil(3.2)                         -- 4
10 % 3                                 -- 1 (modulo)

-- Conditionals
if x >= 10 then
    return {0, 45}
end

-- Tables (arrays, 1-indexed!)
local t = {10, 20, 30}
t[1]                                   -- 10 (NOT t[0]!)

-- Redis commands
redis.call("GET", key)                 -- Fetch value
redis.call("SET", key, value)          -- Store value
redis.call("INCR", key)               -- Increment
redis.call("EXPIRE", key, seconds)     -- Set TTL
redis.call("DEL", key)                 -- Delete
redis.call("EXISTS", key)              -- Check existence
```

### Your Script Flow — One Diagram

```
  Node.js                        Redis (Lua)
  ───────                        ───────────
  redis.eval(script,        ──►  KEYS[1] = "ratelimit:shorten:1.2.3.4"
    1, key,                      ARGV[1] = 1723729515
    now, windowSec, limit)       ARGV[2] = 60
                                 ARGV[3] = 10
                                     │
                                     ▼
                                 GET current window count
                                 GET previous window count
                                 Calculate weighted estimate
                                     │
                              ┌──────┴──────┐
                              │ estimate    │
                              │ >= limit?   │
                              └──┬──────┬───┘
                              YES│      │NO
                                 ▼      ▼
                           return    INCR counter
                           {0,retry} EXPIRE counter
                                     return {remaining,0}
                                     │
  [remaining, retryAfter] ◄──────────┘
  if retryAfter > 0 → 429
  else → proceed to handler
```

### When to Use Lua vs Alternatives

| Need | Solution |
|:--|:--|
| Read → decide → write (your rate limiter) | **Lua script ✅** |
| Multiple independent writes (batch SET) | MULTI/EXEC |
| Optimistic lock (check-and-set one key) | WATCH + MULTI |
| Simple atomic increment | INCR (no script needed) |
| Complex computation on large datasets | **Don't use Redis** — do it in Node.js |

---

## 🎓 Final Mental Model

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Think of a Lua script as a LOCKED ROOM in a single-teller bank:│
  │                                                                  │
  │  🔒 You walk into the room and LOCK THE DOOR.                  │
  │  📖 You read the account balance.                               │
  │  🧮 You do the math.                                            │
  │  💰 You make the withdrawal (or reject it).                     │
  │  🔓 You UNLOCK THE DOOR.                                       │
  │                                                                  │
  │  While you're inside, nobody else can enter.                    │
  │  Nobody can read or modify the balance between your steps.     │
  │  Your check-then-act is GUARANTEED to be correct.              │
  │                                                                  │
  │  The cost: everyone else waits at the door.                     │
  │  The rule: be FAST inside the room. Don't dawdle.              │
  │  Your script: 4 commands, ~0.01 ms. In and out. ⚡             │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

> **Race conditions happen when two operations read the same state and both act on stale information. Lua scripts eliminate this by making the read-decide-write sequence indivisible. Redis's single thread is the lock. Your script is the critical section. Together, they guarantee correctness at 100,000+ operations per second.**

---

*This guide is part of the TinyURL backend documentation. See also: [Middleware Architectures](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/middleware_architectures.md) · [Caching Strategies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/caching_strategies.md) · [Interfacing with Redis](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/interfacing_with_redis.md)*
