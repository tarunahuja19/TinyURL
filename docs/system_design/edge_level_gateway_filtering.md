# 🛡️ The Complete Guide to Edge-Level Gateway Filtering

> *"Your application server is a doctor's office. The patients (requests) walk in, sit down, and get examined. But what if 50,000 people rush the door at once? The doctor can only see 20 patients per hour. The waiting room collapses. Edge filtering is the security guard, parking lot, and traffic cop that keeps the queue manageable miles before anyone reaches the door."*

This guide teaches you **everything** about edge-level and gateway filtering — what the edge is, why app-level rejection is expensive, how Nginx/Envoy/Cloudflare drop bad traffic before it touches your code, concrete configuration for your TinyURL, the X-Forwarded-For proxy trap, WAF rules, DDoS defense layers, and how to evolve from app-only to multi-tier defense.

---

## 📖 Table of Contents

1. [Chapter 1: What Is the "Edge"? — The Security Perimeter](#chapter-1-what-is-edge)
2. [Chapter 2: Why App-Level Rejection Is Expensive](#chapter-2-app-level-cost)
3. [Chapter 3: The Defense Funnel — Layer by Layer](#chapter-3-funnel)
4. [Chapter 4: Nginx — Your Gateway (Complete Guide)](#chapter-4-nginx)
5. [Chapter 5: Connection-Level Controls — Limit_conn](#chapter-5-limit-conn)
6. [Chapter 6: Request-Level Controls — Limit_req](#chapter-6-limit-req)
7. [Chapter 7: WAF — Web Application Firewall Rules](#chapter-7-waf)
8. [Chapter 8: Geo-Blocking & IP Blacklists](#chapter-8-geo-blocking)
9. [Chapter 9: The X-Forwarded-For Trap — Critical!](#chapter-9-xff)
10. [Chapter 10: Your TinyURL — Complete Nginx + Docker Setup](#chapter-10-your-tinyurl)
11. [Chapter 11: CDN & Cloud Edge (Cloudflare / AWS Shield)](#chapter-11-cdn)
12. [Chapter 12: Quick Reference Cheat Sheet](#chapter-12-cheat-sheet)

---

<a id="chapter-1-what-is-edge"></a>
## 📕 Chapter 1: What Is the "Edge"? — The Security Perimeter

### 🏟️ The Stadium Analogy

```
  A concert venue has MULTIPLE layers of security,
  each positioned further from the stage:

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  🌊 THE INTERNET (millions of requests)                           │
  │       │                                                             │
  │       ▼                                                             │
  │  ┌─────────────────────────────────────────────┐                   │
  │  │  🛰️ CDN / Cloud Edge (Cloudflare)           │ LAYER 1          │
  │  │  "The Highway Checkpoint"                    │                   │
  │  │  • Absorbs DDoS at network level             │                   │
  │  │  • Blocks known botnet IP ranges             │                   │
  │  │  • CAPTCHA challenges for suspicious traffic │                   │
  │  │  • 10,000,000+ RPS capacity                  │                   │
  │  └──────────────────┬──────────────────────────┘                   │
  │                     ▼                                               │
  │  ┌─────────────────────────────────────────────┐                   │
  │  │  🚧 Reverse Proxy / Gateway (Nginx)          │ LAYER 2          │
  │  │  "The Parking Lot Security"                  │                   │
  │  │  • Per-IP rate limiting (50 req/s)           │                   │
  │  │  • Connection limiting (20 concurrent/IP)    │                   │
  │  │  • WAF rules (block SQL injection)           │                   │
  │  │  • SSL termination                            │                   │
  │  │  • 100,000+ RPS capacity                     │                   │
  │  └──────────────────┬──────────────────────────┘                   │
  │                     ▼                                               │
  │  ┌─────────────────────────────────────────────┐                   │
  │  │  🚪 Application (Fastify + Redis)            │ LAYER 3          │
  │  │  "The Ticket Scanner at the Door"            │                   │
  │  │  • Per-route, per-IP rate limiting            │                   │
  │  │  • Business logic validation                  │                   │
  │  │  • Sliding window counter via Lua             │                   │
  │  │  • 10,000+ RPS capacity                      │                   │
  │  └──────────────────┬──────────────────────────┘                   │
  │                     ▼                                               │
  │  ┌─────────────────────────────────────────────┐                   │
  │  │  🎧 Route Handler / Database                 │ LAYER 4          │
  │  │  "The Stage"                                 │                   │
  │  │  • PostgreSQL queries                         │                   │
  │  │  • Redis cache operations                     │                   │
  │  └─────────────────────────────────────────────┘                   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘

  THE EDGE = Layers 1 and 2.
  Everything that processes traffic BEFORE it reaches your application code.
```

---

<a id="chapter-2-app-level-cost"></a>
## 📗 Chapter 2: Why App-Level Rejection Is Expensive

### The Hidden Cost of Saying "No" in Fastify

```
  When your Fastify middleware rejects a request with 429,
  the request has ALREADY consumed significant resources:

  ┌── COST OF A 429 REJECTION IN YOUR APP ─────────────────────────────┐
  │                                                                     │
  │  STEP                           │ COST            │ CUMULATIVE    │
  │─────────────────────────────────│─────────────────│───────────────│
  │  1. TCP 3-way handshake         │ ~0.5 ms         │ 0.5 ms       │
  │     (SYN → SYN-ACK → ACK)      │ + socket alloc  │              │
  │                                 │                 │              │
  │  2. TLS handshake (if HTTPS)    │ ~2-5 ms         │ 3-5.5 ms    │
  │     (certificate exchange,      │ + CPU for       │              │
  │      key derivation)            │   crypto        │              │
  │                                 │                 │              │
  │  3. HTTP request parsing        │ ~0.05 ms        │ 3.05-5.55 ms│
  │     (Fastify parses headers,    │                 │              │
  │      method, URL)               │                 │              │
  │                                 │                 │              │
  │  4. JSON body parsing           │ ~0.05 ms        │ 3.1-5.6 ms  │
  │     (Fastify parses req.body)   │                 │              │
  │                                 │                 │              │
  │  5. Rate limit check (Redis)    │ ~0.3 ms         │ 3.4-5.9 ms  │
  │     (Network to Redis +         │                 │              │
  │      Lua EVAL execution)        │                 │              │
  │                                 │                 │              │
  │  6. 429 response serialization  │ ~0.05 ms        │ 3.45-5.95 ms│
  │     + send                      │                 │              │
  │                                 │                 │              │
  │  TOTAL per rejection:           │ ~3.5-6 ms       │              │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Under DDoS: The Numbers Get Scary

```
  A botnet sends 100,000 requests/second to your server.

  APP-ONLY DEFENSE:
  ┌────────────────────────────────────────────────────────────────────┐
  │  100,000 × 5 ms = 500,000 ms of CPU time per second             │
  │  = 500 CPU-seconds per real second                                │
  │  = 500 CPU cores JUST TO SAY "NO"!                               │
  │                                                                    │
  │  Plus:                                                              │
  │  • 100,000 TCP connections consuming socket buffers               │
  │  • 100,000 Redis EVAL commands/second (Redis at capacity)        │
  │  • V8 garbage collector thrashing from 100K temporary objects     │
  │  • Event loop completely blocked — legitimate users timeout      │
  │                                                                    │
  │  Your $20/month server is spending ALL its resources              │
  │  rejecting attack traffic. Zero capacity for real users. 💀      │
  └────────────────────────────────────────────────────────────────────┘

  WITH NGINX IN FRONT:
  ┌────────────────────────────────────────────────────────────────────┐
  │  Nginx handles 100,000 req/s with ~2 CPU cores (written in C).   │
  │  limit_req drops 90,000 immediately (under the limit: 10K pass). │
  │                                                                    │
  │  Your Fastify app sees 10,000 req/s (manageable).               │
  │  Of those 10K, your Lua script rejects 2,000 over-limit.        │
  │  8,000 legitimate requests are served. ✅                         │
  │                                                                    │
  │  Cost of Nginx rejection: ~0.01 ms (C code, no JS, no Redis)    │
  │  100,000 × 0.01 ms = 1,000 ms = 1 CPU-second (vs 500!)         │
  └────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-3-funnel"></a>
## 📘 Chapter 3: The Defense Funnel — Layer by Layer

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  100,000 requests/second (mixed: bots + legitimate users)      │
  │                                                                  │
  │  ┌──────────────────────────────────┐                            │
  │  │  LAYER 1: CDN (Cloudflare)       │ Drops 80K (known bots,   │
  │  │  Drops: 80%                      │ DDoS mitigation)         │
  │  └──────────────┬───────────────────┘                            │
  │                 │ 20,000 req/s pass through                     │
  │                 ▼                                                │
  │  ┌──────────────────────────────────┐                            │
  │  │  LAYER 2: Nginx                  │ Drops 10K (per-IP limit  │
  │  │  Drops: 50%                      │ exceeded, conn limit)    │
  │  └──────────────┬───────────────────┘                            │
  │                 │ 10,000 req/s pass through                     │
  │                 ▼                                                │
  │  ┌──────────────────────────────────┐                            │
  │  │  LAYER 3: Fastify + Redis        │ Drops 2K (per-route     │
  │  │  Drops: 20%                      │ limits exceeded)         │
  │  └──────────────┬───────────────────┘                            │
  │                 │ 8,000 req/s reach handler                     │
  │                 ▼                                                │
  │  ┌──────────────────────────────────┐                            │
  │  │  LAYER 4: Handler + Database     │ Serves legitimate        │
  │  │                                  │ responses                 │
  │  └──────────────────────────────────┘                            │
  │                                                                  │
  │  RESULT: Your app handles 8K legitimate RPS without breaking.  │
  │  Each layer catches a different CLASS of threat.                │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-4-nginx"></a>
## 📙 Chapter 4: Nginx — Your Gateway (Complete Guide)

### What Nginx Does

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  NGINX IS A REVERSE PROXY:                                         │
  │                                                                     │
  │  It sits BETWEEN the internet and your Fastify application.       │
  │  All traffic hits Nginx first, and Nginx decides:                 │
  │  • Forward the request to Fastify (proxy_pass)                    │
  │  • Reject the request immediately (4xx response)                  │
  │  • Drop the connection silently                                    │
  │                                                                     │
  │  Internet → Nginx (port 80/443) → Fastify (port 3099, internal)  │
  │                                                                     │
  │  WHY NGINX IS FAST:                                                │
  │  • Written in C (not JavaScript — no V8 overhead)                 │
  │  • Event-driven architecture (like Node.js, but in C)             │
  │  • Handles 10,000+ connections per worker process                 │
  │  • Single worker = ~2-5 MB memory (vs ~50 MB for Node.js)        │
  │  • Rejection cost: ~0.01 ms (vs ~5 ms in Fastify)                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-5-limit-conn"></a>
## 📒 Chapter 5: Connection-Level Controls — limit_conn

### The Problem: Connection Exhaustion

```
  Your server has a finite number of TCP connections it can hold open.
  Node.js default: ~1024 file descriptors (connections).

  SLOWLORIS ATTACK:
  Attacker opens 1,024 connections but sends data v-e-r-y s-l-o-w-l-y.
  Each connection stays open for minutes.
  All connection slots consumed. No new connections accepted.
  Legitimate users get "Connection Refused." 💀

  Rate limiting DOESN'T catch this — the attacker sends < 1 request/sec!
  Connection limiting DOES catch this.
```

### Nginx limit_conn Configuration

```nginx
# Define a shared memory zone for tracking connections per IP
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
#               ^^^^^^^^^^^^^^^^^^^^       ^^^^^^^^^^  ^^^
#               Use IP as identifier       Zone name   10 MB shared memory
#               (binary = compact,                     (~160,000 IPs)
#                4 bytes per IPv4)

server {
    listen 80;

    location / {
        limit_conn conn_limit 20;
        #                     ^^
        #                     Max 20 simultaneous connections per IP
        #                     Connection #21 from same IP → rejected (503)

        limit_conn_status 429;
        #                 ^^^
        #                 Return 429 instead of default 503

        proxy_pass http://fastify_app;
    }
}
```

### How It Protects

```
  Normal user: 2-5 concurrent connections (browser tabs)
  Limit: 20 per IP → Normal users never hit this limit ✅

  Slowloris attacker: Opens 1000 connections from one IP
  Connection #21 → REJECTED immediately by Nginx
  Your Fastify app never sees connections 21-1000
  Attack neutralized at the gate ✅

  ┌── MEMORY COST ─────────────────────────────────────────────────────┐
  │                                                                     │
  │  10 MB zone = ~160,000 unique IP addresses tracked                │
  │  Each entry: 64 bytes (IP address + counter + metadata)           │
  │  If zone fills up: oldest entries are evicted (LRU)               │
  │  Cost to your server: 10 MB of RAM. Negligible. ✅                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-6-limit-req"></a>
## 📔 Chapter 6: Request-Level Controls — limit_req

### Nginx's Built-in Rate Limiter

```nginx
# Define rate limit zone
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=50r/s;
#              ^^^^^^^^^^^^^^^^^^^^       ^^^^^^^^^      ^^^^^^^
#              Per-IP tracking            Zone name      50 requests/second

server {
    listen 80;

    location / {
        limit_req zone=api_limit burst=20 nodelay;
        #                        ^^^^^^^^  ^^^^^^^
        #                        Allow 20  Don't queue — reject immediately
        #                        extra     if over (burst + rate)
        #                        requests
        #                        in a burst

        proxy_pass http://fastify_app;
    }
}
```

### Understanding `burst` and `nodelay`

```
  rate=50r/s means: 1 request every 20 milliseconds.
  If requests arrive faster than every 20ms, Nginx can:

  WITHOUT burst: Immediately reject the excess.
  WITH burst=20: Queue up to 20 excess requests and drip them through.
  WITH burst=20 nodelay: Allow the burst immediately (no queuing).

  ┌── SCENARIO: 70 requests arrive in 1 second ────────────────────────┐
  │                                                                     │
  │  rate=50r/s, NO burst:                                             │
  │  Requests 1-50: ALLOWED (at rate)                                  │
  │  Requests 51-70: REJECTED immediately (503/429)                   │
  │                                                                     │
  │  rate=50r/s, burst=20:                                             │
  │  Requests 1-50: ALLOWED (at rate)                                  │
  │  Requests 51-70: QUEUED (dripped through at 1/20ms rate)          │
  │  Client waits 0-400ms for queued requests                         │
  │                                                                     │
  │  rate=50r/s, burst=20, nodelay:                                    │
  │  Requests 1-70: ALL ALLOWED immediately ✅                         │
  │  But the burst "slots" refill at 50/second rate                   │
  │  Request 71: REJECTED (burst slots exhausted)                     │
  │                                                                     │
  │  RECOMMENDATION: burst=20 nodelay for your TinyURL                │
  │  Handles normal traffic bursts without penalizing users.          │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Nginx Uses the Leaky Bucket Algorithm!

```
  Nginx's limit_req internally uses the LEAKY BUCKET algorithm:

  • Tokens "leak" at the configured rate (50/s = 1 every 20ms)
  • burst= is the bucket capacity
  • nodelay= skips the queuing, just checks capacity
  
  This is why Nginx provides SMOOTH traffic shaping.
  Your app (Fastify) gets a steady stream of requests,
  not sudden spikes. PostgreSQL is protected. ✅
```

---

<a id="chapter-7-waf"></a>
## 📚 Chapter 7: WAF — Web Application Firewall Rules

### What a WAF Blocks

```
  A WAF inspects the REQUEST CONTENT — URL, headers, body —
  and blocks requests matching known attack patterns:

  ┌── ATTACK TYPE ─────────┬── PATTERN ────────────────────────────────┐
  │                         │                                           │
  │  SQL Injection          │ ' OR 1=1 --                              │
  │                         │ '; DROP TABLE users; --                  │
  │                         │ UNION SELECT * FROM                      │
  │                         │                                           │
  │  Path Traversal         │ ../../etc/passwd                         │
  │                         │ ..\..\windows\system32                   │
  │                         │                                           │
  │  XSS (Cross-Site        │ <script>alert('xss')</script>           │
  │  Scripting)             │ javascript:void(0)                       │
  │                         │ onload=alert(1)                          │
  │                         │                                           │
  │  Command Injection      │ ; rm -rf /                               │
  │                         │ | cat /etc/passwd                        │
  │                         │                                           │
  │  Header Injection       │ Host: evil.com                           │
  │                         │ X-Forwarded-For: <script>               │
  │                         │                                           │
  └─────────────────────────┴──────────────────────────────────────────┘
```

### Nginx WAF Configuration

```nginx
server {
    listen 80;

    # Block SQL injection patterns in URL and args
    if ($query_string ~* "union.*select") { return 403; }
    if ($query_string ~* "insert.*into") { return 403; }
    if ($query_string ~* "drop.*table") { return 403; }
    if ($query_string ~* "select.*from") { return 403; }

    # Block path traversal
    if ($uri ~* "\.\.") { return 403; }

    # Block common exploit scanners
    if ($http_user_agent ~* "(nikto|sqlmap|nmap|masscan)") { return 403; }

    # Block requests with no User-Agent (often bots)
    if ($http_user_agent = "") { return 403; }

    location / {
        proxy_pass http://fastify_app;
    }
}
```

### For Your TinyURL — What Matters

```
  Your TinyURL accepts originalUrl in POST body.
  A WAF should verify:
  • The URL starts with http:// or https://
  • The URL doesn't contain <script> tags (XSS in URL)
  • The request body isn't suspiciously large (> 1 KB for a single URL)

  BUT: Your Fastify JSON schema validation already does most of this.
  The WAF adds a SECOND layer — defense in depth.
```

---

<a id="chapter-8-geo-blocking"></a>
## 📖 Chapter 8: Geo-Blocking & IP Blacklists

### Block by Country (GeoIP)

```nginx
# Requires ngx_http_geoip2_module

geoip2 /usr/share/GeoIP/GeoLite2-Country.mmdb {
    auto_reload 5m;
    $geoip2_data_country_code default=US source=$remote_addr country iso_code;
}

map $geoip2_data_country_code $allowed_country {
    default yes;
    CN no;    # Block China (if you don't serve Chinese users)
    RU no;    # Block Russia
    # Add more as needed
}

server {
    if ($allowed_country = no) {
        return 403;
    }
}
```

### Block Known Bad IP Ranges

```nginx
# Block known data center / bot farm IP ranges
# These IPs are almost never real users

deny 198.51.100.0/24;    # Known botnet range
deny 203.0.113.0/24;     # Documentation range (shouldn't appear in real traffic)
allow all;                # Allow everything else
```

---

<a id="chapter-9-xff"></a>
## ⚠️ Chapter 9: The X-Forwarded-For Trap — Critical!

### The Problem

```
  WITHOUT Nginx (direct connection):
  ┌────────────────────────────────────────────────────────────────────┐
  │  Client (1.2.3.4) ───► Fastify                                   │
  │                                                                    │
  │  req.ip = "1.2.3.4" ← Correct! Fastify reads the TCP source IP. │
  └────────────────────────────────────────────────────────────────────┘

  WITH Nginx (reverse proxy):
  ┌────────────────────────────────────────────────────────────────────┐
  │  Client (1.2.3.4) ───► Nginx (172.18.0.3) ───► Fastify          │
  │                                                                    │
  │  req.ip = "172.18.0.3" ← WRONG! 💀                               │
  │  Fastify sees Nginx's internal Docker IP, not the real client!   │
  │                                                                    │
  │  CONSEQUENCE:                                                      │
  │  Your rate limiter key = "ratelimit:shorten:172.18.0.3"          │
  │  EVERY user on the internet shares ONE rate limit counter!       │
  │  After 10 requests from anyone, EVERYONE is blocked! 💀💀💀      │
  └────────────────────────────────────────────────────────────────────┘
```

### The Fix — Two Parts

```
  PART 1: Nginx forwards the real client IP in a header:

  location / {
      proxy_set_header X-Forwarded-For $remote_addr;
      #                                ^^^^^^^^^^^^
      #                                The REAL client IP from TCP
      proxy_set_header X-Real-IP $remote_addr;
      proxy_pass http://fastify_app;
  }

  PART 2: Fastify trusts the X-Forwarded-For header:

  // src/app.js
  const app = fastify({
      trustProxy: true
      //          ^^^^
      //          Tells Fastify: "The IP in X-Forwarded-For is the real client.
      //          Don't use the TCP source IP (that's just Nginx)."
  });

  Now:
  req.ip = "1.2.3.4"  ← Read from X-Forwarded-For header ✅
  req.headers['x-forwarded-for'] = "1.2.3.4" ← Available in headers too

  Your middleware already reads this:
  const clientIp = req.headers['x-forwarded-for']
      ?.split(',')[0].trim() || req.ip;
  // split(',')[0] because X-Forwarded-For can contain a chain:
  // "1.2.3.4, 10.0.0.1, 172.18.0.3" → take the first (original client)
```

### Security Warning: X-Forwarded-For Spoofing

```
  ⚠️ A malicious client can SET their own X-Forwarded-For header:

  curl -H "X-Forwarded-For: 9.9.9.9" https://your-tinyurl.com/api/shorten

  If Fastify blindly trusts this, the attacker gets a different rate limit
  key (9.9.9.9 instead of their real IP) → limit bypass! 💀

  THE FIX: Nginx OVERWRITES the X-Forwarded-For header:

  proxy_set_header X-Forwarded-For $remote_addr;
  # NOT $proxy_add_x_forwarded_for (which APPENDS, preserving the fake!)
  # $remote_addr = the TCP source IP that Nginx actually sees.
  # Even if the client set a fake X-Forwarded-For, Nginx replaces it.

  This is safe because Nginx sees the REAL TCP connection source.
  You can't fake the TCP source IP (it would break the connection).
```

---

<a id="chapter-10-your-tinyurl"></a>
## 📃 Chapter 10: Your TinyURL — Complete Nginx + Docker Setup

### The Docker Compose Addition

Your current [`docker-compose.yml`](file:///c:/Users/TARUN/Desktop/TinyURL/infra/docker-compose.yml) doesn't have Nginx. Here's how to add it:

```yaml
# infra/docker-compose.yml — ADD this service:

services:
  nginx:
    image: nginx:alpine
    container_name: TinyURL-Nginx
    restart: unless-stopped
    ports:
      - "80:80"           # Public traffic enters here
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app               # Wait for Fastify to start

  app:
    build: ..
    container_name: TinyURL-App
    restart: unless-stopped
    # REMOVE the ports section! App is no longer directly exposed.
    # ports:
    #   - "3099:3099"     ← DELETE THIS LINE (Nginx handles public port)
    expose:
      - "3099"            # Internal-only (Nginx can reach it, internet cannot)
    environment:
      - PORT=3099
    depends_on:
      redis:
        condition: service_started
      postgres-shard-0:
        condition: service_healthy
      postgres-shard-1:
        condition: service_healthy
```

### The Nginx Configuration

```nginx
# infra/nginx/nginx.conf

worker_processes auto;   # One worker per CPU core

events {
    worker_connections 4096;   # Max connections per worker
}

http {
    # ─── RATE LIMITING ZONES ──────────────────────────────────────
    
    # Coarse global rate limit: 50 requests/second per IP
    limit_req_zone $binary_remote_addr zone=global_limit:10m rate=50r/s;
    
    # Connection limit: max 20 simultaneous connections per IP
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

    # Custom error pages for rate limiting
    limit_req_status 429;
    limit_conn_status 429;

    # ─── UPSTREAM (your Fastify app) ──────────────────────────────

    upstream tinyurl_app {
        server app:3099;         # Docker service name + internal port
        keepalive 64;            # Persistent connections (reduce TCP overhead)
    }

    # ─── SERVER BLOCK ─────────────────────────────────────────────

    server {
        listen 80;
        server_name _;

        # Connection limit
        limit_conn conn_limit 20;

        # ── PUBLIC API ROUTES ─────────────────────────────────────

        location / {
            # Global rate limit with burst allowance
            limit_req zone=global_limit burst=20 nodelay;

            # Forward real client IP to Fastify
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header Host $host;
            proxy_set_header X-Request-ID $request_id;

            # Proxy to Fastify
            proxy_pass http://tinyurl_app;

            # Timeout settings
            proxy_connect_timeout 5s;
            proxy_read_timeout 10s;
            proxy_send_timeout 10s;
        }

        # ── BLOCK METRICS FROM PUBLIC ACCESS ──────────────────────

        location /metrics {
            # Prometheus metrics should NOT be publicly accessible!
            deny all;
            return 403;
        }

        # ── WAF: Block common attack patterns ────────────────────

        # Block path traversal
        location ~* \.\. {
            return 403;
        }
    }
}
```

### The Flow After Adding Nginx

```
  BEFORE (current):
  Internet:80 ──► Fastify:3099 (directly exposed!)

  AFTER (with Nginx):
  Internet:80 ──► Nginx:80 ──► Fastify:3099 (internal only!)
                    │
                    ├── limit_conn: max 20 concurrent per IP
                    ├── limit_req: max 50 req/s per IP (burst 20)
                    ├── Block /metrics from public
                    ├── Set X-Forwarded-For header
                    └── Proxy to Fastify

  Two layers of defense:
  Layer 1 (Nginx):   50 req/s per IP, connection limits, WAF
  Layer 2 (Fastify): 10/min for POST, 100/min for GET (per route)
```

---

<a id="chapter-11-cdn"></a>
## 📕 Chapter 11: CDN & Cloud Edge (Cloudflare / AWS Shield)

### What CDNs Add Beyond Nginx

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  FEATURE              │ NGINX   │ CLOUDFLARE        │ AWS SHIELD  │
  │───────────────────────│─────────│───────────────────│─────────────│
  │  Rate limiting        │ ✅ Yes  │ ✅ Yes + ML       │ ✅ Yes      │
  │  DDoS absorption      │ ⚠️ Basic│ ✅ 100+ Tbps     │ ✅ 100+ Tbps│
  │  Bot detection        │ ❌ No   │ ✅ ML-based       │ ✅ Yes      │
  │  CAPTCHA challenges   │ ❌ No   │ ✅ Turnstile     │ ❌ No       │
  │  Geo-blocking         │ ⚠️ Plugin│ ✅ Built-in      │ ✅ Built-in │
  │  SSL/TLS termination  │ ✅ Yes  │ ✅ Free certs    │ ✅ ACM certs│
  │  Static file caching  │ ✅ Yes  │ ✅ Global CDN    │ ✅ CloudFront│
  │  HTTP/3 (QUIC)        │ ⚠️ Partial│ ✅ Yes         │ ✅ Yes      │
  │  Cost                 │ Free    │ Free tier avail. │ $3K+/month  │
  │  Global POP network   │ ❌ No   │ ✅ 300+ cities   │ ✅ 400+ POP│
  │                                                                     │
  │  For your TinyURL MVP: Nginx is sufficient.                       │
  │  For production: Cloudflare's free tier is an excellent upgrade.  │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### How Cloudflare Would Sit in Your Architecture

```
  Internet
     │
     ▼
  ┌──────────────────┐
  │  Cloudflare CDN   │  DNS points to Cloudflare
  │  (edge servers    │  Cloudflare proxies to your origin
  │   worldwide)      │
  └────────┬─────────┘
           │ Only legitimate traffic forwarded
           ▼
  ┌──────────────────┐
  │  Your Nginx       │  Now sees only "clean" traffic
  │  (reverse proxy)  │  limit_req handles the rest
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │  Fastify + Redis  │  Per-route business logic limits
  └──────────────────┘
```

---

<a id="chapter-12-cheat-sheet"></a>
## 📋 Chapter 12: Quick Reference Cheat Sheet

### Defense Layers — Quick Comparison

| Layer | Tool | Cost/Rejection | Capacity | Best For |
|:--|:--|:--|:--|:--|
| CDN/Edge | Cloudflare | ~0.001 ms | 10M+ RPS | DDoS, bots |
| Gateway | Nginx | ~0.01 ms | 100K+ RPS | Floods, WAF |
| App | Fastify+Redis | ~0.3 ms | 10K+ RPS | Per-route limits |

### Nginx Quick Reference

```nginx
# Rate limit: 50 req/s per IP, allow burst of 20
limit_req_zone $binary_remote_addr zone=api:10m rate=50r/s;
limit_req zone=api burst=20 nodelay;

# Connection limit: 20 concurrent per IP  
limit_conn_zone $binary_remote_addr zone=conn:10m;
limit_conn conn 20;

# Forward real IP to app
proxy_set_header X-Forwarded-For $remote_addr;

# Block metrics from public
location /metrics { deny all; }
```

### Critical Checklist When Adding a Proxy

```
  ☐ Nginx OVERWRITES X-Forwarded-For (not append)
  ☐ Fastify has trustProxy: true
  ☐ App port is NOT exposed to the internet (use expose:, not ports:)
  ☐ /metrics endpoint is blocked from public access
  ☐ limit_req + limit_conn are configured
  ☐ Tested with curl -H "X-Forwarded-For: fake" (verify it's overwritten)
```

---

## 🎓 Final Mental Model

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Edge filtering is TRIAGE.                                      │
  │                                                                  │
  │  In an emergency room, you don't let every person walk          │
  │  straight to the surgeon. You have:                             │
  │                                                                  │
  │  🏥 Ambulance dispatch (CDN) — filters at the source           │
  │  🚪 Reception desk (Nginx) — quick check, redirect or reject   │
  │  👨‍⚕️ Nurse (App middleware) — detailed assessment                │
  │  🔬 Doctor (Route handler) — actual treatment                   │
  │                                                                  │
  │  Each layer is CHEAPER and FASTER than the next.                │
  │  Each layer catches DIFFERENT types of problems.                │
  │  Together they protect the expensive doctor from burnout.       │
  │                                                                  │
  │  Your Fastify route handler is the doctor.                      │
  │  Don't make it see every patient.                               │
  │  Let the reception desk handle the crowd.                       │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

> **The cheapest request to handle is the one that never reaches your application. Edge and gateway filtering absorb 90-99% of attack traffic at 1/500th the cost of an app-level rejection. Your TinyURL's next evolution: add Nginx in front with `limit_req` and `limit_conn`, block `/metrics` from public, and set `trustProxy: true` in Fastify.**

---

*This guide is part of the TinyURL system design documentation. See also: [Rate Limiting Topologies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/rate_limiting_topologies.md) · [Comparing Rate Limiting Algorithms](file:///c:/Users/TARUN/Desktop/TinyURL/docs/system_design/comparing_algorithms.md) · [Middleware Architectures](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/middleware_architectures.md)*
