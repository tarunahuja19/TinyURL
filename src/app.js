import fastify from "fastify";
import { shortenRoutes } from "./modules/shorten/shorten.route.js";
import { redirectRoutes } from "./modules/redirect/redirect.route.js";

export function buildApp() {
    const app = fastify({ logger: true });
    app.register(shortenRoutes);
    app.register(redirectRoutes);
    return app;
}