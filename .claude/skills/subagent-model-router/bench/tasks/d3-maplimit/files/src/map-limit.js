export function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const results = [];
    let running = 0, next = 0, done = 0;
    const launch = () => {
      while (running <= limit && next < items.length) {
        const i = next++;
        running++;
        fn(items[i], i).then((v) => {
          results.push(v);
          running--; done++;
          if (done === items.length) resolve(results);
          else launch();
        }, reject);
      }
    };
    launch();
  });
}
