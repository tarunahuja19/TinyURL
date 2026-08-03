# 🗺️ Client-Side Database Routing: The Complete Visual Guide

When your database gets too big for a single server, you split it into multiple databases (shards). But how does your application know which database to talk to for a specific short URL? 

Let's demystify **Client-Side Routing** with a simple analogy, clear diagrams, and real code.

---

## 🎭 The Filing Cabinet Analogy

Imagine you run a busy document archive room with **two physical filing cabinets** (Cabinet A and Cabinet B).

```
   [ Cabinet A ]          [ Cabinet B ]
   (Shard 0)              (Shard 1)
```

There are two ways you could organize this:

### 1. Server-Side Routing (The Proxy Clerk)
You hire a clerk to stand in the middle. Whenever you want to store or find a file, you just hand it to the clerk. The clerk looks at the file, decides which cabinet it belongs to, and handles the storage/retrieval. You don't even know Cabinet B exists; you only see the clerk.
* **Examples in tech:** Vitess, Citus, PgBouncer (with custom routing logic).

### 2. Client-Side Routing (Direct Routing) — *Our Approach*
You don't hire a clerk. Instead, you keep a simple rule in your head. When a file arrives, you run the rule yourself (e.g., *"If the file name hash is even, go to Cabinet A. Otherwise, go to Cabinet B."*). You walk directly to the correct cabinet.
* **Why it's great:** Extremely fast (no middleman clerk to talk to, no extra network hop or latency).
* **The catch:** If you forget the rule or change it, you'll look in the wrong cabinet and think the file is lost!

---

## 📊 Visual Flow Comparison

```mermaid
graph TD
    subgraph Server-Side Routing (Proxy)
        App1[Node App] -->|Query: "Get key 'xyz'"| Proxy[Database Proxy]
        Proxy -->|Routes to Shard A| DbA1[(Shard A)]
        Proxy -.->|Ignore Shard B| DbB1[(Shard B)]
    end

    subgraph Client-Side Routing (Direct)
        App2[Node App] -->|1. Run rule: 'xyz' belongs to Shard B| App2
        App2 -->|2. Query direct| DbB2[(Shard B)]
        App2 -.->|Ignore Shard A| DbA2[(Shard A)]
    end

    style App2 fill:#4CAF50,stroke:#388E3C,color:#fff
    style DbB2 fill:#2196F3,stroke:#1976D2,color:#fff
```

---

## 🧠 The Rule: How to Turn a Key into a Cabinet Number

We have a short URL key (like `abc123`). We need a deterministic mathematical formula that always outputs `0` (Cabinet A) or `1` (Cabinet B).

Here is how we do it:

```typescript
// src/db/shardRouter.ts

export const SHARD_COUNT = 2;

/**
 * Converts any string key into a stable, positive 32-bit integer.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // 31 is a prime number that spreads out hash values evenly
    hash = (hash * 31 + str.charCodeAt(i)) | 0; // "| 0" forces standard 32-bit integer limits
  }
  return Math.abs(hash); // Ensure it's not negative
}

/**
 * Decides which database index (0 to SHARD_COUNT - 1) a key belongs to.
 */
export function resolveShardIndex(shortKey: string): number {
  return hashString(shortKey) % SHARD_COUNT;
}
```

### 🔍 How this behaves:
* Input: `"abc123"` ➔ `hashString` returns `53849202` ➔ `53849202 % 2` = `0` ➔ **Cabinet A** (Shard 0)
* Input: `"abc124"` ➔ `hashString` returns `53849203` ➔ `53849203 % 2` = `1` ➔ **Cabinet B** (Shard 1)

Notice how a change of just one character (`3` to `4`) flips the cabinet. This distributes our short URLs perfectly evenly across both databases!

---

## 🔌 Wiring the Cabinets (The Connection Pools)

In our application configuration, we establish direct connections to both databases:

```typescript
// src/db/shardClients.ts
import { Pool } from 'pg';
import { env } from '../config/env';
import { resolveShardIndex } from './shardRouter';

// Setup connection pools for all shards
export const shardPools: Pool[] = [
  new Pool({ connectionString: env.shardAUrl, max: 10, idleTimeoutMillis: 30000 }), // Shard 0 (A)
  new Pool({ connectionString: env.shardBUrl, max: 10, idleTimeoutMillis: 30000 }), // Shard 1 (B)
];

/**
 * Automatically routes and returns the correct connection pool for a key.
 */
export function getPoolForKey(shortKey: string): Pool {
  const index = resolveShardIndex(shortKey);
  return shardPools[index];
}
```

### ⚙️ Docker Setup & Environment Variables
Each shard is a completely isolated Postgres database instance running on a different port.

```yaml
# infra/docker-compose.yml
services:
  postgres-a:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppassword
      POSTGRES_DB: urlshortener_a
    ports: ["5432:5432"] # Port 5432
    volumes: [pg_data_a:/var/lib/postgresql/data]

  postgres-b:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppassword
      POSTGRES_DB: urlshortener_b
    ports: ["5433:5432"] # Port 5433
    volumes: [pg_data_b:/var/lib/postgresql/data]

volumes:
  pg_data_a:
  pg_data_b:
```

```bash
# .env
SHARD_A_URL=postgres://appuser:apppassword@localhost:5432/urlshortener_a
SHARD_B_URL=postgres://appuser:apppassword@localhost:5433/urlshortener_b
```

---

## ⚡ The Database Lifecycle (Reads and Writes)

Now, client-side routing is integrated transparently into your services. The key rule here: **Route first, Query second.**

### 📥 1. Storing a New URL (Write Path)
We generate a key, find the correct database using the key, and write to it.

```typescript
// shorten.service.ts
import { getPoolForKey } from '../../db/shardClients';
import { nextId } from '../../id-generation/snowflake';
import { encode } from '../../id-generation/base62';

export async function createShortUrl(originalUrl: string): Promise<string> {
  const id = nextId();
  const shortKey = encode(id);

  // 1. ROUTE: Ask where this key belongs
  const pool = getPoolForKey(shortKey); 
  
  // 2. QUERY: Insert directly into that shard
  await pool.query(
    `INSERT INTO urls (id, short_key, original_url) VALUES ($1, $2, $3)`,
    [id.toString(), shortKey, originalUrl]
  );

  return shortKey;
}
```

### 📤 2. Looking Up a URL (Read Path)
We receive a short URL key, find which database it was stored in, and query it.

```typescript
// redirect.service.ts
import { getPoolForKey } from '../../db/shardClients';

async function fetchFromDb(shortKey: string): Promise<string | null> {
  // 1. ROUTE: Ask where this key lives
  const pool = getPoolForKey(shortKey); 
  
  // 2. QUERY: Fetch only from that shard
  const { rows } = await pool.query(
    `SELECT original_url FROM urls WHERE short_key = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [shortKey]
  );
  return rows[0]?.original_url ?? null;
}
```

---

## ⚠️ The Golden Rule: Determinism

> [!IMPORTANT]
> The routing function `resolveShardIndex(key)` **must always return the exact same database index** for the same key. Always.

If you change the routing logic, change `SHARD_COUNT` from `2` to `3`, or use a random factor:
* A key stored in Shard A will be searched for in Shard B during redirect.
* The query returns empty.
* The user gets a **404 Not Found**, even though their link is safely stored in Shard A!

---

## 🧹 Housekeeping: Migrating All Shards

Since both shards are separate databases, they have no idea about each other's schema. When you change your table structures, you must run migrations against **every single shard pool**.

```typescript
// scripts/migrate.ts
import { shardPools } from '../src/db/shardClients';

async function run() {
  // Loop over every shard and apply schema changes
  for (const pool of shardPools) {
    // ...same migration logic as before, but looped over each shard's pool
    await pool.query(`CREATE TABLE IF NOT EXISTS urls (...)`);
  }
}
```

This is a direct consequence of sharding you might not expect at first: schema changes are no longer a single operation — they're now `N` operations that all have to succeed, or you end up with shards that have silently drifted out of sync with each other.

---

## 🚪 The "Room Expansion" Problem (Resharding)

What happens if we run out of space on both Shard A and B, and need to add **Shard C**?

If we change `SHARD_COUNT` to `3`, the math changes:
* Old logic: `hash % 2` ➔ Key `"xyz"` goes to `0` (Shard A).
* New logic: `hash % 3` ➔ Key `"xyz"` goes to `2` (Shard C).

Now, the system will look for `"xyz"` on Shard C, but it's physically stored on Shard A! Suddenly, almost all your existing URLs will 404.

### 💡 How do production apps handle this?
They use **Consistent Hashing**. Instead of a simple modulo (`%`), they map keys and database nodes onto a circular ring. Adding a new node only requires moving a small fraction of keys, rather than recalculating the entire database. For our fixed two-shard system, standard modulo is perfect, but consistent hashing is the key to scaling dynamically in production!