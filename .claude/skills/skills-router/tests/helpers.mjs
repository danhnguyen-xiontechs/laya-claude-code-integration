// Shared fixtures: a throw-away project + home with every catalog source, and a fake decision provider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

/** { root, home, cacheDir, builtinFiles } with project, user, plugin, command, agent, BMad and builtin sources. */
export function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-'));
  const root = path.join(base, 'proj'), home = path.join(base, 'home');
  // project skills: plain, block scalar + explicit-only, and .agents/skills with a quoted description
  write(path.join(root, '.claude/skills/review-pr/SKILL.md'),
    '---\nname: review-pr\ndescription: Review a pull request (GitHub, Azure DevOps, GitLab) against the project rules and report findings by severity.\n---\n# Review PR\nFetch the PR diff, check each rule, write findings.');
  write(path.join(root, '.claude/skills/review-pr-jev-classify/SKILL.md'),
    '---\r\nname: review-pr-jev-classify\r\ndescription: >-\r\n  A/B copy of review-pr with a Jev severity check of each finding.\r\n  Trigger only on "/review-pr-jev-classify <url>" or an explicit request to A/B Laya vs Jev on PR severity; plain PR reviews go to review-pr.\r\n---\r\n# Review PR (Jev)\r\n');
  write(path.join(root, '.agents/skills/deploy-app/SKILL.md'),
    "---\nname: deploy-app\ndescription: 'Deploy the app to staging or production; it''s the release workflow.'\n---\nSteps: build, push, verify.");
  write(path.join(root, '.claude/skills/morning-brief/SKILL.md'),
    '---\nname: morning-brief\ndescription: Render the morning brief. Use only when the user explicitly asks for their morning brief.\ndisable-model-invocation: false\n---\n');
  write(path.join(root, '.claude/skills/not-a-skill/README.md'), 'no SKILL.md here');
  // user skills: one shadowed by the project, one with a multi-line plain description
  write(path.join(home, '.claude/skills/review-pr/SKILL.md'), '---\nname: review-pr\ndescription: Old user copy of review-pr.\n---\n');
  write(path.join(home, '.claude/skills/pdf-tools/SKILL.md'),
    '---\nname: pdf-tools\ndescription: Read, merge and split PDF files,\n  fill PDF forms and extract tables.\nallowed-tools: Bash\n---\n# PDF tools\n' + 'x'.repeat(3000));
  // installed plugin (user scope) + an uninstalled marketplace checkout that must be ignored
  const plug = path.join(home, '.claude/plugins/cache/mk/frontend/1.0.0');
  write(path.join(plug, 'skills/frontend-design/SKILL.md'), '---\nname: frontend-design\ndescription: "Build distinctive, production-grade web UI \\"without\\" generic AI looks."\n---\n');
  write(path.join(plug, 'skills/review-pr/SKILL.md'), '---\nname: review-pr\ndescription: Plugin copy of review-pr.\n---\n');
  write(path.join(home, '.claude/plugins/marketplaces/mk/plugins/other/skills/ignored/SKILL.md'), '---\nname: ignored\ndescription: not installed\n---\n');
  write(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'frontend@mk': [{ scope: 'user', installPath: plug }],
      'elsewhere@mk': [{ scope: 'project', projectPath: path.join(base, 'other-project'), installPath: plug }],
    },
  }));
  // commands (namespaced, and one without frontmatter) and an agent
  write(path.join(home, '.claude/commands/git/commit.md'), '---\ndescription: Write a conventional commit message and commit staged changes\nargument-hint: [scope]\n---\nCommit body');
  write(path.join(root, '.claude/commands/release.md'), '# Cut a release: bump version, tag and push\n\nMore text.');
  write(path.join(root, '.claude/agents/test-runner.md'), '---\nname: test-runner\ndescription: Runs the test suite and summarizes failures.\ntools: Bash\n---\nYou run tests.');
  // BMad catalog: header, _meta row, an action row and a skill that is also a project skill
  write(path.join(root, '_bmad/_config/bmad-help.csv'), [
    'module,skill,display-name,menu-code,description,action,args,phase,preceded-by,followed-by,required,output-location,outputs',
    'BMad Method,_meta,,,,,,,,,false,https://docs.bmad-method.org/,',
    'BMad Method,bmad-prd,PRD,PRD,"Create, edit or validate a PRD (product requirements document).",,,2-planning,bmad-product-brief,bmad-architecture,true,planning_artifacts,prd',
    'BMad Method,bmad-prd,PRD,VP,"Validate a finished PRD, ""strictly"".",validate,,2-planning,,,false,,',
    'BMad Method,bmad-code-review,Code Review,CR,"Adversarial review of code changes in the working tree with layered reviewers.",,,4-implementation,bmad-dev-story,,false,,',
  ].join('\n'));
  write(path.join(root, '.claude/skills/bmad-code-review/SKILL.md'), '---\nname: bmad-code-review\ndescription: Adversarial BMad code review of the working tree changes.\n---\n');
  const builtin = path.join(base, 'builtin.json');
  write(builtin, JSON.stringify({ skills: [{ name: 'code-review', description: 'Review the current diff or a pull request for correctness bugs.' }] }));
  return { base, root, home, cacheDir: path.join(base, 'cache'), builtinFiles: [builtin] };
}

/**
 * Fake decisions endpoint. `answer(body)` returns the answers map; default: choice prefers the first
 * candidate, gate/fit from options. Records every call.
 */
export function fakeProvider({ gate = 0.9, fits = [0.8, 0.4, 0.1], choice = null, status = 200, cost = 0.00002, throws = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (throws) throw new Error(throws);
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (status !== 200) return { ok: false, status, json: async () => ({ error: { code: 'bad', message: 'nope' } }) };
    const ids = Object.keys(body.questions.which.criteria);
    const probs = choice || Object.fromEntries(ids.map((id, i) => [id, id === 'none' ? 0.05 : Number((0.9 / (i + 1)).toFixed(3))]));
    const answers = { which: { probabilities: probs }, gate: { noul: gate } };
    fits.forEach((f, i) => { if (body.questions[`fit_${i}`]) answers[`fit_${i}`] = { probabilities: { yes: f, no: 1 - f } }; });
    return { ok: true, status: 200, json: async () => ({ model: 'fake-1', answers, usage: { input_tokens: 100, output_tokens: 3, cost } }) };
  };
  return { calls, fetchImpl };
}
