// The fixed regression corpus, generated deterministically (no files to drift).
// Each case: the command, the text Claude would read, whether core flagged it an
// error, `critical` substrings that must survive trimming, and the expected action.

export type Fixture = {
  name: string;
  command: string;
  text: string;
  isError: boolean;
  critical: string[];
  expect: 'trim' | 'pass';
  /** Strings that must never reach Jev. */
  secrets?: string[];
};

const rep = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
const restore = rep(40, (i) => `  Restored C:\\src\\Proj${i}\\Proj${i}.csproj (in ${100 + i} ms).`);
const passed = (n: number, from = 0) => rep(n, (i) => `  Passed Contoso.Hr.Tests.LeaveServiceTests.Case_${from + i} [${(i % 9) + 1} ms]`);

const failBlock = (name: string, exp: string, act: string, file: string, line: number) => [
  `  Failed ${name} [17 ms]`,
  '  Error Message:',
  `   Assert.Equal() Failure: Expected: ${exp} Actual: ${act}`,
  '  Stack Trace:',
  `     at ${name}() in ${file}:line ${line}`,
  '     at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments, Signature sig, Boolean isConstructor)',
];

export const FIXTURES: Fixture[] = [
  {
    name: 'long_passing_dotnet_test',
    command: 'dotnet test Contoso.Hr.sln',
    text: ['Determining projects to restore...', ...restore, 'Test run for C:\\src\\Contoso.Hr.Tests\\bin\\Debug\\net8.0\\Contoso.Hr.Tests.dll (.NETCoreApp,Version=v8.0)', ...passed(420), 'Passed!  - Failed:     0, Passed:   420, Skipped:     0, Total:   420, Duration: 4 s'].join('\n'),
    isError: false,
    critical: ['Passed!  - Failed:     0, Passed:   420'],
    expect: 'trim',
  },
  {
    name: 'multiple_failing_tests',
    command: 'dotnet test',
    text: ['Exit code 1', ...restore, ...passed(150), ...failBlock('Contoso.Hr.Tests.LeaveServiceTests.Accrual_RoundsDown', '3', '4', 'C:\\src\\Tests\\LeaveServiceTests.cs', 42), ...passed(120, 150), ...failBlock('Contoso.Hr.Tests.PayrollTests.Overtime_Weekend', '1.5', '2.0', 'C:\\src\\Tests\\PayrollTests.cs', 88), ...passed(60, 270), ...failBlock('Contoso.Hr.Tests.PayrollTests.Tax_Null', 'null', '0', 'C:\\src\\Tests\\PayrollTests.cs', 131), 'Failed!  - Failed:     3, Passed:   330, Skipped:     0, Total:   333'].join('\n'),
    isError: true,
    critical: ['Exit code 1', 'Accrual_RoundsDown', 'Expected: 3 Actual: 4', 'LeaveServiceTests.cs:line 42', 'Overtime_Weekend', 'Expected: 1.5 Actual: 2.0', 'PayrollTests.cs:line 88', 'Tax_Null', 'PayrollTests.cs:line 131', 'Failed!  - Failed:     3'],
    expect: 'trim',
  },
  {
    name: 'dotnet_compiler_errors',
    command: 'dotnet build -c Release',
    text: ['Exit code 1', 'MSBuild version 17.9.8+b34f75857 for .NET', ...restore, ...rep(260, (i) => `  Contoso.Lib${i % 13} -> C:\\src\\Lib${i % 13}\\bin\\Release\\net8.0\\Contoso.Lib${i % 13}.dll`), "C:\\src\\Hr\\LeaveService.cs(57,31): error CS1002: ; expected [C:\\src\\Hr\\Hr.csproj]", "C:\\src\\Hr\\PayrollCalc.cs(12,9): error CS0246: The type or namespace name 'Money' could not be found [C:\\src\\Hr\\Hr.csproj]", '', 'Build FAILED.', '', '    0 Warning(s)', '    2 Error(s)', '', 'Time Elapsed 00:00:21.47'].join('\n'),
    isError: true,
    critical: ['Exit code 1', 'LeaveService.cs(57,31): error CS1002', "PayrollCalc.cs(12,9): error CS0246: The type or namespace name 'Money'", 'Build FAILED.', '2 Error(s)'],
    expect: 'trim',
  },
  {
    name: 'exception_stack_trace',
    command: 'npm test',
    text: ['Exit code 1', '> hr-web@1.0.0 test', '> jest', ...rep(280, (i) => `PASS src/components/c${i}.test.tsx`), "TypeError: Cannot read properties of undefined (reading 'employeeId')", ...rep(24, (i) => `    at fn${i} (/app/src/services/leave${i}.ts:${10 + i}:5)`), 'Test Suites: 1 failed, 280 passed, 281 total', 'Tests:       1 failed, 1904 passed, 1905 total'].join('\n'),
    isError: true,
    critical: ['Exit code 1', "TypeError: Cannot read properties of undefined (reading 'employeeId')", 'at fn0 (/app/src/services/leave0.ts:10:5)', 'at fn4 (/app/src/services/leave4.ts:14:5)', 'Test Suites: 1 failed', 'Tests:       1 failed'],
    expect: 'trim',
  },
  {
    name: 'warnings_then_fatal',
    command: 'npm run build',
    text: ['Exit code 134', '> hr-web@1.0.0 build', ...rep(300, (i) => (i % 2 ? `WARNING in ./src/pages/p${i}.tsx: Module Warning (from ./node_modules/eslint-loader): 'x' is assigned a value but never used` : `warning: browserslist: caniuse-lite is outdated. Please run next command \`npx update-browserslist-db@latest\``)), '<--- Last few GCs --->', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 'npm ERR! code 134'].join('\n'),
    isError: true,
    critical: ['Exit code 134', 'FATAL ERROR: Reached heap limit', 'npm ERR! code 134'],
    expect: 'trim',
  },
  {
    name: 'secret_like_strings',
    command: 'dotnet test',
    text: ['Exit code 1', ...passed(200), 'warn: Startup[0] Using connection string Server=db;User Id=sa;Password=Hunter2Secret!;', 'warn: Http[1] Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789', 'warn: Config[2] OPENROUTER_API_KEY=sk-or-v1-0123456789abcdef0123456789abcdef', ...passed(100, 200), ...failBlock('Contoso.Hr.Tests.AuthTests.Token_Expired', 'True', 'False', 'C:\\src\\Tests\\AuthTests.cs', 19), 'Failed!  - Failed:     1, Passed:   300, Skipped:     0, Total:   301'].join('\n'),
    isError: true,
    critical: ['Exit code 1', 'Token_Expired', 'AuthTests.cs:line 19', 'Failed!  - Failed:     1'],
    expect: 'trim',
    secrets: ['Hunter2Secret', 'abcdefghijklmnopqrstuvwxyz0123456789', 'sk-or-v1-0123456789abcdef0123456789abcdef'],
  },
  {
    name: 'malformed_log',
    command: 'dotnet test',
    text: ['Exit code 1', ...rep(400, (i) => `\u001b[3${i % 7}m${'#'.repeat(i % 50)}\u0000${(i * 7919).toString(36)}…`)].join('\n'),
    isError: true,
    // Only "Exit code 1" is recognised; with nothing else to anchor on we keep it all.
    critical: ['Exit code 1'],
    expect: 'pass',
  },
  {
    name: 'short_output',
    command: 'dotnet test',
    text: ['Exit code 1', ...failBlock('Contoso.Hr.Tests.X.Y', '1', '2', 'C:\\src\\X.cs', 3), 'Failed!  - Failed:     1, Passed:   0'].join('\n'),
    isError: true,
    critical: ['Exit code 1', 'Contoso.Hr.Tests.X.Y'],
    expect: 'pass',
  },
  {
    name: 'unmatched_command',
    command: 'cat logs/app.log',
    text: rep(1500, (i) => `2026-10-16T10:${String(i % 60).padStart(2, '0')} INFO request ${i} ok`).join('\n'),
    isError: false,
    critical: [],
    expect: 'pass',
  },
  {
    name: 'piped_to_head_excluded',
    command: 'dotnet test | tail -50',
    text: [...passed(400), 'Passed!  - Failed:     0, Passed:   400'].join('\n'),
    isError: false,
    critical: [],
    expect: 'pass',
  },
];
