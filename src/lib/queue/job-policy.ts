import type { JobsOptions } from 'bullmq';

export function processingJobId(sourceId: string, step: string, processingRunId?: string): string {
  return `${sourceId}${processingRunId ? `-${processingRunId}` : ''}-${step}`;
}

export function queueJobOptions(queueName: string): JobsOptions {
  return {
    // Only normalization safely repeats existing attribution writes. Other
    // stages can replace evidence or create new runs, so require explicit retry.
    attempts: queueName === 'normalize_turns' ? 3 : 1,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 86_400, count: 1000 },
    removeOnFail: { age: 604_800, count: 1000 },
  };
}
