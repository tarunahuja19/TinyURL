import { rateLimit } from '../../middleware/ratelimit.middleware.js';
import { shortenController } from './shorten.controller.js';
export async function shortenRoutes(fastify , options) {
    fastify.post('/api/shorten', {preHandler:rateLimit({name:'shorten',windowSeconds:60,limit:10})},shortenController);
}
