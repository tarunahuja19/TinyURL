import { redirectController } from './redirect.controller.js';
export async function redirectRoutes(fastify) {
    fastify.get('/:shortkey',(req,res)=>{
        redirectController(req,res);
    })
}