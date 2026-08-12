import fastify from "fastify";
import { randomUUID } from "crypto";
import { shortenRoutes } from "./modules/shorten/shorten.route.js";
import { redirectRoutes } from "./modules/redirect/redirect.route.js";
import { logger } from "./observability/logger.js";
import { register, httpRequestCounter, httpRequestDurationHistogram } from "./observability/metrics.js";
import { collectDbPoolMetrics } from "./db/shard_router.js";

export function buildApp() {
    const app = fastify({
        loggerInstance: logger,
        genReqId(req) {
            return req.headers['x-request-id'] || randomUUID();
        }
    });

    // Correlation ID & HTTP Metrics Hooks
    app.addHook('onRequest', async (req, reply) => {
        req.startTime = process.hrtime();
        reply.header('x-request-id', req.id);
    });

    app.addHook('onResponse', async (req, reply) => {
        if (req.startTime) {
            const diff = process.hrtime(req.startTime);
            const durationInSeconds = diff[0] + diff[1] / 1e9;
            const route = req.routeOptions?.url || req.url || 'unknown';
            const method = req.method;
            const statusCode = String(reply.statusCode);

            httpRequestCounter.inc({ method, route, status_code: statusCode });
            httpRequestDurationHistogram.observe({ method, route, status_code: statusCode }, durationInSeconds);
        }
    });

    // Expose Prometheus Metrics Endpoint
    app.get('/metrics', async (req, reply) => {
        try {
            collectDbPoolMetrics();
            reply.type(register.contentType);
            return await register.metrics();
        } catch (err) {
            reply.status(500).send(err);
        }
    });

    // Register Application Routes
    app.register(shortenRoutes);
    app.register(redirectRoutes);

    return app;
}