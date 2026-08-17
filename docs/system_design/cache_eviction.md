# 🗑️ The Complete Guide to Cache Eviction Policies

> *"Your cache is a nightclub with a maximum capacity. When the club is full and someone important shows up at the door, the bouncer has to pick someone already inside to throw out. The eviction policy is the bouncer's rulebook."*

This guide teaches you **everything** about cache eviction — why it exists, every eviction algorithm in detail, how each one decides what to throw out, the math behind them, which one your TinyURL should use, and how to size, configure, and monitor your Redis cache to prevent eviction disasters.

---

## 📖 Table of Contents

1. [Chapter 1: Why Eviction Exists — The Full Drawer Problem](#chapter-1-why-eviction)
2. [Chapter 2: The 8 Redis Eviction Policies — Complete Family](#chapter-2-all-policies)
3. [Chapter 3: LRU — Least Recently Used (The Default Champion)](#chapter-3-lru)
4. [Chapter 4: LFU — Least Frequently Used (The Statistician)](#chapter-4-lfu)
5. [Chapter 5: LRU vs LFU — The Deep Showdown](#chapter-5-lru-vs-lfu)
6. [Chapter 6: Random Eviction — The Coin Flip](#chapter-6-random)
7. [Chapter 7: TTL-Based Eviction — The Expiring-First Approach](#chapter-7-ttl-based)
8. [Chapter 8: noeviction — The Bouncer Who Says "No Entry"](#chapter-8-noeviction)
9. [Chapter 9: volatile- vs allkeys- — Which Keys Are Fair Game?](#chapter-9-volatile-vs-allkeys)
10. [Chapter 10: How Redis Actually Implements LRU (Approximate)](#chapter-10-redis-implementation)
11. [Chapter 11: Sizing Your Cache — Back-of-Envelope Math](#chapter-11-sizing)
12. [Chapter 12: Your TinyURL — Configuration & Recommendations](#chapter-12-your-tinyurl)
13. [Chapter 13: Monitoring & Alerting on Eviction](#chapter-13-monitoring)
14. [Chapter 14: Quick Reference Cheat Sheet](#chapter-14-cheat-sheet)

---

<a id="chapter-1-why-eviction"></a>
## 📕 Chapter 1: Why Eviction Exists — The Full Drawer Problem

### 🗄️ The Desk Drawer Analogy

```
  You have a desk drawer that holds exactly 10 folders.
  The drawer is YOUR CACHE (Redis).
  The folders are YOUR CACHED DATA (URL mappings, rate limit counters).
  The drawer has a MAXIMUM SIZE (maxmemory).

  ┌──────────────────────────────────────────────────────────────────┐
  │  📁 abc123 → google.com                                        │
  │  📁 def456 → github.com                                        │
  │  📁 ghi789 → twitter.com                                       │
  │  📁 jkl012 → reddit.com                                        │
  │  📁 mno345 → youtube.com                                       │
  │  📁 pqr678 → netflix.com                                       │
  │  📁 stu901 → amazon.com                                        │
  │  📁 vwx234 → facebook.com                                      │
  │  📁 yza567 → linkedin.com                                      │
  │  📁 bcd890 → wikipedia.org                                     │
  │                                                                  │
  │  ⚠️ DRAWER IS FULL! 10/10 folders                               │
  └──────────────────────────────────────────────────────────────────┘

  Now an 11th URL arrives: efg111 → stackoverflow.com
  
  You MUST throw out an existing folder to make room.
  But WHICH ONE?

  That decision is the EVICTION POLICY.
```

### Why Not Just Make the Drawer Bigger?

```
  "Can't I just use more RAM?"

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  1 GB RAM costs ~$5-10/month on cloud providers.                   │
  │  1 GB SSD costs ~$0.10/month (50-100x cheaper!)                   │
  │                                                                     │
  │  Your TinyURL with 10 million URLs:                                │
  │  All in Redis:  10M × 150 bytes = 1.5 GB RAM = ~$15/month        │
  │  All in Postgres: 10M × 150 bytes = 1.5 GB SSD = ~$0.15/month    │
  │                                                                     │
  │  But only 5% of URLs get 95% of the clicks (power law).           │
  │  So you only need the TOP 500K URLs in Redis:                      │
  │  500K × 150 bytes = 75 MB RAM = ~$0.75/month!                     │
  │                                                                     │
  │  Eviction automatically keeps the HOT 500K and tosses the COLD     │
  │  9.5 million. You get 95% cache hit rate with 5% of the memory!   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### What Happens Without maxmemory?

```
  WITHOUT maxmemory limit (your current Docker config!):
  ──────────────────────────────────────────────────────
  Redis has NO memory cap.
  It grows and grows as new URLs are cached.
  Eventually it consumes ALL available RAM on the container.
  The Linux kernel invokes the OOM (Out Of Memory) Killer.
  Redis process is KILLED. All cached data LOST. 💀
  
  ┌──── Timeline ──────────────────────────────────────────────────┐
  │  Month 1:  Redis using 50 MB. Container has 1 GB.  Fine. ✅   │
  │  Month 6:  Redis using 500 MB. Getting tight.       ⚠️       │
  │  Month 8:  Redis using 950 MB. Swapping to disk.    🐌       │
  │  Month 9:  Redis using 1.05 GB. OOM Killer strikes. 💀       │
  │            All cached data gone. Every request hits DB.       │
  │            DB overwhelmed. Site slows to a crawl.             │
  └────────────────────────────────────────────────────────────────┘

  WITH maxmemory limit + eviction policy:
  ────────────────────────────────────────
  Redis caps at 256 MB.
  When 256 MB is reached, the eviction policy kicks in.
  Cold keys are automatically removed to make room for hot keys.
  Redis NEVER exceeds the limit. NEVER gets OOM killed. ✅
```

> [!CAUTION]
> **Your current `docker-compose.yml` has NO `maxmemory` set on Redis!** This means Redis will grow unbounded and eventually get OOM-killed. Chapter 12 shows how to fix this.

---

<a id="chapter-2-all-policies"></a>
## 📗 Chapter 2: The 8 Redis Eviction Policies — Complete Family

Redis offers exactly **8 eviction policies**, organized into two groups:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │              THE 8 REDIS EVICTION POLICIES                         │
  │                                                                     │
  │  "allkeys-" policies: Can evict ANY key in the database           │
  │  ─────────────────────────────────────────────────                 │
  │  1. allkeys-lru       Evict least recently used key               │
  │  2. allkeys-lfu       Evict least frequently used key             │
  │  3. allkeys-random    Evict a random key                          │
  │                                                                     │
  │  "volatile-" policies: Can ONLY evict keys that have a TTL set    │
  │  ───────────────────────────────────────────────────────           │
  │  4. volatile-lru      Evict least recently used key with TTL      │
  │  5. volatile-lfu      Evict least frequently used key with TTL    │
  │  6. volatile-random   Evict a random key with TTL                 │
  │  7. volatile-ttl      Evict the key with the shortest remaining   │
  │                       TTL (closest to expiring anyway)             │
  │                                                                     │
  │  No eviction:                                                      │
  │  ─────────────                                                     │
  │  8. noeviction        Refuse new writes! Return errors.           │
  │                                                                     │
  │  DEFAULT: noeviction (Redis ships with NO automatic eviction!)    │
  │  RECOMMENDED for your TinyURL: allkeys-lru ✅                      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Nightclub Bouncer Analogy — All 8 Policies

```
  The nightclub is at MAXIMUM CAPACITY. A VIP shows up.
  The bouncer must remove someone. Each policy is a different bouncer:

  ┌── BOUNCER ──────────────┬── STRATEGY ──────────────────────────────┐
  │                          │                                          │
  │  allkeys-lru             │  Walk through the crowd.                │
  │  "The Forgotten Rule"    │  Find the person who's been standing   │
  │                          │  in the corner doing nothing for the    │
  │                          │  longest time. Kick them out.           │
  │                          │                                          │
  │  allkeys-lfu             │  Check the wristband scanner logs.     │
  │  "The Wallflower Rule"   │  Find the person who's visited the     │
  │                          │  club the FEWEST times ever.           │
  │                          │  Kick them out.                         │
  │                          │                                          │
  │  allkeys-random          │  Close your eyes.                       │
  │  "The Lottery Rule"      │  Point at someone random.              │
  │                          │  Kick them out.                         │
  │                          │                                          │
  │  volatile-lru            │  Same as allkeys-lru, but ONLY kick    │
  │  "The Guest-List Rule"   │  people who have a timed guest pass    │
  │                          │  (TTL). VIP members (no TTL) are safe. │
  │                          │                                          │
  │  volatile-lfu            │  Same as allkeys-lfu, but only among   │
  │  "The Guest Wallflower"  │  people with timed guest passes.       │
  │                          │                                          │
  │  volatile-random         │  Pick a random person WITH a timed     │
  │  "The Guest Lottery"     │  pass. Kick them out.                   │
  │                          │                                          │
  │  volatile-ttl            │  Find the person whose guest pass      │
  │  "The Almost-Expired"    │  is about to expire soonest.           │
  │                          │  Kick them out (they're leaving soon   │
  │                          │  anyway).                                │
  │                          │                                          │
  │  noeviction              │  Lock the door.                         │
  │  "The Full-Stop Rule"    │  Tell the VIP: "Sorry, we're full.    │
  │                          │  Nobody leaves, nobody enters."         │
  │                          │                                          │
  └──────────────────────────┴──────────────────────────────────────────┘
```

---

<a id="chapter-3-lru"></a>
## 📘 Chapter 3: LRU — Least Recently Used (The Default Champion)

### The Definition

> **LRU (Least Recently Used):** When eviction is needed, remove the key that hasn't been accessed for the longest time. The logic: "If you haven't been needed lately, you probably won't be needed soon."

### How LRU Thinks

```
  Redis maintains an "idle time" for every key — how long since
  it was last accessed (GET or SET).

  Key          │ Last Accessed │ Idle Time │ LRU Verdict
  ─────────────│───────────────│───────────│──────────────
  url:abc123   │ 2 sec ago     │ 2s        │ KEEP (hot!)
  url:def456   │ 30 sec ago    │ 30s       │ KEEP
  url:ghi789   │ 5 min ago     │ 300s      │ KEEP
  url:jkl012   │ 2 hours ago   │ 7200s     │ MAYBE evict
  url:mno345   │ 3 days ago    │ 259200s   │ EVICT THIS! ❌
                                              ↑
                                    Longest idle time = evicted first
```

### LRU Visualized — The Conveyor Belt

```
  Think of a conveyor belt where every access moves that key
  to the FRONT. Keys at the BACK haven't been touched in a while.

  Most Recent                                              Least Recent
  (FRONT)                                                  (BACK)
  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
  │abc123│def456│ghi789│jkl012│mno345│pqr678│stu901│vwx234│
  └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
       ↑                                               ↑
    Just accessed                                  Will be evicted
    (moved to front)                               first (at back)

  Someone accesses "pqr678":
  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
  │pqr678│abc123│def456│ghi789│jkl012│mno345│stu901│vwx234│
  └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
  ↑ Moved to front!                                    ↑
                                              Still at the back
                                              (eviction candidate)
```

### Why LRU Is Great for URL Shorteners

```
  URL access patterns follow TEMPORAL LOCALITY:
  "A URL clicked right now is likely to be clicked again soon."

  WHY?
  • URLs are shared on social media → bursts of clicks in minutes
  • Popular articles trend for hours → many clicks in a short window  
  • After the buzz dies, clicks drop dramatically
  • LRU naturally keeps trending URLs and evicts dead ones

  ┌── Traffic pattern for url:abc123 ───────────────────────────────┐
  │                                                                  │
  │  Clicks                                                          │
  │  │                                                               │
  │  │     ██                                                        │
  │  │    ████                                                       │
  │  │   ██████      ← Shared on Twitter (viral!)                   │
  │  │  ████████                                                     │
  │  │ ██████████                                                    │
  │  │████████████                                                   │
  │  │  ████████████                                                 │
  │  │      ████████████                                             │
  │  │          ██████████████                                       │
  │  │                ████████████████                               │
  │  │                        ████████████████████                   │
  │  │                                      ___________  ← Dies off │
  │  └──────────────────────────────────────────────────── Time      │
  │                                                                  │
  │  LRU keeps this URL cached during the viral burst (recent use). │
  │  LRU evicts it once it dies off (no recent use). Perfect! ✅     │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-4-lfu"></a>
## 📙 Chapter 4: LFU — Least Frequently Used (The Statistician)

### The Definition

> **LFU (Least Frequently Used):** When eviction is needed, remove the key that has been accessed the fewest total number of times. The logic: "If you've barely been used overall, you're probably not important."

### How LFU Thinks

```
  Redis tracks an ACCESS COUNTER for every key — how many times
  it's been read or written since it was created.

  Key          │ Total Accesses │ LFU Verdict
  ─────────────│────────────────│──────────────
  url:abc123   │ 50,000         │ KEEP (very popular!)
  url:def456   │ 3,200          │ KEEP
  url:ghi789   │ 500            │ KEEP
  url:jkl012   │ 12             │ MAYBE evict
  url:mno345   │ 2              │ EVICT THIS! ❌
                                    ↑
                          Fewest total accesses = evicted first
```

### LFU's Counter — Not a Simple Count

```
  Redis doesn't use a raw counter (that would overflow and be unfair
  to new keys). Instead, it uses a LOGARITHMIC PROBABILISTIC COUNTER:

  Access 1:    counter = 1
  Access 10:   counter ≈ 5
  Access 100:  counter ≈ 10
  Access 1000: counter ≈ 15
  Access 10K:  counter ≈ 20
  Access 100K: counter ≈ 25

  The counter grows logarithmically — it takes exponentially more
  accesses to increment it by 1. This prevents popular keys from
  dominating with massive counts.

  Also: Redis DECAYS the counter over time.
  A key that had 50K accesses 3 months ago but none recently
  will have its counter gradually reduced.
  This prevents "historical celebrities" from hogging cache forever.
```

### When LFU Shines

```
  LFU is BETTER than LRU when you have "evergreen" content —
  keys that are consistently accessed, not in bursts.

  Example: A learning platform with course URLs

  Course URL A:  "intro-to-python"     → 100 clicks/day, every day
  Course URL B:  "viral-meme-quiz"     → 10,000 clicks in 1 hour, then ZERO

  With LRU:
  After the meme quiz's 10K-click burst, it's at the FRONT.
  The intro-to-python course (accessed 30 min ago) is further back.
  LRU might evict intro-to-python even though it's more valuable long-term!

  With LFU:
  intro-to-python has 36,500 total accesses (100/day × 365 days).
  viral-meme-quiz has 10,000 total accesses.
  LFU keeps intro-to-python. Correct! ✅
```

---

<a id="chapter-5-lru-vs-lfu"></a>
## 📒 Chapter 5: LRU vs LFU — The Deep Showdown

### The Championship Battle

```
  URL A — "The Viral Link" 🔥
  ──────────────────────────
  50,000 clicks in 10 minutes (2 hours ago)
  ZERO clicks since
  Last access: 2 HOURS AGO
  Total accesses: 50,000

  URL B — "The Steady Link" 📊
  ─────────────────────────────
  1 click every 10 minutes, all day
  Last access: 10 SECONDS AGO
  Total accesses: 144 (24h × 6/hour)
```

### Round 1: Who Gets Evicted?

```
  ┌── LRU's Decision ──────────────────────────────────────────────────┐
  │                                                                     │
  │  "WHO WAS ACCESSED LEAST RECENTLY?"                                │
  │                                                                     │
  │  URL A: last accessed 2 hours ago → EVICT ❌                      │
  │  URL B: last accessed 10 seconds ago → KEEP ✅                    │
  │                                                                     │
  │  LRU throws out the viral link because it hasn't been touched     │
  │  in 2 hours, even though it had 50K clicks.                       │
  │                                                                     │
  │  IS THIS GOOD? 🤔                                                 │
  │  YES, if viral links typically don't come back.                    │
  │  NO, if the viral link might spike again (re-shared on social).  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── LFU's Decision ──────────────────────────────────────────────────┐
  │                                                                     │
  │  "WHO WAS ACCESSED LEAST OFTEN?"                                   │
  │                                                                     │
  │  URL A: 50,000 total accesses → KEEP ✅                           │
  │  URL B: 144 total accesses → EVICT ❌                             │
  │                                                                     │
  │  LFU throws out the steady link because its lifetime access       │
  │  count is much lower, even though it's still being used!          │
  │                                                                     │
  │  IS THIS GOOD? 🤔                                                 │
  │  NO, for URL shorteners. URL B is actively in use!                │
  │  YES, for content that's valued by total popularity.              │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Verdict — Access Pattern Determines the Winner

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  ACCESS PATTERN         │ WINNER    │ WHY                          │
  │─────────────────────────│───────────│──────────────────────────────│
  │                         │           │                              │
  │  Viral bursts,          │ LRU ✅    │ "Recently hot" = likely     │
  │  quick rise/fall        │           │ to be hot again soon.       │
  │  (Twitter sharing)      │           │ Dead links naturally fall   │
  │                         │           │ to the back.                 │
  │                         │           │                              │
  │  Steady, evergreen      │ LFU ✅    │ "Always popular" = keep     │
  │  access over weeks      │           │ it cached. Occasional       │
  │  (learning platforms)   │           │ spikes shouldn't displace   │
  │                         │           │ proven favorites.            │
  │                         │           │                              │
  │  Completely random      │ Random ✅ │ If there's no pattern,     │
  │  (no temporal locality) │           │ any eviction is equally     │
  │                         │           │ good (or bad).               │
  │                         │           │                              │
  │  Mixed (most real apps) │ LRU ✅    │ LRU is the safest default. │
  │                         │           │ Works well for most          │
  │                         │           │ workloads without tuning.    │
  │                         │           │                              │
  │  YOUR URL SHORTENER:    │ LRU ✅    │ URLs have viral-then-die    │
  │                         │           │ access patterns. LRU        │
  │                         │           │ naturally handles this.      │
  │                         │           │                              │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-6-random"></a>
## 📔 Chapter 6: Random Eviction — The Coin Flip

### The Definition

> **Random Eviction:** When eviction is needed, pick a random key and remove it. No analysis, no history, no logic. Pure chance.

### When Random Is Surprisingly Good

```
  "Random eviction sounds terrible. Why does it exist?"

  1. IT'S FAST — O(1) time to choose a victim.
     LRU needs to scan and compare idle times.
     Random just picks. Done.

  2. IT'S FAIR — No key gets special treatment.
     No algorithm bugs. No edge cases.

  3. IT WORKS WHEN THERE'S NO PATTERN:
     If every key is equally likely to be accessed,
     LRU and LFU provide zero benefit over random.
     Random is cheaper to compute.

  4. RESEARCH SHOWS it's not much worse than LRU:
     Random eviction achieves ~90% of LRU's hit rate
     in many real-world workloads. The difference is
     smaller than you'd expect!

  ┌── Hit Rate Comparison (simulated) ─────────────────────────────┐
  │                                                                  │
  │  Policy      │ Hit Rate │ Computation Cost │ Overall Score      │
  │──────────────│──────────│──────────────────│────────────────────│
  │  LRU         │ 95%      │ Medium           │ Best overall ✅    │
  │  LFU         │ 93%      │ High             │ Best for steady   │
  │  Random      │ 89%      │ Very low         │ Surprisingly OK   │
  │  FIFO        │ 85%      │ Low              │ Worst of all      │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  For your URL shortener:
  The 6% hit rate difference between LRU (95%) and Random (89%)
  means ~600 more cache misses per 10,000 requests.
  That's 600 × 10ms = 6 seconds of extra DB time per 10K requests.
  Not catastrophic, but LRU is clearly better. ✅
```

---

<a id="chapter-7-ttl-based"></a>
## 📚 Chapter 7: TTL-Based Eviction — The Expiring-First Approach

### The Definition

> **volatile-ttl:** When eviction is needed, remove the key with the **shortest remaining TTL** — the one that's closest to expiring on its own anyway.

### How It Thinks

```
  Key          │ TTL Remaining  │ volatile-ttl Verdict
  ─────────────│────────────────│──────────────
  url:abc123   │ 23 hours       │ KEEP (long life ahead)
  url:def456   │ 12 hours       │ KEEP
  url:ghi789   │ 2 hours        │ MAYBE
  url:jkl012   │ 30 minutes     │ PROBABLY evict
  url:mno345   │ 45 seconds     │ EVICT THIS! ❌
                                    ↑
                          Shortest TTL = evicted first
                          (it was about to expire anyway!)
```

### When volatile-ttl Makes Sense

```
  GOOD for volatile-ttl:
  • When your TTLs vary significantly (some keys 1 hour, some 24 hours)
  • When you want to preserve keys that will be useful for longer
  • When expiring keys are "less valuable" by definition

  BAD for volatile-ttl:
  • When ALL your keys have the SAME TTL (like your url: keys, all 86400s)
    → All keys have similar remaining TTL → essentially random eviction!
  • When a key about to expire might actually be the hottest key
    (popular URL that was cached 23 hours ago — about to expire but
     still getting 1000 clicks/minute!)

  YOUR TINYURL:
  All URL cache entries have TTL = 86400 seconds.
  volatile-ttl would basically be random. Not useful. ❌
  allkeys-lru is much better for uniform TTLs. ✅
```

---

<a id="chapter-8-noeviction"></a>
## 📖 Chapter 8: noeviction — The Bouncer Who Says "No Entry"

### The Definition

> **noeviction:** When memory is full, Redis returns an error on any command that would add new data (SET, LPUSH, XADD, etc.). Read commands (GET) still work.

### The Dangerous Default

```
  ⚠️ noeviction is Redis's DEFAULT policy!

  If you don't configure maxmemory-policy, Redis uses noeviction.
  When memory fills up:

  redis.set("url:abc123", "google.com")
  → ERROR: OOM command not allowed when used memory > 'maxmemory'

  redis.get("url:abc123")
  → "google.com" (reads still work)

  redis.xadd("stream:clicks", ...)
  → ERROR: OOM command not allowed 💀

  Your click analytics stops recording!
  Your URL caching stops working for new URLs!
  Existing cached URLs keep working, but no new ones can be cached.
```

### When noeviction Is Actually Appropriate

```
  ✅ USE noeviction when:
  • Redis is your PRIMARY data store (not a cache)
  • Losing data is unacceptable
  • You'd rather fail loudly than silently lose data
  • Example: Redis as a session store for logged-in users
    → Better to reject new logins than to randomly log out existing users!

  ❌ DON'T USE noeviction when:
  • Redis is a CACHE in front of PostgreSQL (your case!)
  • The data exists in the database (safe to evict from cache)
  • You'd rather serve slightly slower than error out

  YOUR TINYURL:
  Redis is a cache. PostgreSQL has all the data. 
  Evicting old cache entries is harmless — they'll be re-cached on demand.
  noeviction would cause errors. allkeys-lru would seamlessly manage memory.
```

---

<a id="chapter-9-volatile-vs-allkeys"></a>
## 📃 Chapter 9: volatile- vs allkeys- — Which Keys Are Fair Game?

### The Two Scopes

```
  "allkeys-" policies: The bouncer can eject ANYONE in the club.
  "volatile-" policies: The bouncer can ONLY eject people with temporary passes (TTL).

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Your Redis keyspace:                                              │
  │                                                                     │
  │  KEY                          │ TTL?    │ allkeys? │ volatile?     │
  │───────────────────────────────│─────────│──────────│───────────────│
  │  url:abc123                   │ 86400s  │ ✅ Yes   │ ✅ Yes        │
  │  url:def456                   │ 86400s  │ ✅ Yes   │ ✅ Yes        │
  │  ratelimit:redirect:1.2.3.4  │ 120s    │ ✅ Yes   │ ✅ Yes        │
  │  stream:clicks                │ NO TTL  │ ✅ Yes   │ ❌ Protected! │
  │  session:user:42 (future)     │ NO TTL  │ ✅ Yes   │ ❌ Protected! │
  │                                                                     │
  │  With "volatile-lru":                                              │
  │  ✅ Can evict url:abc123 (has TTL)                                 │
  │  ✅ Can evict ratelimit:... (has TTL)                              │
  │  ❌ CANNOT evict stream:clicks (no TTL — protected!)              │
  │                                                                     │
  │  With "allkeys-lru":                                               │
  │  ✅ Can evict ANY key, including stream:clicks                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### When to Use Each Scope

```
  USE "volatile-" when:
  ─────────────────────
  You have a MIX of cache data (with TTL) and persistent data (no TTL)
  in the SAME Redis instance, and you want to protect the persistent data.

  Example: Redis stores both:
  • URL cache entries (with TTL — OK to evict)
  • Active user sessions (no TTL — MUST NOT evict!)

  volatile-lru would only evict cache entries, never sessions. ✅

  USE "allkeys-" when:
  ─────────────────────
  ALL your data is cache data, or you don't mind any key being evicted.

  YOUR TINYURL:
  All your url: keys have TTL ✅
  Rate limit keys have TTL ✅
  stream:clicks has NO TTL ⚠️

  If you use allkeys-lru, stream:clicks could theoretically be evicted.
  In practice, stream:clicks is accessed constantly (XADD on every redirect),
  so LRU would never evict it (it's always "recently used").
  
  RECOMMENDATION: allkeys-lru is safe for your use case. ✅
  But volatile-lru would also work as extra protection for the stream.
```

---

<a id="chapter-10-redis-implementation"></a>
## 🔬 Chapter 10: How Redis Actually Implements LRU (Approximate)

### Redis Does NOT Use "Real" LRU!

```
  REAL LRU (textbook):
  Maintain a linked list of all keys, ordered by access time.
  On every GET/SET, move the key to the head of the list.
  On eviction, remove from the tail.

  Problem: With 1 million keys, maintaining this list is EXPENSIVE.
  Every single GET operation requires a linked list manipulation.
  Memory overhead for all those pointers is massive.

  REDIS'S APPROXIMATE LRU:
  Instead of a sorted list of ALL keys, Redis does this:

  1. Pick 5 random keys (default sample size)
  2. Check their idle time (last access timestamp)
  3. Evict the one with the LONGEST idle time
  4. Repeat until enough memory is freed

  ┌── Real LRU ────────────────────────────────────────────────────────┐
  │  Scan ALL 1,000,000 keys → find the one idle longest → evict     │
  │  ✅ Perfect accuracy   ❌ O(n) time   ❌ Huge memory overhead    │
  └────────────────────────────────────────────────────────────────────┘

  ┌── Redis Approximate LRU ───────────────────────────────────────────┐
  │  Sample 5 random keys → find the one idle longest → evict         │
  │  ⚠️ ~95% accuracy    ✅ O(1) time    ✅ Minimal overhead         │
  └────────────────────────────────────────────────────────────────────┘
```

### The Sample Size Tradeoff

```
  CONFIG SET maxmemory-samples 5    ← default (fast, ~95% accuracy)
  CONFIG SET maxmemory-samples 10   ← better accuracy (~98%), slightly slower
  CONFIG SET maxmemory-samples 20   ← near-perfect (~99.5%), slowest

  ┌── Visualization ───────────────────────────────────────────────────┐
  │                                                                     │
  │  Sample Size │ Accuracy │ CPU Cost │ Recommendation               │
  │──────────────│──────────│──────────│──────────────────────────────│
  │  1           │ ~60%     │ Lowest   │ Basically random!            │
  │  3           │ ~85%     │ Low      │ Acceptable                   │
  │  5           │ ~95%     │ Medium   │ Default. Good enough. ✅      │
  │  10          │ ~98%     │ Higher   │ Better, slightly slower      │
  │  20          │ ~99.5%   │ Highest  │ Diminishing returns          │
  │                                                                     │
  │  Redis's default of 5 is excellent for almost all workloads.      │
  │  Increasing to 10 gives marginal improvement at noticeable cost.  │
  │  Don't touch this unless you have profiling data showing need.    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Each Key Stores a Timestamp — 24 Bits

```
  Every Redis key stores a 24-bit timestamp of its last access:

  24 bits = 16,777,216 possible values
  Resolution: ~1 second granularity
  Wraps around: every ~194 days

  Memory cost per key: 24 bits = 3 bytes
  For 1 million keys: 3 MB overhead (negligible)

  This is why Redis can do approximate LRU efficiently —
  it only needs 3 extra bytes per key, not a full linked list.
```

---

<a id="chapter-11-sizing"></a>
## 📊 Chapter 11: Sizing Your Cache — Back-of-Envelope Math

### Step-by-Step Sizing for Your TinyURL

```
  STEP 1: Estimate size per cached item
  ──────────────────────────────────────
  Key:     "url:" + Base62 shortKey     ≈ 4 + 8  = 12 bytes
  Value:   Average original URL         ≈ 60 bytes
  Redis internal overhead per key       ≈ 70 bytes (dict entry, expiry, etc.)
  ─────────────────────────────────────────────────
  Total per cached URL:                 ≈ 142 bytes (~150 bytes with padding)


  STEP 2: Estimate other key types
  ────────────────────────────────
  Rate limit keys:
  Key:   "ratelimit:redirect:1.2.3.4:12345" ≈ 40 bytes
  Value: Counter string "42"                  ≈ 5 bytes
  Overhead:                                   ≈ 70 bytes
  Total per rate limit key:                   ≈ 115 bytes

  Stream entries (stream:clicks):
  Per message: ~200 bytes (fields + values)
  Pending messages (before worker ACKs): ~1000 at peak
  Stream overhead: 1000 × 200 = ~200 KB


  STEP 3: Calculate target memory
  ──────────────────────────────────
  Goal: Cache the top 1 million URLs
  URL cache:        1,000,000 × 150 bytes = 150 MB
  Rate limit keys:  10,000 × 115 bytes    = 1.15 MB  (negligible)
  Stream buffer:                           = 0.2 MB   (negligible)
  Redis system overhead:                   = ~10 MB
  ──────────────────────────────────────────────────
  Total:                                    ≈ 162 MB


  STEP 4: Add headroom (20-30%)
  ──────────────────────────────
  162 MB × 1.3 = ~210 MB

  RECOMMENDATION: Set maxmemory to 256 MB
  (Nice round number, gives you buffer for growth)
```

### The Sizing Table for Different Scales

```
  ┌────────────────────────────────────────────────────────────────┐
  │  Cached URLs  │ URL Memory │ + Overhead │ Recommended maxmemory│
  │───────────────│────────────│────────────│──────────────────────│
  │  10,000       │ 1.5 MB     │ 15 MB      │ 32 MB               │
  │  100,000      │ 15 MB      │ 30 MB      │ 64 MB               │
  │  500,000      │ 75 MB      │ 100 MB     │ 128 MB              │
  │  1,000,000    │ 150 MB     │ 170 MB     │ 256 MB  ← yours ✅  │
  │  5,000,000    │ 750 MB     │ 820 MB     │ 1 GB                │
  │  10,000,000   │ 1.5 GB     │ 1.6 GB     │ 2 GB                │
  └────────────────────────────────────────────────────────────────┘
```

### The Hit Rate vs Memory Tradeoff

```
  "Should I cache 100K URLs or 1M URLs?"

  URL access follows a POWER LAW (Zipf distribution):
  The top 1% of URLs get ~50% of all clicks.
  The top 10% get ~80%.
  The top 20% get ~95%.

  ┌── Cache Size vs Hit Rate ───────────────────────────────────────┐
  │                                                                  │
  │  Hit Rate (%)                                                    │
  │  100│                                    ___________________    │
  │   95│                         __________/                       │
  │   90│              __________/                                   │
  │   80│        _____/                                              │
  │   70│    ___/                                                    │
  │   50│ __/                                                        │
  │   30│/                                                           │
  │     └──────────────────────────────────────────── Cache Size    │
  │     10K    50K   100K   500K    1M     5M    10M                │
  │                                                                  │
  │  Diminishing returns! Going from 100K to 1M cache entries       │
  │  improves hit rate from 80% to 95%. But going from 1M to 10M  │
  │  only improves from 95% to 99%. 10x memory for 4% improvement. │
  │                                                                  │
  │  The SWEET SPOT for most apps: cache the top 20% of keys.      │
  │  If you have 5M URLs, cache ~1M for ~95% hit rate. ✅           │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-12-your-tinyurl"></a>
## 🛠️ Chapter 12: Your TinyURL — Configuration & Recommendations

### Current State — The Gap

Your [`docker-compose.yml`](file:///c:/Users/TARUN/Desktop/TinyURL/infra/docker-compose.yml):

```yaml
redis:
  image: redis:7-alpine
  container_name: TinyURL-Redis
  restart: unless-stopped
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  # ⚠️ NO maxmemory configured!
  # ⚠️ NO eviction policy configured!
  # Redis will grow unbounded until OOM kill! 💀
```

### The Fix — Add Eviction Configuration

```yaml
# RECOMMENDED configuration:
redis:
  image: redis:7-alpine
  container_name: TinyURL-Redis
  restart: unless-stopped
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
  #        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  #        THIS IS THE FIX!
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
```

### Why `allkeys-lru` for Your TinyURL

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  Policy tested against your TinyURL's access patterns:            │
  │                                                                     │
  │  allkeys-lru ✅ RECOMMENDED                                       │
  │  • Your URLs are accessed in viral bursts (temporal locality)     │
  │  • Recently clicked URLs are likely to be clicked again soon      │
  │  • Dead URLs naturally fall off (haven't been accessed)           │
  │  • Simple, proven, industry default                                │
  │                                                                     │
  │  allkeys-lfu ⚠️ GOOD ALTERNATIVE                                  │
  │  • Would work, but LFU's counter decay adds slight CPU overhead  │
  │  • Better if you had "evergreen" URLs with steady traffic        │
  │  • Slightly harder to reason about                                 │
  │                                                                     │
  │  volatile-lru ⚠️ WORKS BUT RISKY                                  │
  │  • All your url: keys have TTL, so they're all eligible ✅       │
  │  • BUT stream:clicks has no TTL — it's protected ✅               │
  │  • Risk: if you add new key types without TTL, they're protected │
  │    even if you WANT them evictable. Implicit, not explicit.       │
  │                                                                     │
  │  noeviction ❌ DANGEROUS                                           │
  │  • Your current implicit default!                                  │
  │  • When memory fills: SET/XADD commands fail with OOM error       │
  │  • New URLs can't be cached. Analytics events are dropped.        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-13-monitoring"></a>
## 📡 Chapter 13: Monitoring & Alerting on Eviction

### Redis CLI Commands for Eviction Health

```bash
# Connect to your Redis
docker exec -it TinyURL-Redis redis-cli

# ── CHECK CONFIGURATION ──────────────────────────────────

# What's the memory limit?
CONFIG GET maxmemory
# → "maxmemory" "268435456"  (256 MB in bytes)
# → "maxmemory" "0"          (0 = NO LIMIT! ⚠️)

# What's the eviction policy?
CONFIG GET maxmemory-policy
# → "maxmemory-policy" "allkeys-lru"  ← good! ✅
# → "maxmemory-policy" "noeviction"   ← dangerous! ⚠️

# What's the sample size?
CONFIG GET maxmemory-samples
# → "maxmemory-samples" "5"  ← default, good ✅


# ── CHECK CURRENT MEMORY ─────────────────────────────────

INFO memory
# Look for:
# used_memory_human: 45.23M      ← current usage
# maxmemory_human: 256.00M       ← configured limit
# mem_fragmentation_ratio: 1.12  ← should be close to 1.0

# Quick percentage:
# 45.23 / 256 = 17.7% used. Plenty of headroom. ✅


# ── CHECK EVICTION STATS ─────────────────────────────────

INFO stats
# Look for:
# evicted_keys: 0          ← no evictions yet (good, cache isn't full)
# evicted_keys: 125000     ← evictions happening (cache is at max capacity)
#                             Not necessarily bad — it means LRU is working!
# evicted_keys: 5000000    ← massive evictions! Cache is way too small.
#                             Your hit rate is suffering. Add more memory! ⚠️

# keyspace_hits: 9500000   ← cache hits
# keyspace_misses: 500000  ← cache misses
# Hit rate: 9.5M / (9.5M + 0.5M) = 95% ✅


# ── CHECK INDIVIDUAL KEY IDLE TIME ───────────────────────

OBJECT IDLETIME url:abc123
# → (integer) 3600   ← idle for 3600 seconds (1 hour)
# → (integer) 5      ← idle for 5 seconds (hot key!)

# Check LFU frequency counter:
OBJECT FREQ url:abc123
# → (integer) 15   ← logarithmic access frequency
# (Only available when LFU policy is active)
```

### Prometheus Metrics for Eviction

```
  ADD THESE TO YOUR GRAFANA DASHBOARD:

  ┌── ALERT: High Eviction Rate ─────────────────────────────────────┐
  │                                                                    │
  │  Metric: redis_evicted_keys_total (rate over 5 minutes)           │
  │  Threshold: > 1000 evictions/minute for 10 minutes               │
  │  Severity: Warning                                                 │
  │  Action: Consider increasing maxmemory or optimizing key sizes   │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘

  ┌── ALERT: Memory Near Limit ──────────────────────────────────────┐
  │                                                                    │
  │  Metric: redis_memory_used_bytes / redis_memory_max_bytes        │
  │  Threshold: > 90% for 5 minutes                                  │
  │  Severity: Warning                                                 │
  │  Action: Check for key leaks, review TTL settings                │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘

  ┌── ALERT: Hit Rate Drop ──────────────────────────────────────────┐
  │                                                                    │
  │  Metric: keyspace_hits / (keyspace_hits + keyspace_misses)       │
  │  Threshold: < 80% for 10 minutes                                 │
  │  Severity: Critical                                                │
  │  Action: Check if Redis restarted (cold cache) or if eviction   │
  │          is too aggressive (cache too small)                      │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-14-cheat-sheet"></a>
## 📋 Chapter 14: Quick Reference Cheat Sheet

### All 8 Policies — One-Page Summary

| Policy | Scope | Algorithm | Best For |
|:--|:--|:--|:--|
| `allkeys-lru` | All keys | Least recently used | **General caching (YOUR BEST CHOICE ✅)** |
| `allkeys-lfu` | All keys | Least frequently used | Steady/evergreen access patterns |
| `allkeys-random` | All keys | Random | No access pattern / simple workloads |
| `volatile-lru` | TTL keys only | Least recently used | Mixed cache + persistent data |
| `volatile-lfu` | TTL keys only | Least frequently used | Mixed data, steady access |
| `volatile-random` | TTL keys only | Random | Mixed data, no pattern |
| `volatile-ttl` | TTL keys only | Shortest TTL first | Varied TTLs, expire-first logic |
| `noeviction` | N/A | Refuse writes | Redis as primary store (not cache) |

### Decision Flowchart

```
  Is Redis a CACHE (backed by a database)?

  ├── YES (your TinyURL)
  │   ├── Do you have keys WITHOUT TTL that must NEVER be evicted?
  │   │   ├── YES → volatile-lru (protects no-TTL keys)
  │   │   └── NO → allkeys-lru ✅ (simplest, most effective)
  │   │
  │   └── Do your URLs have steady, evergreen access (not bursty)?
  │       ├── YES → allkeys-lfu (better for steady patterns)
  │       └── NO → allkeys-lru ✅ (better for bursty/viral)
  │
  └── NO (Redis is primary data store)
      └── noeviction (refuse writes, don't lose data)
```

### Configuration Quick Reference

```bash
# Set via docker-compose command:
command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

# Set via redis.conf file:
maxmemory 256mb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Set at runtime (no restart needed!):
CONFIG SET maxmemory 268435456          # 256 MB in bytes
CONFIG SET maxmemory-policy allkeys-lru
CONFIG SET maxmemory-samples 5

# Verify:
CONFIG GET maxmemory
CONFIG GET maxmemory-policy
INFO memory
INFO stats | grep evicted
```

### Eviction vs Expiration vs Invalidation

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  CONCEPT        │ WHAT             │ WHO TRIGGERS   │ WHY          │
  │─────────────────│──────────────────│────────────────│──────────────│
  │  EVICTION       │ Remove key to    │ Redis          │ Memory full  │
  │                 │ free memory       │ (automatic)    │              │
  │                 │                  │                │              │
  │  EXPIRATION     │ Remove key       │ Redis          │ TTL expired  │
  │  (TTL)          │ after time limit │ (automatic)    │              │
  │                 │                  │                │              │
  │  INVALIDATION   │ Remove key       │ Your code      │ Data changed │
  │                 │ because data     │ (redis.del())  │ in database  │
  │                 │ changed           │                │              │
  │                 │                  │                │              │
  │  All three REMOVE keys. The difference is WHY and WHO.            │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 🎓 Final Mental Model

```
  Cache eviction is INVENTORY MANAGEMENT for your Redis warehouse:

  📦 Your warehouse (Redis) has limited shelf space (RAM).
  📦 New products (URLs) arrive constantly.
  📦 Old products that nobody buys should be removed.
  📦 The eviction policy is your inventory manager's strategy:

  LRU:    "Remove the product nobody's looked at in the longest time."
  LFU:    "Remove the product with the fewest total sales ever."
  Random: "Close your eyes and pull one off the shelf."
  TTL:    "Remove the one closest to its expiration date."
  None:   "The warehouse is full. Stop accepting deliveries."

  The right manager depends on your customers' shopping patterns.
  For a URL shortener with viral traffic:
  LRU is the perfect inventory manager. ✅

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Eviction isn't a failure — it's a FEATURE.                     │
  │  It means your cache is working at maximum efficiency,          │
  │  automatically keeping the hottest data and discarding the rest.│
  │  A cache that never evicts is either too large or too small.    │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

> **The best eviction policy is the one you configure and forget. Set `allkeys-lru` with a sensible `maxmemory`, monitor `evicted_keys`, and let Redis do what it does best — manage memory automatically so your application doesn't have to.**

---

*This guide is part of the TinyURL system design documentation. See also: [CAP Theorem](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/CAP_Theorem.md) · [Caching Strategies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/caching_strategies.md) · [Cache Invalidation](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/cache_invalidation.md)*
