# 📊 Comparing Rate Limiting Algorithms

All rate-limiting algorithms exist to answer a single question: *"Has this client made too many requests recently?"* 

However, they answer it in different ways, making tradeoffs between **precision**, **memory cost**, and **burst tolerance**. Let's compare the four primary algorithms using a **Drinks and Bartender Analogy**.

---

## 🎟️ 1. Token Bucket (The Drink Voucher Bucket)
*Allows bursts, caps the average speed.*

```
Tokens drop in ──► [ 🪙 🪙 🪙 Bucket (Max: N) ]
                         │
        Request takes a token to pass
                         ▼
```

* **The Metaphor:** A guest holds a bucket that can store up to $N$ drink vouchers (tokens). The bartender drops a new voucher into the bucket at a fixed rate (e.g., 1 voucher every 6 seconds).
  * If a guest has been quiet, their bucket fills up. They can suddenly order 5 drinks all at once (**burst**). 
  * Once the bucket is empty, they must wait for the next voucher to drop in.
* **Lua Concept:**
  ```lua
  local tokens = tonumber(redis.call("GET", key)) or capacity
  local last_refill = tonumber(redis.call("GET", key .. ":ts")) or now
  
  local elapsed = now - last_refill
  local refill_amount = elapsed * refill_rate
  tokens = math.min(capacity, tokens + refill_amount)
  
  if tokens < 1 then
    return 0 -- Rejected
  else
    tokens = tokens - 1
    redis.call("SET", key, tokens)
    redis.call("SET", key .. ":ts", now)
    return 1 -- Allowed
  end
  ```
* **Best Use Case:** Public APIs (e.g., Stripe, GitHub). Real users act in bursts (loading a dashboard page fires multiple API requests at once). We shouldn't block them as long as their overall usage is reasonable.

---

## 💧 2. Leaky Bucket (The Slow-Drip Funnel)
*Smoothens traffic, allows zero bursts.*

```
Raw requests pour in ──► [ \ 💧 💧 💧 / Funnel ]
                             │
            Requests drip out at a steady rate
                             ▼
```

* **The Metaphor:** A funnel sits on the bar. Guests pour drinks (requests) in as fast as they want. The drink drips out of the bottom of the funnel at a **perfectly constant speed**.
  * If guests pour drinks in too fast, the funnel fills up and overflows onto the floor (requests get rejected).
  * The outflow speed never changes, regardless of how fast requests arrived.
* **Lua Concept:**
  ```lua
  local queue_size = tonumber(redis.call("LLEN", key)) or 0
  
  if queue_size >= max_queue_size then
    return 0 -- Overflow, reject request
  else
    redis.call("RPUSH", key, request_id)
    return 1 -- Queued, will drain at a steady speed
  end
  ```
* **Best Use Case:** Traffic shaping and background workers. Great for queueing writes into databases (like Postgres) that cannot handle sudden spikes in traffic.

---

## 📖 3. Sliding Window Log (The Exact Security Ledger)
*100% accurate, but expensive.*

```
Logbook:
[ 12:01:05 | 12:01:12 | 12:01:14 ]  <── Prune anything older than 60s
                                    <── Count what is left
```

* **The Metaphor:** A bouncer stands at the door writing the **exact timestamp** of every single request in a logbook.
  * When a new request arrives, the bouncer looks at the book, crosses out all timestamps older than 60 seconds, counts the remaining lines, and decides whether to let them pass.
* **Lua Concept:**
  ```lua
  -- Prune old timestamps
  redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
  
  -- Count active logs left
  local count = redis.call("ZCARD", key)
  if count >= limit then
    return 0 -- Blocked
  end
  
  -- Log the new request timestamp
  redis.call("ZADD", key, now, now .. "-" .. math.random())
  redis.call("EXPIRE", key, window)
  return 1 -- Allowed
  ```
* **Best Use Case:** Financial transactions or billing/metering systems where "approximate" counting is unacceptable because money depends on the exact count.

---

## 📦 4. Sliding Window Counter (The Two-Box Estimate)
*The one we built! Ultra-fast, minimal memory.*

```
[ Box A: Previous Min ]  ──(Weighted Estimate)──► [ Box B: Current Min ]
```

* **The Metaphor:** Instead of keeping a giant list of timestamps, the bouncer just keeps two counters: **Box A (Previous Minute)** and **Box B (Current Minute)**.
  * The bouncer calculates a weighted average of the two boxes based on how far we are into the current minute.
* **Lua Concept:**
  ```lua
  local current_count = tonumber(redis.call("GET", current_key)) or 0
  local previous_count = tonumber(redis.call("GET", previous_key)) or 0
  local weight = (window_size - elapsed_in_current) / window_size
  local estimated_count = (previous_count * weight) + current_count
  ```
* **Best Use Case:** High-traffic APIs. Only stores **two integer keys** in Redis per client, keeping Redis memory footprint extremely low even under massive scale.

---

## ⚖️ Side-by-Side Comparison

| Metric | Token Bucket 🪙 | Leaky Bucket 💧 | Sliding Window Log 📖 | Sliding Window Counter (Ours) 📦 |
| :--- | :--- | :--- | :--- | :--- |
| **Allows Bursts?** | **Yes** (up to capacity) | **No** (smooths to steady drip) | **No** (exact count window) | **Mostly No** (weighted estimate) |
| **Memory per Client** | Low (2 values) | Medium (variable queue) | High (1 entry per request) | **Ultra-Low (2 values)** |
| **Precision** | Exact | Exact | **100% Exact** | Approximate (Estimate) |
| **Redis Overhead** | Low (GET + SET) | Low (LLEN + RPUSH) | High (ZSET operations) | **Low (GETs + INCR)** |

---

## ❓ Why we chose the Sliding Window Counter for TinyURL

Your rate limiter executes on **every single request** to the `/api/shorten` and `/redirect` endpoints. 

At a high scale (e.g. thousands of operations per second):
1. **Sliding Window Log** would require storing thousands of individual timestamps in a Sorted Set (`ZSET`) inside Redis. Under load, this would quickly consume megabytes of RAM and waste CPU processing time constantly pruning sets.
2. **Sliding Window Counter** allows us to estimate rates with near-perfect accuracy while only storing **two simple integers** per client IP. This protects Redis memory from bloating.

---

## 🛠️ Summary: When to swap algorithms

* **Switch to Token Bucket if...** users complain that they can't import 8 links at once from a browser bookmark sync because the rate limiter blocks them instantly.
* **Switch to Leaky Bucket if...** the background database worker is crashing during high traffic spikes, and you need to smooth out the flow of SQL inserts.
* **Switch to Sliding Window Log if...** you start charging users per API call and need mathematically exact counts for billing.