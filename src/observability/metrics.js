import client from 'prom-client';

// Create a custom Prometheus Registry
export const register = new client.Registry();

// Enable default metrics collection (CPU, Memory, Event Loop, GC)
client.collectDefaultMetrics({
  register,
  prefix: 'tinyurl_'
});

// Custom HTTP Metrics
export const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

export const httpRequestDurationHistogram = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

// Custom Redis Metrics
export const redisCacheHitsCounter = new client.Counter({
  name: 'redis_cache_hits_total',
  help: 'Total number of Redis cache hits',
  registers: [register]
});

export const redisCacheMissesCounter = new client.Counter({
  name: 'redis_cache_misses_total',
  help: 'Total number of Redis cache misses',
  registers: [register]
});

// Custom DB Pool Metrics
export const dbPoolActiveGauge = new client.Gauge({
  name: 'db_pool_active_connections',
  help: 'Number of active database connections in pool',
  labelNames: ['shard'],
  registers: [register]
});

export const dbPoolIdleGauge = new client.Gauge({
  name: 'db_pool_idle_connections',
  help: 'Number of idle database connections in pool',
  labelNames: ['shard'],
  registers: [register]
});

export const dbPoolWaitingGauge = new client.Gauge({
  name: 'db_pool_waiting_count',
  help: 'Number of queries waiting for a database connection',
  labelNames: ['shard'],
  registers: [register]
});
