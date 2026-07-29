import { redirectController } from './redirect.controller.js';
export async function redirectRoutes(fastify) {
    fastify.get('/:shortkey', redirectController);
}