import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyOrigin, parseSkillFrontmatter } from '../lib/skills-md.js'

test('parses a plain LF frontmatter', () => {
  const meta = parseSkillFrontmatter('---\nname: grilling\ndescription: Grill the user\n---\n\nBody\n')
  assert.equal(meta.name, 'grilling')
  assert.equal(meta.description, 'Grill the user')
})

test('parses CRLF and BOM files (the bug that lost every key)', () => {
  const text = '\uFEFF---\r\nname: libai-skill\r\ndescription: 李白.Skill\r\ndisable-model-invocation: true\r\n---\r\n'
  const meta = parseSkillFrontmatter(text)
  assert.equal(meta.name, 'libai-skill')
  assert.equal(meta.description, '李白.Skill')
  assert.equal(meta['disable-model-invocation'], 'true')
})

test('strips matching quotes and ignores non-frontmatter files', () => {
  assert.equal(parseSkillFrontmatter('---\nname: "quoted"\n---').name, 'quoted')
  assert.equal(parseSkillFrontmatter("---\nname: 'single'\n---").name, 'single')
  assert.deepEqual(parseSkillFrontmatter('no frontmatter here'), {})
  assert.deepEqual(parseSkillFrontmatter('---\nname: broken'), {})
})

test('classifies origins from source and real file location', () => {
  assert.deepEqual(classifyOrigin({ source: 'user-dsh', provider: 'filesystem', path: '' }), { kind: 'self', label: '' })
  assert.deepEqual(classifyOrigin({ source: 'project-agents', provider: 'filesystem', path: '' }), { kind: 'project', label: '' })
  assert.deepEqual(classifyOrigin({ source: 'bundled', provider: 'dsh-office', path: '' }), { kind: 'office', label: '' })
  assert.deepEqual(
    classifyOrigin({ source: 'bundled', provider: 'filesystem', path: '/x/node_modules/@acme/plugin/skill/SKILL.md' }),
    { kind: 'plugin', label: '@acme/plugin' },
  )
  assert.deepEqual(
    classifyOrigin({ source: 'bundled', provider: 'filesystem', path: '/x/node_modules/@deepseek-ai/dsh-agent-preset/skills/a/SKILL.md' }),
    { kind: 'bundled', label: '' },
  )
  assert.deepEqual(classifyOrigin({ source: 'bundled', provider: 'filesystem', path: '' }), { kind: 'bundled', label: '' })
  assert.deepEqual(classifyOrigin({ source: 'weird', provider: '', path: '' }), { kind: 'unknown', label: 'weird' })
})
