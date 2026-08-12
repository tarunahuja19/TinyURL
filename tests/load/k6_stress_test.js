import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },   // Warm-up to 50 VUs
    { duration: '30s', target: 500 },  // Ramp-up to 500 VUs (~5,000 RPS target)
    { duration: '30s', target: 500 },  // Sustain peak load
    { duration: '10s', target: 0 },    // Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'], // 95% of requests should complete within 100ms
    http_req_failed: ['rate<0.01'],    // Error rate under 1%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3099';

// Setup phase: pre-create a short URL to simulate hot cache reads
export function setup() {
  const payload = JSON.stringify({ originalUrl: 'https://example.com/target-page-for-load-test' });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/api/shorten`, payload, params);

  let shortKey = 'loadtest1';
  if (res.status === 200 || res.status === 201) {
    try {
      const body = JSON.parse(res.body);
      shortKey = body.shortKey || body.shortUrl?.split('/').pop() || 'loadtest1';
    } catch (e) {
      console.warn('Failed to parse setup response:', res.body);
    }
  }

  return { hotShortKey: shortKey };
}

export default function (data) {
  const rand = Math.random();

  if (rand < 0.90) {
    // 90% Hot URL Redirects (Tests Redis Cache & Event Stream emission)
    const res = http.get(`${BASE_URL}/${data.hotShortKey}`, { redirects: 0 });
    check(res, {
      'redirect status is 302': (r) => r.status === 302,
    });
  } else if (rand < 0.95) {
    // 5% Shorten Requests (Tests Snowflake ID Gen & Sharded Postgres Insert)
    const payload = JSON.stringify({ originalUrl: `https://example.com/page-${Math.random()}` });
    const params = { headers: { 'Content-Type': 'application/json' } };
    const res = http.post(`${BASE_URL}/api/shorten`, payload, params);
    check(res, {
      'shorten status is 200/201': (r) => r.status === 200 || r.status === 201,
    });
  } else {
    // 5% Cold / Non-existent Keys (Tests Cache Miss & DB Lookup)
    const res = http.get(`${BASE_URL}/nonExistentKey${Math.floor(Math.random() * 1000)}`, { redirects: 0 });
    check(res, {
      'not found status is 404': (r) => r.status === 404,
    });
  }

  // Small sleep to control throughput spacing
  sleep(0.001);
}
