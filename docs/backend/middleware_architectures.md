# 🚪 The Complete Guide to Middleware Architectures

> *"A middleware is a guard at a checkpoint. Your request is a traveler crossing a border. Each guard inspects, stamps, modifies, or rejects the traveler before they reach their destination. The power isn't in any one guard — it's in the pipeline: the ability to snap in, reorder, or remove guards without touching the destination itself."*

This guide teaches you **everything** about middleware — what it is, the pipeline model, every Fastify lifecycle hook, how your TinyURL uses middleware at every layer, how to compose them, the Express vs Fastify paradigm difference, and advanced patterns like short-circuiting, error propagation, and cross-cutting concerns.

---

## 📖 Table of Contents

1. [Chapter 1: What Is Middleware? — The Airport Security Analogy](#chapter-1-what-is-middleware)
2. [Chapter 2: The Pipeline Model — How Requests Flow](#chapter-2-pipeline)
3. [Chapter 3: Fastify's Lifecycle — The Complete Hook System](#chapter-3-fastify-lifecycle)
4. [Chapter 4: Your TinyURL's Middleware — Complete Map](#chapter-4-your-tinyurl)
5. [Chapter 5: Short-Circuiting — Rejecting Early](#chapter-5-short-circuit)
6. [Chapter 6: Composability — Stacking Middleware](#chapter-6-composability)
7. [Chapter 7: Global vs Per-Route Middleware](#chapter-7-global-vs-route)
8. [Chapter 8: The Middleware Factory Pattern — Higher-Order Functions](#chapter-8-factory)
9. [Chapter 9: Error Handling Middleware — The Safety Net](#chapter-9-errors)
10. [Chapter 10: Cross-Cutting Concerns — The Real Power](#chapter-10-cross-cutting)
11. [Chapter 11: Express vs Fastify Middleware — The Paradigm Shift](#chapter-11-express-vs-fastify)
12. [Chapter 12: Common Middleware Patterns in Production](#chapter-12-production)
13. [Chapter 13: Anti-Patterns — Middleware Gone Wrong](#chapter-13-anti-patterns)
14. [Chapter 14: Quick Reference Cheat Sheet](#chapter-14-cheat-sheet)

---

<a id="chapter-1-what-is-middleware"></a>
## 📕 Chapter 1: What Is Middleware? — The Airport Security Analogy

### ✈️ The Airport Story

You're flying internationally. Between entering the airport and boarding your plane, you pass through a sequence of **checkpoints**. Each checkpoint has a specific job, and they run **in order**:

```
  YOU (The HTTP Request) arrive at the airport terminal.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  CHECKPOINT 1: Ticket Counter 🎫                                   │
  │  "Do you have a valid ticket?"                                     │
  │  → Checks your booking. Stamps your boarding pass.                │
  │  → TinyURL equivalent: onRequest hook (log arrival, set req ID)   │
  │                                                                     │
  │  CHECKPOINT 2: Baggage Scanner 🧳                                  │
  │  "Let me scan your luggage."                                       │
  │  → Opens your bag (request body), checks for prohibited items.    │
  │  → TinyURL equivalent: preParsing (Fastify parses JSON body)      │
  │                                                                     │
  │  CHECKPOINT 3: Passport Control 🛂                                 │
  │  "Is your passport valid? Any visa issues?"                        │
  │  → Validates your identity documents.                              │
  │  → TinyURL equivalent: preValidation (schema validation)          │
  │                                                                     │
  │  CHECKPOINT 4: Security Screening 🔒                               │
  │  "Are you on the no-fly list? Have you flown too many times       │
  │   today?" (Rate limiting!)                                         │
  │  → If rejected: "Go home. Try again tomorrow." (429 response)     │
  │  → TinyURL equivalent: preHandler (rate limiter middleware)       │
  │                                                                     │
  │  CHECKPOINT 5: The Gate 🛫                                         │
  │  "Welcome aboard!" → Your route handler runs.                     │
  │  → TinyURL equivalent: route handler (shortenController)          │
  │                                                                     │
  │  CHECKPOINT 6: Customs on Arrival 🎒                               │
  │  "Let me check what you're bringing out."                          │
  │  → Inspects the response before it leaves.                        │
  │  → TinyURL equivalent: onSend (add response headers)              │
  │                                                                     │
  │  CHECKPOINT 7: Exit Log 📓                                         │
  │  "We'll record your departure time in our logs."                   │
  │  → Runs AFTER the response is sent to the client.                 │
  │  → TinyURL equivalent: onResponse (Prometheus metrics)            │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### The Formal Definition

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  MIDDLEWARE: A function that sits BETWEEN the raw HTTP request     │
  │  and your business logic (route handler). It can:                  │
  │                                                                     │
  │  1. INSPECT the request    (logging, validation)                   │
  │  2. MODIFY the request     (add headers, enrich data)             │
  │  3. REJECT the request     (rate limiting, authentication)        │
  │  4. INSPECT the response   (add CORS headers, compress)           │
  │  5. MEASURE timing         (Prometheus latency histograms)        │
  │                                                                     │
  │  The KEY PROPERTY: middleware is COMPOSABLE and REUSABLE.          │
  │  You can snap it onto any route without changing the handler.     │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-2-pipeline"></a>
## 📗 Chapter 2: The Pipeline Model — How Requests Flow

### The Conveyor Belt

```
  A middleware pipeline is a CONVEYOR BELT:
  The request enters on one side, passes through stations,
  and the response comes out the other side.

  REQUEST ──►[Station 1]──►[Station 2]──►[Station 3]──►[Handler]
                                                           │
  RESPONSE ◄──[Station 6]◄──[Station 5]◄──[Station 4]◄────┘

  Each station can:
  ✅ Let the item pass through (call next / return nothing)
  ❌ Yank it off the belt (send a response, short-circuit)
  ✏️ Modify the item (add headers, transform data)
```

### The Pipeline in Code

```javascript
// Conceptual model (simplified):

async function pipeline(request) {
    // PHASE 1: Request middleware (runs BEFORE handler)
    const req1 = await middleware1(request);   // Log arrival
    const req2 = await middleware2(req1);       // Parse body
    const req3 = await middleware3(req2);       // Validate schema
    const req4 = await middleware4(req3);       // Rate limit CHECK ← may reject!
    
    // PHASE 2: Route handler (YOUR business logic)
    const response = await handler(req4);      // Create short URL
    
    // PHASE 3: Response middleware (runs AFTER handler)
    const res1 = await middleware5(response);   // Add headers
    const res2 = await middleware6(res1);        // Record metrics
    
    return res2;  // Send to client
}
```

### Why Pipeline Order Matters

```
  ┌── CORRECT ORDER ────────────────────────────────────────────────────┐
  │                                                                      │
  │  1. onRequest:     Log request arrival          (free, instant)     │
  │  2. Parse body:    JSON.parse the request body  (cheap)             │
  │  3. Validate:      Check URL format             (cheap)             │
  │  4. Rate limit:    Check Redis counter          (network call)      │
  │  5. Handler:       Query DB, generate short URL (expensive!)        │
  │                                                                      │
  │  If rate limit rejects at step 4, we saved the EXPENSIVE step 5.   │
  │  We wasted zero DB connections on a rejected request. ✅             │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘

  ┌── WRONG ORDER ──────────────────────────────────────────────────────┐
  │                                                                      │
  │  1. onRequest:     Log request                                      │
  │  2. Parse body                                                       │
  │  3. Handler:       Query DB, generate short URL (expensive!)        │
  │  4. Rate limit:    Check Redis counter                               │
  │                                                                      │
  │  If rate limit rejects at step 4, we ALREADY wasted a DB query     │
  │  and generated a short URL for nothing! Resources burned. 💀        │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘

  RULE: Cheapest checks first. Most expensive work last.
```

---

<a id="chapter-3-fastify-lifecycle"></a>
## 📘 Chapter 3: Fastify's Lifecycle — The Complete Hook System

### Every Hook, In Order

Fastify defines a strict sequence of hooks. Each one runs at a specific point in the request's life:

```
  REQUEST ARRIVES
       │
       ▼
  ┌─────────────────┐
  │   onRequest      │ ① Fires FIRST. Body NOT parsed yet.
  │                   │   Your code: set req.startTime, add x-request-id
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   preParsing     │ ② Fires BEFORE body is parsed.
  │                   │   Good for: custom decompression, body transform
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   preValidation  │ ③ Body IS parsed, but NOT validated yet.
  │                   │   Good for: sanitizing inputs before schema check
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   preHandler     │ ④ Body parsed AND validated. Schema passed. ✅
  │                   │   Your code: RATE LIMITER lives here.
  │                   │   Because: body is valid, worth checking the limit
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   HANDLER        │ ⑤ YOUR ROUTE LOGIC. The main attraction.
  │                   │   Your code: shortenController, redirectController
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │  preSerialization│ ⑥ Response object exists but NOT serialized yet.
  │                   │   Good for: filtering sensitive fields from response
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   onSend         │ ⑦ Response IS serialized (string/Buffer).
  │                   │   Good for: final header modifications, compression
  └────────┬──────────┘
           ▼
  ┌─────────────────┐
  │   onResponse     │ ⑧ Response SENT to client. Connection may be closed.
  │                   │   Your code: Prometheus metrics (duration histogram)
  │                   │   Cannot modify response (already sent!)
  └────────┬──────────┘
           ▼
       DONE!


  ┌─────────────────┐
  │   onError        │ 🚨 Fires if ANY hook or handler throws.
  │                   │   Catches the error, formats it, sends clean response.
  └─────────────────┘
```

### Your Code Mapped to the Lifecycle

```
  ┌── YOUR APP.JS HOOKS ───────────────────────────────────────────────┐
  │                                                                     │
  │  app.addHook('onRequest', async (req, reply) => {                  │
  │      req.startTime = process.hrtime();      // ① Start the clock  │
  │      reply.header('x-request-id', req.id);  // ① Add correlation  │
  │  });                                                                │
  │                                                                     │
  │  // ② ③ — Fastify handles parsing + validation automatically      │
  │                                                                     │
  │  // ④ — Per-route preHandler:                                      │
  │  fastify.post('/api/shorten', {                                    │
  │      preHandler: rateLimit({ name: 'shorten', ... })               │
  │  }, shortenController);                                             │
  │                                                                     │
  │  // ⑤ — Route handler runs (shortenController)                     │
  │                                                                     │
  │  // ⑥ ⑦ — Not used (Fastify handles JSON serialization)            │
  │                                                                     │
  │  app.addHook('onResponse', async (req, reply) => {                 │
  │      const diff = process.hrtime(req.startTime);   // ⑧ Stop clock│
  │      const duration = diff[0] + diff[1] / 1e9;                    │
  │      httpRequestDurationHistogram.observe(..., duration);          │
  │      httpRequestCounter.inc(...);                                   │
  │  });                                                                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-4-your-tinyurl"></a>
## 📙 Chapter 4: Your TinyURL's Middleware — Complete Map

### Every Middleware in Your System

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │          YOUR TINYURL'S COMPLETE MIDDLEWARE PIPELINE                │
  │                                                                     │
  │  TYPE    │ HOOK        │ MIDDLEWARE       │ FILE                   │
  │──────────│─────────────│──────────────────│────────────────────────│
  │  Global  │ onRequest   │ Start timer +    │ app.js:18             │
  │          │             │ correlation ID   │                        │
  │          │             │                  │                        │
  │  Route   │ preHandler  │ Rate limiter     │ ratelimit.middleware.js│
  │  (POST)  │             │ (10 req/min)     │ shorten.route.js:4    │
  │          │             │                  │                        │
  │  Route   │ preHandler  │ Rate limiter     │ ratelimit.middleware.js│
  │  (GET)   │             │ (100 req/min)    │ redirect.route.js:4   │
  │          │             │                  │                        │
  │  Global  │ onResponse  │ Prometheus       │ app.js:23             │
  │          │             │ metrics          │                        │
  │                                                                     │
  │  Total: 2 global hooks + 2 per-route middleware                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### A POST /api/shorten Request — Step by Step

```
  ┌── STEP-BY-STEP: POST /api/shorten ─────────────────────────────────┐
  │                                                                     │
  │  1. HTTP arrives at Fastify                                        │
  │                                                                     │
  │  2. onRequest [GLOBAL] — app.js:18                                │
  │     ├── req.startTime = process.hrtime()    // Start timer         │
  │     └── reply.header('x-request-id', ...)   // Correlation ID      │
  │                                                                     │
  │  3. Fastify auto-parses JSON body                                  │
  │     └── req.body = { originalUrl: "https://google.com" }           │
  │                                                                     │
  │  4. preHandler [ROUTE] — ratelimit.middleware.js                   │
  │     ├── Extract client IP from x-forwarded-for header              │
  │     ├── redis.eval(luaScript, ...)  // Atomic rate limit check     │
  │     ├── Set X-RateLimit-Limit header (10)                          │
  │     ├── Set X-RateLimit-Remaining header (9)                       │
  │     ├── IF over limit:                                              │
  │     │   ├── Set Retry-After header                                 │
  │     │   └── reply.status(429).send({error: "Too many requests"})   │
  │     │       ↑ SHORT-CIRCUIT! Steps 5-7 never run. ⚡              │
  │     └── IF under limit: proceed to step 5                         │
  │                                                                     │
  │  5. HANDLER — shortenController                                    │
  │     ├── Generate Snowflake ID                                      │
  │     ├── Encode to Base62 short key                                 │
  │     ├── INSERT into PostgreSQL                                      │
  │     ├── SET into Redis cache                                       │
  │     └── reply.status(201).send({ short_url, shortKey })            │
  │                                                                     │
  │  6. Fastify auto-serializes JSON response                          │
  │                                                                     │
  │  7. onResponse [GLOBAL] — app.js:23                                │
  │     ├── Calculate request duration                                  │
  │     ├── httpRequestCounter.inc(...)                                 │
  │     └── httpRequestDurationHistogram.observe(...)                   │
  │                                                                     │
  │  8. Response sent to client ✅                                      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-5-short-circuit"></a>
## 📒 Chapter 5: Short-Circuiting — Rejecting Early

### The Security Guard Who Says "Go Home"

```
  In a pipeline, SHORT-CIRCUITING means stopping the conveyor belt
  and sending the request back WITHOUT reaching the handler.

  Normal flow:
  Request → [Guard 1 ✅] → [Guard 2 ✅] → [Guard 3 ✅] → [Handler] → Response

  Short-circuited flow:
  Request → [Guard 1 ✅] → [Guard 2 ❌ REJECTED!] ──────────────→ Response
                                                    ↑
                                          Handler never runs!
                                          No DB query! No CPU wasted!
```

### How Short-Circuiting Works in Fastify

```javascript
// Your ratelimit.middleware.js:
export function rateLimit(options) {
    return async function (req, reply) {
        const result = await checkRateLimit(key, options.windowSeconds, options.limit);

        reply.header('X-RateLimit-Limit', options.limit);
        reply.header('X-RateLimit-Remaining', result.remaining);

        if (!result.allowed) {
            reply.header('Retry-After', result.retryAfterSeconds);
            return reply.status(429).send({ error: 'Too many requests, slow down.' });
            //     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            //     This RETURN sends the response immediately.
            //     Fastify sees a response was sent and SKIPS the handler.
            //     The handler (shortenController) NEVER EXECUTES.
        }
        
        // If we reach here without returning, Fastify continues to the handler.
        // The absence of a return = "let the request through."
    };
}
```

### Why Short-Circuiting Saves Resources

```
  WITHOUT short-circuiting (rate limit after handler):
  ┌──────────────────────────────────────────────────────────────────┐
  │  1. Parse JSON body                          (~0.01 ms)         │
  │  2. Validate schema                          (~0.01 ms)         │
  │  3. Generate Snowflake ID                    (~0.001 ms)        │
  │  4. INSERT into PostgreSQL                   (~5-15 ms) ← WASTE │
  │  5. SET into Redis cache                     (~0.5 ms)  ← WASTE │
  │  6. Check rate limit: "Sorry, over limit!"   (~0.3 ms)          │
  │  7. Return 429                                                    │
  │                                                                    │
  │  Total wasted work: 5.5-15.5 ms of DB + cache operations        │
  │  for a request you're going to reject anyway! 💀                 │
  └──────────────────────────────────────────────────────────────────┘

  WITH short-circuiting (rate limit before handler):
  ┌──────────────────────────────────────────────────────────────────┐
  │  1. Parse JSON body                          (~0.01 ms)         │
  │  2. Validate schema                          (~0.01 ms)         │
  │  3. Check rate limit: "Sorry, over limit!"   (~0.3 ms)          │
  │  4. Return 429                                                    │
  │                                                                    │
  │  Total time: 0.32 ms. DB never touched. Perfect. ✅              │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-6-composability"></a>
## 📔 Chapter 6: Composability — Stacking Middleware

### The Power of Arrays

```javascript
// You can stack MULTIPLE middleware on a single route:
fastify.post('/api/shorten', {
    preHandler: [
        rateLimit({ name: 'shorten', windowSeconds: 60, limit: 10 }),  // Guard 1
        authenticate,                                                    // Guard 2
        validatePremiumPlan,                                            // Guard 3
    ]
}, shortenController);

// Execution order: Guard 1 → Guard 2 → Guard 3 → Handler
// If Guard 1 rejects → Guards 2, 3, and Handler never run.
// If Guard 2 rejects → Guard 3 and Handler never run.
```

### Composability Rules

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  RULE 1: ORDER = CHEAPEST FIRST, MOST EXPENSIVE LAST              │
  │  ──────                                                            │
  │  Rate limit (Redis: 0.3 ms) before Auth (DB: 5 ms).              │
  │  No point authenticating someone you're going to rate-limit.      │
  │                                                                     │
  │  RULE 2: EACH MIDDLEWARE IS INDEPENDENT                            │
  │  ──────                                                            │
  │  Each middleware does ONE thing. Don't combine rate limiting       │
  │  and authentication into one function. Keep them separate.         │
  │  This lets you mix and match per route.                            │
  │                                                                     │
  │  RULE 3: MIDDLEWARE COMMUNICATES VIA req                           │
  │  ──────                                                            │
  │  If Guard 1 discovers information (like the user's identity),     │
  │  it attaches it to req: req.userId = '42';                        │
  │  Guard 2 can then read req.userId.                                │
  │  The req object is the "backpack" the traveler carries.           │
  │                                                                     │
  │  RULE 4: DON'T MODIFY res AFTER SENDING                           │
  │  ──────                                                            │
  │  Once reply.send() is called, the response is going out.          │
  │  Trying to modify it after sending is undefined behavior.         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-7-global-vs-route"></a>
## 📚 Chapter 7: Global vs Per-Route Middleware

### The Two Scopes

```
  GLOBAL MIDDLEWARE (app.addHook):
  ────────────────────────────────
  Applies to EVERY request, regardless of route.
  Like the airport's MAIN ENTRANCE security — everyone passes through.

  Your TinyURL globals:
  • onRequest:  start timer + correlation ID    (every request)
  • onResponse: Prometheus metrics              (every request)


  PER-ROUTE MIDDLEWARE (route options):
  ─────────────────────────────────────
  Applies to ONE specific route only.
  Like the VIP LOUNGE door — only people going to that room are checked.

  Your TinyURL per-route:
  • POST /api/shorten:  rateLimit(10 req/min)   (creation only)
  • GET /:shortkey:     rateLimit(100 req/min)   (redirects only)
```

### When to Use Each

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  USE GLOBAL when:                                                   │
  │  ✅ Logging (every request should be logged)                        │
  │  ✅ Correlation IDs (every request needs one)                       │
  │  ✅ Metrics (every request should be measured)                      │
  │  ✅ CORS headers (every response needs them)                        │
  │  ✅ Security headers (helmet, every response)                       │
  │                                                                      │
  │  USE PER-ROUTE when:                                                │
  │  ✅ Rate limiting (different limits per endpoint)                   │
  │  ✅ Authentication (only protected routes need it)                  │
  │  ✅ Request validation (different schemas per route)                │
  │  ✅ Caching headers (different TTLs per route)                      │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-8-factory"></a>
## 📖 Chapter 8: The Middleware Factory Pattern — Higher-Order Functions

### Your Rate Limiter Is a Factory

```javascript
// rateLimit is NOT the middleware itself.
// rateLimit is a FACTORY that CREATES middleware.

export function rateLimit(options) {              // ← FACTORY (takes config)
    return async function (req, reply) {          // ← MIDDLEWARE (takes req/reply)
        const key = `ratelimit:${options.name}:${clientIp}`;
        const result = await checkRateLimit(key, options.windowSeconds, options.limit);
        // ...
    };
}

// Usage — the factory produces DIFFERENT middleware from the same template:
rateLimit({ name: 'shorten',  windowSeconds: 60, limit: 10  })  // Creates: shorten limiter
rateLimit({ name: 'redirect', windowSeconds: 60, limit: 100 })  // Creates: redirect limiter
```

### Why Factories Are Powerful

```
  WITHOUT factory pattern:
  ────────────────────────
  // You'd need separate middleware functions for each route:
  async function rateLimitShorten(req, reply) { /* 10 req/min */ }
  async function rateLimitRedirect(req, reply) { /* 100 req/min */ }
  async function rateLimitDelete(req, reply) { /* 5 req/min */ }
  // Duplicated logic! If you fix a bug, you fix it 3 times. 💀

  WITH factory pattern:
  ─────────────────────
  // One factory, infinite configurations:
  rateLimit({ name: 'shorten',  limit: 10  })    // Creates middleware A
  rateLimit({ name: 'redirect', limit: 100 })    // Creates middleware B
  rateLimit({ name: 'delete',   limit: 5   })    // Creates middleware C
  // Bug fix in rateLimit() fixes ALL three. ✅

  This is a HIGHER-ORDER FUNCTION:
  A function that RETURNS a function.
  The outer function configures. The inner function executes.
```

### The Closure — How Config Survives

```javascript
export function rateLimit(options) {
    //                     ↑ options is captured in CLOSURE
    return async function (req, reply) {
        //                 ↑ This function runs later (when a request arrives)
        //                   But it still has access to `options` from when
        //                   the factory was called!
        
        const key = `ratelimit:${options.name}:${clientIp}`;
        //                       ^^^^^^^^^^^^^^
        //                       options.name was captured at factory-call time
        //                       It's frozen in the closure. Immutable config. ✅
    };
}
```

---

<a id="chapter-9-errors"></a>
## 📃 Chapter 9: Error Handling Middleware — The Safety Net

### What Happens When Middleware Throws?

```
  If ANY hook or handler throws an uncaught error:

  Request → [onRequest ✅] → [preHandler 💥 THROWS!]
                                     │
                                     ▼
                              [onError handler]
                                     │
                                     ▼
                              500 Internal Server Error
                              { "error": "Something went wrong" }

  WITHOUT onError: Fastify sends a default 500 response.
  WITH onError: You control the error format, logging, and status code.
```

### Your Rate Limiter's Error Handling

```javascript
// rate_limiter.js — the try/catch IS error middleware:
export async function checkRateLimit(key, windowSeconds, limit) {
    try {
        const [remaining, retryAfter] = await redis.eval(script, 1, key, ...);
        return { allowed: retryAfter === 0, remaining, retryAfterSeconds: retryAfter };
    } catch (err) {
        // Redis is down! What do we do?
        console.error('Rate limiter Redis error, failing open:', err.message);
        return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
        //       ^^^^^^^^^^^^
        //       "Fail open" — allow the request through.
        //       AP trade-off: availability over rate-limit consistency.
    }
}
```

```
  WHY "fail open"?
  ────────────────
  If Redis is temporarily down, your choices are:

  FAIL CLOSED: Block ALL requests → entire site goes down 💀
  FAIL OPEN:   Allow ALL requests → rate limits bypassed temporarily ⚠️

  For a URL shortener, availability > strict rate limiting.
  A brief window without rate limits is less damaging than total downtime.
  This is a CAP Theorem trade-off (see your CAP Theorem guide).
```

---

<a id="chapter-10-cross-cutting"></a>
## 🔀 Chapter 10: Cross-Cutting Concerns — The Real Power

### What Are Cross-Cutting Concerns?

```
  A "cross-cutting concern" is something that affects MANY routes
  but isn't part of any route's core business logic.

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  CONCERN              │ AFFECTS    │ MIDDLEWARE SOLUTION            │
  │───────────────────────│────────────│────────────────────────────────│
  │  Logging              │ All routes │ Global onRequest hook         │
  │  Metrics              │ All routes │ Global onResponse hook        │
  │  Correlation IDs      │ All routes │ Global onRequest hook         │
  │  Rate limiting        │ Some routes│ Per-route preHandler          │
  │  Authentication       │ Some routes│ Per-route preHandler          │
  │  CORS                 │ All routes │ Global onSend hook            │
  │  Compression          │ All routes │ Global onSend hook            │
  │  Error formatting     │ All routes │ Global onError hook           │
  │                                                                     │
  │  WITHOUT middleware: you'd copy-paste these into EVERY handler.   │
  │  WITH middleware: write once, apply everywhere. ✅                  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Your onRequest + onResponse = Request Tracing

```javascript
// These two hooks together create a REQUEST TRACING SYSTEM:

// HOOK 1: Start the clock
app.addHook('onRequest', async (req, reply) => {
    req.startTime = process.hrtime();           // ← Timestamp IN
    reply.header('x-request-id', req.id);       // ← Unique ID for tracing
});

// ...handler runs... (could take 1 ms or 100 ms)

// HOOK 2: Stop the clock
app.addHook('onResponse', async (req, reply) => {
    const diff = process.hrtime(req.startTime); // ← Timestamp OUT
    const duration = diff[0] + diff[1] / 1e9;   // ← Duration in seconds
    httpRequestDurationHistogram.observe({...}, duration);
});

// Result: Every request's latency is recorded in Prometheus.
// You can graph p50, p95, p99 latency in Grafana.
// This is a CROSS-CUTTING CONCERN — applied to ALL routes with ZERO
// changes to any handler. The handlers don't even know they're being timed!
```

---

<a id="chapter-11-express-vs-fastify"></a>
## 📕 Chapter 11: Express vs Fastify Middleware — The Paradigm Shift

### Express: The next() Model

```javascript
// Express middleware uses an explicit next() callback:
function logRequest(req, res, next) {
    console.log(`${req.method} ${req.url}`);
    next();          // ← Explicitly call next() to continue the pipeline
                     //   If you forget next(), the request HANGS forever! 💀
}

function rateLimit(req, res, next) {
    if (isOverLimit(req.ip)) {
        return res.status(429).send('Too many requests');
        // NOT calling next() = short-circuit
    }
    next();  // ← Must call next() to proceed
}

app.use(logRequest);      // Global middleware
app.use(rateLimit);       // Global middleware
app.get('/api/shorten', handler);
```

### Fastify: The Hook/Return Model

```javascript
// Fastify middleware uses hooks and return values:
app.addHook('onRequest', async (req, reply) => {
    console.log(`${req.method} ${req.url}`);
    // No next()! Just return. Fastify moves to the next hook automatically.
});

// Short-circuiting uses reply.send() + return:
app.addHook('preHandler', async (req, reply) => {
    if (isOverLimit(req.ip)) {
        return reply.status(429).send('Too many requests');
        // reply.send() + return = short-circuit. No next() to forget. ✅
    }
    // No explicit "continue" — just don't send a reply and Fastify continues.
});
```

### The Key Differences

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  FEATURE           │ EXPRESS           │ FASTIFY                   │
  │────────────────────│───────────────────│───────────────────────────│
  │  Continue signal   │ next()            │ Return without sending    │
  │  Short-circuit     │ Don't call next() │ reply.send() + return     │
  │  Error handling    │ next(err)         │ throw or reply.send(err)  │
  │  Async support     │ Manual (callback) │ Native (async/await) ✅   │
  │  Hook granularity  │ before/after only │ 8 specific lifecycle      │
  │                    │                   │ hooks (fine-grained) ✅    │
  │  Encapsulation     │ Flat (global)     │ Plugin-scoped ✅           │
  │                                                                     │
  │  Fastify's approach is safer: you CAN'T forget next().            │
  │  If you forget to return, the request continues normally.          │
  │  No hanging requests from missing callbacks. ✅                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-12-production"></a>
## 📓 Chapter 12: Common Middleware Patterns in Production

### Patterns You'll See Everywhere

```
  ┌── PATTERN 1: Authentication Guard ─────────────────────────────────┐
  │                                                                     │
  │  async function authenticate(req, reply) {                         │
  │      const token = req.headers.authorization?.split(' ')[1];       │
  │      if (!token) return reply.status(401).send({error:'No token'});│
  │      try {                                                          │
  │          req.user = jwt.verify(token, SECRET);                     │
  │      } catch {                                                      │
  │          return reply.status(401).send({error:'Invalid token'});   │
  │      }                                                              │
  │  }                                                                  │
  │                                                                     │
  │  // Attaches req.user for downstream handlers to use               │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── PATTERN 2: Request Logger ───────────────────────────────────────┐
  │                                                                     │
  │  app.addHook('onResponse', async (req, reply) => {                 │
  │      req.log.info({                                                │
  │          method: req.method,                                       │
  │          url: req.url,                                             │
  │          statusCode: reply.statusCode,                             │
  │          responseTime: Date.now() - req.startTime                  │
  │      });                                                            │
  │  });                                                                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── PATTERN 3: CORS Headers ────────────────────────────────────────┐
  │                                                                     │
  │  app.addHook('onSend', async (req, reply, payload) => {           │
  │      reply.header('Access-Control-Allow-Origin', '*');             │
  │      reply.header('Access-Control-Allow-Methods', 'GET,POST');    │
  │      return payload;                                                │
  │  });                                                                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── PATTERN 4: Response Sanitizer ───────────────────────────────────┐
  │                                                                     │
  │  app.addHook('preSerialization', async (req, reply, payload) => {  │
  │      if (payload && payload.internalDbId) {                        │
  │          delete payload.internalDbId;  // Strip internal fields    │
  │      }                                                              │
  │      return payload;                                                │
  │  });                                                                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-13-anti-patterns"></a>
## ⚠️ Chapter 13: Anti-Patterns — Middleware Gone Wrong

```
  ┌── ANTI-PATTERN 1: Fat Middleware ──────────────────────────────────┐
  │                                                                     │
  │  ❌ BAD: Middleware that does EVERYTHING                           │
  │  async function megaMiddleware(req, reply) {                       │
  │      await checkRateLimit(req);                                    │
  │      await authenticateUser(req);                                  │
  │      await validatePremiumPlan(req);                               │
  │      await logToElasticsearch(req);                                │
  │      await checkMaintenanceMode(req);                              │
  │  }                                                                  │
  │                                                                     │
  │  ✅ GOOD: Split into focused, composable middleware                │
  │  preHandler: [rateLimit, authenticate, validatePlan]               │
  │  // Each can be reused independently on different routes           │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── ANTI-PATTERN 2: Expensive Global Middleware ─────────────────────┐
  │                                                                     │
  │  ❌ BAD: DB query on every request globally                        │
  │  app.addHook('onRequest', async (req) => {                         │
  │      req.user = await db.query('SELECT * FROM users WHERE ...');   │
  │  });                                                                │
  │  // Runs on /metrics, /health, /favicon.ico — wasted DB queries!  │
  │                                                                     │
  │  ✅ GOOD: Use per-route for expensive operations                   │
  │  fastify.get('/api/profile', { preHandler: authenticate }, ...)    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌── ANTI-PATTERN 3: Order-Dependent Silent Failures ─────────────────┐
  │                                                                     │
  │  ❌ BAD: Middleware assumes req.user exists without checking       │
  │  preHandler: [validatePlan, authenticate]  // WRONG ORDER!         │
  │  // validatePlan reads req.user, but authenticate hasn't run yet!  │
  │                                                                     │
  │  ✅ GOOD: Each middleware checks its own preconditions             │
  │  preHandler: [authenticate, validatePlan]  // Correct order        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-14-cheat-sheet"></a>
## 📋 Chapter 14: Quick Reference Cheat Sheet

### Fastify Hooks — Quick Reference

| Hook | Runs When | Body Parsed? | Can Short-Circuit? | Your Use |
|:--|:--|:--|:--|:--|
| `onRequest` | First, before anything | ❌ No | ✅ Yes | Timer + request ID |
| `preParsing` | Before body parsing | ❌ No | ✅ Yes | (not used) |
| `preValidation` | After parsing, before validation | ✅ Yes | ✅ Yes | (not used) |
| `preHandler` | After validation, before handler | ✅ Yes | ✅ Yes | **Rate limiter** |
| `handler` | The route logic | ✅ Yes | N/A | Controller |
| `preSerialization` | Before JSON.stringify | ✅ Yes | ✅ Yes | (not used) |
| `onSend` | After serialization | N/A (string) | ✅ Yes | (not used) |
| `onResponse` | After response sent | N/A | ❌ No | **Prometheus metrics** |
| `onError` | On any error | Depends | ✅ Yes | (Fastify default) |

### Decision Flowchart

```
  Where should my middleware go?

  ├── Does it apply to ALL routes?
  │   ├── YES → app.addHook('onRequest' or 'onResponse')
  │   └── NO  → Per-route: { preHandler: [myMiddleware] }
  │
  ├── Does it need the parsed request body?
  │   ├── YES → preHandler (runs after parsing + validation)
  │   └── NO  → onRequest (runs first, cheapest position)
  │
  ├── Can it reject the request?
  │   ├── YES → reply.status(4xx).send(...) + return
  │   └── NO  → Just attach data to req and return
  │
  └── Does it run AFTER the response?
      ├── YES → onResponse (can't modify response, only log/measure)
      └── NO  → Any earlier hook
```

---

## 🎓 Final Mental Model

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Middleware is SEPARATION OF CONCERNS applied to HTTP.          │
  │                                                                  │
  │  Your handler says: "I create short URLs."                     │
  │  It does NOT say: "I check rate limits, log requests,          │
  │  set correlation IDs, measure latency, or handle CORS."        │
  │                                                                  │
  │  Each of those responsibilities is a separate middleware        │
  │  function that you SNAP ONTO the pipeline like LEGO bricks.    │
  │                                                                  │
  │  Add auth? Snap a brick.                                        │
  │  Add rate limiting? Snap a brick.                               │
  │  Remove rate limiting for admins? Remove the brick.             │
  │  The handler never changes.                                     │
  │                                                                  │
  │  That's the power: your business logic is ISOLATED from        │
  │  your infrastructure concerns. They evolve independently.      │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

> **Middleware is the pipeline between "request arrives" and "business logic runs." The art is choosing what to check, in what order, and knowing when to reject early. Your TinyURL's rate limiter is a textbook example: it sits in preHandler, short-circuits with 429, and uses a factory pattern for per-route configuration.**

---

*This guide is part of the TinyURL backend documentation. See also: [Redis Lua Scripting](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/redis_lua_scripting.md) · [Caching Strategies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/caching_strategies.md) · [302 vs 301 Redirect](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/302_vs_301_redirect.md)*
