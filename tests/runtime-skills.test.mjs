import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'contractor-skills-'));
process.env.CONTRACTOR_DATA_DIR = tempDir;
const runtimeSkillsMod = await import(`../src/runtime-skills.mjs?test=${Date.now()}`);

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runtime document skills', () => {
  it('parses frontmatter metadata from markdown skills', async () => {
    const markdown = [
      '---',
      'id: custom-skill',
      'name: Custom Skill',
      'appliesTo:',
      '  - cv',
      '  - quote',
      'version: 3',
      '---',
      '',
      '# Body',
      '',
      'Rules here.',
    ].join('\n');

    const skill = runtimeSkillsMod.parseRuntimeSkill(markdown, 'custom-skill.md');

    assert.strictEqual(skill.id, 'custom-skill');
    assert.strictEqual(skill.name, 'Custom Skill');
    assert.deepStrictEqual(skill.appliesTo, ['cv', 'quote']);
    assert.strictEqual(skill.version, '3');
    assert.ok(skill.body.includes('Rules here.'));
  });

  it('initializes editable skills in the user data directory', async () => {
    const skills = runtimeSkillsMod.initRuntimeSkills();
    const ids = skills.map(skill => skill.id).sort();

    assert.ok(ids.includes('hebrew-document-generator'));
    assert.ok(ids.includes('israeli-cv-builder'));
    assert.ok(runtimeSkillsMod.USER_SKILLS_DIR.startsWith(tempDir));
  });
});
