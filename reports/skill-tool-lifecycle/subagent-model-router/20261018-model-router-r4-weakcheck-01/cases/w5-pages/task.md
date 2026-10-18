Create src/pages.js exporting `pageWindow(total, page, perPage, span)`. It returns the page numbers a pager should show.

- `total` is a non-negative integer item count, `perPage` an integer >= 1, `span` an integer >= 1 (the most page links to show).
- totalPages = max(1, ceil(total / perPage)). `page` must be an integer from 1 to totalPages; otherwise throw a RangeError with message `page out of range: ` followed by the page value, e.g. `page out of range: 11`.
- Let len = min(span, totalPages). The window is len consecutive page numbers that contain `page`, centred so that floor(span / 2) pages come before `page` when there is room (for an even span the extra link goes after the current page).
- Clamp the window to the pages that exist: it never starts below 1 and never ends above totalPages.
- Return the page numbers as an array of integers in ascending order.

Examples: pageWindow(100, 5, 10, 5) gives [3,4,5,6,7]; pageWindow(100, 1, 10, 4) gives [1,2,3,4].

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
