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
    http_req_duration: ['p(95)<300'], // 95% of requests under 500 VUs complete within 300ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3099';

// Setup phase: pre-create a short URL to simulate hot cache reads
export function setup() {
  const payload = JSON.stringify({ originalUrl: 'https://example.com/target-page-for-load-test' });
  const params = { headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.99.99.99' } };
  const res = http.post(`${BASE_URL}/api/shorten`, payload, params);

  let shortKey = 'loadtest1';
  if (res.status === 200 || res.status === 201) {
    try {
      const body = JSON.parse(res.body);
      shortKey = body.shortKey || body.short_url?.split('/').pop() || 'loadtest1';
    } catch (e) {
      console.warn('Failed to parse setup response:', res.body);
    }
  }

  console.log(`[k6 Setup] Hot Short URL Key generated: '${shortKey}' (Status: ${res.status})`);
  return { hotShortKey: shortKey };
}

export default function (data) {
  const rand = Math.random();
  // Simulate unique real client IP per VU to model distributed traffic
  const clientIp = `10.0.${Math.floor(__VU / 256)}.${(__VU % 256) + 1}`;
  const headers = { 'x-forwarded-for': clientIp };

  if (rand < 0.90) {
    // 90% Hot URL Redirects (Tests Redis Cache & Event Stream emission)
    const res = http.get(`${BASE_URL}/${data.hotShortKey}`, { redirects: 0, headers });
    check(res, {
      'redirect status is 302 or 429': (r) => r.status === 302 || r.status === 429,
    });
  } else if (rand < 0.95) {
    // 5% Shorten Requests (Tests Snowflake ID Gen & Sharded Postgres Insert)
    const payload = JSON.stringify({ originalUrl: `https://example.com/page-${Math.random()}` });
    const postHeaders = { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp };
    const res = http.post(`${BASE_URL}/api/shorten`, payload, { headers: postHeaders });
    check(res, {
      'shorten status is 200/201 or 429': (r) => r.status === 200 || r.status === 201 || r.status === 429,
    });
  } else {
    // 5% Cold / Non-existent Keys (Tests Cache Miss & DB Lookup)
    const res = http.get(`${BASE_URL}/nonExistentKey${Math.floor(Math.random() * 1000)}`, { redirects: 0, headers });
    check(res, {
      'not found status is 404 or 429': (r) => r.status === 404 || r.status === 429,
    });
  }

  // Small sleep to control throughput spacing
  sleep(0.001);
}
