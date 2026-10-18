import assert from 'node:assert/strict'
import { test } from 'vitest'

import { runSeedanceQuickTest } from '../seedance-channel-test'

test('quick test performs one read-only check and never submits or polls', async () => {
  let calls = 0
  const result = await runSeedanceQuickTest('sd2.0-480P', async (params) => {
    calls += 1
    assert.deepEqual(params, {
      model: 'sd2.0-480P',
      endpoint_type: 'seedance-quick',
    })
    return {
      success: true,
      check_mode: 'quick',
      task_created: false,
      generation_checked: false,
      time: 0.12,
    }
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'success')
  assert.equal(result.quickCheck, true)
  assert.equal(result.taskId, undefined)
})

test('quick test rejects a generic success without the read-only contract', async () => {
  const result = await runSeedanceQuickTest('sd2.0-480P', async () => ({
    success: true,
  }))
  assert.equal(result.status, 'error')
})

test('quick failure never falls back to paid generation', async () => {
  let calls = 0
  const result = await runSeedanceQuickTest('sd2.0-480P', async () => {
    calls += 1
    return { success: false, message: 'authentication failed' }
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'error')
  assert.equal(result.error, 'authentication failed')
})
