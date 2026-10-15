import { config } from './config/index.js';
const port = config.tls ? (config.port ?? 3000) + 443 : config.port;
console.log(`listening on ${port}`);
