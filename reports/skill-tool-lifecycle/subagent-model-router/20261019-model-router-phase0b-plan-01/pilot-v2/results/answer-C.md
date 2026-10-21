1. **The change:** Component/file: unknown. It is most likely the WebESS Overtime tab's employee-list query or API, in the Time and Attendance module. It could also be the F&O-side service that WebESS calls. I can't see the code, so this is the logic to change, not a patch.

 Steps:
 1. Find the code that builds the Overtime tab's employee list. It currently selects employees where `OvertimeEligible = Yes`, then left-joins overtime records and shows 0 when none exist.
 2. Change that to an inner join, or add an `EXISTS` filter. The filter should look like this:

```sql
WHERE emp.OvertimeEligible = 1
  AND EXISTS (
    SELECT 1 FROM OvertimeRecords ot
    WHERE ot.EmployeeId = emp.Id
      AND ot.OvertimeDate >= @FromDate
      AND ot.OvertimeDate <  DATEADD(day, 1, @ToDate)
  )
```

 For LINQ, use the equivalent: `employees.Where(e => e.OvertimeEligible && records.Any(r => r.EmployeeId == e.Id && r.Date >= from && r.Date <= to))`.

 3. Keep the eligibility check if the business wants it. Otherwise "has records in range" alone is enough.
 4. Make the date comparison inclusive of the end date (28 Aug), and use the same date field and time zone handling as the displayed totals.
 5. Decide whether records with 0 hours or in a Rejected or Cancelled status count as records. Match whatever F&O treats as an overtime record.
 6. Check that the empty-state message still shows when no employee matches, and that paging and total counts use the filtered list.

2. **Assumptions:**
 - The list is built from an eligible-employee query joined to overtime records, and the join is an outer join that yields 0 rows.
 - The filtering can be done in WebESS or its API, not only in F&O.
 - "Overtime record" means any overtime entry in F&O dated within the selected range, whatever its status. I assume this because the ticket doesn't mention status.
 - Overtime Eligible stays as a condition, so the result is eligible employees who also have records.
 - The date range is inclusive at both ends.
 - Managers viewing their team's overtime use the same code path as the case in the ticket.

3. **Verification:**
 - Use the ticket's data. For 24–28 Aug, the Overtime tab should show only Danh. Hammad, Long and Ruchika should no longer appear.
 - Widen the range to include a date where Hammad, Long or Ruchika has overtime in F&O. They should then appear with the correct hours.
 - Test boundaries: a record on 24 Aug and one on 28 Aug should both be included. A record on 23 Aug or 29 Aug should be excluded.
 - Test a range with no records. It should show an empty state, with no errors.
 - Test an employee with Overtime Eligible = No who has records, to confirm the behaviour you decided on in step 3.
 - Compare the WebESS list with the F&O overtime records for the same range.
 - Add a unit or integration test for the query covering the cases above. Run the existing Overtime tab tests for regressions, including paging and totals.