import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runSeedanceChannelTest,
  type SeedanceTestResponse,
} from '../seedance-channel-test'

test('Seedance submission is not marked completed until the task completes', async () => {
  const replies: SeedanceTestResponse[] = [
    { success: true, task_id: 'task_1', stage: 'queued' },
    { success: true, stage: 'in_progress' },
    { success: true, stage: 'completed' },
  ]
  const progress: string[] = []
  let submissions = 0
  const result = await runSeedanceChannelTest(
    'sd2.0-480P',
    async (params) => {
      if (params.video_test_ack) submissions += 1
      const reply = replies.shift()
      assert.ok(reply)
      return reply
    },
    (update) => progress.push(update.stage),
    async () => {}
  )
  assert.deepEqual(progress, ['queued', 'in_progress'])
  assert.equal(submissions, 1)
  assert.equal(result.status, 'success')
})
test('Seedance polling network failure retains the task and does not resubmit', async () => {
  let requests = 0
  const result = await runSeedanceChannelTest(
    'sd2.0-480P',
    async () => {
      requests += 1
      if (requests === 1)
        return { success: true, task_id: 'task_saved', stage: 'queued' }
      throw new Error('network failed')
    },
    () => {},
    async () => {}
  )
  assert.equal(result.status, 'pending')
  assert.equal(result.taskId, 'task_saved')
  assert.equal(requests, 2)
})
test('Seedance resumed pending test only queries the existing task', async () => {
  const result = await runSeedanceChannelTest(
    'sd2.0-480P',
    async (params) => {
      assert.equal(params.video_test_ack, undefined)
      assert.equal(params.seedance_task_id, 'task_saved')
      return { success: false, stage: 'failed', message: 'generation rejected' }
    },
    () => {},
    async () => {},
    'task_saved'
  )
  assert.equal(result.status, 'error')
})
