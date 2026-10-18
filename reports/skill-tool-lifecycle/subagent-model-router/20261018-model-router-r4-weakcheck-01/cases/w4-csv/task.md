Create src/csv.js exporting `parseCsv(text)`, which returns an array of rows, each row an array of string fields.

- Fields are separated by commas. Records end at LF or CRLF.
- A field wrapped in double quotes may contain commas, LF and CR characters, and a doubled quote (two double-quote characters in a row) that stands for one literal quote. Quotes inside an unquoted field are literal characters.
- A single LF or CRLF at the very end of the input does not start an extra record. An empty line in the middle is a record with one empty field: the input "a", LF, LF, "b" gives [["a"],[""],["b"]].
- An empty input string returns []. The input of two double quotes alone (a quoted empty field) returns [[""]].
- If the input ends inside a quoted field, throw an Error with message `unterminated quoted field`.

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
