import { getOriginalUrl } from './redirect.service.js';
export async function redirectController(req,res) {
    const {shortkey}=req.params;
    const originalUrl=await getOriginalUrl(shortkey);
    if(!originalUrl){
        return res.status(404).send({error:'short url not found'});
    }
    return res.redirect(originalUrl, 302);          
}