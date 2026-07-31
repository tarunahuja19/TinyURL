import { createShortURL } from "./shorten.service.js";
export async function shortenController(req,res) {
    if (!req.body) {
        return res.status(400).send({error: 'request body missing or not JSON'});
    }
    const originalURL = req.body.OriginalURL || req.body.original_url;
    if(!originalURL){
        return res.status(400).send({error:'original url missing'});
    }
    const short_url_key=await createShortURL(originalURL);
    res.status(201).send({short_url:`${req.protocol}://${req.headers.host}/${short_url_key}`});
}
