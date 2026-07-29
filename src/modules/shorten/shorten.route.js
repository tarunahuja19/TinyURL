import { shortenController } from './shorten.controller.js';

export async function shortenRoutes(fastify , options) {
    fastify.post('/api/shorten', shortenController);
}
