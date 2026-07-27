import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

app.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`url-shortener listening at ${address}`);
});