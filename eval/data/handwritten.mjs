// Hand-written, ESS-flavoured test data with ground truth fixed BY CONSTRUCTION (written before any model saw it).
// Not real run data: the report says so wherever these numbers appear. Names/e-mails are invented.

// ---- verdict / oracle: [expected, actual, truth] ---------------------------------------------------------------
export const VERDICT_HW = [
  // pass
  ['Leave request is created and listed with status Pending', "Toast 'Leave request submitted'. Time off list now shows Annual leave 12–13 Nov, status Pending.", 'pass'],
  ['Payslip for September 2026 opens and shows net pay', "Payslip September 2026 opened; header 'Net pay' with an amount shown, PDF download button visible.", 'pass'],
  ['Approvals page lists pending requests for the manager', "Approvals tab 'Pending (3)' lists 3 requests: Leave – A. Tan, Overtime – L. Wong, Leave – R. Das.", 'pass'],
  ["Profile shows the employee's work email", 'Profile > Contact info: Work email jane.doe@example.com displayed.', 'pass'],
  ['Holiday is highlighted on the calendar', "Fri 09/10 shows chip '(VN) Holiday' in orange; other days unmarked.", 'pass'],
  ['Cancel button is disabled for an approved leave in the past', 'Leave 02/03 Approved: Cancel button rendered with disabled attribute (greyed).', 'pass'],
  ['Course calendar shows the next enrolled course', "Courses calendar, 14 Oct: 'Excel advanced 09:00–12:00 Enrolled'.", 'pass'],
  ['Search by name filters the employee list', "Typed 'Tan' → list reduced from 24 to 2 rows: Alice Tan, Ben Tan.", 'pass'],
  ['Total hours for the week equals the sum of the daily hours', 'Mon 8, Tue 8, Wed 8, Thu 8, Fri 8 = 40; toolbar Total hours: 40.', 'pass'],
  ['Error message appears when end date is before start date', "After choosing end 05/10 and start 08/10 an inline error 'End date must be on or after start date' appears under End date; Save disabled.", 'pass'],
  ['User lands on the home dashboard after sign in', 'URL /home, dashboard tiles Attendance, Time off, Payslips visible.', 'pass'],
  ['Time off balance shows 14 days annual leave', 'Balance card: Annual leave 14.0 days remaining.', 'pass'],
  ['Total hours stays the same after navigating away and back', 'Total hours 55 on first visit; after Next then Previous month still 55.', 'pass'],
  ['Dates before the hire date are not selectable', 'Dates 01–14 Sep are greyed and not selectable; 15 Sep (hire date) onwards selectable.', 'pass'],
  // fail
  ['Time off balance shows 14 days annual leave', 'Balance card: Annual leave 9.5 days remaining.', 'fail'],
  ['Leave request is created and listed with status Pending', "Toast 'Leave request submitted'. List shows the request with status Draft.", 'fail'],
  ['Payslip for September 2026 opens and shows net pay', 'Clicking September 2026 does nothing; the payslip panel never opens and no toast appears.', 'fail'],
  ['Approvals page lists pending requests for the manager', "Approvals tab 'Pending (0)': No requests to display although two pending requests exist in the API response.", 'fail'],
  ['Holiday is highlighted on the calendar', 'Fri 09/10 shows no holiday chip; the day looks like a normal working day.', 'fail'],
  ['Cancel button is disabled for an approved leave in the past', 'Cancel button is enabled and clickable on leave 02/03 Approved.', 'fail'],
  ['Search by name filters the employee list', "Typed 'Tan' → the list still shows all 24 rows.", 'fail'],
  ['Total hours for the week equals the sum of the daily hours', 'Daily hours sum to 40 but the toolbar shows Total hours: 0.', 'fail'],
  ['Error message appears when end date is before start date', 'No error shown; the Save button stays enabled and the request is accepted.', 'fail'],
  ['Course calendar shows the next enrolled course', "Calendar shows 'Excel advanced' on 15 Oct instead of 14 Oct.", 'fail'],
  ["Profile shows the employee's work email", 'Work email field is empty.', 'fail'],
  ['Employee sees only their own payslips', 'Payslip list contains payslips for two other employees (E1043, E1077).', 'fail'],
  ['Month view Total hours is 55 for June 2026', 'Month view June 2026: Scheduled hours 160, Total hours: 0, Absence hours 160.', 'fail'],
  ['Total hours stays the same after navigating away and back', 'First visit Total hours 55; after Next then Previous month Total hours 0.', 'fail'],
  ['Scheduled hours reflects the whole month', 'Scheduled hours: 40 (the week value) while Month view is selected.', 'fail'],
  // blocked
  ['Time off balance shows 14 days annual leave', "Redirected to Microsoft sign-in 'Pick an account'; the session expired so the page could not be reached.", 'blocked'],
  ['Approvals page lists pending requests for the manager', 'This account has no direct reports, so the approvals list cannot be exercised; a manager account is needed.', 'blocked'],
  ['Payslip for September 2026 opens and shows net pay', 'Page stays on skeleton placeholders for 40 s; API /payslips returned 503; nothing to verify.', 'blocked'],
  ['Cancel button is disabled for an approved leave in the past', 'No approved past leave exists for this profile, so the scenario cannot be set up.', 'blocked'],
  ['Course calendar shows the next enrolled course', 'Courses menu entry is not present for this role; the feature flag is off on dev.', 'blocked'],
  ['Holiday is highlighted on the calendar', "ESS dev returned 'Something went wrong' (traceId 00-8f31) when loading the calendar; cannot check.", 'blocked'],
  ['Total hours for the week equals the sum of the daily hours', 'Browser could not reach the site (ERR_CONNECTION_TIMED_OUT).', 'blocked'],
  ['Search by name filters the employee list', 'Test data missing: the employee list is empty on this environment.', 'blocked'],
];

// ---- oracle only: the page is not in the expected state yet → not_ready (observed is partial / still loading) ----
// [expected, observed[], loading]
export const ORACLE_NOT_READY = [
  ['Table shows 3 leave requests', ['Leave requests', 'Loading...'], true],
  ['Toolbar shows Total hours for June 2026', ['June 2026', 'Total hours', '—'], true],
  ["Payslip list shows 'September 2026'", ['Payslips', '2026'], true],
  ['Approvals list shows the pending requests', ['Approvals', 'Pending ( )'], true],
  ['Balance card shows the annual leave days', ['Time off', 'Balances'], true],
  ['Course calendar shows the enrolled course', ['Courses', 'October 2026'], true],
  ['Profile shows the work email', ['My profile', 'Work email'], true],
  ['Team list shows the direct reports', ['Team view', 'Direct reports'], true],
];

// ---- wait: page snapshots the way wait.mjs probes them. [id, url path, title, loading_indicators, text, truth] ----
// truth = { state: ready|loading|error, login: true|false, screen: <SCREENS key>, debatable?: true }
// debatable = a reasonable person could label the 'Microsoft sign-in page?' question either way (reported separately).
const R = (screen) => ({ state: 'ready', login: false, screen });
export const WAIT_HW = [
  ['home', '/home', 'ESS', 0, 'Home Welcome back, Jane Quick links Attendance Time off Payslips Approvals Announcements 3 new', R('home')],
  ['profile', '/profile', 'ESS', 0, 'My profile Personal details Jane Doe Employee ID E1042 Department Finance Contact info Work email jane.doe@example.com Phone +65 8123 4567 Address Dependents Education Identification', R('profile')],
  ['time-off', '/time-off', 'ESS', 0, 'Time off Balances Annual leave 14.0 days Sick leave 6.0 days Requests New request Status Pending Approved', R('time-off')],
  ['attendance', '/attendance', 'ESS', 0, 'My attendance Week 5 - 11 Oct Mon 05/10 · 8h Tue 06/10 · 8h Wed 07/10 · No records Scheduled hours 40 Total hours 24 Absence hours 0', R('attendance')],
  ['payslips', '/payslips', 'ESS', 0, 'Payslips 2026 October September August Net pay 4,215.00 Download PDF', R('payslips')],
  ['hr-request', '/hr-request', 'ESS', 0, 'HR requests New request Type Letter of employment Status Submitted Reference HR-2210', R('hr-request')],
  ['approvals', '/approvals', 'ESS', 0, 'Approvals Pending (3) Leave A. Tan 12-13 Nov Overtime L. Wong 2h Approve Reject', R('approvals')],
  ['employment', '/employment', 'ESS', 0, 'Employment Probation review Questionnaire due 30 Oct Calibration Overall rating Meets expectations', R('employment')],
  ['courses', '/courses', 'ESS', 0, 'Courses Calendar October 2026 Excel advanced 14 Oct 09:00 Enrolled Safety induction Not started', R('courses')],
  ['manager-view-empty', '/manager-view', 'ESS', 0, 'Team view Direct reports 0 No team members to display', R('unknown')],
  ['attendance-month', '/attendance', 'ESS', 0, 'My attendance Month view October 2026 Scheduled hours 176 Total hours 0 Absence hours 48 Mon Tue Wed Thu Fri Sat Sun 1 2 3 4 5 6 7 8 9 10', R('attendance')],
  ['time-off-form', '/time-off/new', 'ESS', 0, 'New leave request Leave type Annual leave Start date End date Phone number Handover to Submit Cancel', R('time-off')],
  // still loading (no spinner class, so the DOM counter says 0 — the page text is what tells)
  ['shell-attendance', '/attendance', 'ESS', 0, 'ESS Home Time off Attendance Payslips Approvals Loading data', { state: 'loading', login: false, screen: 'attendance' }],
  ['shell-time-off', '/time-off', 'ESS', 0, 'Time off Balances Annual leave — Sick leave — Requests No data yet fetching…', { state: 'loading', login: false, screen: 'time-off' }],
  ['shell-payslips', '/payslips', 'ESS', 0, 'Payslips 2026 Please wait', { state: 'loading', login: false, screen: 'payslips' }],
  ['shell-approvals', '/approvals', 'ESS', 0, 'Approvals Pending ( ) Fetching your approvals', { state: 'loading', login: false, screen: 'approvals' }],
  ['shell-home', '/home', 'ESS', 0, 'ESS Quick links Attendance Time off Payslips', { state: 'loading', login: false, screen: 'home' }],
  ['shell-profile', '/profile', 'ESS', 0, 'My profile Personal details — — — — Loading', { state: 'loading', login: false, screen: 'profile' }],
  // sign-in: wording the built-in regex catches
  ['login-pick', '/login', 'Sign in to your account', 0, 'Microsoft Pick an account jane.doe@example.com Use another account', { state: 'ready', login: true, screen: 'login' }],
  ['login-stay', '/login', 'Sign in', 0, 'Stay signed in? Do this to reduce the number of times you are asked to sign in. No Yes', { state: 'ready', login: true, screen: 'login' }],
  // sign-in: wording the regex MISSES (the only place a model can add value)
  ['login-code', '/login', 'Sign in', 0, 'Enter code We texted your phone +65 •••• 12. Please enter the code to sign in. Resend code', { state: 'ready', login: true, screen: 'login' }],
  ['login-authenticator', '/login', 'Sign in', 0, "Approve a request on your phone Open your Authenticator app and approve the request. Don't see it?", { state: 'ready', login: true, screen: 'login' }],
  ['login-session', '/', 'ESS', 0, 'Your session has expired Please log in again to continue Log in', { state: 'ready', login: true, screen: 'login', debatable: true }],
  ['login-continue', '/', 'ESS', 0, 'Welcome Sign-in required Use your work account to continue Continue with Microsoft', { state: 'ready', login: true, screen: 'login' }],
  ['login-password', '/login', 'Sign in', 0, 'Jane Doe jane.doe@example.com Forgot my password Sign in', { state: 'ready', login: true, screen: 'login', debatable: true }],
  // errors: wording the regex catches
  ['error-went-wrong', '/attendance', 'ESS', 0, 'Something went wrong Please try again later. traceId 00-abc', { state: 'error', login: false, screen: 'error' }],
  ['error-denied', '/approvals', 'ESS', 0, 'Access denied You do not have permission to view this page', { state: 'error', login: false, screen: 'error' }],
  // errors: wording the regex MISSES
  ['error-load', '/time-off', 'ESS', 0, "We couldn't load your data. Check your connection and try again. Retry", { state: 'error', login: false, screen: 'error' }],
  ['error-503', '/payslips', 'ESS', 0, 'Oops! Service temporarily unavailable (503) Please come back in a few minutes', { state: 'error', login: false, screen: 'error' }],
  ['error-support', '/profile', 'ESS', 0, "This page isn't working right now. Contact support with reference 8f31c2", { state: 'error', login: false, screen: 'error' }],
  ['error-500', '/attendance', 'ESS', 0, 'Request failed with status code 500', { state: 'error', login: false, screen: 'error' }],
  ['error-forbidden', '/employment', 'ESS', 0, "Forbidden You don't have permission to view this resource", { state: 'error', login: false, screen: 'error' }],
  ['error-404', '/hr-request/99', 'ESS', 0, "404 The page you're looking for doesn't exist Back to home", { state: 'error', login: false, screen: 'error' }],
];
