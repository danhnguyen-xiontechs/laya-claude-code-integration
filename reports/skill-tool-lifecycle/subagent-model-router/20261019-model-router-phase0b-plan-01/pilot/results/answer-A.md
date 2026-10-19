1. **The change**

**Component:** unknown. It is probably the WebESS Time and Attendance service or API that builds the Overtime tab list. It could also be the F&O data entity or OData query that feeds it.

**Likely cause:** The list is built from all employees with **Overtime Eligible = Yes**. Their overtime records are then joined with a left/outer join, so employees with no records come back with a total of 0 instead of being left out.

**Fix:** Only include an employee if they have at least one overtime record inside the selected date range. Make this change on the server side so the totals and paging stay correct.

*If the list is built in C#/LINQ:*
```csharp
var overtimeInRange = overtimeRecords
    .Where(o => o.TransDate >= fromDate && o.TransDate <= toDate);

var result = employees
    .Where(e => e.OvertimeEligible == NoYes.Yes)
    .Join(overtimeInRange,                 // inner join instead of GroupJoin/DefaultIfEmpty
          e => e.PersonnelNumber,
          o => o.PersonnelNumber,
          (e, o) => new { e, o })
    .GroupBy(x => x.e)
    .Select(g => new OvertimeSummary
    {
        Employee = g.Key,
        TotalHours = g.Sum(x => x.o.Hours)
    })
    .ToList();
```

*If it is SQL or a view:*
```sql
-- change LEFT JOIN to INNER JOIN, or add:
WHERE EXISTS (SELECT 1 FROM Overtime o
              WHERE o.PersonnelNumber = e.PersonnelNumber
                AND o.TransDate BETWEEN @From AND @To)
-- or after aggregation:
HAVING COUNT(o.RecId) > 0
```

*If it is X++ or a data entity:* change `outer join` to `exists join` (or plain `join`) on the overtime table. Keep the date-range ranges on that joined table.

The date filter must be applied to the overtime records themselves. If it is placed in the outer join's `ON` clause or applied after the join, employees without records will still show up.

**Steps:**
1. Find the Overtime tab endpoint (something like `GetOvertime(from, to, managerId)`) and the query behind it.
2. Change the outer join to an inner/exists join, or filter out rows with no records in the date range.
3. Keep the **Overtime Eligible** filter. It still applies.
4. If the front end also adds every eligible employee to the grid, remove that step.

2. **Assumptions**
- The 0-overtime rows come from an outer join or a "list all eligible employees" step, not from overtime records that really have 0 hours.
- The overtime records have a date field that can be filtered by the selected range.
- An employee whose records add up to 0 hours but who does have a record in the range should still appear. If they shouldn't, also filter on `TotalHours > 0`.
- No other screen or report expects this endpoint to return every eligible employee. If one does, add a parameter or a separate endpoint instead of changing the existing one.

3. **Verification**
- Repeat the bug: date range **24 Aug – 28 Aug**. Only **Danh** should appear. Hammad, Long and Ruchika should not.
- Compare with F&O: the employees shown should match the overtime records in F&O for that range, with the same hours.
- Edge cases:
  - a record exactly on the start or end date should be included;
  - a range with no records should show an empty grid with an empty-state message;
  - employees with **Overtime Eligible = No** should never appear;
  - an employee with records just outside the range should not appear.
- Regression: check paging and record counts, check the other Time and Attendance tabs still list employees as before, and add a unit or integration test that asserts eligible employees without records in the range are excluded.

---
*Note:* the claude.ai Gmail, Google Calendar and Google Drive connectors need to be authorized in your claude.ai connector settings. They can't be used until then. They weren't needed for this task.