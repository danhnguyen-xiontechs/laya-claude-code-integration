export function createLimiter(max) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be a positive integer');
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length > 0) {
      const job = queue.shift();
      active++;
      let p;
      try { p = Promise.resolve(job.fn()); } catch (e) { p = Promise.reject(e); }
      p.then((v) => { active--; job.resolve(v); pump(); }, (e) => { job.reject(e); });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
