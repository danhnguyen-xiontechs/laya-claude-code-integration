Create src/money.js exporting `parseAmount(text)`. It turns a decimal amount string into an integer number of cents, without floating-point error.

- Accepted form: an optional leading `+` or `-`, one or more digits, then optionally `.` followed by one or two digits. Examples: `12` gives 1200, `12.5` gives 1250, `0.29` gives 29, `1.15` gives 115, `-0.07` gives -7, `+3.10` gives 310.
- Anything else throws a RangeError with message `bad amount: ` followed by the input as given, e.g. `bad amount: 1.234`. This includes more than two decimals, `1.`, `.5`, empty text, letters, scientific notation, thousands separators, and leading or trailing spaces.
- Non-string input is converted with String() before the check.

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
