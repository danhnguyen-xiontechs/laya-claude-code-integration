import * as users from '../users/index.js';
export const greet = (id) => `Hello ${users.getUserName(id)}`;
