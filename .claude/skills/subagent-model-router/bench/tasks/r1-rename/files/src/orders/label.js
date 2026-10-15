import { getUserName } from '../users/index.js';
export const orderLabel = (o) => `#${o.id} for ${getUserName(o.userId)}`;
