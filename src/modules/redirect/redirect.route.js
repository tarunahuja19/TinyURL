import { redirectController } from './redirect.controller.js';
import { rateLimit } from '../../middleware/ratelimit.middleware.js';
export async function redirectRoutes(fastify) {
    fastify.get('/:shortkey',{preHandler:rateLimit({name:'redirect',windowSeconds:60,limit:100})},redirectController);
}