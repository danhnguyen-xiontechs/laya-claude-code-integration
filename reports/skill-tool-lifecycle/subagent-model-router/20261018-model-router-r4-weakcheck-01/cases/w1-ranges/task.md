Create src/ranges.js exporting `mergeRanges(ranges)`.

`ranges` is an array of [start, end] pairs of integers, both ends inclusive. Return a new array of merged [start, end] pairs sorted by start.
- Two ranges merge when they overlap OR when they touch, i.e. the next start is at most the current end + 1. Example: [[1,3],[4,6]] becomes [[1,6]].
- A range fully inside another is absorbed. The merged end is the larger of the two ends.
- The input must not be mutated, and every returned pair must be a fresh array.
- An empty input returns [].
- If any pair has start > end, throw a RangeError whose message is `bad range: ` followed by JSON.stringify of that pair, e.g. `bad range: [5,2]`.

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
