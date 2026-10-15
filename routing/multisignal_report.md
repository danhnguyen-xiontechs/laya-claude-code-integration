# Multi-signal routing (laya 0.3.21)

Grid search duoc fit tren chinh 60 prompt nay -> la tran tren, khong phai do chinh xac thuc.

## request_only (median 1780 ms / predict, 4 tin hieu + baseline)

| strategy | dung | thap hon can | haiku/sonnet/opus dung |
|---|---|---|---|
| baseline choice 3 tang | 47/60 | 3 | 14/14/19 |
| fixed rule | 41/60 | 2 | 7/16/18 |
| grid mix lo=1.5 hi=2.0 w=0.25 | 45/60 | 11 | 17/12/16 |
| grid mix lo=1.0 hi=2.0 w=0.25 | 44/60 | 5 | 10/18/16 |
| grid mix lo=1.25 hi=2.0 w=0.25 | 44/60 | 8 | 13/15/16 |
| grid mix lo=1.5 hi=1.75 w=0.25 | 44/60 | 8 | 17/8/19 |
| grid mix lo=1.25 hi=2.0 w=0.5 | 44/60 | 10 | 16/12/16 |

## request_plus_signals (median 2041 ms / predict, 4 tin hieu + baseline)

| strategy | dung | thap hon can | haiku/sonnet/opus dung |
|---|---|---|---|
| baseline choice 3 tang | 50/60 | 3 | 17/14/19 |
| fixed rule | 38/60 | 3 | 7/14/17 |
| grid mix lo=1.25 hi=1.75 w=0.25 | 50/60 | 5 | 16/16/18 |
| grid complexity lo=1.5 hi=1.75 w=0 | 50/60 | 6 | 19/12/19 |
| grid mix lo=1.25 hi=2.0 w=0.5 | 50/60 | 7 | 18/15/17 |
| grid mix lo=1.5 hi=1.75 w=0.25 | 50/60 | 8 | 19/13/18 |
| grid mix lo=1.25 hi=2.0 w=0.25 | 49/60 | 7 | 16/17/16 |
