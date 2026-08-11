import { getOriginalUrl } from './redirect.service.js';
import { emitClickEvent } from '../../queue/click_producer.js';

export async function redirectController(req, res) {
    const { shortkey } = req.params;
    const originalUrl = await getOriginalUrl(shortkey);

    if (!originalUrl) {
        return res.status(404).send({ error: 'short url not found' });
    }

    // Extract analytics headers
    const userAgent = req.headers['user-agent'] || '';
    const referrer  = req.headers['referer'] || req.headers['referrer'] || '';
    const rawFwdIp  = req.headers['x-forwarded-for'];
    const ip        = (rawFwdIp ? rawFwdIp.split(',')[0].trim() : null) || req.ip || req.socket?.remoteAddress || '';

    // Asynchronous non-blocking event emission
    emitClickEvent({
        shortKey: shortkey,
        userAgent,
        ip,
        referrer,
        timestamp: Date.now()
    });

    return res.redirect(originalUrl, 302);
}