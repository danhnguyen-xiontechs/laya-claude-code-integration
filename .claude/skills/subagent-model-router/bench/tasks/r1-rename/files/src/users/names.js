const USERS = { 1: 'Ada', 2: 'Linus' };
export function getUserName(id) { return USERS[id] ?? 'unknown'; }
export function getUserNameLength(id) { return getUserName(id).length; }
