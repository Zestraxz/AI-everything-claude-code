#!/usr/bin/env node
/**
 * Ratchet check for the required SKILL.md sections.
 *
 * CLAUDE.md requires every curated skill to document three sections:
 * When to Use, How It Works, Examples. Most existing skills predate that
 * rule, so this check is a ratchet rather than a hard gate:
 *
 *   1. A skill missing a section FAILS unless it is listed in
 *      scripts/ci/skill-sections-allowlist.json.
 *   2. An allowlisted skill that now has every section FAILS with a
 *      "remove from allowlist" message, so the list only shrinks.
 *   3. An allowlist entry with no matching skill directory FAILS.
 *
 * Headings are matched case-insensitively at any level. Accepted forms:
 *   - When to Use   -> "When to Use", "When to Activate"
 *   - How It Works  -> "How It Works"
 *   - Examples      -> any heading containing the word "Example(s)"
 *
 * Pass --update-allowlist to regenerate the allowlist from the current
 * tree. Only use that to bootstrap; the daily workflow is to fix one
 * skill and delete its allowlist entry by hand.
 *
 * Scope: curated skills/ only. Missing or empty SKILL.md files are
 * reported by validate-skills.js and skipped here.
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '../../skills');
const ALLOWLIST_PATH = path.join(__dirname, 'skill-sections-allowlist.json');

const UPDATE_ALLOWLIST = process.argv.includes('--update-allowlist');

const REQUIRED_SECTIONS = [
  { name: 'When to Use', pattern: /^when to (?:use|activate)\b/i },
  { name: 'How It Works', pattern: /^how it works\b/i },
  { name: 'Examples', pattern: /\bexamples?\b/i }
];

/**
 * Collect markdown heading texts, ignoring fenced code blocks so a
 * "## Examples" inside a code sample does not count.
 *
 * @param {string} content
 * @returns {string[]}
 */
function extractHeadings(content) {
  const headings = [];
  let inFence = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

/**
 * @param {string} content
 * @returns {string[]} names of required sections not found
 */
function findMissingSections(content) {
  const headings = extractHeadings(content);
  return REQUIRED_SECTIONS
    .filter(section => !headings.some(heading => section.pattern.test(heading)))
    .map(section => section.name);
}

function listSkillDirs(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
}

function readAllowlist(allowlistPath) {
  if (!fs.existsSync(allowlistPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error(`${path.basename(allowlistPath)} must contain a "skills" array`);
  }
  return parsed.skills;
}

function writeAllowlist(allowlistPath, skills) {
  const payload = {
    $comment: 'Skills still missing a required SKILL.md section (When to Use, How It Works, Examples). '
      + 'Fix a skill, then delete its entry. Regenerate only with: node scripts/ci/validate-skill-sections.js --update-allowlist',
    skills: [...skills].sort()
  };
  fs.writeFileSync(allowlistPath, `${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {string} skillsDir
 * @returns {Array<{dir: string, missing: string[]}>}
 */
function scanSkills(skillsDir) {
  return listSkillDirs(skillsDir).flatMap(dir => {
    const skillMd = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) return [];
    const content = fs.readFileSync(skillMd, 'utf-8');
    if (content.trim().length === 0) return [];
    return [{ dir, missing: findMissingSections(content) }];
  });
}

function validateSkillSections() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('No skills directory, skipping');
    return 0;
  }

  const results = scanSkills(SKILLS_DIR);
  const incomplete = results.filter(result => result.missing.length > 0);

  if (UPDATE_ALLOWLIST) {
    writeAllowlist(ALLOWLIST_PATH, incomplete.map(result => result.dir));
    console.log(`Wrote ${incomplete.length} skills to ${path.basename(ALLOWLIST_PATH)}`);
    return 0;
  }

  const allowlist = new Set(readAllowlist(ALLOWLIST_PATH));
  const knownDirs = new Set(results.map(result => result.dir));
  let errorCount = 0;

  for (const { dir, missing } of incomplete) {
    if (allowlist.has(dir)) continue;
    console.error(`ERROR: skills/${dir}/SKILL.md - missing required section(s): ${missing.join(', ')}`);
    errorCount++;
  }

  const completeDirs = new Set(results.filter(result => result.missing.length === 0).map(result => result.dir));
  for (const dir of [...allowlist].sort()) {
    if (!knownDirs.has(dir)) {
      console.error(`ERROR: allowlist entry "${dir}" has no skills/${dir}/SKILL.md - remove it from the allowlist`);
      errorCount++;
    } else if (completeDirs.has(dir)) {
      console.error(`ERROR: skills/${dir}/SKILL.md now has every required section - remove it from the allowlist`);
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.error(`${errorCount} skill section error(s)`);
    return 1;
  }

  const remaining = incomplete.length;
  console.log(
    `Validated ${results.length} skills: ${results.length - remaining} complete, ${remaining} still on the allowlist`
  );
  return 0;
}

try {
  process.exit(validateSkillSections());
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
