# Human review of the Phase 0B rubrics (before the run)

Status: **for the user to review. No rubric has been changed, and nothing has been graded.** Generated from the locked rubric files and `calibration-stories-0B.json` (the story text the models will see). Hashes are the locked values in `rubric-lock-0B.md`, checked against the files when this file was written.

## How to use this
1. Read the story text, the summary and the criteria for each story below.
2. Mark accept, or change, for each story. A change means a new rubric version and a new rubric lock, with the offline checks run again before the run lock. Nothing is graded yet, so no grades are voided.
3. Stories not listed here had no second-read flag. W-19279 is pilot-exposed and excluded from 0B conclusions, so it is not reviewed here.

Why these stories: the second read flagged six stories, each adjudicated against the story text (`rubric-plan-0B.md` section 4). W-21681 is included because its flag is open in the same way. W-19358 is included for its `not_evaluable` status.

## Input text note
Some story text in `calibration-stories-0B.json` has U+FFFD (the replacement character) where a dash, apostrophe or similar was lost in extraction. Stories with it: W-19279 (2), W-19358 (1), W-19427 (3), W-20932 (1). The text is shown as stored. It is not corrected here, because a change would alter the model input and its hash. The reviewer should decide whether this is acceptable for the run.

## W-21635: in Web ESS - goals related details and Measure of success field not available for staff to add details against the goal.

- Rubric: `rubrics/rubric-W-21635.md`, sha256 `416256de896a27eb6e7cc7a8dacac85e078fa1abac28df4b97329c4cc704f976` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: The second read called the story non-discriminative, because R2 holds for most answers. Kept as discriminative: R1 separates a plausible wrong answer (fields for the manager only, or only one of the two fields). This is a judgment call.
- Decision needed: Keep R1 decisive as locked, or record the story as `non_discriminative` (no grades)?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
in Web ESS - goals related details and Measure of success field not available for staff to add details against the goal.
9/23/2026 11:44 AM Bug filed on &quot;PM-GS-014 - Goal Setting - Submit Goal Plan for Approval&quot; Step no. Result Title 1. None Log in as Employee.Expected Result Goal plan is submitted successfully and routed for manager review. 2. Failed Complete all goal-related sections.Comment in Web ESS - goals related details and Measure of success field not available for staff to add details against the goal. 3. Passed Verify mandatory information is completed. 4. Passed Submit the goal plan. 5. Passed Verify submission confirmation message. 6. Passed Verify plan status changes to Submitted. Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from "PM-GS-014 - Goal Setting - Submit Goal Plan for Approval" (filed 9/23/2026). The test expects: all goal-related sections completed; the goal plan submitted and routed for manager review; a confirmation message; and status changed to Submitted. The comment says that goal-related details and a Measure of success field are not available for the staff member to fill in against each goal.
Not stated: whether Measure of success is required, and the exact layout.

### Required (R), decisive for overall
- **R1.** Pass: the answer makes goal-related details and a Measure of success field available to the employee for each goal. Fail: only one of the two is added, or the fields are added for the manager only.
- **R2.** Pass: the answer keeps the submit path working: a goal plan with the new fields completed is submitted, the confirmation appears, and status becomes Submitted. Fail: the new fields stop the submit or the status change.

### Diagnostic (D), reported only
- **D1.** States whether Measure of success is mandatory, and why. Not stated in the story, so the answer may choose and must state the choice.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-20925: No field available to enter contact number during leave

- Rubric: `rubrics/rubric-W-20925.md`, sha256 `bdd699f6691eb3cd8492bb11a85475515a2c029e6e03a096570720b0c089760e` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: The second read flagged R2 as a test step. Not changed: R2 restates steps 2 and 3 of the test, so an answer that accepts letters or special characters fails it.
- Decision needed: Keep R2 decisive as locked, or move it to D?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
No field available to enter contact number during leave
9/21/2026 4:26 PM Bug filed on &quot;Employee - Fields validation - Phone Number Verify mandatory/optional behavior&quot; Step no. Result Title 1. None Log in with the appropriate user role and navigate to the relevant page.Expected Result Verify that the system behavior matches the expected outcome for the test case. 2. Failed System to allow numeric entry.Comment No field available to enter Phone number 3. None System to block alphabets entry and special characters. 4. None Verify that the system behavior matches the expected outcome for the test case. Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from test case "Employee - Fields validation - Phone Number Verify mandatory/optional behavior" (filed 9/21/2026). The test expects numeric entry to be allowed (step 2) and alphabets and special characters to be blocked (step 3). The comment says there is no field to enter a phone number during leave.
Not stated: whether the field is mandatory or optional, and the exact form.

### Required (R), decisive for overall
- **R1.** Pass: the answer makes a phone number field available in the leave request flow. Fail: it adds no field, or adds one only on a screen that is not part of leave.
- **R2.** Pass: the answer makes the field accept digits and reject letters and special characters, as step 3 requires. Fail: it accepts letters or special characters, or it rejects digits.

### Diagnostic (D), reported only
- **D1.** States whether the field is mandatory or optional, and why. The story does not say, so the answer may choose and must state the choice.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-20926: No field available to enter address during leave

- Rubric: `rubrics/rubric-W-20926.md`, sha256 `e17b946cd16c03a50dfafa75ac53148bc7a2ff1b63e9103a2ed15f45d8ace7ac` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: The second read flagged R2 as a test step, as for W-20925. Not changed, for the same reason.
- Decision needed: Keep R2 decisive as locked, or move it to D?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
No field available to enter address during leave
9/21/2026 4:27 PM Bug filed on &quot;Employee - Fields validation - Address verify mandatory/optional behavior&quot; Step no. Result Title 1. None Log in with the appropriate user role and navigate to the relevant page.Expected Result Verify that the system behavior matches the expected outcome for the test case. 2. Failed System to allow alpha numeric entry. 3. None Block special characters. 4. None Verify that the system behavior matches the expected outcome for the test case. Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from test case "Employee - Fields validation - Address verify mandatory/optional behavior" (filed 9/21/2026). The test expects alphanumeric entry to be allowed (step 2) and special characters to be blocked (step 3). The comment says there is no field to enter an address during leave.
Not stated: whether the field is mandatory or optional, and the exact form.

### Required (R), decisive for overall
- **R1.** Pass: the answer makes an address field available in the leave request flow. Fail: it adds no field, or adds one only on a screen that is not part of leave.
- **R2.** Pass: the answer makes the field accept letters and digits, and block special characters, as steps 2 and 3 require. Fail: it accepts special characters, or accepts only letters or only digits.

### Diagnostic (D), reported only
- **D1.** States whether the field is mandatory or optional, and why. The story does not say, so the answer may choose and must state the choice.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-20927: No field to enter Handover details mandatorily

- Rubric: `rubrics/rubric-W-20927.md`, sha256 `c33ad445d092f29c76dce3f5c28bcdb96445afb3511c2da0d27a84866ac31fae` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: R2 was changed after the second read, before the lock: the form and the step where the check applies moved to D1. Mandatory entry (from the title) is now R2.
- Decision needed: Accept the change as locked, or revert it?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
No field to enter Handover details mandatorily
9/21/2026 4:28 PM Bug filed on &quot;Employee - Fields validation - Handover Details & Remarks&quot; Step no. Result Title 1. None Log in with the appropriate user role and navigate to the relevant page.Expected Result Verify that the system behavior matches the expected outcome for the test case. 2. None System to save entered data. 3. None Verify that the system behavior matches the expected outcome for the test case. Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from test case "Employee - Fields validation - Handover Details & Remarks" (filed 9/21/2026). The title says there is no field to enter handover details mandatorily. The test expects the system to save the entered data (step 2).
Not stated: the form or request type the field belongs to, when the mandatory check applies, and what the remarks field should do.

### Required (R), decisive for overall
- **R1.** Pass: the answer makes a Handover Details field available so the employee can enter handover details. Fail: it adds no handover field, or adds only a remarks field.
- **R2.** Pass: the answer makes the handover details field mandatory (the title says it must be entered mandatorily), and entered data is still saved when the field is filled. Fail: the field stays optional, or a filled field blocks saving.

### Diagnostic (D), reported only
- **D1.** States the form the field belongs to and the step where the mandatory check applies. The story does not say, so the answer may choose and must state the choice.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-22080: Bulk approve/ reject option to be available for overtime submission by attendance approver in ESS. Th escreen keeps giving confirmation pop up on each checkbox click.

- Rubric: `rubrics/rubric-W-22080.md`, sha256 `dcfda64496a5e12d48f2debf86f99e8b6dc1018cb79752d5a29b5490fa9eeda2` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: The second read flagged R3: the roles and the consolidated report are not in the bug title. Not changed: both are stated in step 2 of the test's expected result.
- Decision needed: Keep R3 decisive as locked, or move part of it to D?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
Bulk approve/ reject option to be available for overtime submission by attendance approver in ESS. Th escreen keeps giving confirmation pop up on each checkbox click.
10/1/2026 1:03 AM Bug filed on &quot;Workflow - Overtime process - Attendance administrator should be able to view all overtime entries calcuated by system. must have an option to &quot;select all&quot; and approve (or) not approve a particular entry for overtime&quot; Step no. Result Title 1. None Log in with the appropriate user role and navigate to the relevant page.Expected Result Verify that the system behavior matches the expected outcome for the test case. 2. None Access must be granted to AMSF and MSO to view and approve individual overtime entry for staff. consodilated report should also be made available to OPS team and HR. 3. None Verify that the system behavior matches the expected outcome for the test case. Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from "Workflow - Overtime process - Attendance administrator should be able to view all overtime entries calculated by system. Must have an option to select all and approve (or not approve) a particular entry" (filed 10/1/2026). The test expects: AMSF and MSO have access to view and approve individual overtime entries for staff; a consolidated report is also available to the OPS team and HR. The title says the screen keeps showing a confirmation pop-up on each checkbox click.
Not stated: how the access roles are set up, and the exact layout of the select-all control.

### Required (R), decisive for overall
- **R1.** Pass: the answer adds a select-all option and lets the approver approve or not approve an individual entry. Fail: there is no select-all, or there is no per-entry choice.
- **R2.** Pass: the answer removes the confirmation pop-up on each checkbox click. A single confirmation for the bulk action is allowed. Fail: the pop-up still appears on each checkbox click.
- **R3.** Pass: the answer gives AMSF and MSO view and approve access to individual overtime entries, and provides a consolidated overtime report to the OPS team and HR. Fail: either part is missing.

### Diagnostic (D), reported only
- **D1.** Names the roles or permissions it uses to set the access. Not required.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-21681: Midyear Review - Cancel/ Edit goals option is not available

- Rubric: `rubrics/rubric-W-21681.md`, sha256 `02bfa597d280db3233603d201a93d848cefeacf8c0c93b3744c1b72b465647ea` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: The second read flagged R3 (weighting). Not changed: the story says the weighting "should be either reassigned or there should be an option to add another goal", and R3 accepts either.
- Decision needed: Keep R3 decisive as locked, or change it?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
Midyear Review - Cancel/ Edit goals option is not available
9/24/2026 9:27 AM Bug filed on &quot;PM-MYR-005 - Mid-Year Review - Cancel Goal /Edit Due to Business Change&quot; Step no. Result Title 1. Passed Log in as Employee.Expected Result Goal can be formally cancelled with supporting justification and review history retains the update. Note: Incase a goal is cancelled, the alloted weighing percentage should be either reassigned or there should be an option to add another goal and submit for line manager approval. 2. Passed Open Mid-Year Review. 3. Passed Select an active goal. 4. Failed Update goal status to &quot;Cancelled&quot; /Edit GoalComment Cancel/ Edit goals option is not available 5. Failed Enter cancellation justification.Comment Cancel/ Edit goals option is not available 6. Passed Save the review. 7. Failed Verify cancellation reason is displayed.Comment Cancel/ Edit goals option is not available Test Configuration: Windows 10
```

### Story summary (rubric)
Bug from "PM-MYR-005 - Mid-Year Review - Cancel Goal / Edit Due to Business Change" (filed 9/24/2026). The test expects: a goal can be formally cancelled with supporting justification and review history keeps the update; if a goal is cancelled, its weighting is either reassigned or the employee can add another goal and submit it for line manager approval. The comment says the Cancel/Edit goal option, the cancellation justification and the displayed cancellation reason are all missing.
Not stated: the list of goal statuses, and how weighting is split when reassigned.

### Required (R), decisive for overall
- **R1.** Pass: the answer makes it possible to set an active goal to Cancelled and enter a cancellation justification in Mid-Year Review. Fail: it offers only a display change or a free-text note, with no Cancel option.
- **R2.** Pass: after saving, the cancellation reason is displayed and kept in review history. Fail: the reason is not displayed, or the history is not kept.
- **R3.** Pass: the answer states how the cancelled goal's weighting is handled: reassigned to other goals, or a replacement goal added and submitted for line manager approval (the story allows either; the answer chooses one). Fail: it does not deal with the weighting.

### Diagnostic (D), reported only
- **D1.** Says which goal statuses it assumes, if it adds any beyond "Cancelled". Not required.

Reviewer: [ ] accept    [ ] change: ____________________

---

## W-19358: WebESS - Time and Attendance � Cancelled Leave Is Still Displayed as Approved Leave

- Rubric: `rubrics/rubric-W-19358.md`, sha256 `bd2ae54efb584e5dce34a1f4725605e329f3beb4b1962821df35c9e83fcfb83d` (locked; hash checked against `rubric-lock-0B.md` when this file was written).
- Second read: Not flagged by the second read (pass). Status is `not_evaluable`: the full text is not recoverable locally. The rubric is locked but not used, and no call is made for this story.
- Decision needed: Accept `not_evaluable` (no call, no grade), or give a reason to write a rubric from the visible text (a new lock, and the status is decided again)?

### Story text (`calibration-stories-0B.json`, shown as stored)
```text
WebESS - Time and Attendance � Cancelled Leave Is Still Displayed as Approved Leave
An employee originally submitted a leave request for **03/09/2026** on **27/07/2026**. The leave was subsequently cancelled on **30/07/2026**. After the cancellation, there is no longer an effective approved leave for **03/09/2026** in F&O. ![image.png](https://dev.azure.com/gemseducation/c153c9a8-3abc-4dd1-b615-03f718b00c76/_apis/wit/attachments/09b1923f-69bd-4e88-a653-2357767a934c?fileName=image.png) However, when checking **WebESS > Time and Attendance**, the date is still displayed as **Approved Leave**. ![image.png](https://dev.azure.com/gemseducation/c153c9a8-3abc-4dd1-b615-03f718b00c76/_apis/wit/attachments/2fa3ef36-6bfa-4b70-be57-30968223deee?fileName=image.png) Further investigation in the **Leave Request Detail** shows that there are multiple transactions for the same employee and leave date: * The original leave transaction created on **27/07/2026** has **Amount = 1** and **St
```

### Story summary (rubric)
WebESS > Time and Attendance shows "Approved Leave" for 03/09/2026. The leave was submitted on 27/07/2026 and cancelled on 30/07/2026. The story says that after cancellation there is no effective approved leave for that date in F&O. Leave Request Detail shows several transactions for the same employee and leave date.
The story text is cut off mid-sentence at the status of the original transaction ("has Amount = 1 and St"). This rubric does not use the cut-off part.
Not stated: which transaction's status is wrong, and whether the fix is in the data or the display.

### Required (R), decisive for overall
- **R1.** Pass: the answer proposes a change so that WebESS does not show 03/09/2026 as Approved Leave once the leave was cancelled on 30/07/2026. The change may be in how the transactions are read or shown, or in the data; the answer may name either. Fail: it only says to check with HR or to resubmit the leave, or it changes labels without stopping the cancelled leave from showing as approved.

### Diagnostic (D), reported only
- **D1.** Pass: the answer says the story text is cut off, or labels its assumptions about the unseen status values. Fail: it assumes those values as fact.

Reviewer: [ ] accept    [ ] change: ____________________
