// The decisions the four web-test-{laya,jev}-* skills ask a model, copied VERBATIM from their scripts
// (wording, labels, thresholds, rules), so the offline A/B sends Laya and Jev exactly what the skills send.
// eval/consistency.test.mjs fails if a script drifts from this file.

// ---- gate (gate.mjs) -------------------------------------------------------------------------------------------
export const GATE = {
  WRITE_RE: /\b(submit|approve|reject|cancel|withdraw|upload|save|delete|remove|add|create|edit|update|send|confirm|apply|complete|finish|delegate|sign|accept|decline|assign|book|enrol|enroll|register|reset|change)\w*/i,
  LOOK_RE: /\b(check|verify|ensure|confirm that|see|observe|inspect|assert)\b[^;]*\b(button|link|option|tab|is (disabled|enabled|hidden|visible|greyed)|greyed|access is denied|denied)\b/i,
  P: 0.5,
  maxLen: 256,
  question: { writes: { type: 'choice', instructions: 'What is the main verb of this test step: one that changes data, or one that only looks at data?',
    criteria: { write: 'Changes data: submit, approve, reject, cancel, withdraw, upload, save, delete, add, create, edit, send, confirm, apply, complete.',
      read: 'Only looks: open, view, navigate, inspect, check, verify, switch view, filter, search, download, read.' } } },
  state: (text) => ({ step_action: text }),
};
export const gateRule = (t) => GATE.WRITE_RE.test(t) && !GATE.LOOK_RE.test(t);

// ---- verdict (verdict.mjs) -------------------------------------------------------------------------------------
export const VERDICT = {
  HIGH: 0.85, LOW: 0.6, maxLen: 512,
  question: { verdict: {
    type: 'choice',
    instructions: 'A manual web test step. Compare the actual result with the expected result. What is the verdict?',
    criteria: {
      pass: 'The actual result shows what the expected result describes.',
      fail: 'The actual result differs from the expected result: wrong value, wrong message, an error, or something missing.',
      blocked: 'The step could not be checked: page did not load, sign-in needed, test data missing, or an environment error.',
    },
  } },
  state: (expected, actual) => ({ expected: expected ?? '', actual: actual ?? '' }),
};

// ---- oracle (oracle.mjs) ---------------------------------------------------------------------------------------
export const ORACLE = {
  PASS_MIN: 0.95, FAIL_MIN: 0.85, maxLen: 512,
  question: { verdict: {
    type: 'choice',
    instructions: 'A web test step. Does the observed page state show the expected result?',
    criteria: {
      pass: 'Yes: the observed state shows everything the expected result describes.',
      fail: 'No: the observed state contradicts the expected result: wrong value, wrong message, an error, or something missing.',
      not_ready: 'Not yet: the page is still loading or has not reached the state the expected result describes.',
      ambiguous: 'Cannot tell from this observation; a person needs to look.',
    },
  } },
  state: (expected, observed, url, loading) => ({ expected: expected ?? '', observed, url, loading }),
  ERROR_RE: /something went wrong|access denied|unauthori[sz]ed|an error occurred|failed to load|\b(?:4\d\d|5\d\d)\b.*error/i,
  /** Quoted fragments of the expected result: the concrete strings the rule can look for. */
  quoted(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/'([^']{2,})'|"([^"]{2,})"|‘([^’]{2,})’|“([^”]{2,})”/g)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4]).trim());
    return out;
  },
};

// ---- wait (wait.mjs) -------------------------------------------------------------------------------------------
export const SCREENS = {
  'home': 'ESS home / dashboard with tiles for the main sections',
  'profile': 'Employee profile: personal details, contact info, address, dependents, education, identification',
  'time-off': 'Leave / time-off: balances, leave requests list or a new leave request form',
  'attendance': 'Attendance: my attendance or team attendance calendar, schedule, holidays',
  'payslips': 'Payslips list or a payslip detail',
  'hr-request': 'HR request: list of HR requests or a new HR request form',
  'approvals': 'Approvals / approval delegation: pending requests for a manager to approve or reject',
  'employment': 'Employment: probation review, questionnaires, calibration views',
  'courses': 'Courses / course calendar / learning',
  'login': 'Microsoft sign-in page: email or password prompt, account picker, MFA / verify your identity',
  'error': 'Error page or a global error message such as Something went wrong, Access denied, 404 Not found',
  'unknown': 'None of the above',
};
export const WAIT = {
  MIN_P: 0.6, MAX_CHARS: 1500,
  LOGIN_RE: /sign in to your account|pick an account|enter password|approve sign in request|verify your identity|stay signed in\?|login\.microsoftonline/i,
  ERROR_RE: /something went wrong|access denied|unauthori[sz]ed|not found|an error occurred|failed to load/i,
  questions: {
    state: { type: 'choice', instructions: 'Has this web page finished loading its content?',
      criteria: { ready: 'Yes: real content (tables, forms, numbers, names) is visible and no loading placeholders remain.',
        loading: 'No: the page is still loading — skeletons, spinners, empty tables, or only a shell/header is visible.',
        error: 'No: the page shows an error instead of content.' } },
    screen: { type: 'choice', instructions: 'Which ESS screen is this page?', criteria: SCREENS },
    login: { type: 'choice', instructions: 'Is this a Microsoft sign-in / MFA page rather than the application?',
      criteria: { true: 'Yes, a sign-in, account picker, password or MFA page.', false: 'No, the application itself.' } },
  },
  state: (probe) => ({ url: probe.url, title: probe.title, loading_indicators: probe.loading, page_text: probe.text.slice(0, 1500) }),
};
