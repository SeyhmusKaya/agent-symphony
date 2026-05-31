// F2: per-role skill loader.
// Test: directory layout, frontmatter parse, attach/detach, effectiveSkills.

import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// Temp dir + env var override for test isolation.
const tmpRoot = mkdtempSync(join(tmpdir(), "arc-skill-test-"));
process.env.ARCHITECT_SKILLS_ROOT = tmpRoot;

const {
  ensureRoleDir,
  loadSkills,
  loadGlobalSkills,
  loadEffectiveSkills,
  listSkillRoles,
  effectiveSkillNames,
} = await import("../../dist/orchestrator/skills.js");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}

// Setup: 3 skill (1 global, 1 mimar, 1 advisor-seo).
const writeSkill = (role, name, desc) => {
  const skillDir = join(tmpRoot, role, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\nSkill body for ${name}.`,
    "utf8",
  );
};

writeSkill("global", "git-workflow", "Git workflow");
writeSkill("mimar", "typescript-master", "TS expertise");
writeSkill("advisor-seo", "keyword-research", "Keyword research");

// Tests
check("global skill loads", loadGlobalSkills().length === 1);
check("global skill name correct", loadGlobalSkills()[0]?.name === "git-workflow");
check("mimar skill loads", loadSkills("mimar").length === 1);
check("mimar skill body parse", loadSkills("mimar")[0]?.body?.includes("typescript-master"));
check("advisor-seo skill loads", loadSkills("advisor-seo").length === 1);

// loadEffectiveSkills: global + role skills merge.
const effSeo = loadEffectiveSkills("advisor-seo");
check("effective advisor-seo = 2 skills", effSeo.length === 2);

const effMimar = loadEffectiveSkills("mimar");
check("effective mimar = 2 skills", effMimar.length === 2);

const effSefMissing = loadEffectiveSkills("sef-nonexistent-project");
check("effective sef-X (missing) = 1 (global only)", effSefMissing.length === 1);

// listSkillRoles: lists all roles.
const roles = listSkillRoles();
const roleNames = roles.map(r => r.role);
check("listSkillRoles contains 3 roles", roleNames.length >= 3);
check("listSkillRoles contains 'global'", roleNames.includes("global"));
check("listSkillRoles contains 'mimar'", roleNames.includes("mimar"));
check("listSkillRoles contains 'advisor-seo'", roleNames.includes("advisor-seo"));

// effectiveSkillNames: name list only.
const namesMimar = effectiveSkillNames("mimar");
check("effectiveSkillNames mimar is array", Array.isArray(namesMimar));
check("effectiveSkillNames mimar = 2 names", namesMimar.length === 2);

// Cleanup
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
