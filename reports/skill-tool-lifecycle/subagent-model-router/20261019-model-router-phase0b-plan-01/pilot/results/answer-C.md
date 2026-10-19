1. **The change:** Component/file: unknown. I can't see the WebESS code. It is most likely the Overtime tab's data query or service (the API or controller that loads overtime for the Time and Attendance page). The same change may be needed in the F&O integration call if the filtering happens there.

   Currently the list seems to be built from employees with `OvertimeEligible = true`, and overtime records are then left-joined onto it. That is why employees with no records show up as 0. Change it to build the list from the overtime records in the date range, and keep the eligibility check as a filter.

   Pseudo-code (C#/LINQ style, to be adapted to the real stack):

   ```csharp
   // Before (suspected)
   var rows = employees
       .Where(e => e.OvertimeEligible)
       .Select(e => new {
           Employee = e,
           Hours = overtime.Where(o => o.EmployeeId == e.Id &&
                                       o.Date >= from && o.Date <= to)
                           .Sum(o => o.Hours)
       });

   // After
   var rows = employees
       .Where(e => e.OvertimeEligible)
       .Select(e => new {
           Employee = e,
           Records = overtime.Where(o => o.EmployeeId == e.Id &&
                                         o.Date >= from && o.Date <= to).ToList()
       })
       .Where(x => x.Records.Any())          // drop employees with no records in range
       .Select(x => new { x.Employee, Hours = x.Records.Sum(o => o.Hours) });
   ```

   If the data is in SQL, use an inner join (or `EXISTS`) on the overtime table with the date range predicate instead of a left join.

   If the filtering is done in the front end, apply `.filter(r => r.records.length > 0)` before rendering. Server-side filtering is preferable, so paging and totals stay correct.

   Check whether a record with 0 hours counts as a record. I'd keep it, because the requirement is about records and not about hours.

2. **Assumptions:**
   - The Overtime tab lists employees by eligibility and then attaches overtime data.
   - "Overtime records" means overtime entries in F&O, synced or fetched, with a date field that can be filtered by the selected range.
   - The date range is inclusive at both ends.
   - The Overtime Eligible flag should still apply, so ineligible employees with records are not shown. This is not stated in the ticket.
   - Row counts, paging and totals are computed from the same filtered list.

3. **Verification:**
   - Reproduce with 24–28 Aug. Only Danh should appear. Hammad, Long and Ruchika should not.
   - Widen the range to include a day when Hammad has overtime. Hammad should then appear with the correct hours.
   - Test a range with no records at all. The tab should show an empty state without errors.
   - Test a single-day range and records on the boundary dates, 24 and 28 Aug.
   - Compare the displayed hours against F&O for the same employees.
   - Check that paging, search and total counts are consistent.
   - Add a unit or integration test covering an eligible employee with no records in range.