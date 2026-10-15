import { fetchUserName } from '../users/index.js';
export const orderLabel = (o) => `#${o.id} for ${fetchUserName(o.userId)}`;
