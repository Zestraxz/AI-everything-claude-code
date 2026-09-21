/**
 * Tests for scripts/ci/validate-skill-sections.js
 *
 * Runs the real validator against the project tree, then exercises the
 * ratchet rules against temporary fixture directories via a wrapper
 * that overrides SKILLS_DIR and ALLOWLIST_PATH.
 *
 * Run with: node tests/ci/validate-skill-sections.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const validatorPath = path.join(repoRoot, 'scripts', 'ci', 'validate-skill-sections.js');

const COMPLETE_SKILL = [
  '---', 'name: complete', 'description: A complete skill', '---',
  '# Complete', '', '## When to Use', 'Always.', '',
  '## How It Works', 'Magic.', '', '## Examples', '`x`', ''
].join('\n');

const INCOMPLETE_SKILL = [
  '---', 'name: partial', 'description: Missing sections', '---',
  '# Partial', '', '## When to Use', 'Sometimes.', ''
].join('\n');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-sections-test-'));
}

function writeSkill(testDir, name, content) {
  const dir = path.join(testDir, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

function writeAllowlist(testDir, skills) {
  fs.writeFileSync(path.join(testDir, 'allowlist.json'), JSON.stringify({ skills }, null, 2));
}

function stripShebang(source) {
  let s = source;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
}

/**
 * Run the validator with SKILLS_DIR and ALLOWLIST_PATH pointed at a
 * fixture directory. Temp wrapper lives inside the repo so require()
 * resolves the same way as the real script.
 */
function runValidator(testDir, argv = []) {
  let source = stripShebang(fs.readFileSync(validatorPath, 'utf8'));
  source = source.replace(
    /const SKILLS_DIR = .*?;/,
    `const SKILLS_DIR = ${JSON.stringify(path.join(testDir, 'skills'))};`
  );
  source = source.replace(
    /const ALLOWLIST_PATH = .*?;/,
    `const ALLOWLIST_PATH = ${JSON.stringify(path.join(testDir, 'allowlist.json'))};`
  );
  const preamble = argv.map(arg => `process.argv.push(${JSON.stringify(arg)});`).join('\n');
  const tmpFile = path.join(repoRoot, `.tmp-skill-sections-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, `${preamble}\n${source}`, 'utf8');
    const stdout = execFileSync('node', [tmpFile], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, cwd: repoRoot
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status || 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

function withFixture(fn) {
  const testDir = createTestDir();
  try {
    fn(testDir);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('Testing validate-skill-sections.js...\n');
  let passed = 0;
  let failed = 0;
  const run = (name, fn) => { if (test(name, fn)) passed++; else failed++; };

  run('passes against the real project tree', () => {
    const stdout = execFileSync('node', [validatorPath], { encoding: 'utf8', cwd: repoRoot });
    assert.ok(/Validated \d+ skills/.test(stdout), `Unexpected output: ${stdout}`);
  });

  run('allowlist matches the real tree (no stale or missing entries)', () => {
    const allowlist = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'ci', 'skill-sections-allowlist.json'), 'utf8'));
    assert.ok(Array.isArray(allowlist.skills), 'allowlist.skills must be an array');
    const sorted = [...allowlist.skills].sort();
    assert.deepStrictEqual(allowlist.skills, sorted, 'allowlist must be sorted');
    assert.strictEqual(new Set(allowlist.skills).size, allowlist.skills.length, 'allowlist must not contain duplicates');
  });

  run('passes when every skill is complete and allowlist is empty', () => withFixture(testDir => {
    writeSkill(testDir, 'alpha', COMPLETE_SKILL);
    writeAllowlist(testDir, []);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('1 complete, 0 still on the allowlist'));
  }));

  run('fails for an incomplete skill that is not allowlisted', () => withFixture(testDir => {
    writeSkill(testDir, 'partial', INCOMPLETE_SKILL);
    writeAllowlist(testDir, []);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail');
    assert.ok(result.stderr.includes('skills/partial/SKILL.md - missing required section(s): How It Works, Examples'), result.stderr);
  }));

  run('passes for an incomplete skill that is allowlisted', () => withFixture(testDir => {
    writeSkill(testDir, 'partial', INCOMPLETE_SKILL);
    writeAllowlist(testDir, ['partial']);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('0 complete, 1 still on the allowlist'));
  }));

  run('fails when an allowlisted skill has been completed (ratchet)', () => withFixture(testDir => {
    writeSkill(testDir, 'fixed', COMPLETE_SKILL);
    writeAllowlist(testDir, ['fixed']);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail');
    assert.ok(result.stderr.includes('now has every required section - remove it from the allowlist'), result.stderr);
  }));

  run('fails when an allowlist entry has no skill directory', () => withFixture(testDir => {
    writeSkill(testDir, 'alpha', COMPLETE_SKILL);
    writeAllowlist(testDir, ['ghost']);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail');
    assert.ok(result.stderr.includes('allowlist entry "ghost" has no skills/ghost/SKILL.md'), result.stderr);
  }));

  run('accepts heading aliases, any level, and any case', () => withFixture(testDir => {
    writeSkill(testDir, 'aliased', [
      '# Aliased', '### WHEN TO ACTIVATE', 'x', '#### how it works', 'y', '## Code Examples', 'z', ''
    ].join('\n'));
    writeAllowlist(testDir, []);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 0, result.stderr);
  }));

  run('ignores headings inside fenced code blocks', () => withFixture(testDir => {
    writeSkill(testDir, 'fenced', [
      '# Fenced', '## When to Use', 'x', '```md', '## How It Works', '## Examples', '```', ''
    ].join('\n'));
    writeAllowlist(testDir, []);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 1, 'Headings in code fences must not count');
    assert.ok(result.stderr.includes('How It Works, Examples'), result.stderr);
  }));

  run('skips directories without a SKILL.md', () => withFixture(testDir => {
    fs.mkdirSync(path.join(testDir, 'skills', 'empty-dir'), { recursive: true });
    writeSkill(testDir, 'alpha', COMPLETE_SKILL);
    writeAllowlist(testDir, []);
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('Validated 1 skills'));
  }));

  run('fails on a malformed allowlist file', () => withFixture(testDir => {
    writeSkill(testDir, 'alpha', COMPLETE_SKILL);
    fs.writeFileSync(path.join(testDir, 'allowlist.json'), '{"nope": true}');
    const result = runValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail');
    assert.ok(result.stderr.includes('must contain a "skills" array'), result.stderr);
  }));

  run('--update-allowlist rewrites the allowlist from the current tree', () => withFixture(testDir => {
    writeSkill(testDir, 'zeta', INCOMPLETE_SKILL);
    writeSkill(testDir, 'alpha', INCOMPLETE_SKILL);
    writeSkill(testDir, 'done', COMPLETE_SKILL);
    writeAllowlist(testDir, ['stale']);
    const result = runValidator(testDir, ['--update-allowlist']);
    assert.strictEqual(result.code, 0, result.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(testDir, 'allowlist.json'), 'utf8'));
    assert.deepStrictEqual(written.skills, ['alpha', 'zeta']);
    assert.strictEqual(runValidator(testDir).code, 0, 'Regenerated allowlist must validate clean');
  }));

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
