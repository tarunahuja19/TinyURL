# 🚀 The Complete Guide to Database Migration Flows

> *"A database without migrations is like a building with no construction records — nobody knows what was built, when, or why. And the next renovation might bring the whole thing down."*

This guide teaches you **everything** about database migrations — what they are, why they exist, how they work under the hood, and how your TinyURL project uses them to manage two sharded databases without ever touching a GUI.

---

## 📖 Table of Contents

1. [Chapter 1: What Is a Migration? — The Time Machine for Databases](#chapter-1-what-is-a-migration)
2. [Chapter 2: Why Not Just Open pgAdmin and Click Buttons?](#chapter-2-why-not-gui)
3. [Chapter 3: The Anatomy of a Migration File](#chapter-3-anatomy)
4. [Chapter 4: The Migration Runner — Your Construction Foreman](#chapter-4-the-runner)
5. [Chapter 5: Your TinyURL Migration — The Complete Walkthrough](#chapter-5-your-migration)
6. [Chapter 6: The Schema Migrations Table — The History Book](#chapter-6-history-book)
7. [Chapter 7: Idempotency — "Run It 100 Times, Same Result"](#chapter-7-idempotency)
8. [Chapter 8: Transactions — All-or-Nothing Safety](#chapter-8-transactions)
9. [Chapter 9: Migration Ordering — Why Sequence Numbers Matter](#chapter-9-ordering)
10. [Chapter 10: The Golden Rules — Laws That Must Never Be Broken](#chapter-10-golden-rules)
11. [Chapter 11: Migrating Multiple Shards — Your TinyURL Pattern](#chapter-11-sharding)
12. [Chapter 12: Rollbacks — When Things Go Wrong](#chapter-12-rollbacks)
13. [Chapter 13: Production Migration Strategies](#chapter-13-production)
14. [Chapter 14: Quick Reference Cheat Sheet](#chapter-14-cheat-sheet)

---

<a id="chapter-1-what-is-a-migration"></a>
## 📕 Chapter 1: What Is a Migration? — The Time Machine for Databases

### 🏠 The Home Renovation Analogy

Imagine you own a house. Over the years, you make changes:

```
  Year 1:  Build the house (3 bedrooms, 1 kitchen, 1 bathroom)
  Year 2:  Add a garage
  Year 3:  Convert bedroom #3 into an office
  Year 5:  Add a second bathroom
  Year 8:  Knock down a wall to create an open-plan kitchen
```

Now imagine you need to **build an identical house in another city**. Without records, you'd have to look at the finished house and try to reverse-engineer what was done. Good luck!

But if you kept a **renovation diary** — a step-by-step log of every change, in order — you could replay those steps on a blank lot and end up with the exact same house. Every single time.

**That renovation diary is a database migration.**

```
  Migration = A versioned, ordered, replayable record of a database change.

  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │  Migration 001:  CREATE TABLE urls (...)                       │
  │  Migration 002:  CREATE TABLE click_analytics (...)            │
  │  Migration 003:  ALTER TABLE urls ADD COLUMN expires_at ...    │
  │  Migration 004:  CREATE INDEX ON click_analytics (clicked_at)  │
  │                                                                │
  │  Run all 4 → you get the current database.                     │
  │  Run only 1-2 → you get the database as it was at v2.          │
  │  Give to a teammate → they get YOUR exact database.            │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘
```

### The Three Superpowers of Migrations

| Superpower | What It Means | Without It |
|:--|:--|:--|
| **🔁 Reproducibility** | Anyone can create your exact database from scratch by running the migration files | "Hey, can you Slack me the SQL commands you ran last week?" |
| **📜 Version History** | Every change is tracked in Git with timestamps, authors, and reasons | "Who added this column? When? Why??" |
| **🤝 Team Sync** | Everyone's database matches. New developer? Clone repo, run migrate, done. | "It works on my machine" but breaks everywhere else |

---

<a id="chapter-2-why-not-gui"></a>
## 📗 Chapter 2: Why Not Just Open pgAdmin and Click Buttons?

### 🖱️ The GUI Trap

It's tempting. You open pgAdmin, right-click, "Create Table", fill in the fields, click Save. Done! 

But now answer these questions:

```
  ❓ Can your teammate get the same table?
     → They'd need to repeat your exact clicks. Hope they don't miss one!

  ❓ Can you deploy this to production?
     → You'd need to manually click through pgAdmin on the production server.
       At 2 AM. Under pressure. With shaking hands. 🫠

  ❓ What if something goes wrong?
     → You have no record of what you did. No undo button. No history.

  ❓ Can you spin up a fresh test database?
     → Click through everything again from scratch? For the 50th time?

  ❓ Can you code-review a database change?
     → "Hey, I clicked some buttons in pgAdmin. LGTM? 🤷"
```

### Code vs Clicks — The Definitive Comparison

```
  ┌──────────────────────────┬─────────────────────────────────┐
  │   GUI / Manual Clicks     │   Migration Files (Code)        │
  │──────────────────────────│─────────────────────────────────│
  │                          │                                  │
  │  ❌ Not in Git           │  ✅ Version controlled           │
  │  ❌ Not repeatable       │  ✅ Run anywhere, same result    │
  │  ❌ No code review       │  ✅ PR-reviewed like any code    │
  │  ❌ Can't automate       │  ✅ npm run migrate              │
  │  ❌ Error-prone at 2 AM  │  ✅ Script doesn't get nervous   │
  │  ❌ No rollback story    │  ✅ Can write DOWN migrations    │
  │  ❌ "Works on my machine"│  ✅ Same everywhere              │
  │                          │                                  │
  └──────────────────────────┴─────────────────────────────────┘
```

> [!CAUTION]
> **Rule #1 of database engineering: NEVER make manual schema changes on any database that matters.** Every change must be a file in your repository. If it's not in code, it doesn't exist.

---

<a id="chapter-3-anatomy"></a>
## 📘 Chapter 3: The Anatomy of a Migration File

A migration file is just a SQL file (or JavaScript/TypeScript file) that contains the commands to change the database.

### The Simplest Migration

```sql
-- migrations/0001_create_urls.sql

CREATE TABLE urls (
    id    BIGINT PRIMARY KEY,
    url   TEXT NOT NULL
);
```

That's it. A migration file is just SQL in a file with a number prefix.

### The Anatomy — Broken Down

```
  0001_create_urls.sql
  ││││ │             │
  ││││ │             └── .sql = It's a SQL file
  ││││ │
  ││││ └── create_urls = Description (human-readable)
  ││││
  └┘└┘── 0001 = Sequence number (runs in this order)
```

### A More Complex Migration

```sql
-- migrations/0002_add_analytics.sql

-- UP: Apply this change
CREATE TABLE url.click_analytics (
    id         BIGSERIAL PRIMARY KEY,
    short_key  TEXT NOT NULL,
    ip         TEXT,
    country    VARCHAR(10),
    region     VARCHAR(100),
    city       VARCHAR(100),
    user_agent TEXT,
    referrer   TEXT,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_click_analytics_short_key ON url.click_analytics (short_key);
CREATE INDEX idx_click_analytics_clicked_at ON url.click_analytics (clicked_at);
```

### What Your TinyURL Uses

Your project has two migration files in [`src/db/migrations/`](file:///c:/Users/TARUN/Desktop/TinyURL/src/db/migrations):

```
  src/db/migrations/
  ├── schema.sql          ← Creates the "url" namespace and enables pgcrypto
  └── create_table.sql    ← Creates the URL table, analytics table, and indexes
```

These contain the full blueprint of your database — every table, every column, every index.

---

<a id="chapter-4-the-runner"></a>
## 📙 Chapter 4: The Migration Runner — Your Construction Foreman

Migration files are just blueprints. You need a **runner** — a program that reads the files and executes them against the database.

### 🏗️ The Foreman Analogy

```
  Migration Files = Architectural blueprints
  Migration Runner = The construction foreman
  Database = The building site

  The foreman:
  1. Looks at the blueprints (reads migration files)
  2. Checks the construction log (schema_migrations table)
  3. Skips already-completed work
  4. Executes only new blueprints
  5. Records what was done
```

### How a Migration Runner Works — Step by Step

```mermaid
flowchart TD
    START["npm run migrate"] --> READ["Read all migration files\nfrom migrations/ directory"]
    READ --> SORT["Sort files by sequence number\n(0001, 0002, 0003...)"]
    SORT --> LOOP["For each migration file..."]
    
    LOOP --> CHECK{"Already applied?\n(Check schema_migrations table)"}
    
    CHECK -- "Yes, already done" --> SKIP["⏭️ Skip this file"]
    SKIP --> NEXT["Next file"]
    
    CHECK -- "No, this is new!" --> BEGIN["BEGIN TRANSACTION"]
    BEGIN --> EXEC["Execute the SQL"]
    
    EXEC -- "Success ✅" --> RECORD["Record filename in\nschema_migrations table"]
    RECORD --> COMMIT["COMMIT TRANSACTION"]
    COMMIT --> NEXT
    
    EXEC -- "Error ❌" --> ROLLBACK["ROLLBACK TRANSACTION\n(Undo everything!)"]
    ROLLBACK --> FAIL["❌ Stop! Report error."]
    
    NEXT --> LOOP
    LOOP -- "All files processed" --> DONE["✅ Migration complete!"]
```

### The schema_migrations Table — How the Runner Remembers

Every migration runner creates a special bookkeeping table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,       -- Which file was run
    applied_at  TIMESTAMPTZ DEFAULT NOW()  -- When it was run
);
```

After running migrations, it looks like this:

```
  ┌─────────────────────────┬──────────────────────────┐
  │ filename                │ applied_at               │
  │─────────────────────────│──────────────────────────│
  │ schema.sql              │ 2026-08-10 14:30:00+05:30│
  │ create_table.sql        │ 2026-08-10 14:30:01+05:30│
  └─────────────────────────┴──────────────────────────┘
```

The runner checks this table before running any file. If the filename already exists, it skips it.

---

<a id="chapter-5-your-migration"></a>
## 📒 Chapter 5: Your TinyURL Migration — The Complete Walkthrough

Let's trace exactly what happens when you run `npm run migrate` in your TinyURL project.

### Step 0: What Triggers It

Your [`package.json`](file:///c:/Users/TARUN/Desktop/TinyURL/package.json) has:

```json
"scripts": {
    "migrate": "node scripts/migrate_shards.js"
}
```

So `npm run migrate` executes [`migrate_shards.js`](file:///c:/Users/TARUN/Desktop/TinyURL/scripts/migrate_shards.js).

### Step 1: Read Environment Variables

```javascript
const NUM_SHARDS = parseInt(process.env.NUM_SHARDS ?? '2', 10);
```

From your [`.env`](file:///c:/Users/TARUN/Desktop/TinyURL/.env) file:
```
NUM_SHARDS=2
DB_SHARD_0_URL=postgres://postgres:***@localhost:5434/tinyURL_shard0
DB_SHARD_1_URL=postgres://postgres:***@localhost:5435/tinyURL_shard1
```

The runner knows: "I need to migrate **2** databases."

### Step 2: Connect to Each Shard

```javascript
const pool = new Pool({ connectionString: safeConnectionString, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
```

For each shard, it opens a connection to that shard's PostgreSQL instance.

### Step 3: Run the SQL Statements — In Order

Here's the exact sequence for **each shard**:

```
  Step 3a:  CREATE SCHEMA IF NOT EXISTS url;
            ─────────────────────────────────
            Creates the "url" namespace.
            IF NOT EXISTS = safe to re-run.

                ↓

  Step 3b:  CREATE TABLE IF NOT EXISTS url.URL (
                ID          BIGINT PRIMARY KEY,
                OriginalURL TEXT NOT NULL,
                ShortURL    TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW(),
                expires_at  TIMESTAMP
            );
            ─────────────────────────────────
            Creates the main URL table.
            IF NOT EXISTS = safe to re-run.

                ↓

  Step 3c:  CREATE UNIQUE INDEX IF NOT EXISTS
            idx_urls_short_url ON url.URL (ShortURL);
            ─────────────────────────────────
            Ensures no two URLs can share the same short key.
            IF NOT EXISTS = safe to re-run.

                ↓

  Step 3d:  CREATE TABLE IF NOT EXISTS url.click_analytics (...);
            ─────────────────────────────────
            Creates the analytics event table.
            IF NOT EXISTS = safe to re-run.

                ↓

  Step 3e:  CREATE INDEX IF NOT EXISTS
            idx_click_analytics_short_key ON url.click_analytics (short_key);
            CREATE INDEX IF NOT EXISTS
            idx_click_analytics_clicked_at ON url.click_analytics (clicked_at);
            ─────────────────────────────────
            Creates indexes for fast analytics queries.
            IF NOT EXISTS = safe to re-run.

                ↓

  Step 3f:  SELECT COUNT(*) AS count FROM url.URL;
            ─────────────────────────────────
            Verification! Confirms the table exists and is queryable.
            Prints the row count as proof.
```

### Step 4: Report Results

```
  ╔══════════════════════════════════════════════════════╗
  ║       TinyURL — Phase 4 Shard Migration              ║
  ║       Migrating 2 shard(s)                           ║
  ╚══════════════════════════════════════════════════════╝

  [Migrate] ── Shard 0 ──────────────────────────────
  [Migrate] Connecting to: postgres://postgres:***@localhost:5434/tinyURL_shard0
  [Migrate] Running CREATE SCHEMA...
  [Migrate] ✓ Schema ready
  [Migrate] Running CREATE TABLE (url.URL)...
  [Migrate] ✓ Table url.URL ready
  [Migrate] Running CREATE INDEX (url.URL)...
  [Migrate] ✓ Index idx_urls_short_url ready
  [Migrate] Running CREATE TABLE (url.click_analytics)...
  [Migrate] ✓ Table url.click_analytics ready
  [Migrate] Running CREATE INDEX (url.click_analytics)...
  [Migrate] ✓ Indexes on url.click_analytics ready
  [Migrate] ✓ Shard 0 verified — 0 rows

  [Migrate] ── Shard 1 ──────────────────────────────
  [Migrate] (same steps...)
  [Migrate] ✓ Shard 1 verified — 0 rows

  [Migrate] ── Summary ─────────────────────────────────
  [Migrate] ✅  Shard 0: OK
  [Migrate] ✅  Shard 1: OK

  [Migrate] 🎉  All shards migrated successfully.
  [Migrate] You can now start the server: npm run dev
```

### The Complete Flow — Visualized

```mermaid
sequenceDiagram
    participant Dev as 👨‍💻 Developer
    participant Script as 📜 migrate_shards.js
    participant Env as 📄 .env
    participant S0 as 🐘 Shard 0 (port 5434)
    participant S1 as 🐘 Shard 1 (port 5435)

    Dev->>Script: npm run migrate
    Script->>Env: Read NUM_SHARDS, DB_SHARD_*_URL
    Env-->>Script: 2 shards, connection strings

    par Migrate Both Shards in Parallel
        Script->>S0: CREATE SCHEMA url
        Script->>S1: CREATE SCHEMA url
        S0-->>Script: ✓
        S1-->>Script: ✓

        Script->>S0: CREATE TABLE url.URL + indexes
        Script->>S1: CREATE TABLE url.URL + indexes
        S0-->>Script: ✓
        S1-->>Script: ✓

        Script->>S0: CREATE TABLE url.click_analytics + indexes
        Script->>S1: CREATE TABLE url.click_analytics + indexes
        S0-->>Script: ✓
        S1-->>Script: ✓

        Script->>S0: SELECT COUNT(*) FROM url.URL
        Script->>S1: SELECT COUNT(*) FROM url.URL
        S0-->>Script: 0 rows
        S1-->>Script: 0 rows
    end

    Script-->>Dev: 🎉 All shards migrated!
```

> [!NOTE]
> Notice how both shards are migrated **in parallel** using `Promise.allSettled()`. This is faster than doing them one at a time, and `allSettled` ensures that if shard 0 fails, shard 1 still attempts its migration (unlike `Promise.all` which would abort everything on the first failure).

---

<a id="chapter-6-history-book"></a>
## 📔 Chapter 6: The Schema Migrations Table — The History Book

### How Professional Migration Runners Track History

Your current [`migrate_shards.js`](file:///c:/Users/TARUN/Desktop/TinyURL/scripts/migrate_shards.js) uses `IF NOT EXISTS` on every statement to make it safe to re-run. But as your project grows, a more robust approach is a **schema_migrations tracking table**.

Here's how it works in professional migration systems:

```sql
-- The runner creates this table automatically:
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT,                         -- Hash of file contents
    applied_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### The Before & After

```
  FIRST RUN (fresh database):
  ┌─────────────────────────────────────────────────────────────────┐
  │ schema_migrations table: (empty)                                │
  │                                                                 │
  │ Runner reads files:                                              │
  │   0001_create_schema.sql  → Not in table → RUN ✅ → Record     │
  │   0002_create_urls.sql    → Not in table → RUN ✅ → Record     │
  │   0003_create_analytics.sql → Not in table → RUN ✅ → Record   │
  │                                                                 │
  │ schema_migrations table after:                                   │
  │ ┌──────────────────────────────┬──────────────────────────┐     │
  │ │ filename                     │ applied_at               │     │
  │ │ 0001_create_schema.sql       │ 2026-08-10 14:30:00      │     │
  │ │ 0002_create_urls.sql         │ 2026-08-10 14:30:01      │     │
  │ │ 0003_create_analytics.sql    │ 2026-08-10 14:30:02      │     │
  │ └──────────────────────────────┴──────────────────────────┘     │
  └─────────────────────────────────────────────────────────────────┘


  SECOND RUN (same database, no new files):
  ┌─────────────────────────────────────────────────────────────────┐
  │ Runner reads files:                                              │
  │   0001_create_schema.sql  → Already in table → SKIP ⏭️         │
  │   0002_create_urls.sql    → Already in table → SKIP ⏭️         │
  │   0003_create_analytics.sql → Already in table → SKIP ⏭️       │
  │                                                                 │
  │ Result: Nothing happens. Database unchanged. Perfectly safe! ✅ │
  └─────────────────────────────────────────────────────────────────┘


  THIRD RUN (after adding 0004_add_user_agent.sql):
  ┌─────────────────────────────────────────────────────────────────┐
  │ Runner reads files:                                              │
  │   0001_create_schema.sql  → Already in table → SKIP ⏭️         │
  │   0002_create_urls.sql    → Already in table → SKIP ⏭️         │
  │   0003_create_analytics.sql → Already in table → SKIP ⏭️       │
  │   0004_add_user_agent.sql → NOT in table → RUN ✅ → Record     │
  │                                                                 │
  │ Only the NEW migration runs. Previous work is preserved! ✅     │
  └─────────────────────────────────────────────────────────────────┘
```

### How Your Runner Achieves the Same Thing (Without the Table)

Your `migrate_shards.js` uses a different but equally valid strategy:

```sql
CREATE TABLE IF NOT EXISTS url.URL (...)
CREATE INDEX IF NOT EXISTS idx_urls_short_url ON url.URL (ShortURL)
```

The `IF NOT EXISTS` clause tells PostgreSQL: "Create this only if it doesn't already exist. If it does, do nothing."

| Approach | Tracking Table | IF NOT EXISTS |
|:--|:--|:--|
| **How it knows what's done** | Checks its own bookkeeping table | PostgreSQL checks the catalog |
| **Re-run safety** | ✅ Skips applied files | ✅ PostgreSQL silently ignores |
| **Can detect "was file modified"?** | ✅ Yes (via checksum) | ❌ No |
| **Can track WHO ran it and WHEN?** | ✅ Yes | ❌ No |
| **Complexity** | More code to write | Simpler |

> [!TIP]
> Your `IF NOT EXISTS` approach is perfectly fine for the current stage. As your project grows and you start making `ALTER TABLE` changes (which don't have an `IF NOT EXISTS` equivalent), you'll want to adopt a tracking table or use a migration library like `node-pg-migrate` or `knex`.

---

<a id="chapter-7-idempotency"></a>
## 📖 Chapter 7: Idempotency — "Run It 100 Times, Same Result"

### 🎯 The Definition

> **Idempotent** = Running the operation once has the same effect as running it 100 times.

This is the MOST important property of a migration system.

### Real-World Idempotency

```
  IDEMPOTENT things:                 NON-IDEMPOTENT things:
  ─────────────────                  ─────────────────────

  🔄 Turning a light switch ON      ➕ Adding $10 to a bank account
     (already on? still on!)            (do it twice = $20!)

  🔄 Setting thermostat to 72°F     ➕ Inserting a row into a table
     (already 72? nothing changes!)     (do it twice = duplicate row!)

  🔄 CREATE TABLE IF NOT EXISTS     💀 CREATE TABLE (without IF NOT EXISTS)
     (table exists? fine!)              (table exists? ERROR!)
```

### Idempotent SQL vs Non-Idempotent SQL

```sql
-- ✅ IDEMPOTENT — safe to run 100 times
CREATE TABLE IF NOT EXISTS url.URL (...);
CREATE INDEX IF NOT EXISTS idx_urls_short_url ON url.URL (ShortURL);
CREATE SCHEMA IF NOT EXISTS url;

-- ❌ NOT IDEMPOTENT — second run CRASHES
CREATE TABLE url.URL (...);
-- ERROR: relation "url.URL" already exists

CREATE INDEX idx_urls_short_url ON url.URL (ShortURL);
-- ERROR: relation "idx_urls_short_url" already exists
```

### How Your TinyURL Achieves Idempotency

Every single statement in your migration uses `IF NOT EXISTS`:

```javascript
// From migrate_shards.js:
const CREATE_SCHEMA = `CREATE SCHEMA IF NOT EXISTS url;`;           // ✅
const CREATE_TABLE  = `CREATE TABLE IF NOT EXISTS url.URL (...)`;   // ✅
const CREATE_INDEX  = `CREATE UNIQUE INDEX IF NOT EXISTS ...`;      // ✅
const CREATE_ANALYTICS_TABLE = `CREATE TABLE IF NOT EXISTS ...`;    // ✅
const CREATE_ANALYTICS_INDEXES = `CREATE INDEX IF NOT EXISTS ...`;  // ✅
```

**This is why you can safely run `npm run migrate` as many times as you want.** First run creates everything. Subsequent runs are no-ops.

```
  $ npm run migrate    ← Creates everything (first time)
  $ npm run migrate    ← Does nothing (already exists)
  $ npm run migrate    ← Does nothing
  $ npm run migrate    ← Does nothing
  $ npm run migrate    ← Still does nothing. All safe! ✅
```

---

<a id="chapter-8-transactions"></a>
## 📚 Chapter 8: Transactions — All-or-Nothing Safety

### 🎰 The Slot Machine Problem

Imagine a migration that does 3 things:

```sql
-- Migration 0005: Add user tracking
-- Step 1: Add user_id column to URL table
ALTER TABLE url.URL ADD COLUMN user_id BIGINT;

-- Step 2: Create users table
CREATE TABLE url.users (
    id    BIGINT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
);

-- Step 3: Add foreign key linking URLs to users
ALTER TABLE url.URL ADD CONSTRAINT fk_user
    FOREIGN KEY (user_id) REFERENCES url.users(id);
```

**What if Step 2 fails?** (Maybe a typo in the SQL)

```
  WITHOUT TRANSACTION:
  ────────────────────
  Step 1: ✅ Column added (user_id now exists in url.URL)
  Step 2: ❌ FAILED! (typo in SQL)
  Step 3: ⏭️ Never runs

  Database is now in a HALF-DONE state! 💀
  - url.URL has a user_id column pointing to nothing
  - url.users table doesn't exist
  - The migration can't be re-run because Step 1 would fail
    ("column already exists")
  
  You're stuck. Manual cleanup required. 🧹😩


  WITH TRANSACTION:
  ─────────────────
  BEGIN;
  Step 1: ✅ Column added (tentatively)
  Step 2: ❌ FAILED!
  ROLLBACK;  ← Undo EVERYTHING. Step 1 is reversed.

  Database is back to its original state! ✅
  Fix the typo, re-run the migration. No manual cleanup needed.
```

### How Transactions Work in Code

```javascript
const client = await pool.connect();

try {
    // Start a transaction — nothing is permanent until COMMIT
    await client.query('BEGIN');
    
    // Run all migration steps inside the transaction
    await client.query('ALTER TABLE url.URL ADD COLUMN user_id BIGINT');
    await client.query('CREATE TABLE url.users (...)');
    await client.query('ALTER TABLE url.URL ADD CONSTRAINT fk_user ...');
    
    // Everything succeeded! Make it permanent.
    await client.query('COMMIT');
    console.log('✅ Migration applied');
    
} catch (error) {
    // Something failed! Undo ALL changes.
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, all changes rolled back:', error.message);
    
} finally {
    client.release();
}
```

### Visualizing the Transaction

```mermaid
stateDiagram-v2
    [*] --> BEGIN: Start transaction

    BEGIN --> Step1: ALTER TABLE ADD COLUMN
    Step1 --> Step2: CREATE TABLE
    Step2 --> Step3: ADD CONSTRAINT

    Step3 --> COMMIT: All steps succeeded ✅
    COMMIT --> [*]: Changes are permanent

    Step1 --> ROLLBACK: Error at any step ❌
    Step2 --> ROLLBACK: Error at any step ❌
    Step3 --> ROLLBACK: Error at any step ❌
    
    ROLLBACK --> [*]: Database unchanged\n(as if nothing happened)
```

> [!IMPORTANT]
> Your current `migrate_shards.js` does NOT wrap its statements in a transaction. This is fine today because every statement uses `IF NOT EXISTS` (which is individually idempotent). But when you start writing `ALTER TABLE` migrations, you **must** add `BEGIN/COMMIT/ROLLBACK` wrapping to avoid the half-done state.

### The One Exception: `CREATE INDEX CONCURRENTLY`

PostgreSQL has a special rule:

```sql
-- This CANNOT be run inside a transaction:
CREATE INDEX CONCURRENTLY idx_name ON table_name (column);
-- ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block

-- Why? CONCURRENTLY allows reads/writes during index creation,
-- but this conflicts with transaction isolation.
-- You must run this statement OUTSIDE a transaction.
```

This is important for production migrations on large tables (see [Chapter 13](#chapter-13-production)).

---

<a id="chapter-9-ordering"></a>
## 📃 Chapter 9: Migration Ordering — Why Sequence Numbers Matter

### 🧱 The Brick Wall Problem

You can't paint a wall before you build it. Migrations have **dependencies**.

```
  ❌ WRONG ORDER:
  ──────────────
  0002_add_analytics.sql runs FIRST:
    CREATE INDEX idx_click_analytics_short_key ON url.click_analytics (short_key);
    → ❌ ERROR: relation "url.click_analytics" does not exist!
    (The table hasn't been created yet!)


  ✅ CORRECT ORDER:
  ────────────────
  0001_create_tables.sql runs first:
    CREATE TABLE url.click_analytics (...);
    → ✅ Table created.

  0002_add_analytics_indexes.sql runs second:
    CREATE INDEX idx_click_analytics_short_key ON url.click_analytics (short_key);
    → ✅ Index created on existing table.
```

### How Ordering Works

```
  Migration files sorted by prefix:

  📄 0001_create_schema.sql        ← Runs 1st
  📄 0002_create_url_table.sql     ← Runs 2nd  (needs schema from 0001)
  📄 0003_create_analytics.sql     ← Runs 3rd  (needs schema from 0001)
  📄 0004_add_expiry_column.sql    ← Runs 4th  (needs table from 0002)
  📄 0005_add_user_tracking.sql    ← Runs 5th  (needs tables from 0002, 0003)

  The NUMBER is the only thing that determines order.
  The descriptive name after the number is just for humans.
```

### Common Numbering Schemes

| Scheme | Example | Pros | Cons |
|:--|:--|:--|:--|
| **Sequential** | `0001_`, `0002_`, `0003_` | Simple, clear order | Merge conflicts if two devs create `0004_` |
| **Timestamp** | `20260815143000_` | No conflicts (unique to the second) | Harder to read |
| **Date + Seq** | `2026_08_15_01_` | Readable + unique per day | Slightly verbose |

> [!TIP]
> For a solo project like TinyURL, simple sequential numbering (`0001_`, `0002_`) is perfect. Switch to timestamps when you have multiple developers creating migrations simultaneously.

---

<a id="chapter-10-golden-rules"></a>
## ⚖️ Chapter 10: The Golden Rules — Laws That Must Never Be Broken

### 🏛️ The 7 Commandments of Database Migrations

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  I.    NEVER edit an applied migration file.                        │
  │                                                                     │
  │  II.   NEVER delete an applied migration file.                      │
  │                                                                     │
  │  III.  ALWAYS create a NEW file for changes.                        │
  │                                                                     │
  │  IV.   ALWAYS make migrations idempotent.                           │
  │                                                                     │
  │  V.    ALWAYS test migrations on a copy before production.          │
  │                                                                     │
  │  VI.   ALWAYS wrap multi-step migrations in transactions.           │
  │                                                                     │
  │  VII.  NEVER put application logic in migrations.                   │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Rule I Explained: Why You Can't Edit Applied Files

```
  You wrote and deployed 0001_create_urls.sql:
  ┌─────────────────────────────────────────────┐
  │ CREATE TABLE url.URL (                      │
  │     ID BIGINT PRIMARY KEY,                  │
  │     OriginalURL TEXT NOT NULL               │
  │ );                                          │
  └─────────────────────────────────────────────┘

  Deployed to production ✅. Recorded in schema_migrations ✅.

  Later, you realize you forgot ShortURL. You edit the file:
  ┌─────────────────────────────────────────────┐
  │ CREATE TABLE url.URL (                      │
  │     ID BIGINT PRIMARY KEY,                  │
  │     OriginalURL TEXT NOT NULL,              │
  │     ShortURL TEXT NOT NULL     ← ADDED!    │
  │ );                                          │
  └─────────────────────────────────────────────┘

  What happens when someone runs migrate?

  Runner: "0001_create_urls.sql — already applied. SKIP."
  
  Result: ShortURL column NEVER gets created! 💀
  The database is now OUT OF SYNC with the migration file.
  The runner thinks it's done, but the schema is wrong.


  ✅ CORRECT FIX: Create a new file:
  ┌─────────────────────────────────────────────┐
  │ -- 0002_add_shorturl_column.sql             │
  │ ALTER TABLE url.URL                         │
  │     ADD COLUMN ShortURL TEXT NOT NULL;       │
  └─────────────────────────────────────────────┘

  The runner sees this new file and applies it. 
  Both old and new databases end up correct. ✅
```

> [!CAUTION]
> **Migrations only move forward.** Like time, they cannot be rewritten. If you made a mistake, fix it in the NEXT migration. The old one is history.

### Rule VII Explained: No App Logic in Migrations

```sql
-- ❌ BAD — This belongs in application code, not a migration:
INSERT INTO url.URL VALUES (1, 'https://google.com', 'goog', NOW(), NULL);
INSERT INTO url.URL VALUES (2, 'https://github.com', 'gh', NOW(), NULL);

-- ✅ OK — Seed data scripts are separate files, not migrations.
-- ✅ OK — Reference/lookup data is acceptable:
INSERT INTO url.plans (id, name) VALUES (1, 'free'), (2, 'pro'), (3, 'enterprise');
```

---

<a id="chapter-11-sharding"></a>
## 🗂️ Chapter 11: Migrating Multiple Shards — Your TinyURL Pattern

Your TinyURL uses **database sharding** — splitting data across multiple PostgreSQL instances. This adds a unique challenge: **every shard needs the same schema.**

### The Challenge

```
  Without sharding (simple):
  ┌──────────────┐
  │ 1 Database    │ ← Run migration once. Done.
  └──────────────┘

  With 2 shards (your setup):
  ┌──────────────┐   ┌──────────────┐
  │ Shard 0       │   │ Shard 1       │ ← Must run migration on BOTH.
  │ port 5434     │   │ port 5435     │    Both must end up identical.
  └──────────────┘   └──────────────┘

  With 10 shards (future):
  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
  │ S0 │ │ S1 │ │ S2 │ │ S3 │ │ S4 │ │ S5 │ │ S6 │ │ S7 │ │ S8 │ │ S9 │
  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘
  ← All 10 must have the EXACT same schema! →
```

### How Your Runner Handles This

Your [`migrate_shards.js`](file:///c:/Users/TARUN/Desktop/TinyURL/scripts/migrate_shards.js) does something clever:

```javascript
// 1. Discover all shards from environment variables
const shardUrls = Array.from({ length: NUM_SHARDS }, (_, i) => {
    return process.env[`DB_SHARD_${i}_URL`];
});

// 2. Migrate ALL shards in parallel
const results = await Promise.allSettled(
    shardUrls.map((url, i) => migrateOneShard(i, url))
);
```

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    PARALLEL MIGRATION                           │
  │                                                                 │
  │    npm run migrate                                               │
  │         │                                                       │
  │         ├──── Thread 1 ──▶ Shard 0 (port 5434)                 │
  │         │                  CREATE SCHEMA...                     │
  │         │                  CREATE TABLE...                      │
  │         │                  CREATE INDEX...                      │
  │         │                  ✅ Done                               │
  │         │                                                       │
  │         └──── Thread 2 ──▶ Shard 1 (port 5435)                 │
  │                            CREATE SCHEMA...                     │
  │                            CREATE TABLE...                      │
  │                            CREATE INDEX...                      │
  │                            ✅ Done                               │
  │                                                                 │
  │    Both finish ──▶ Report summary                               │
  └─────────────────────────────────────────────────────────────────┘
```

### `Promise.allSettled` vs `Promise.all`

This is a subtle but important design choice:

```javascript
// Promise.all — stops on FIRST failure:
await Promise.all([migrateShard0(), migrateShard1()]);
// If shard 0 fails → shard 1's migration is ABANDONED mid-flight!
// You don't know if shard 1 succeeded or not. 😰

// Promise.allSettled — runs ALL, reports each:
const results = await Promise.allSettled([migrateShard0(), migrateShard1()]);
// If shard 0 fails → shard 1 STILL COMPLETES.
// You get a clear report: Shard 0 ❌, Shard 1 ✅
// You know exactly what to fix.
```

```
  Promise.all:                      Promise.allSettled:
  ──────────                        ──────────────────

  Shard 0: ❌ FAIL                  Shard 0: ❌ FAIL
  Shard 1: 🤷 Unknown               Shard 1: ✅ OK
  Shard 2: 🤷 Unknown               Shard 2: ✅ OK

  "Something failed. Good luck       "Shard 0 failed. Shards 1-2 are fine.
   figuring out what."                 Fix shard 0 and re-run."
```

### Connection Cleanup

After migrating, the runner properly cleans up:

```javascript
finally {
    client.release();    // Return connection to pool
    await pool.end();    // Close all connections and shut down pool
}
```

> [!IMPORTANT]
> Always close your pools after migration scripts! Unlike your server (which runs forever), migration scripts should connect, do their work, and exit cleanly. Leaked connections in a migration script can block subsequent scripts or leave zombie connections on PostgreSQL.

---

<a id="chapter-12-rollbacks"></a>
## ⏪ Chapter 12: Rollbacks — When Things Go Wrong

### The UP/DOWN Pattern

Professional migration systems use paired files:

```
  migrations/
  ├── 0001_create_urls.up.sql       ← Apply the change
  ├── 0001_create_urls.down.sql     ← UNDO the change
  ├── 0002_add_analytics.up.sql
  ├── 0002_add_analytics.down.sql
  └── ...
```

**UP migration** (forward):
```sql
-- 0001_create_urls.up.sql
CREATE TABLE url.URL (
    ID BIGINT PRIMARY KEY,
    OriginalURL TEXT NOT NULL,
    ShortURL TEXT NOT NULL
);
```

**DOWN migration** (rollback):
```sql
-- 0001_create_urls.down.sql
DROP TABLE url.URL;
```

### When to Use Rollbacks

```
  Scenario: You deployed migration 0005 to production.
  Problem:  It has a bug that breaks the app.
  Action:   Run the DOWN migration to undo it.

  $ npm run migrate:down    ← Runs 0005.down.sql
  
  Database is back to state after migration 0004.
  App works again while you fix the bug.
```

### Writing Safe DOWN Migrations

| UP Statement | DOWN Statement | Notes |
|:--|:--|:--|
| `CREATE TABLE X` | `DROP TABLE X` | ⚠️ Destroys all data in the table! |
| `ADD COLUMN X` | `ALTER TABLE DROP COLUMN X` | ⚠️ Destroys data in that column! |
| `CREATE INDEX X` | `DROP INDEX X` | ✅ Safe — indexes contain no unique data |
| `INSERT INTO X` | `DELETE FROM X WHERE ...` | ⚠️ Tricky — must match exact rows |
| `ALTER COLUMN TYPE` | `ALTER COLUMN TYPE (original)` | ⚠️ May lose precision |

> [!WARNING]
> **Rollbacks are NOT free.** A DOWN migration that drops a table **permanently deletes all data in it.** In production, you might choose to keep the table and just roll back the application code instead. Rollbacks are a last resort, not a daily tool.

### Your TinyURL's Current Approach

Your project doesn't have formal DOWN migrations (which is fine for the current stage). Your `IF NOT EXISTS` pattern provides a different kind of safety:

```
  Instead of "undo mistakes with DOWN migrations"
  You use "mistakes are harmless because IF NOT EXISTS"
  
  This works for CREATE statements, but won't work for:
  - ALTER TABLE (no IF NOT EXISTS equivalent for most ALTERs)
  - DROP COLUMN (destructive and irreversible)
  - Data migrations (INSERT/UPDATE)
```

---

<a id="chapter-13-production"></a>
## 🏭 Chapter 13: Production Migration Strategies

### The Fear of Production Migrations

```
  Local development:
  "Let me just drop the table and recreate it." 🤷

  Production with 50 million rows:
  "If I mess this up, the CEO will personally fire me at 2 AM." 😱
```

### Safe Production Migration Patterns

#### Pattern 1: Zero-Downtime Column Addition

```sql
-- ✅ SAFE — Adding a nullable column is instant, no table lock
ALTER TABLE url.URL ADD COLUMN user_id BIGINT;

-- ❌ DANGEROUS — Adding a NOT NULL column locks the table!
ALTER TABLE url.URL ADD COLUMN user_id BIGINT NOT NULL DEFAULT 0;
-- This rewrites EVERY row in the table. On 50M rows = minutes of downtime.

-- ✅ SAFE alternative (3 steps):
-- Step 1: Add nullable column (instant)
ALTER TABLE url.URL ADD COLUMN user_id BIGINT;
-- Step 2: Backfill data in batches (no lock)
UPDATE url.URL SET user_id = 0 WHERE user_id IS NULL AND ID BETWEEN 0 AND 1000000;
UPDATE url.URL SET user_id = 0 WHERE user_id IS NULL AND ID BETWEEN 1000001 AND 2000000;
-- ... continue in batches ...
-- Step 3: Add NOT NULL constraint (after all rows are populated)
ALTER TABLE url.URL ALTER COLUMN user_id SET NOT NULL;
```

#### Pattern 2: Creating Indexes Without Locking

```sql
-- ❌ DANGEROUS — Locks the table for the duration of index creation!
CREATE INDEX idx_new ON url.URL (OriginalURL);
-- On 50M rows = table locked for minutes. No reads or writes!

-- ✅ SAFE — Creates index in the background, no lock!
CREATE INDEX CONCURRENTLY idx_new ON url.URL (OriginalURL);
-- Takes longer, but the table remains fully usable.
-- Remember: can't be inside a transaction!
```

#### Pattern 3: The Expand-Contract Pattern (for Renaming)

```
  Goal: Rename column "ShortURL" to "short_key"

  ❌ WRONG: ALTER TABLE url.URL RENAME COLUMN ShortURL TO short_key;
  (Instantly breaks ALL application code that references "ShortURL"!)

  ✅ CORRECT (3-phase deploy):

  Phase 1 — EXPAND:
  ┌─────────────────────────────────────────────────────────┐
  │ Migration: Add new column                               │
  │ ALTER TABLE url.URL ADD COLUMN short_key TEXT;           │
  │                                                         │
  │ App code: Write to BOTH columns                         │
  │ INSERT INTO url.URL (ShortURL, short_key) VALUES ($1,$1)│
  │ Read from: ShortURL (old column)                        │
  └─────────────────────────────────────────────────────────┘

  Phase 2 — MIGRATE:
  ┌─────────────────────────────────────────────────────────┐
  │ Migration: Backfill new column                          │
  │ UPDATE url.URL SET short_key = ShortURL                 │
  │     WHERE short_key IS NULL;                            │
  │                                                         │
  │ App code: Read from NEW column (short_key)              │
  └─────────────────────────────────────────────────────────┘

  Phase 3 — CONTRACT:
  ┌─────────────────────────────────────────────────────────┐
  │ Migration: Drop old column                              │
  │ ALTER TABLE url.URL DROP COLUMN ShortURL;               │
  │                                                         │
  │ App code: Uses only short_key                           │
  └─────────────────────────────────────────────────────────┘
```

### Migration Pre-Flight Checklist

Before running any migration in production:

```
  ☐  Migration tested on a staging database with production-sized data
  ☐  Migration reviewed by at least one other developer
  ☐  Rollback plan documented (DOWN migration or manual steps)
  ☐  Database backup taken BEFORE running migration
  ☐  Migration does not lock large tables for extended periods
  ☐  Application code is forward-compatible (handles both old and new schema)
  ☐  Monitoring dashboards open (watch for errors, latency spikes)
  ☐  Run during low-traffic window if possible
```

---

<a id="chapter-14-cheat-sheet"></a>
## 📋 Chapter 14: Quick Reference Cheat Sheet

### Migration File Naming

```
  [sequence]_[description].[sql|js]

  0001_create_schema.sql
  0002_create_urls_table.sql
  0003_add_click_analytics.sql
  0004_add_expires_at_column.sql
  0005_create_users_table.sql
```

### Safe SQL Statements for Migrations

```sql
-- Creating things (idempotent with IF NOT EXISTS):
CREATE SCHEMA IF NOT EXISTS schema_name;
CREATE TABLE IF NOT EXISTS table_name (...);
CREATE INDEX IF NOT EXISTS index_name ON table_name (column);

-- Adding columns (instant, no lock):
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS col_name TYPE;

-- Creating indexes without locking:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name ON table_name (column);

-- Dropping things safely:
DROP TABLE IF EXISTS table_name;
DROP INDEX IF EXISTS index_name;
ALTER TABLE table_name DROP COLUMN IF EXISTS col_name;
```

### Your TinyURL Migration Commands

| Command | What It Does |
|:--|:--|
| `npm run migrate` | Runs [`migrate_shards.js`](file:///c:/Users/TARUN/Desktop/TinyURL/scripts/migrate_shards.js) — creates all tables and indexes on all shards |
| `npm run dev` | Starts the server (run AFTER migrate) |
| `npm run inspect-db` | Checks what data exists in the analytics tables |

### Migration Flow Summary

```
  Developer writes SQL ──▶ Commits to Git ──▶ PR reviewed ──▶ Merged
                                                                  │
  ┌───────────────────────────────────────────────────────────────┘
  │
  ▼
  CI/CD pipeline runs ──▶ npm run migrate ──▶ Tests pass ──▶ Deploy app
                               │
                               ▼
                     ┌─── For each shard ───┐
                     │                      │
                     │  Connect to database  │
                     │  Run SQL statements   │
                     │  Verify tables exist   │
                     │  Clean up connection   │
                     │                      │
                     └──────────────────────┘
```

### The Mental Model

```
  Migrations are like GIT, but for your database:

  Git commit    = Migration file
  git log       = schema_migrations table
  git push      = npm run migrate
  git revert    = DOWN migration / rollback
  .gitignore    = IF NOT EXISTS (skip what's done)
  merge conflict = Two developers creating the same migration number

  Your database schema is version-controlled,
  just like your application code.
```

---

## 🎓 Final Mental Model

```
  Think of migrations as JOURNAL ENTRIES for your database:

  📓 Entry 1:   "August 10 — Built the main building (url.URL table)"
  📓 Entry 2:   "August 12 — Added the analytics wing (click_analytics)"
  📓 Entry 3:   "August 15 — Installed GPS signage (indexes)"
  📓 Entry 4:   "September 1 — Added visitor parking (users table)"

  You can:
  ✅ Read the journal to see the full history
  ✅ Replay entries 1-4 to build an identical structure
  ✅ Give the journal to a new builder (developer) — they can recreate everything
  ✅ Add new entries, but NEVER erase or rewrite old ones

  The journal only moves forward. Like time itself.
```

> **Migrations aren't about writing SQL files. They're about making database changes predictable, repeatable, and safe — the same way Git made code changes predictable, repeatable, and safe.**

---

*This guide is part of the TinyURL backend documentation. See also: [Database Schema Design](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/database_schema_design.md) · [Connection Pooling](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/connection_pooling.md) · [Caching Strategies](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/caching_strategies.md)*
