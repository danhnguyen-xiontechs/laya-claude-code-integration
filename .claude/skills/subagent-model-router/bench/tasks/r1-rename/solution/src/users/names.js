const USERS = { 1: 'Ada', 2: 'Linus' };
export function fetchUserName(id) { return USERS[id] ?? 'unknown'; }
export function getUserNameLength(id) { return fetchUserName(id).length; }
