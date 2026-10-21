**1. The change**

Component: **unknown**. I have no access to the WebESS code, so this is the logic the Overtime tab's data load should use. It most likely sits in the service or query that builds the Overtime list.

The cause is probably that the list starts from all employees with `Overtime Eligible = Yes` and attaches overtime data to each one, keeping employees who have no matching rows (shown as 0). The fix is to start from the overtime records in the date range and keep only employees who have at least one.

Pseudo-code:

```
employees = getEmployees(OvertimeEligible = Yes)
records   = getOvertimeRecords(startDate, endDate)   // F&O, date range applied here

rows = employees
  .map(e => ({ employee: e, records: records.filter(r => r.employeeId == e.id) }))
  .filter(row => row.records.length > 0)
```

If the list is built in SQL, use an `EXISTS` check instead of a left join:

```sql
SELECT e.*
FROM Employee e
WHERE e.OvertimeEligible = 1
  AND EXISTS (
    SELECT 1 FROM OvertimeRecord o
    WHERE o.EmployeeId = e.Id
      AND o.Date BETWEEN @StartDate AND @EndDate
  )
```

Do not rely on filtering by total hours > 0 in the UI. That would hide a real record with 0 hours. Filter on whether a record exists in the range.

**2. Assumptions**

- The zero-hour rows come from a left join or a default-zero row built from the eligibility list.
- The start and end dates are both inclusive, and the date range is applied to the overtime records, not to a pre-computed total.
- A record with 0 hours that exists in F&O counts as an overtime record and stays visible.
- The Overtime Eligible flag still controls who can enter overtime. This change affects display only.
- Other tabs do not use this list and need no change.
- I have not run anything. I could not check the data, the code, or the F&O source.

**3. Verification**

- Reproduce: select 24–28 Aug. Only Danh should appear. Hammad, Long, and Ruchika should not.
- Boundary tests:
  - An employee with a record on 24 Aug or 28 Aug appears.
  - An employee with a record only on 23 Aug or 29 Aug does not appear.
  - An eligible employee with no records at all does not appear.
  - An employee with a 0-hour record in range appears, if that is the agreed behavior.
- Empty state: a date range with no records shows an empty list, not a list of zeros.
- Cross-check: run the F&O overtime query for the same range and compare the employee list with the WebESS output.
- Unit-test the filter function, and integration-test the endpoint with a fixture that includes eligible employees with and without records.
- Regression: confirm the other WebESS tabs and the eligibility flag behave as before.