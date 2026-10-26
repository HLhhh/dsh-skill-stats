import assert from 'node:assert/strict'
import test from 'node:test'
import { compact, mentionsSkill } from '../lib/mentions.js'

test('compacts separators and case', () => {
  assert.equal(compact('Code-Review'), 'codereview')
  assert.equal(compact('code review'), 'codereview')
  assert.equal(compact('dsh_plugin_open_source'), 'dshpluginopensource')
})

test('long names match across separators and inside Chinese sentences', () => {
  assert.equal(mentionsSkill('再做一次codereview', 'code-review'), true)
  assert.equal(mentionsSkill('please run a code review again', 'code-review'), true)
  assert.equal(mentionsSkill('CodeReview please', 'code-review'), true)
  assert.equal(mentionsSkill('用一下 dsh plugin open source', 'dsh-plugin-open-source'), true)
})

test('short names only match whole tokens', () => {
  assert.equal(mentionsSkill('use pr please', 'pr'), true)
  assert.equal(mentionsSkill('prepare the pull request', 'pr'), false)
  assert.equal(mentionsSkill('time to prep', 'pr'), false)
  assert.equal(mentionsSkill('run tdd now', 'tdd'), true)
  assert.equal(mentionsSkill('runtdd', 'tdd'), false)
})

test('empty input never matches', () => {
  assert.equal(mentionsSkill('', 'code-review'), false)
  assert.equal(mentionsSkill('hello', ''), false)
  assert.equal(mentionsSkill('hello', 'a'), false)
})
