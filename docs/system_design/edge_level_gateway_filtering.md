# 🛡️ Edge-Level & Gateway Filtering: The Security Funnel

In our previous system design guides, we rate-limited requests at the application level (our Fastify middleware with Redis). 

However, in production, letting *every* request hit your application just to be rejected is a major risk. This guide explains how we filter bad traffic at the **Edge** (using a Load Balancer like Nginx) before it ever touches our Node.js app code.

---

## 🏟️ The Metaphor: The Nightclub Security Funnel

Let's continue our **VIP Nightclub** analogy:

```
  🌊 Mass Public Traffic (Bots, Legit Users, Spammers)
               │
               ▼
   [ 🚧 Highway Roadblock ] ◄── Edge Layer (Nginx): Blocks massive floods cheaply
               │
               ▼
   [ 🚪 VIP Lounge Door ]   ◄── App Layer (Fastify): Enforces precise API quotas
               │
               ▼
   [ 🎧 The DJ Booth ]      ◄── Route Handler / Database
```

1. **The Highway Roadblock (Edge Layer - Nginx):**
   * Placed miles away from the club. It turns away massive buses of uninvited people, bad vehicles, and known troublemakers.
   * *Why it is cheap:* It stops crowds before they consume parking spaces, line queue slots, or air conditioning inside the building.
2. **The VIP Door (App Layer - Fastify/Redis):**
   * The host standing at the interior VIP lounge door. They check database guest lists and keep precise tallies.
   * *Why it is expensive:* By the time a guest gets rejected here, they have already entered the building, used up security guard time, and stood in line.

---

## 💸 The True Cost of an App-Level Rejection

When our Fastify app rejects a request with a `429 Too Many Requests` status, it still does a massive amount of work behind the scenes:

```
Request ──► [ 1. TCP Handshake ] ──► [ 2. Fastify Parses Body ] ──► [ 3. preHandler runs ] ──► [ 4. Redis Roundtrip (Lua) ] ──► [ 5. 429 Rejected ]
```

Under a major flood (e.g., a bot firing 50,000 requests/sec), your Node.js CPU and Redis memory will spike just trying to say *"No"* to all of them. **That spike itself can crash your app.**

**Edge Filtering** exists to drop the bad traffic at **Step 1**, preventing the request from ever talking to Node.js or Redis.

---

## 🛠️ Concrete Edge-Level Tools (Nginx)

Nginx is written in fast, optimized C code, making it thousands of times faster at rejecting connections than Node.js. Here are the tools it uses:

### 1. Connection-Level Capping (Limit Parking Slots) 🚗
Stop a single bad client from hogging all open network connection slots on your server.
```nginx
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

server {
  location / {
    limit_conn conn_limit 20; # Max 20 concurrent connections per IP address
  }
}
```

### 2. Blunt Rate Limiting (Coarse Rate Cap) ⏱️
Before checking specific route limits, enforce a global ceiling. Nginx doesn't know what database routes cost—it just enforces a blunt limit.
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=50r/s;

server {
  location / {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_pass http://fastify_app;
  }
}
```

### 3. WAF (Web Application Firewall) 🧱
Inspect request text patterns. Nginx can drop requests containing malicious SQL injection strings (e.g., `' OR 1=1`) or directory path traversal attempts (e.g. `../../etc/passwd`) before your routes parse them.

### 4. Geo / IP Range Blocking 🗺️
Instantly drop requests originating from known data-center bot ranges or countries where you don't operate.

---

## 🧱 Implementation: Dropping Nginx in Front of Fastify

Here is a minimal configuration showing how Nginx sits in front of our TinyURL application using Docker:

### 1. Update Services
We route port `80` (public traffic) directly to Nginx, and let Nginx proxy it internally to the Fastify app container.

```yaml
# infra/docker-compose.yml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app

  app:
    # app port 3000 is no longer exposed to the public internet!
```

### 2. Define the Nginx Configuration
We define a global limit of `50 requests per second` per IP, and proxy all traffic through to our Fastify app cluster.

```nginx
# infra/nginx.conf
events {}

http {
  limit_req_zone $binary_remote_addr zone=global_limit:10m rate=50r/s;

  upstream fastify_app {
    server app:3000; # Points to Docker container service name
  }

  server {
    listen 80;

    location / {
      limit_req zone=global_limit burst=20 nodelay;
      proxy_pass http://fastify_app;
      
      # Forward the user's real IP to Fastify
      proxy_set_header X-Forwarded-For $remote_addr;
    }
  }
}
```

---

## ⚠️ The Proxy Trap: `X-Forwarded-For`

Once Nginx sits in front of Fastify, all incoming requests to Fastify will technically come from **Nginx's internal container IP** (e.g., `172.18.0.3`), not the user. 

If you don't fix this, your Fastify rate limiter will think **every client in the world is the same person**, rate-limiting everyone instantly!

* **The Fix:** Nginx forwards the real client's IP in the `X-Forwarded-For` header. You must tell Fastify to trust this header in your main server startup script:
```typescript
// src/app.ts
const app = Fastify({ 
  logger: true,
  trustProxy: true // ◄── Crucial! Instructs Fastify to read client IPs from X-Forwarded-For
});
```

---

## ⚖️ Defense-in-Depth Comparison

| Feature | Edge Layer (Nginx) 🚧 | App Layer (Fastify & Redis) 🚪 |
| :--- | :--- | :--- |
| **Cost per Rejection** | **Near-Zero** (No Javascript execution) | High (Javascript parse + Redis roundtrip) |
| **Precision** | Blunt (Same limit applies to every URL) | **Precise** (10/min for `/shorten`, 100/min for `/redirect`) |
| **Target Threat** | Massive floods, botnets, DDoS attacks | Business abuse, database resource hogging |
| **Capacity** | Handles tens of thousands requests/sec | Bounded by Redis connection limits |

---

## 🧠 The Complete Funnel

In a secure system, rate limiting is a **funnel**, not a single wall:
1. **Edge (Nginx)** stops the brute-force traffic spikes cheaply.
2. **App (Fastify/Redis)** enforces granular, fair usage quotas based on route expense and user identities.
3. **Application Handler** executes logic safely.
4. **Fallback Handler (`errorHandler.ts`)** ensures that if anything slips past and throws an error, the system fails cleanly instead of crashing.