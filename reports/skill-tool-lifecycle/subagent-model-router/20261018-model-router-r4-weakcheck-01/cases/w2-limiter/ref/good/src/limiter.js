export function createLimiter(max) {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be a positive integer');
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < max && queue.length > 0) {
      const job = queue.shift();
      active++;
      Promise.resolve()
        .then(() => job.fn())
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
