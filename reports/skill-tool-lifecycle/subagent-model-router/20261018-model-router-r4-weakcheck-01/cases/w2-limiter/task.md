Create src/limiter.js exporting `createLimiter(max)`. It returns a function `run(fn)`.

- `createLimiter(max)` throws a RangeError with message `max must be a positive integer` unless max is an integer >= 1.
- `run(fn)` returns a Promise that resolves to fn's return value (awaiting it if fn returns a promise), or rejects with the error fn throws or rejects with.
- At most `max` jobs are running at any moment. Other jobs wait in a first-in first-out queue and start in the order they were submitted.
- fn is called with no arguments, and never synchronously inside the `run(fn)` call: it starts on a later tick.
- A job that throws synchronously, or whose promise rejects, still frees its slot so the queue keeps moving.

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
