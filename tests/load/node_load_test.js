import http from 'http';
import { env } from '../../src/config/env.js';

const PORT = env.PORT || 3099;
const BASE_URL = process.env.TARGET_URL || `http://localhost:${PORT}`;

const DURATION_SECONDS = 30;
const CONCURRENCY = 100;

console.log(`🚀 Starting Node Load Test against ${BASE_URL}`);
console.log(`⏱️ Duration: ${DURATION_SECONDS}s | 👥 Concurrency: ${CONCURRENCY} workers\n`);

let totalRequests = 0;
let successCount = 0; // 2xx / 3xx
let rateLimitedCount = 0; // 429
let notFoundCount = 0; // 404
let serverErrorCount = 0; // 5xx

const getLatencies = [];
const postLatencies = [];

async function makeRequest(url, options = {}) {
  const method = options.method || 'GET';
  const start = process.hrtime();
  return new Promise((resolve) => {
    const req = http.request(url, options, (res) => {
      res.resume(); // consume response stream
      const diff = process.hrtime(start);
      const durationMs = (diff[0] * 1000) + (diff[1] / 1e6);

      if (method === 'GET') {
        getLatencies.push(durationMs);
      } else {
        postLatencies.push(durationMs);
      }

      totalRequests++;
      const code = res.statusCode;
      if (code >= 200 && code < 400) {
        successCount++;
      } else if (code === 429) {
        rateLimitedCount++;
      } else if (code === 404) {
        notFoundCount++;
      } else if (code >= 500) {
        serverErrorCount++;
      }
      resolve();
    });

    req.on('error', () => {
      const diff = process.hrtime(start);
      const durationMs = (diff[0] * 1000) + (diff[1] / 1e6);
      if (method === 'GET') {
        getLatencies.push(durationMs);
      } else {
        postLatencies.push(durationMs);
      }
      totalRequests++;
      serverErrorCount++;
      resolve();
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Pre-create short URL for testing hot redirects
async function setup() {
  const body = JSON.stringify({ originalUrl: 'https://example.com/load-test-target' });
  let shortKey = 'testkey';
  try {
    const res = await fetch(`${BASE_URL}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (res.ok) {
      const data = await res.json();
      shortKey = data.shortKey || shortKey;
    }
  } catch (e) {
    // fallback
  }
  return shortKey;
}

async function worker(shortKey, stopTime) {
  while (Date.now() < stopTime) {
    const rand = Math.random();
    if (rand < 0.90) {
      // 90% GET Redirects
      await makeRequest(`${BASE_URL}/${shortKey}`, { method: 'GET' });
    } else if (rand < 0.95) {
      // 5% POST Shorten Requests
      await makeRequest(`${BASE_URL}/api/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalUrl: `https://example.com/page-${Math.random()}` })
      });
    } else {
      // 5% GET Cold Keys
      await makeRequest(`${BASE_URL}/coldKey${Math.floor(Math.random() * 1000)}`, { method: 'GET' });
    }
  }
}

function calcPercentiles(arr) {
  if (!arr.length) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    p50: (sorted[Math.floor(sorted.length * 0.50)] || 0).toFixed(2),
    p95: (sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2),
    p99: (sorted[Math.floor(sorted.length * 0.99)] || 0).toFixed(2),
  };
}

async function runLoadTest() {
  const shortKey = await setup();
  console.log(`✅ Pre-created short URL key: '${shortKey}'`);
  console.log(`🔥 Bombarding server with traffic...\n`);

  const startTime = Date.now();
  const stopTime = startTime + (DURATION_SECONDS * 1000);

  const workers = Array.from({ length: CONCURRENCY }, () => worker(shortKey, stopTime));
  await Promise.all(workers);

  const elapsedTimeSec = (Date.now() - startTime) / 1000;
  const getStats = calcPercentiles(getLatencies);
  const postStats = calcPercentiles(postLatencies);
  const rps = (totalRequests / elapsedTimeSec).toFixed(2);

  console.log(`═════════════════════════════════════════════════════════`);
  console.log(`📊 DETAILED LOAD TEST BREAKDOWN (GET vs POST)`);
  console.log(`═════════════════════════════════════════════════════════`);
  console.log(`Total Requests Sent  : ${totalRequests}`);
  console.log(`Successful (2xx/3xx) : ${successCount}`);
  console.log(`Rate Limited (429)   : ${rateLimitedCount} 🛡️ (Rate Limiter Active)`);
  console.log(`Not Found (404)      : ${notFoundCount}`);
  console.log(`Server Errors (5xx)  : ${serverErrorCount}`);
  console.log(`Throughput (RPS)      : ${rps} req/sec`);
  console.log(`---------------------------------------------------------`);
  console.log(`📥 GET Requests Latency (${getLatencies.length} reqs):`);
  console.log(`   └─ p50: ${getStats.p50} ms | p95: ${getStats.p95} ms | p99: ${getStats.p99} ms`);
  console.log(`📤 POST Requests Latency (${postLatencies.length} reqs):`);
  console.log(`   └─ p50: ${postStats.p50} ms | p95: ${postStats.p95} ms | p99: ${postStats.p99} ms`);
  console.log(`═════════════════════════════════════════════════════════\n`);
}

runLoadTest().catch(console.error);
