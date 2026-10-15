export function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let running = 0, next = 0, done = 0, failed = false;
    if (!items.length) return resolve(results);
    const launch = () => {
      while (!failed && running < limit && next < items.length) {
        const i = next++;
        running++;
        Promise.resolve().then(() => fn(items[i], i)).then((v) => {
          results[i] = v;
          running--; done++;
          if (done === items.length) resolve(results);
          else launch();
        }, (e) => { failed = true; reject(e); });
      }
    };
    launch();
  });
}
