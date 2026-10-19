export type SeedanceStage =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'pending'
export type SeedanceTestResponse = {
  success: boolean
  stage?: SeedanceStage
  task_id?: string
  message?: string
  time?: number
  check_mode?: string
  task_created?: boolean
  generation_checked?: boolean
  error_code?: string
  billing_group?: string
}
export type SeedanceTestUpdate = {
  quickCheck?: boolean
  status: 'testing' | 'success' | 'error' | 'pending'
  stage: SeedanceStage
  taskId?: string
  billingGroup?: string
  error?: string
  responseTime?: number
}
type Request = (params: {
  model: string
  endpoint_type: string
  video_test_ack?: boolean
  seedance_task_id?: string
  billing_group?: string
}) => Promise<SeedanceTestResponse>

// Submission happens exactly once. Polling and timeout never recreate a task.
export async function runSeedanceChannelTest(
  model: string,
  request: Request,
  onProgress: (update: SeedanceTestUpdate) => void,
  wait: () => Promise<void> = () =>
    new Promise((resolve) => window.setTimeout(resolve, 10_000)),
  existingTaskId?: string,
  billingGroup?: string
): Promise<SeedanceTestUpdate> {
  let taskId = existingTaskId
  let responseTime: number | undefined
  let billing = billingGroup
  try {
    if (!taskId) {
      const submitted = await request({
        model,
        endpoint_type: 'seedance-video',
        video_test_ack: true,
        billing_group: billingGroup || undefined,
      })
      if (!submitted.success || !submitted.task_id) {
        return {
          status:
            submitted.error_code === 'seedance_test_submit_unknown'
              ? 'pending'
              : 'error',
          stage: 'failed',
          error: submitted.message || 'Video submission failed',
        }
      }
      taskId = submitted.task_id
      billing = submitted.billing_group || billingGroup
      responseTime = submitted.time
      onProgress({
        status: 'testing',
        stage: 'queued',
        taskId,
        billingGroup: billing,
        responseTime,
      })
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait()
      const response = await request({
        model,
        endpoint_type: 'seedance-video',
        seedance_task_id: taskId,
      })
      billing = response.billing_group || billing
      if (response.stage === 'completed' && response.success) {
        return {
          status: 'success',
          stage: 'completed',
          taskId,
          billingGroup: billing,
          responseTime,
        }
      }
      if (!response.success || response.stage === 'failed') {
        return {
          status: 'error',
          stage: 'failed',
          taskId,
          billingGroup: billing,
          responseTime,
          error: response.message || 'Video generation failed',
        }
      }
      onProgress({
        status: 'testing',
        stage: response.stage || 'in_progress',
        taskId,
        billingGroup: billing,
        responseTime,
      })
    }
    return {
      status: 'pending',
      stage: 'pending',
      taskId,
      billingGroup: billing,
      responseTime,
    }
  } catch {
    return {
      status: 'pending',
      stage: 'pending',
      taskId,
      billingGroup: billing,
      responseTime,
      error:
        'Check task history before retrying; submission is never automatically repeated.',
    }
  }
}

// A single read-only check never falls back to paid submission or polling.
export async function runSeedanceQuickTest(
  model: string,
  request: Request
): Promise<SeedanceTestUpdate> {
  const response = await request({ model, endpoint_type: 'seedance-quick' })
  if (!response.success) {
    return {
      status: 'error',
      stage: 'failed',
      quickCheck: true,
      error: response.message || 'Quick interface check failed',
    }
  }
  if (
    response.check_mode !== 'quick' ||
    response.task_created !== false ||
    response.generation_checked !== false
  ) {
    return {
      status: 'error',
      stage: 'failed',
      quickCheck: true,
      error: 'Unexpected quick check response',
    }
  }
  return {
    status: 'success',
    stage: 'completed',
    quickCheck: true,
    responseTime: response.time,
  }
}
