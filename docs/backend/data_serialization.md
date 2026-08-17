# 📦 The Complete Guide to Data Serialization (JSON vs Binary Buffers)

> *"Every piece of data your server sends or receives must be packed into bytes for transmission and unpacked on the other end. Serialization is that packing process. The format you choose determines how fast your data travels, how much space it takes, and whether a human can read it."*

This guide teaches you **everything** about data serialization — what it is, why it exists, every format you'll encounter, how JSON and binary buffers work at the byte level, and exactly where your TinyURL project serializes and deserializes data across its entire stack.

---

## 📖 Table of Contents

1. [Chapter 1: What Is Serialization? — The Moving Day Analogy](#chapter-1-what-is-serialization)
2. [Chapter 2: Text vs Binary — The Two Worlds](#chapter-2-text-vs-binary)
3. [Chapter 3: JSON — The Universal Language](#chapter-3-json)
4. [Chapter 4: JSON.stringify & JSON.parse — The Packing & Unpacking](#chapter-4-stringify-parse)
5. [Chapter 5: Binary Buffers — Raw Bytes, Maximum Speed](#chapter-5-binary-buffers)
6. [Chapter 6: Character Encoding — UTF-8, ASCII, and Why It Matters](#chapter-6-encoding)
7. [Chapter 7: How HTTP Serializes Data (Content-Type)](#chapter-7-http)
8. [Chapter 8: How Redis Serializes Data (RESP Protocol)](#chapter-8-redis)
9. [Chapter 9: How PostgreSQL Serializes Data (Wire Protocol)](#chapter-9-postgres)
10. [Chapter 10: How Your TinyURL Serializes Everywhere](#chapter-10-your-tinyurl)
11. [Chapter 11: Alternative Formats — Protocol Buffers, MessagePack, BSON](#chapter-11-alternatives)
12. [Chapter 12: Performance Comparison — JSON vs Binary](#chapter-12-performance)
13. [Chapter 13: When to Choose What — The Decision Framework](#chapter-13-when-to-choose)
14. [Chapter 14: Quick Reference Cheat Sheet](#chapter-14-cheat-sheet)

---

<a id="chapter-1-what-is-serialization"></a>
## 📕 Chapter 1: What Is Serialization? — The Moving Day Analogy

### 📦 The Moving Day Story

You're moving to a new house. You have a **living room** full of things:

```
  Your living room (in-memory data):
  ┌────────────────────────────────────────────────┐
  │  🛋️  Couch (object with cushions, legs, fabric) │
  │  📚  Bookshelf (array of books)                │
  │  🖼️  Paintings (nested objects)                 │
  │  🪴  Plants (with soil, pot, species)           │
  └────────────────────────────────────────────────┘

  Problem: You can't teleport a couch through a wire.
  You need to DISASSEMBLE everything, pack it into boxes,
  label the boxes, ship them, and REASSEMBLE at the new house.
```

**That's serialization and deserialization:**

```
  SERIALIZATION (Packing):
  Living room objects → Disassemble → Pack into labeled boxes → Ship

  DESERIALIZATION (Unpacking):
  Receive boxes → Read labels → Reassemble → Living room objects

  In code:
  JavaScript object → JSON.stringify() → String of bytes → Send over network
  Receive bytes → JSON.parse() → JavaScript object → Use in your code
```

### The Formal Definition

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  SERIALIZATION:                                                     │
  │  Converting an in-memory data structure (object, array, number)    │
  │  into a format that can be stored or transmitted.                   │
  │                                                                     │
  │  DESERIALIZATION:                                                   │
  │  Converting that stored/transmitted format back into an in-memory  │
  │  data structure.                                                    │
  │                                                                     │
  │  WHY it exists:                                                     │
  │  • RAM data structures (pointers, heap objects) can't travel       │
  │    across networks or be written to disk.                          │
  │  • You need a flat, portable representation: BYTES.                │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

### Where Serialization Happens in Your TinyURL

```
  ┌── Every arrow below involves serialization ────────────────────────┐
  │                                                                     │
  │  Browser ←──JSON──→ Fastify ←──RESP──→ Redis                      │
  │                       │                                             │
  │                       ├──Wire Protocol──→ PostgreSQL               │
  │                       │                                             │
  │                       └──Prometheus Text──→ Grafana                │
  │                                                                     │
  │  Every. Single. Arrow. Is serialization + deserialization.         │
  │  You just don't see it because frameworks handle it for you.      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-2-text-vs-binary"></a>
## 📗 Chapter 2: Text vs Binary — The Two Worlds

### The Postcard vs Package Analogy

```
  TEXT SERIALIZATION (JSON, XML, CSV):
  ────────────────────────────────────
  Like sending a POSTCARD ✉️
  • Anyone can read it (human-readable)
  • Written in a language everyone understands
  • Takes more space (words are verbose)
  • Easy to debug (just look at it!)

  BINARY SERIALIZATION (Protocol Buffers, MessagePack, raw Buffers):
  ──────────────────────────────────────────────────────────────────
  Like sending a SEALED PACKAGE 📦
  • Only the recipient with instructions can decode it
  • Written in a compact code (not human-readable)
  • Takes less space (every byte carries max info)
  • Hard to debug (need special tools to inspect)
```

### The Same Data — Two Representations

```
  DATA: A URL mapping { shortKey: "abc123", url: "https://google.com" }

  AS JSON (text, 56 bytes):
  {"shortKey":"abc123","url":"https://google.com"}
  
  Every character is human-readable. You can copy-paste it.
  You can read it in a log file. You can debug it visually.

  AS BINARY (MessagePack, ~38 bytes):
  82 a8 73 68 6f 72 74 4b 65 79 a6 61 62 63 31 32
  33 a3 75 72 6c b4 68 74 74 70 73 3a 2f 2f 67 6f
  6f 67 6c 65 2e 63 6f 6d

  Looks like gibberish. But it's 32% smaller!
  And it's faster to parse (no string scanning).
```

### The Tradeoff Spectrum

```
  Human Readable ◄──────────────────────────────► Machine Efficient
  
  JSON        XML       YAML      BSON     MsgPack    Protobuf     Raw Bytes
  ├───────────┤          ├──────────┤         ├──────────┤            │
  Easy to     Easy to    Compact    Very      Ultimate
  read/debug  write      & fast     compact   speed
  
  Verbose     Verbose    Moderate   Small     Tiny       Tiny         Zero
  (~100 bytes) (~200 bytes)          (~65 B)  (~50 B)    (~35 B)     overhead
```

---

<a id="chapter-3-json"></a>
## 📘 Chapter 3: JSON — The Universal Language

### What JSON Actually Is

JSON (JavaScript Object Notation) is a **text-based** data format that represents structured data as human-readable strings.

```
  JSON supports exactly 6 data types:

  ┌─────────────────────────────────────────────────────────────────┐
  │  TYPE      │  JSON EXAMPLE           │  JS EQUIVALENT          │
  │────────────│─────────────────────────│─────────────────────────│
  │  String    │  "hello"                │  "hello"                │
  │  Number    │  42, 3.14, -17          │  42, 3.14, -17          │
  │  Boolean   │  true, false            │  true, false            │
  │  Null      │  null                   │  null                   │
  │  Array     │  [1, 2, "three"]        │  [1, 2, "three"]       │
  │  Object    │  {"key": "value"}       │  {key: "value"}        │
  │                                                                 │
  │  NOT supported by JSON:                                         │
  │  ❌ undefined    (JS only)                                      │
  │  ❌ function     (can't serialize code)                         │
  │  ❌ Date         (serialized as string, loses type info)        │
  │  ❌ BigInt       (throws error! critical for your Snowflake IDs)│
  │  ❌ Map / Set    (serialized as empty object)                   │
  │  ❌ Symbol       (silently dropped)                             │
  │  ❌ Infinity/NaN (serialized as null)                           │
  └─────────────────────────────────────────────────────────────────┘
```

### Why JSON Won the Internet

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  JSON'S ADVANTAGES:                                                │
  │                                                                     │
  │  ✅ Human-readable (debug by looking at it!)                       │
  │  ✅ Language-agnostic (every language has a JSON parser)            │
  │  ✅ Native to JavaScript (no import needed)                        │
  │  ✅ Self-describing (keys tell you what values mean)               │
  │  ✅ Ubiquitous (100% of REST APIs use it)                          │
  │  ✅ Tool support (every editor highlights it, every API tool       │
  │     like Postman/curl understands it)                              │
  │                                                                     │
  │  JSON'S DISADVANTAGES:                                              │
  │                                                                     │
  │  ❌ Verbose (keys repeated in every object of an array)            │
  │  ❌ Slow to parse (string scanning, quote matching)                │
  │  ❌ No binary data (must Base64-encode images, adding 33% size)    │
  │  ❌ No comments (can't annotate config files)                      │
  │  ❌ No type info beyond the 6 basics (no Date, no BigInt)          │
  │  ❌ Precision loss with large numbers (> 2^53 for integers)        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-4-stringify-parse"></a>
## 📙 Chapter 4: JSON.stringify & JSON.parse — The Packing & Unpacking

### JSON.stringify() — Object → String

```javascript
const data = {
    shortKey: "abc123",
    url: "https://google.com",
    clicks: 42,
    active: true,
    tags: ["popular", "social"],
    meta: null
};

const json = JSON.stringify(data);
// '{"shortKey":"abc123","url":"https://google.com","clicks":42,
//   "active":true,"tags":["popular","social"],"meta":null}'

typeof data;  // "object"  (lives in memory, has methods, prototype chain)
typeof json;  // "string"  (flat text, can be sent over a wire)
```

### What Happens Inside JSON.stringify()

```
  Step-by-step, JSON.stringify traverses your object:

  Input: { shortKey: "abc123", clicks: 42, tags: ["a","b"] }

  1. Open brace:            {
  2. First key:             "shortKey":
  3. First value (string):  "abc123"
  4. Comma:                 ,
  5. Second key:            "clicks":
  6. Second value (number): 42
  7. Comma:                 ,
  8. Third key:             "tags":
  9. Third value (array):   ["a","b"]
  10. Close brace:          }

  Output: '{"shortKey":"abc123","clicks":42,"tags":["a","b"]}'

  Every object property becomes a "key":value text pair.
  Strings get wrapped in double quotes.
  Numbers stay as-is.
  Arrays become [...] with commas.
```

### JSON.parse() — String → Object

```javascript
const json = '{"shortKey":"abc123","url":"https://google.com"}';

const data = JSON.parse(json);
// { shortKey: "abc123", url: "https://google.com" }

data.shortKey;  // "abc123" — it's a real JS object now!
data.url;       // "https://google.com"
```

### What Happens Inside JSON.parse()

```
  Step-by-step, JSON.parse scans the string character by character:

  Input: '{"shortKey":"abc123","clicks":42}'

  Pos 0:  { → Start of object
  Pos 1:  " → Start of key string
  Pos 2-9: shortKey → Key text
  Pos 10: " → End of key string
  Pos 11: : → Key-value separator
  Pos 12: " → Start of value string
  Pos 13-18: abc123 → Value text
  Pos 19: " → End of value string
  Pos 20: , → Next property
  Pos 21: " → Start of key string
  ...and so on...

  The parser must scan EVERY character. For large JSON (megabytes),
  this character-by-character scanning becomes a performance bottleneck.
```

### ⚠️ The BigInt Trap — Critical for Your TinyURL!

```javascript
// Your Snowflake ID generates BigInts like this:
const rawId = snowflake.nextRawId();
// rawId = 7291038479048704n  (a BigInt — note the 'n' suffix)

// JSON.stringify CANNOT handle BigInt!
JSON.stringify({ id: rawId });
// ❌ TypeError: Do not know how to serialize a BigInt

// THAT'S WHY your code converts BigInt to string BEFORE serialization:
// In your database query, the BigInt is passed as a query parameter,
// and pg (node-postgres) handles the conversion.
// In your API response, you return the Base62-encoded string:
const shortKey = encode(rawId);  // "2HhH9fK" — a regular string ✅
```

```
  The BigInt Problem Explained:

  JavaScript Number:  Safe up to 2^53 - 1 = 9,007,199,254,740,991
  Your Snowflake ID:  Can be up to 2^63 = 9,223,372,036,854,775,808

  If you serialized a large Snowflake ID as a JSON number:
  { "id": 9223372036854775808 }
  
  The receiving end would parse it as:
  { "id": 9223372036854776000 }  ← WRONG! Last digits lost! 💀

  Solution 1: Send as string:  { "id": "9223372036854775808" }
  Solution 2: Send as Base62:  { "shortKey": "2HhH9fK" }  ← your approach ✅
```

> [!CAUTION]
> **Never send raw BigInt or large integer IDs as JSON numbers.** JavaScript (and many other languages) lose precision above 2^53. Always convert to a string first. Your TinyURL's Base62 encoding elegantly solves this.

### Common JSON.stringify Gotchas

```javascript
// 1. undefined is DROPPED silently
JSON.stringify({ a: 1, b: undefined, c: 3 });
// '{"a":1,"c":3}'  — b is gone!

// 2. Functions are DROPPED silently
JSON.stringify({ name: "test", fn: () => {} });
// '{"name":"test"}'  — fn is gone!

// 3. Date becomes a string (can't be auto-restored)
JSON.stringify({ created: new Date() });
// '{"created":"2026-08-17T12:00:00.000Z"}'
JSON.parse('{"created":"2026-08-17T12:00:00.000Z"}').created;
// "2026-08-17T12:00:00.000Z"  — it's a STRING, not a Date object!

// 4. Map and Set become empty objects
JSON.stringify({ cache: new Map([["a", 1]]) });
// '{"cache"}'  — data LOST!

// 5. Circular references CRASH
const obj = {};
obj.self = obj;
JSON.stringify(obj);
// ❌ TypeError: Converting circular structure to JSON

// 6. NaN and Infinity become null
JSON.stringify({ x: NaN, y: Infinity });
// '{"x":null,"y":null}'
```

---

<a id="chapter-5-binary-buffers"></a>
## 📒 Chapter 5: Binary Buffers — Raw Bytes, Maximum Speed

### What Is a Buffer?

A Buffer is a chunk of raw memory — a fixed-length sequence of bytes. No structure, no keys, no type info. Just raw data.

```
  JSON string:  '{"shortKey":"abc123"}'
                 ↓ Every character = 1 byte (ASCII)
  As bytes:     7b 22 73 68 6f 72 74 4b 65 79 22 3a 22 61 62 63 31 32 33 22 7d
                { "  s  h  o  r  t  K  e  y  "  :  "  a  b  c  1  2  3  "  }
                
  That's 21 bytes for a simple key-value pair.
  The quotes, colons, and braces are OVERHEAD — they carry no data,
  only structure.

  Binary encoding of the SAME data:
  06 61 62 63 31 32 33
  ↑  ↑──────────────↑
  │  The 6 bytes of "abc123"
  Length prefix (6 bytes of data follow)

  That's 7 bytes! 3x smaller! ⚡
  No quotes, no colons, no braces — just the data.
```

### Node.js Buffer Basics

```javascript
// Creating buffers
const buf1 = Buffer.from('abc123');           // From string
const buf2 = Buffer.from([0x61, 0x62, 0x63]); // From byte array
const buf3 = Buffer.alloc(10);                 // 10 zero-filled bytes

// Inspecting buffers
buf1.length;          // 6 (bytes)
buf1[0];              // 97 (decimal for 'a')
buf1.toString('hex'); // '616263313233'
buf1.toString('utf8');// 'abc123'

// Buffers are NOT strings!
typeof buf1;          // 'object'
typeof 'abc123';      // 'string'
```

### How Your Snowflake ID Uses Binary Thinking

Your [`snowflake.js`](file:///c:/Users/TARUN/Desktop/TinyURL/src/id-generation/snowflake.js) packs data into a 64-bit integer using bitwise operations:

```javascript
return (timestamp << TIMESTAMP_SHIFT)
     | (this.#machineId << MACHINE_SHIFT)
     | this.#sequence;
```

```
  This IS binary serialization! You're packing 3 values into 1 number:

  64-bit Snowflake ID:
  ┌──────────── 41 bits ────────────┬── 10 bits ──┬── 12 bits ──┐
  │         Timestamp               │  Machine ID │  Sequence   │
  │  (ms since custom epoch)        │  (0-1023)   │  (0-4095)   │
  └─────────────────────────────────┴─────────────┴─────────────┘
  
  Bit positions:
  63                    22         12           0
  ├────── timestamp ────┤──machine─┤──sequence──┤

  Value: 0001011011... 0000000001 000000000000
         (timestamp)   (machine 1) (sequence 0)

  Three fields packed into 8 bytes (64 bits).
  In JSON, this would be ~80 bytes:
  {"timestamp":1723729500000,"machineId":1,"sequence":0}
  
  Binary: 8 bytes. JSON: 80 bytes. 10x difference! ⚡
```

### Then Base62 Re-Serializes It for Humans

```
  Binary (64-bit integer):
  0000 0001 1010 1011 ... (8 bytes, not human-readable)
       │
       ▼ encode()
  Base62 string:
  "2HhH9fK" (7 characters, human-readable, URL-safe)
       │
       ▼ send in HTTP response
  JSON:
  { "shortKey": "2HhH9fK" }

  The journey:
  3 numbers → 1 packed BigInt → 1 Base62 string → 1 JSON field
  (binary)    (binary)          (text)             (text)

  You go from binary (efficient) to text (readable) at the API boundary.
```

---

<a id="chapter-6-encoding"></a>
## 📔 Chapter 6: Character Encoding — UTF-8, ASCII, and Why It Matters

### What Is Character Encoding?

```
  Computers only understand numbers (0 and 1).
  Characters (letters, emojis) must be mapped to numbers.
  
  Character encoding = the MAP that says which number = which character.

  ASCII (1963, 128 characters):
  ┌────────┬────────┬──────────┐
  │ Number │  Hex   │ Character│
  │────────│────────│──────────│
  │   48   │  0x30  │    0     │
  │   65   │  0x41  │    A     │
  │   97   │  0x61  │    a     │
  │  123   │  0x7B  │    {     │
  │  125   │  0x7D  │    }     │
  └────────┴────────┴──────────┘
  Only English letters, numbers, and symbols. No emojis! No 中文! No العربية!

  UTF-8 (1993, 1,112,064 characters):
  ┌──────────┬──────────────────┬──────────┐
  │ Bytes    │  Hex             │ Character│
  │──────────│──────────────────│──────────│
  │ 1 byte   │  0x41            │    A     │  (same as ASCII!)
  │ 2 bytes  │  0xC3 0xA9       │    é     │
  │ 3 bytes  │  0xE4 0xB8 0xAD  │    中    │
  │ 4 bytes  │  0xF0 0x9F 0x98 0x80│  😀    │
  └──────────┴──────────────────┴──────────┘
  Every character in every language, plus emojis!
```

### Why This Matters for Your TinyURL

```
  Your URLs can contain UTF-8 characters!

  Original URL:    https://example.com/café/résumé
  JSON serialized: {"originalUrl":"https://example.com/café/résumé"}
  
  'é' is 2 bytes in UTF-8 (0xC3 0xA9), not 1.
  JSON.stringify handles this automatically in Node.js. ✅

  Your Base62 alphabet is pure ASCII:
  0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
  
  Every character = exactly 1 byte. URL-safe. No encoding issues. ✅
```

---

<a id="chapter-7-http"></a>
## 📚 Chapter 7: How HTTP Serializes Data (Content-Type)

### The Content-Type Header — The Label on the Box

```
  When your browser sends a POST request, it must tell the server:
  "Hey, the data in this request body is in THIS format."

  That's what the Content-Type header does:
  
  Content-Type: application/json
  ↑              ↑
  Header name    "I'm sending JSON"
```

### Your TinyURL's HTTP Serialization Flow

**Request (client → server):**

From your [`k6_stress_test.js`](file:///c:/Users/TARUN/Desktop/TinyURL/tests/load/k6_stress_test.js):

```javascript
const payload = JSON.stringify({ originalUrl: 'https://example.com/page' });
const params = { headers: { 'Content-Type': 'application/json' } };
const res = http.post(`${BASE_URL}/api/shorten`, payload, params);
```

```
  What travels on the wire:

  POST /api/shorten HTTP/1.1
  Host: localhost:3099
  Content-Type: application/json          ← "This body is JSON!"
  Content-Length: 49                       ← "It's 49 bytes long"

  {"originalUrl":"https://example.com/page"}  ← The serialized body
```

**Fastify deserialization (automatic):**

```
  Fastify sees Content-Type: application/json
       │
       ▼
  Automatically calls JSON.parse() on the body
       │
       ▼
  req.body = { originalUrl: "https://example.com/page" }
       │
       ▼
  Your controller accesses: req.body.originalUrl  ← Already a JS object!
```

**Response (server → client):**

From your [`shorten.controller.js`](file:///c:/Users/TARUN/Desktop/TinyURL/src/modules/shorten/shorten.controller.js):

```javascript
res.status(201).send({
    short_url: `${req.protocol}://${req.headers.host}/${short_url_key}`,
    shortKey: short_url_key
});
```

```
  What Fastify sends on the wire:

  HTTP/1.1 201 Created
  Content-Type: application/json          ← Fastify auto-sets this!
  Content-Length: 72

  {"short_url":"http://localhost:3099/2HhH9fK","shortKey":"2HhH9fK"}

  Fastify automatically calls JSON.stringify() on the object you pass
  to res.send(). You never have to serialize manually!
```

### The Content-Type Family

| Content-Type | Format | Human Readable? | Your TinyURL Uses? |
|:--|:--|:--|:--|
| `application/json` | JSON | ✅ Yes | ✅ API requests & responses |
| `text/plain` | Plain text | ✅ Yes | ✅ Prometheus metrics |
| `text/html` | HTML | ✅ Yes | ❌ (no web UI yet) |
| `application/octet-stream` | Raw binary | ❌ No | ❌ |
| `application/x-protobuf` | Protocol Buffers | ❌ No | ❌ |
| `application/msgpack` | MessagePack | ❌ No | ❌ |
| `multipart/form-data` | File uploads | Mixed | ❌ |

---

<a id="chapter-8-redis"></a>
## 📖 Chapter 8: How Redis Serializes Data (RESP Protocol)

### RESP — Redis Serialization Protocol

When your code calls `redis.get("url:abc123")`, ioredis doesn't send JSON. It speaks **RESP** — Redis's own binary-text hybrid protocol.

```
  Your code:           redis.get("url:abc123")
  
  ioredis serializes:  *2\r\n$3\r\nGET\r\n$10\r\nurl:abc123\r\n
  
  Let's decode that:
  
  *2\r\n         → "This message has 2 parts (command + key)"
  $3\r\n         → "Next part is 3 bytes long"
  GET\r\n        → "The command: GET"
  $10\r\n        → "Next part is 10 bytes long"
  url:abc123\r\n → "The key: url:abc123"

  Redis responds:
  $23\r\n                             → "Response is 23 bytes"
  https://www.google.com\r\n          → "The value"

  ioredis deserializes this back into a JavaScript string:
  "https://www.google.com"
```

### Your XADD Command — Serialized to RESP

```javascript
redis.xadd('stream:clicks', '*',
    'shortKey', 'abc123',
    'ip', '1.2.3.4'
);
```

```
  ioredis translates this to RESP:

  *8\r\n                    → 8 parts total
  $4\r\nXADD\r\n            → Command: XADD
  $13\r\nstream:clicks\r\n  → Stream name
  $1\r\n*\r\n               → Auto-generate ID
  $8\r\nshortKey\r\n        → Field name 1
  $6\r\nabc123\r\n          → Field value 1
  $2\r\nip\r\n              → Field name 2
  $7\r\n1.2.3.4\r\n         → Field value 2

  Notice: Even though it looks text-ish, RESP uses LENGTH PREFIXES
  ($4, $13, $1, $8, etc.) — this is a binary-friendly technique.
  The parser doesn't need to scan for delimiters — it knows exactly
  how many bytes to read. Fast! ⚡
```

### Why Redis Uses RESP Instead of JSON

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  If Redis used JSON:                                               │
  │  {"command":"GET","args":["url:abc123"]}                           │
  │  → 46 bytes, requires JSON parser, slow string scanning           │
  │                                                                     │
  │  RESP:                                                              │
  │  *2\r\n$3\r\nGET\r\n$10\r\nurl:abc123\r\n                          │
  │  → 30 bytes, length-prefixed, parser reads exact byte counts      │
  │                                                                     │
  │  RESP is 35% smaller AND faster to parse.                          │
  │  At 100,000 ops/sec, this adds up to real savings. ⚡              │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<a id="chapter-9-postgres"></a>
## 📃 Chapter 9: How PostgreSQL Serializes Data (Wire Protocol)

### The pg (node-postgres) Serialization Chain

When your code runs:

```javascript
await pool.query(
    `INSERT INTO url.URL (ID, OriginalURL, ShortURL) VALUES ($1, $2, $3)`,
    [rawId, originalURL, shortKey]
);
```

Here's the serialization journey:

```
  Your JavaScript:
  [7291038479048704n, "https://google.com", "2HhH9fK"]
       │
       ▼ pg library serializes parameters
  PostgreSQL Wire Protocol (binary):
  ┌──────────────────────────────────────────────────────────────────┐
  │  Message Type: 'P' (Parse)                                      │
  │  Query: INSERT INTO url.URL (ID, OriginalURL, ShortURL)        │
  │         VALUES ($1, $2, $3)                                     │
  │                                                                  │
  │  Message Type: 'B' (Bind)                                       │
  │  Parameter 1: "7291038479048704" (BigInt → text representation) │
  │  Parameter 2: "https://google.com"                              │
  │  Parameter 3: "2HhH9fK"                                        │
  │                                                                  │
  │  Message Type: 'E' (Execute)                                    │
  └──────────────────────────────────────────────────────────────────┘
       │
       ▼ Sent over TCP to PostgreSQL server
  PostgreSQL parses, executes, returns result
       │
       ▼ Response in wire protocol
  ┌──────────────────────────────────────────────────────────────────┐
  │  Message Type: 'C' (CommandComplete)                            │
  │  Tag: "INSERT 0 1" (1 row inserted)                             │
  └──────────────────────────────────────────────────────────────────┘
       │
       ▼ pg library deserializes response
  Your JavaScript: { command: 'INSERT', rowCount: 1 }
```

### Why Parameterized Queries ($1, $2, $3) Are Serialization Too

```
  UNSAFE (string concatenation — NO serialization):
  `INSERT INTO url.URL VALUES (${rawId}, '${url}', '${key}')`
  
  If url = "'; DROP TABLE url.URL; --"
  Query becomes: INSERT INTO url.URL VALUES (123, ''; DROP TABLE url.URL; --', 'abc')
  💀 SQL INJECTION! Your table is deleted!

  SAFE (parameterized — proper serialization):
  `INSERT INTO url.URL VALUES ($1, $2, $3)`, [rawId, url, key]
  
  The pg library SERIALIZES each parameter separately from the query.
  The parameter values are sent as DATA, never as executable SQL.
  Even if url = "'; DROP TABLE...", PostgreSQL treats it as a plain string value.
  ✅ SQL injection is IMPOSSIBLE with parameterized queries.
```

> [!IMPORTANT]
> **Parameterized queries are a form of serialization that prevents SQL injection.** Your TinyURL correctly uses `$1, $2, $3` parameters everywhere. Never use string interpolation for SQL queries.

---

<a id="chapter-10-your-tinyurl"></a>
## 🗺️ Chapter 10: How Your TinyURL Serializes Everywhere

Here's every serialization point in your entire system:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │            COMPLETE SERIALIZATION MAP                               │
  │                                                                     │
  │  BOUNDARY                 │ FORMAT   │ SERIALIZE     │ DESERIALIZE │
  │───────────────────────────│──────────│───────────────│─────────────│
  │                           │          │               │             │
  │  Client → Fastify         │ JSON     │ JSON.stringify│ JSON.parse  │
  │  (POST /api/shorten)      │          │ (client)      │ (Fastify)   │
  │                           │          │               │             │
  │  Fastify → Client         │ JSON     │ JSON.stringify│ JSON.parse  │
  │  (201 response)           │          │ (Fastify)     │ (client)    │
  │                           │          │               │             │
  │  Fastify → Redis          │ RESP     │ ioredis       │ Redis       │
  │  (GET/SET/XADD)           │          │ (automatic)   │ (automatic) │
  │                           │          │               │             │
  │  Redis → Fastify          │ RESP     │ Redis         │ ioredis     │
  │  (response)               │          │ (automatic)   │ (automatic) │
  │                           │          │               │             │
  │  Fastify → PostgreSQL     │ PG Wire  │ pg library    │ PostgreSQL  │
  │  (INSERT/SELECT)          │ Protocol │ (automatic)   │ (automatic) │
  │                           │          │               │             │
  │  PostgreSQL → Fastify     │ PG Wire  │ PostgreSQL    │ pg library  │
  │  (result rows)            │ Protocol │ (automatic)   │ (automatic) │
  │                           │          │               │             │
  │  Snowflake → Base62       │ Binary → │ Bitwise ops   │ encode()    │
  │  (ID generation)          │ Text     │ (<< | &)      │ (division)  │
  │                           │          │               │             │
  │  Fastify → Prometheus     │ Text     │ prom-client   │ Prometheus  │
  │  (/metrics endpoint)      │ (OpenMetrics)│ register.metrics()│ (scrape) │
  │                           │          │               │             │
  │  Click event → Stream     │ RESP     │ String()      │ parseFields │
  │  (analytics)              │ (flat)   │ (explicit)    │ (manual)    │
  │                           │          │               │             │
  └───────────────────────────┴──────────┴───────────────┴─────────────┘
```

### The Click Event Serialization — A Detailed Example

Your analytics events go through multiple serialization stages:

```
  STAGE 1: JavaScript object (in memory)
  ────────────────────────────────────────
  {
      shortKey: "abc123",       // string
      userAgent: "Chrome/127",  // string
      ip: "1.2.3.4",            // string
      referrer: "twitter.com",  // string
      timestamp: 1723729500000  // number
  }

  STAGE 2: XADD arguments (explicit String conversion)
  ──────────────────────────────────────────────────────
  'shortKey', 'abc123',
  'userAgent', 'Chrome/127',
  'ip', '1.2.3.4',
  'referrer', 'twitter.com',
  'timestamp', '1723729500000'   ← String() converts number to string
  
  Redis Streams store ONLY strings. No types.
  You must convert numbers manually: String(timestamp || Date.now())

  STAGE 3: RESP on the wire (ioredis serialization)
  ──────────────────────────────────────────────────
  *12\r\n$4\r\nXADD\r\n$13\r\nstream:clicks\r\n$1\r\n*\r\n
  $8\r\nshortKey\r\n$6\r\nabc123\r\n ... (length-prefixed binary-text)

  STAGE 4: Consumer reads it back (manual deserialization)
  ────────────────────────────────────────────────────────
  // analytics_worker.js — parseFields()
  function parseFields(fieldsArray) {
      const obj = {};
      for (let i = 0; i < fieldsArray.length; i += 2) {
          obj[fieldsArray[i]] = fieldsArray[i + 1];
      }
      return obj;
  }
  // Converts: ['shortKey', 'abc123', 'ip', '1.2.3.4', ...]
  // Into:     { shortKey: 'abc123', ip: '1.2.3.4', ... }

  STAGE 5: Type restoration (manual parsing)
  ──────────────────────────────────────────
  const clickedAt = new Date(parseInt(data.timestamp, 10));
  // '1723729500000' → parseInt → 1723729500000 → new Date()
  // String → Number → Date object
  // This is MANUAL deserialization because Redis doesn't preserve types!
```

---

<a id="chapter-11-alternatives"></a>
## 📓 Chapter 11: Alternative Formats — Protocol Buffers, MessagePack, BSON

### Protocol Buffers (Protobuf) — Google's Binary Format

```
  Used by: Google (gRPC), most large-scale microservice systems

  // Define schema in a .proto file:
  message ClickEvent {
      string short_key = 1;
      string ip = 2;
      string user_agent = 3;
      int64 timestamp = 4;
  }

  // Serialized binary (about 35 bytes):
  0a 06 61 62 63 31 32 33 12 07 31 2e 32 2e 33 2e
  34 1a 0a 43 68 72 6f 6d 65 2f 31 32 37 20 80 ...

  Compared to JSON (about 95 bytes):
  {"short_key":"abc123","ip":"1.2.3.4","user_agent":"Chrome/127","timestamp":1723729500000}

  63% smaller! And 2-5x faster to serialize/deserialize!
```

### MessagePack — "JSON but Binary"

```
  Used by: Redis internals, game servers, real-time systems

  Same data as JSON, but in compact binary:
  JSON:        {"name":"abc","count":42}   → 24 bytes
  MessagePack: 82 a4 6e 61 6d 65 a3 61    → 16 bytes (33% smaller)
               62 63 a5 63 6f 75 6e 74
               2a

  Advantage: Drop-in replacement for JSON (same data model).
  No schema needed (unlike Protobuf).
```

### BSON — MongoDB's Binary JSON

```
  Used by: MongoDB

  Like JSON but with:
  ✅ Type preservation (Date stays Date, Binary stays Binary)
  ✅ Length-prefixed (fast to skip fields without parsing)
  ❌ Often LARGER than JSON (due to type headers)
  ❌ Mostly tied to MongoDB ecosystem
```

### The Format Comparison

```
  Encoding the same click event object:

  FORMAT          │ SIZE     │ PARSE SPEED │ SCHEMA? │ HUMAN READABLE?
  ────────────────│──────────│─────────────│─────────│────────────────
  JSON            │ 95 bytes │ Baseline    │ No      │ ✅ Yes
  MessagePack     │ 63 bytes │ 2x faster   │ No      │ ❌ No
  BSON            │ 102 bytes│ 1.5x faster │ No      │ ❌ No
  Protocol Buffers│ 35 bytes │ 5x faster   │ Yes     │ ❌ No
  Raw Binary      │ ~25 bytes│ 10x faster  │ Custom  │ ❌ No
  
  │←── easy to use ──────────────────────── fast & compact ──→│
```

---

<a id="chapter-12-performance"></a>
## ⚡ Chapter 12: Performance Comparison — JSON vs Binary

### When Does Format Matter?

```
  "Should I switch from JSON to Protobuf?"

  Let's do the math for YOUR TinyURL:

  JSON response: {"short_url":"http://localhost:3099/2HhH9fK","shortKey":"2HhH9fK"}
  Size: ~72 bytes
  JSON.stringify time: ~0.001ms (1 microsecond)

  At 10,000 requests/second:
  Total serialization time: 10,000 × 0.001ms = 10ms per second
  That's 10ms out of 1000ms = 1% of your server's time.

  If you switched to Protobuf (5x faster serialization):
  Total serialization time: 10,000 × 0.0002ms = 2ms per second
  Savings: 8ms per second.

  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │  8ms saved per second at 10,000 RPS.                           │
  │  In exchange for: schema files, code generation, build steps,  │
  │  loss of human readability, harder debugging.                   │
  │                                                                 │
  │  FOR YOUR TINYURL: NOT WORTH IT. JSON is perfect. ✅            │
  │                                                                 │
  │  FOR GOOGLE AT 10 MILLION RPS:                                 │
  │  8ms × 1000 = 8 SECONDS saved per second.                     │
  │  63% bandwidth savings = millions in infra costs.              │
  │  ABSOLUTELY WORTH IT. ✅                                        │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

### When to Switch Away from JSON

```
  STAY with JSON when:
  ──────────────────────
  ✅ Your API is human-facing (REST APIs, web apps)
  ✅ Your data is small (< 1KB per message)
  ✅ You value debuggability over raw speed
  ✅ You're under 100,000 RPS
  ✅ Your team is small and prefers simplicity

  SWITCH to binary when:
  ──────────────────────
  ⚡ You're doing microservice-to-microservice communication
  ⚡ Your messages are large (> 10KB) and frequent
  ⚡ Bandwidth costs are significant (cloud egress fees)
  ⚡ You're above 100,000 RPS and serialization is a bottleneck
  ⚡ Strict schema enforcement is desired (Protobuf)
  ⚡ Real-time systems (games, trading) where every ms matters
```

---

<a id="chapter-13-when-to-choose"></a>
## 🧭 Chapter 13: When to Choose What — The Decision Framework

### The Decision Flowchart

```
  Who will read this data?

  ├── Humans (developers, API users, log readers)?
  │   └── JSON ✅ (readable, debuggable, universal)
  │
  ├── Only machines (microservice-to-microservice)?
  │   ├── Need strict schema validation?
  │   │   └── Protocol Buffers ✅ (with gRPC)
  │   ├── Need JSON-like flexibility without schema?
  │   │   └── MessagePack ✅ (drop-in binary JSON)
  │   └── Need maximum speed, willing to write custom code?
  │       └── Raw binary Buffers ✅
  │
  └── Databases?
      ├── Redis? → Strings (RESP handles the wire format)
      ├── PostgreSQL? → Parameterized queries ($1, $2)
      └── MongoDB? → BSON (automatic)
```

### Your TinyURL's Choices — All Justified

```
  ┌── CHOICE ─────────────────┬── FORMAT ─┬── WHY ─────────────────────┐
  │                            │           │                            │
  │  HTTP API responses        │  JSON     │  Human-readable, standard │
  │  HTTP API requests         │  JSON     │  Universal client support │
  │  Redis cache values        │  String   │  Simple, fast, sufficient │
  │  Redis stream events       │  Strings  │  XADD only takes strings  │
  │  PostgreSQL queries        │  PG Wire  │  Automatic via pg library │
  │  Snowflake IDs             │  Binary   │  Bit-packing for density  │
  │  Short keys                │  Base62   │  URL-safe, human-readable │
  │  Prometheus metrics        │  Text     │  OpenMetrics standard     │
  │                            │           │                            │
  │  None of these should be changed. Each is the correct choice      │
  │  for its boundary.                                                 │
  └────────────────────────────┴───────────┴────────────────────────────┘
```

---

<a id="chapter-14-cheat-sheet"></a>
## 📋 Chapter 14: Quick Reference Cheat Sheet

### JSON.stringify / JSON.parse Quick Reference

```javascript
// SERIALIZE: Object → String
JSON.stringify(obj)                    // Compact
JSON.stringify(obj, null, 2)           // Pretty-printed (2-space indent)
JSON.stringify(obj, ['key1', 'key2'])  // Only include these keys

// DESERIALIZE: String → Object
JSON.parse(jsonString)                 // Basic
JSON.parse(str, (key, val) => {        // With reviver (type restoration)
    if (key === 'date') return new Date(val);
    return val;
});

// GOTCHAS:
JSON.stringify(undefined)     // undefined (not a string!)
JSON.stringify(NaN)           // "null"
JSON.stringify(123n)          // ❌ TypeError (BigInt)
JSON.stringify(new Map())     // "{}" (data lost!)
JSON.stringify(new Date())    // '"2026-08-17T..."' (string, not Date)
```

### Buffer Quick Reference

```javascript
// CREATE
Buffer.from('hello')                    // From string (UTF-8)
Buffer.from('68656c6c6f', 'hex')        // From hex string
Buffer.from([0x68, 0x65, 0x6c, 0x6c])   // From byte array
Buffer.alloc(10)                         // 10 zero-filled bytes

// CONVERT
buf.toString('utf8')                     // Buffer → string
buf.toString('hex')                      // Buffer → hex string
buf.toString('base64')                   // Buffer → base64

// INSPECT
buf.length                               // Size in bytes
buf[0]                                   // First byte (number)
buf.equals(otherBuf)                     // Byte-for-byte comparison
```

### Format Comparison — One-Page Summary

| | JSON | MessagePack | Protocol Buffers | Raw Buffer |
|:--|:--|:--|:--|:--|
| **Readable** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Schema** | ❌ No | ❌ No | ✅ Required | Custom |
| **Size** | Large | Small | Very small | Minimal |
| **Speed** | Baseline | 2x faster | 5x faster | 10x faster |
| **Types** | 6 basic | 6 basic + binary | Rich (int32, float, enum) | Raw |
| **Use case** | REST APIs | Internal messaging | Microservices (gRPC) | Low-level |

---

## 🎓 Final Mental Model

```
  Serialization is TRANSLATION between two languages:

  🧠 In-Memory Language (JavaScript):
     Rich objects, methods, prototypes, closures, Dates, BigInts,
     pointers, garbage collection, type system...

  📡 Wire Language (bytes on network/disk):
     Just bytes. No types. No methods. No structure.
     A flat sequence of 0s and 1s.

  JSON translator:     Accurate but verbose. Everyone speaks it.
  Binary translator:   Fast and compact. Needs special training.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  Use JSON at your API boundaries (where humans look).           │
  │  Use binary internally (where machines talk to machines).       │
  │  Use your framework's built-in serialization everywhere else.  │
  │                                                                  │
  │  The best serialization is the one you don't have to think      │
  │  about — because the framework handles it automatically.        │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

> **Data at rest is just bytes. Data in motion is just bytes. Serialization is the art of giving those bytes meaning — and choosing the right format is choosing how fast that meaning travels.**

---

*This guide is part of the TinyURL backend documentation. See also: [Interfacing with Redis](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/interfacing_with_redis.md) · [Connection Pooling](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/connection_pooling.md) · [302 vs 301 Redirect](file:///c:/Users/TARUN/Desktop/TinyURL/docs/backend/302_vs_301_redirect.md)*
