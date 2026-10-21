1. **The change**

**Component:** unknown. Probably the WebESS Time and Attendance service or API that builds the employee list for the **Overtime** tab, or the matching F&O data entity or query.

**Likely cause:** The list starts from all employees with **Overtime Eligible = Yes**. Overtime records are then outer-joined (LEFT JOIN) onto it, so eligible employees with no records still appear with 0. The fix is to show only employees who have at least one overtime record in the selected range.

**Code (illustrative C#/LINQ; names are placeholders):**

```csharp
// Before (suspected): eligible employees, overtime left-joined -> zero rows shown
// var result = eligibleEmployees
//     .GroupJoin(overtimeRecords, e => e.PersonnelNumber, o => o.PersonnelNumber,
//                (e, ots) => new { e, Total = ots.Sum(x => x.Hours) });

// After: only employees with overtime records inside the selected range
var overtimeInRange = overtimeRecords
    .Where(o => o.Date >= fromDate.Date && o.Date <= toDate.Date);

var result = eligibleEmployees
    .Join(overtimeInRange,
          e => e.PersonnelNumber,
          o => o.PersonnelNumber,
          (e, o) => new { e, o })
    .GroupBy(x => x.e)
    .Select(g => new OvertimeEmployeeDto
    {
        PersonnelNumber = g.Key.PersonnelNumber,
        Name            = g.Key.Name,
        TotalOvertime   = g.Sum(x => x.o.Hours),
        Records         = g.Select(x => x.o).ToList()
    })
    .ToList();
```

**SQL equivalent:**

```sql
SELECT e.PersonnelNumber, e.Name, SUM(o.Hours) AS TotalOvertime
FROM Employee e
INNER JOIN OvertimeRecord o
    ON o.PersonnelNumber = e.PersonnelNumber
   AND o.WorkDate BETWEEN @FromDate AND @ToDate
WHERE e.OvertimeEligible = 1
GROUP BY e.PersonnelNumber, e.Name;
```

**Steps:**
1. Find the method or query that fills the Overtime tab's employee list.
2. Change the outer join to an inner join, or add a filter that keeps only employees with records in the range (`Records.Any()` or `EXISTS`).
3. If the list is built on the frontend instead, filter out employees whose overtime list for the range is empty before rendering.
4. Keep the eligibility check as it is. It still applies, but it is no longer enough on its own for an employee to appear.

2. **Assumptions**
- The list comes from eligible employees with overtime outer-joined onto it, which is why the extra rows show 0.
- Overtime records come from F&O and have an employee key and a date that can be compared with the selected range.
- The From and To dates are both inclusive (24 Aug and 28 Aug both count).
- If an employee has records in the range that add up to 0 hours, they should still appear, because they do have records. If the business wants them hidden too, add `HAVING SUM(Hours) > 0`.
- No other screen relies on this endpoint to list every eligible employee. If one does, add a parameter or a separate method instead of changing shared behaviour.
- Only the Overtime tab is in scope. Other Time and Attendance tabs keep their current behaviour.

3. **Verification**
- **Repro case:** Select 24 Aug – 28 Aug. Only Danh should appear, and his total should match F&O. Hammad, Long and Ruchika should not appear.
- **Edge dates:** Give an employee a record dated exactly on the From date and another on the To date. They should appear. A record one day outside the range should not make them appear.
- **Empty range:** Pick a range with no overtime at all. The tab should show the empty state with no errors.
- **Eligibility:** An employee with **Overtime Eligible = No** who has records should still be hidden, if that is how it works today.
- **Regression:** Check that totals, paging, sorting and approval actions in the Overtime tab still work. Also check that other screens using the same service are unchanged.
- **Automated tests:** Add a unit or integration test with mixed data (eligible with and without records, records inside and outside the range) and check the returned list.