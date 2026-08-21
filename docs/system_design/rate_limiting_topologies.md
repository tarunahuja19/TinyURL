# 🏟️ The Complete Guide to Rate Limiting Topologies

> *"Rate limiting isn't just an algorithm — it's an architecture decision. WHERE you count, WHO you count, WHERE you store the count, and WHAT you're protecting — each axis is a design choice that shapes your system's fairness, resilience, and performance."*

This guide teaches you **everything** about rate limiting topologies — the four axes of design decisions (identity, storage, execution layer, scope), how each choice affects your system under real-world attack patterns, and exactly how your TinyURL's topology was chosen and how it evolves.

---

## 📖 Table of Contents

1. [Chapter 1: What Is a Topology? — Beyond the Algorithm](#chapter-1-what-is-topology)
2. [Chapter 2: Axis 1 — Identity (WHO Are We Counting?)](#chapter-2-identity)
3. [Chapter 3: Axis 2 — Storage (WHERE Is the Counter?)](#chapter-3-storage)
4. [Chapter 4: Axis 3 — Execution Layer (WHERE Does the Check Run?)](#chapter-4-execution-layer)
5. [Chapter 5: Axis 4 — Scope (WHAT Are We Protecting?)](#chapter-5-scope)
6. [Chapter 6: Your TinyURL's Topology — The Complete Map](#chapter-6-your-tinyurl)
7. [Chapter 7: Multi-Tier Rate Limiting — Defense in Depth](#chapter-7-multi-tier)
8. [Chapter 8: Distributed Rate Limiting — The Multi-Region Problem](#chapter-8-distributed)
9. [Chapter 9: Rate Limiting Under Attack — DDoS Scenarios](#chapter-9-ddos)
10. [Chapter 10: Evolution Path — How Your Topology Grows](#chapter-10-evolution)
11. [Chapter 11: Interview Framework — Discussing Rate Limiting](#chapter-11-interview)
12. [Chapter 12: Quick Reference Cheat Sheet](#chapter-12-cheat-sheet)

---

<a id="chapter-1-what-is-topology"></a>
## 📕 Chapter 1: What Is a Topology? — Beyond the Algorithm

### The Concert Stadium Story

```
  You're managing crowd control for a 100,000-person concert.
  Your algorithm is "count to a limit and reject."
  But that algorithm alone doesn't answer these questions:

  ┌── THE 4 QUESTIONS OF TOPOLOGY ─────────────────────────────────────┐
  │                                                                     │
  │  1. IDENTITY: "How do we identify each person?"                    │
  │     By their face? Their tour bus? Their ticket?                   │
  │     → IP address? User account? API key?                          │
  │                                                                     │
  │  2. STORAGE: "Where does the guard keep the count?"               │
  │     In their own notebook? On a shared radio system?              │
  │     → In-process memory? Redis? Database?                         │
  │                                                                     │
  │  3. EXECUTION LAYER: "Where are the checkpoints?"                 │
  │     At the highway exit? At the venue door? At the VIP lounge?    │
  │     → Edge/CDN? API Gateway? Application middleware?              │
  │                                                                     │
  │  4. SCOPE: "What exactly are we limiting?"                         │
  │     Total people in the stadium? Per room? Per attraction?        │
  │     → Global? Per route? Per resource? Per tenant?                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  The ALGORITHM (Token Bucket, Sliding Window, etc.) decides HOW to count.
  The TOPOLOGY decides WHO, WHERE, and WHAT to count.
  Both are equally important.
```

---

<a id="chapter-2-identity"></a>
## 📗 Chapter 2: Axis 1 — Identity (WHO Are We Counting?)

### The Three Identity Strategies

```
  ┌── STRATEGY 1: IP Address ──────────────────────────────────────────┐
  │                                                                     │
  │  🚌 THE TOUR BUS ANALOGY:                                         │
  │  "No more than 10 people from any single tour bus per minute."    │
  │  The bus license plate is the IP address.                          │
  │                                                                     │
  │  Your code:                                                        │
  │  const clientIp = req.headers['x-forwarded-for']                  │
  │      ?.split(',')[0].trim() || req.ip;                            │
  │  const key = `ratelimit:${options.name}:${clientIp}`;             │
  │                                                                     │
  │  ✅ Zero setup — works without accounts/auth                      │
  │  ✅ Catches most casual abuse instantly                            │
  │                                                                     │
  │  ❌ SHARED IP PROBLEM (NAT):                                       │
  │  An entire office, school, or mobile carrier shares ONE public IP.│
  │  One bad user exhausts the limit → 1,000 innocent coworkers       │
  │  are locked out. This is called "collateral damage."              │
  │                                                                     │
  │  ❌ VPN/PROXY BYPASS:                                              │
  │  Attacker uses 100 different VPN IPs = 100 fresh quotas.          │
  │  Your limit of 10/min becomes 1,000/min for the attacker.        │
  │                                                                     │
  │  WHEN TO USE: Public APIs without authentication (your TinyURL!)  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── STRATEGY 2: User Account / API Key ──────────────────────────────┐
  │                                                                     │
  │  🎫 THE PERSONAL TICKET ANALOGY:                                   │
  │  "Each ticket holder can enter 10 times per minute, regardless    │
  │   of which gate they use or which bus they arrived on."           │
  │                                                                     │
  │  Code:                                                              │
  │  const identity = req.user?.apiKey ?? req.ip;                     │
  │  const key = `ratelimit:${options.name}:${identity}`;             │
  │                                                                     │
  │  ✅ Fair — each user gets their own quota                         │
  │  ✅ Secure — can't bypass by switching VPNs                       │
  │  ✅ Tiered limits — free users: 10/min, premium: 1000/min        │
  │                                                                     │
  │  ❌ Requires authentication (can't use for public anonymous APIs) │
  │  ❌ Account farming — attacker creates 100 free accounts          │
  │     = 100 × 10 = 1,000/min (mitigated with CAPTCHA/email verify) │
  │                                                                     │
  │  WHEN TO USE: APIs with login/signup (Stripe, GitHub, Twitter)    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── STRATEGY 3: Compound Identity ───────────────────────────────────┐
  │                                                                     │
  │  🎫🚌 THE TICKET + BUS COMBO:                                     │
  │  "Each ticket holder can enter 10 times per minute, AND           │
  │   no single tour bus can send more than 50 people per minute."    │
  │                                                                     │
  │  Code:                                                              │
  │  // Layer 1: Per-IP (coarse)                                      │
  │  const ipKey = `ratelimit:ip:${clientIp}`;                        │
  │  // Layer 2: Per-User (fine)                                      │
  │  const userKey = `ratelimit:user:${req.user.apiKey}`;             │
  │  // Both must pass!                                                │
  │                                                                     │
  │  ✅ Catches VPN-hoppers AND shared-IP abuse                       │
  │  ✅ Defense in depth — two independent layers                     │
  │                                                                     │
  │  WHEN TO USE: High-security APIs (payment processors, auth)      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-3-storage"></a>
## 📘 Chapter 3: Axis 2 — Storage (WHERE Is the Counter?)

### Option 1: In-Process Memory (Local Map)

```
  🔴 THE SEPARATE NOTEBOOKS PROBLEM:

  You run 4 app server instances behind a load balancer.
  Each server keeps its own count in a JavaScript Map.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Attacker: IP 1.2.3.4, limit = 10/min                          │
  │                                                                  │
  │  Load Balancer (round-robin):                                   │
  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
  │  │Server A │  │Server B │  │Server C │  │Server D │           │
  │  │Count: 3 │  │Count: 3 │  │Count: 2 │  │Count: 2 │           │
  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
  │                                                                  │
  │  Total requests: 3 + 3 + 2 + 2 = 10 ← OVER LIMIT!             │
  │  But each server thinks: "Only 2-3 requests. Under limit." ✅  │
  │  NOBODY rejects the attacker! 💀                                │
  │                                                                  │
  │  Effective limit: 10 × 4 servers = 40 requests/min              │
  │  (4x the intended limit!)                                        │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ✅ Pros: Zero latency, zero network calls, simplest implementation
  ❌ Cons: Limits multiply by number of instances. Useless at scale.
  USE: Development only. Single-instance hobby projects.
```

### Option 2: Centralized Store (Redis) ← Your Choice

```
  ✅ THE SHARED WALKIE-TALKIE:

  All 4 servers check the SAME Redis counter.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Attacker: IP 1.2.3.4, limit = 10/min                          │
  │                                                                  │
  │  Load Balancer:                                                  │
  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
  │  │Server A │  │Server B │  │Server C │  │Server D │           │
  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
  │       │            │            │            │                   │
  │       └────────────┴─────┬──────┴────────────┘                  │
  │                          │                                       │
  │                   ┌──────┴──────┐                                │
  │                   │   REDIS     │                                │
  │                   │  Count: 10  │ ← OVER LIMIT! BLOCKED! ✅    │
  │                   └─────────────┘                                │
  │                                                                  │
  │  Regardless of which server receives the request,               │
  │  the SAME Redis counter is checked atomically.                  │
  │  No multiplication. Correct enforcement.                        │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ✅ Pros: Correct across unlimited server instances
  ✅ Pros: Survives app restarts (Redis persists the count)
  ❌ Cons: Network latency (~0.3 ms per check)
  ❌ Cons: Redis is a single point of failure
  USE: Any production system with multiple instances (YOUR TINYURL ✅)
```

### Option 3: Hybrid (Local + Centralized)

```
  THE SMART NOTEBOOK:
  Each server keeps a LOCAL cache of recent counts.
  Every N requests or every M seconds, it syncs with Redis.

  Pros: Reduces Redis calls by 80-90%
  Cons: Limits are slightly soft (may allow 10-15% overshoot)
  USE: Massive scale (100K+ RPS) where Redis is the bottleneck
```

---

<a id="chapter-4-execution-layer"></a>
## 📙 Chapter 4: Axis 3 — Execution Layer (WHERE Does the Check Run?)

### The Three Layers

```
  INTERNET TRAFFIC
       │
       ▼
  ┌─────────────────────┐
  │  LAYER 1: CDN/Edge  │  Cloudflare, AWS Shield
  │  (Continental wall)  │  Blocks entire botnets, DDoS floods
  │  Cost per rejection: │  ~0.001 ms (hardware-level)
  │  Handles: 10M+ RPS  │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │  LAYER 2: Gateway   │  Nginx, Envoy, API Gateway
  │  (City wall)         │  Blocks per-IP floods, WAF rules
  │  Cost per rejection: │  ~0.01 ms (C code, no JS)
  │  Handles: 100K+ RPS │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │  LAYER 3: App       │  Fastify + Redis (YOUR CODE)
  │  (Building door)     │  Per-route, per-user, business-logic limits
  │  Cost per rejection: │  ~0.3 ms (JS + Redis EVAL)
  │  Handles: 10K+ RPS  │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │  LAYER 4: Handler   │  Your route handler
  │  (The office desk)   │  Final business logic validation
  └─────────────────────┘
```

### Why Multiple Layers?

```
  "Why not just use the app layer for everything?"

  A DDoS attack sends 1,000,000 requests/second to your server.

  APP-LAYER ONLY:
  ┌────────────────────────────────────────────────────────────────────┐
  │  Each request:                                                      │
  │  1. TCP handshake:           ~1 ms   (Node.js accepts connection) │
  │  2. HTTP parse:              ~0.1 ms (Fastify parses headers)     │
  │  3. JSON body parse:         ~0.05 ms                              │
  │  4. Rate limit (Redis EVAL): ~0.3 ms                               │
  │  5. Send 429 response:       ~0.05 ms                              │
  │  ─────────────────────────────────────                              │
  │  Total per rejection:        ~1.5 ms                               │
  │                                                                      │
  │  At 1M RPS: 1,000,000 × 1.5 ms = 1,500 seconds of CPU time/sec  │
  │  You need 1,500 CPU cores just to SAY "NO"! 💀                    │
  │                                                                      │
  └────────────────────────────────────────────────────────────────────┘

  WITH EDGE + GATEWAY:
  ┌────────────────────────────────────────────────────────────────────┐
  │  Layer 1 (CDN):     Drops 900,000 known-bad IPs at hardware level│
  │  Layer 2 (Nginx):   Drops 90,000 exceeding 50 r/s per IP        │
  │  Layer 3 (App):     Handles 10,000 legitimate requests           │
  │                                                                      │
  │  Your app sees 10K RPS (manageable!) instead of 1M RPS.          │
  │  99% of attack traffic was absorbed before touching Node.js.     │
  └────────────────────────────────────────────────────────────────────┘
```

### Layer Comparison

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  LAYER       │ COST/REJECT│ PRECISION      │ THREAT LEVEL      │
  │──────────────│────────────│────────────────│───────────────────│
  │  CDN/Edge    │ ~0.001 ms  │ Crude          │ DDoS, botnets    │
  │  (Cloudflare)│            │ (IP blacklists)│                   │
  │              │            │                │                   │
  │  Gateway     │ ~0.01 ms   │ Moderate       │ Floods, scrapers │
  │  (Nginx)     │            │ (per-IP rate)  │                   │
  │              │            │                │                   │
  │  App         │ ~0.3 ms    │ Precise ✅      │ Business abuse   │
  │  (Fastify)   │            │ (per-route,    │ API quota limits  │
  │              │            │  per-user)     │                   │
  │                                                                  │
  │  RULE: Use ALL layers. Cheapest rejection first.                │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-5-scope"></a>
## 📒 Chapter 5: Axis 4 — Scope (WHAT Are We Protecting?)

### The Four Scopes

```
  ┌── SCOPE 1: Global ─────────────────────────────────────────────────┐
  │                                                                     │
  │  🌍 "No more than 5,000 people in the entire stadium."            │
  │                                                                     │
  │  Every IP, every route, everything shares ONE counter.             │
  │  Simple. Protects against total system overload.                   │
  │  But unfair: one popular route can consume the entire quota.      │
  │                                                                     │
  │  key = `ratelimit:global:${clientIp}`                              │
  │  limit = 1000/min                                                   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCOPE 2: Per-Route (YOUR CHOICE ✅) ─────────────────────────────┐
  │                                                                     │
  │  📍 "No more than 200 in the VIP lounge, 2,000 in general        │
  │      admission."                                                    │
  │                                                                     │
  │  Different limits per endpoint based on COST:                      │
  │  POST /api/shorten: 10/min  (expensive: DB write + ID gen)       │
  │  GET /:shortkey:    100/min (cheap: cache hit)                    │
  │                                                                     │
  │  key = `ratelimit:shorten:${clientIp}`  (limit: 10)               │
  │  key = `ratelimit:redirect:${clientIp}` (limit: 100)              │
  │                                                                     │
  │  WHY THIS IS BETTER:                                               │
  │  A user clicking 80 short links/min (GET) is normal browsing.     │
  │  A user creating 80 short links/min (POST) is suspicious abuse.   │
  │  Per-route lets you distinguish between harmless and harmful.      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCOPE 3: Per-Resource ───────────────────────────────────────────┐
  │                                                                     │
  │  💎 "No more than 50 fans around a single viral artist."          │
  │                                                                     │
  │  Limits requests to a specific SHORT URL, regardless of WHO:      │
  │  key = `ratelimit:resource:${shortKey}`                            │
  │  limit = 10000/min                                                  │
  │                                                                     │
  │  WHY: A viral link gets 100K clicks/sec. Even if each user        │
  │  is under THEIR limit, the aggregate load on the shard holding    │
  │  that specific key could overwhelm the database.                  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCOPE 4: Per-Tenant (Multi-tenant SaaS) ─────────────────────────┐
  │                                                                     │
  │  🏢 "Company A bought 1,000 API calls/min. Company B bought       │
  │      10,000 API calls/min."                                        │
  │                                                                     │
  │  key = `ratelimit:tenant:${req.tenant.id}`                         │
  │  limit = tenant.plan.rateLimit                                     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-6-your-tinyurl"></a>
## 📔 Chapter 6: Your TinyURL's Topology — The Complete Map

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │              YOUR TINYURL RATE LIMITING TOPOLOGY                   │
  │                                                                     │
  │  AXIS         │ YOUR CHOICE        │ WHY                          │
  │───────────────│────────────────────│──────────────────────────────│
  │               │                    │                              │
  │  Identity     │ IP-Based 🚌        │ Public tool, no accounts/   │
  │  (WHO)        │                    │ auth required. Anyone can   │
  │               │                    │ shorten a URL anonymously.  │
  │               │                    │                              │
  │  Storage      │ Centralized 📡     │ Redis — single source of   │
  │  (WHERE kept) │ (Redis)            │ truth. Correct even with    │
  │               │                    │ multiple app instances.     │
  │               │                    │                              │
  │  Execution    │ App-Level 🚪       │ Fastify preHandler hook.    │
  │  (WHERE runs) │ (Fastify+Redis)    │ Different limits per route. │
  │               │                    │                              │
  │  Scope        │ Per-Route 📍       │ POST /api/shorten: 10/min  │
  │  (WHAT)       │ Per-IP             │ GET /:shortkey: 100/min    │
  │               │                    │ Protects expensive writes.  │
  │               │                    │                              │
  │  Algorithm    │ Sliding Window     │ Ultra-low memory (2 keys), │
  │  (HOW)        │ Counter 📦         │ near-exact, Lua atomic.    │
  │               │                    │                              │
  │  Failure Mode │ Fail Open 🔓       │ If Redis is down, allow    │
  │               │                    │ requests through. AP choice.│
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-7-multi-tier"></a>
## 📚 Chapter 7: Multi-Tier Rate Limiting — Defense in Depth

### The Complete Funnel

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  TIER 1: CDN (Cloudflare / AWS Shield)                            │
  │  ─────────────────────────────────────                             │
  │  • Absorbs DDoS floods at the network edge                       │
  │  • Blocks known-bad IP ranges (botnets, data center IPs)         │
  │  • Challenge suspicious traffic with CAPTCHA                      │
  │  • Your TinyURL: NOT YET IMPLEMENTED (future)                    │
  │                                                                     │
  │  TIER 2: Reverse Proxy (Nginx / Envoy)                            │
  │  ──────────────────────────────────────                            │
  │  • Coarse per-IP rate limiting (50 req/s global)                  │
  │  • Connection limiting (max 20 concurrent per IP)                 │
  │  • WAF rules (block SQL injection, path traversal)               │
  │  • Your TinyURL: NOT YET IMPLEMENTED (future)                    │
  │                                                                     │
  │  TIER 3: Application Middleware (Fastify + Redis)                  │
  │  ─────────────────────────────────────────────────                 │
  │  • Fine-grained per-route limits                                   │
  │  • Sliding window counter via Lua                                  │
  │  • Business-logic-aware (write cost vs read cost)                 │
  │  • Your TinyURL: ✅ IMPLEMENTED (ratelimit.middleware.js)         │
  │                                                                     │
  │  TIER 4: Application Logic (Route Handler)                         │
  │  ──────────────────────────────────────────                        │
  │  • Final validation (schema, business rules)                      │
  │  • Single-flight deduplication (cache stampede protection)        │
  │  • Your TinyURL: ✅ IMPLEMENTED (single_flight.js)                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-8-distributed"></a>
## 📖 Chapter 8: Distributed Rate Limiting — The Multi-Region Problem

### The Challenge

```
  Your TinyURL grows to serve users globally.
  You deploy servers in US-East, EU-West, and Asia-Pacific.
  Each region has its own Redis instance.

  User in Singapore hits Asia-Pacific Redis: count = 5
  Same user VPNs to US: hits US-East Redis: count = 0
  Global limit = 10, but they can make 10 + 10 + 10 = 30 requests!

  ┌── SOLUTIONS ───────────────────────────────────────────────────────┐
  │                                                                     │
  │  OPTION 1: Single Global Redis                                    │
  │  ─────────────────────────────                                     │
  │  All regions talk to one Redis in US-East.                        │
  │  ✅ Perfectly accurate counts                                      │
  │  ❌ Asia requests pay ~150 ms latency to US Redis                 │
  │  ❌ Single point of failure for the entire planet                 │
  │                                                                     │
  │  OPTION 2: Local Redis + Periodic Sync                            │
  │  ─────────────────────────────────────                             │
  │  Each region has local Redis. Counters sync every 5 seconds.      │
  │  ✅ Low latency (local Redis)                                     │
  │  ⚠️ Approximate counts (may allow 10-20% overshoot)              │
  │  ❌ Complex sync logic                                             │
  │                                                                     │
  │  OPTION 3: Divide Quota Across Regions                            │
  │  ─────────────────────────────────────                             │
  │  User limit = 10/min globally.                                     │
  │  Allocate: US = 4, EU = 3, Asia = 3.                              │
  │  Each region enforces its local allocation.                       │
  │  ✅ No cross-region communication needed                          │
  │  ❌ Unfair if user only uses one region (wastes other quotas)     │
  │                                                                     │
  │  OPTION 4: Sticky Sessions                                        │
  │  ──────────────────────                                            │
  │  DNS routes each user to ALWAYS hit the same region.              │
  │  ✅ Simple. Each user has one Redis.                               │
  │  ❌ Doesn't prevent VPN-hopping to different regions              │
  │                                                                     │
  │  YOUR TINYURL (current): Single region, single Redis. Simple. ✅  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-9-ddos"></a>
## 📃 Chapter 9: Rate Limiting Under Attack — DDoS Scenarios

```
  ┌── SCENARIO 1: Simple Brute Force ──────────────────────────────────┐
  │  Attack:  1 IP sends 1,000 requests/second                       │
  │  Defense: Per-IP rate limit catches it at request #11             │
  │  Result:  989 requests/second rejected. Easy. ✅                   │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCENARIO 2: Distributed Attack (10,000 IPs) ────────────────────┐
  │  Attack:  Botnet uses 10,000 IPs, each sending 5 requests/second │
  │  Defense: Each IP is under the 10/min limit!                      │
  │  Result:  50,000 RPS all get through! Your app drowns. 💀        │
  │  Fix:     Edge-level CDN (Cloudflare) + connection limiting      │
  │           + behavior analysis (CAPTCHA challenges)                │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCENARIO 3: Slowloris Attack ────────────────────────────────────┐
  │  Attack:  Attacker opens 10,000 connections but sends data        │
  │           v e r y   s l o w l y, holding connections open         │
  │  Defense: Rate limiting doesn't help (low request rate!)          │
  │  Result:  All server connections exhausted. 💀                    │
  │  Fix:     Nginx connection timeout + limit_conn directive         │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── SCENARIO 4: Application-Layer Abuse ─────────────────────────────┐
  │  Attack:  Competitor creates 100 accounts, each making 9 req/min  │
  │  Defense: Per-user limits show 9 < 10 for each account. Pass!    │
  │  Result:  900 expensive DB writes/min from a single actor. 💀    │
  │  Fix:     Compound identity (per-IP + per-user)                   │
  │           + per-resource limits on hot URLs                       │
  │           + anomaly detection (machine learning)                  │
  └─────────────────────────────────────────────────────────────────────┘

  LESSON: No single layer stops every attack.
  Defense in depth = multiple layers, each catching different threats.
```

---

<a id="chapter-10-evolution"></a>
## 📈 Chapter 10: Evolution Path — How Your Topology Grows

```
  PHASE 1 (NOW): MVP
  ──────────────────
  Identity:  IP only
  Storage:   Single Redis
  Layer:     App middleware only
  Scope:     Per-route, per-IP
  Handles:   ~1,000 RPS

  PHASE 2: Add Nginx
  ──────────────────
  + Nginx in front (limit_req 50r/s, limit_conn 20)
  + WAF rules (block SQL injection patterns)
  + trustProxy: true in Fastify
  Handles:   ~10,000 RPS

  PHASE 3: Add Authentication
  ───────────────────────────
  + User accounts + API keys
  + Per-user limits (free: 10/min, premium: 1000/min)
  + Compound identity (IP + user)
  Handles:   ~50,000 RPS

  PHASE 4: Add CDN
  ────────────────
  + Cloudflare / AWS Shield in front
  + Bot detection, CAPTCHA challenges
  + Geo-blocking for known data-center ranges
  + DDoS absorption at the edge
  Handles:   ~1,000,000+ RPS

  PHASE 5: Global
  ────────────────
  + Multi-region deployment
  + Distributed rate limiting (quota division)
  + Per-tenant limits (if SaaS)
```

---

<a id="chapter-11-interview"></a>
## 📝 Chapter 11: Interview Framework — Discussing Rate Limiting

```
  When asked "Design a rate limiter" in an interview:

  STEP 1: Clarify requirements
  "Are we protecting a single service or multiple microservices?"
  "Is authentication available? Can I use API keys?"
  "What's the expected RPS? Thousands? Millions?"

  STEP 2: Discuss topology BEFORE algorithm
  "First, let me describe WHERE the rate limiting happens..."
  → Draw the multi-layer funnel (Edge → Gateway → App)
  → Explain identity options (IP vs user vs compound)
  → Discuss storage (centralized Redis vs local)

  STEP 3: Choose algorithm with justification
  "For this use case, sliding window counter because..."
  → Compare 2-3 algorithms briefly
  → Justify based on requirements (memory, accuracy, burst tolerance)

  STEP 4: Discuss failure modes
  "If Redis goes down, I'll fail open because..."
  → AP vs CP trade-off
  → Graceful degradation

  STEP 5: Discuss scaling
  "At 1M RPS, I'd add Cloudflare at the edge..."
  → Multi-region considerations
  → Distributed counting challenges
```

---

<a id="chapter-12-cheat-sheet"></a>
## 📋 Chapter 12: Quick Reference Cheat Sheet

### The Four Axes — Decision Matrix

| Axis | Options | Your TinyURL | When to Change |
|:--|:--|:--|:--|
| **Identity** | IP / User / API Key / Compound | IP-Based | When you add user accounts |
| **Storage** | In-process / Redis / Hybrid | Redis (centralized) | When Redis can't handle the RPS |
| **Layer** | CDN / Gateway / App | App (Fastify) | When DDoS attacks exceed app capacity |
| **Scope** | Global / Per-route / Per-resource / Per-tenant | Per-route, per-IP | When viral URLs overload single shards |

---

## 🎓 Final Mental Model

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Rate limiting is NOT just an algorithm.                        │
  │  It's a 4-dimensional design space:                             │
  │                                                                  │
  │  WHO    (Identity)    → IP / User / API Key                    │
  │  WHERE  (Storage)     → Local Map / Redis / Hybrid             │
  │  WHERE  (Layer)       → Edge / Gateway / App                   │
  │  WHAT   (Scope)       → Global / Route / Resource / Tenant     │
  │                                                                  │
  │  The algorithm (Token Bucket, Sliding Window) is just ONE      │
  │  dimension — HOW to count. The topology is the other four.     │
  │  Senior engineers discuss topology first, algorithm second.     │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

*This guide is part of the TinyURL system design documentation. See also: [Comparing Rate Limiting Algorithms](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/comparing_algorithms.md) · [Edge-Level Gateway Filtering](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/edge_level_gateway_filtering.md) · [Redis Lua Scripting](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/redis_lua_scripting.md)*
