import "server-only";

import { pool } from "@/lib/database/client";

export type QueueJob = {
  id: string;
  queue_name: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function enqueueJob(input: { queueName: string; jobType: string; payload?: Record<string, unknown>; maxAttempts?: number; availableAt?: Date }) {
  const result = await pool.query<QueueJob>(`insert into job_queue(queue_name,job_type,payload,max_attempts,available_at) values($1,$2,$3::jsonb,$4,$5) returning id,queue_name,job_type,payload,attempts,max_attempts`, [input.queueName, input.jobType, JSON.stringify(input.payload ?? {}), input.maxAttempts ?? 5, input.availableAt ?? new Date()]);
  return result.rows[0]!;
}

export async function claimJob(queueName: string, workerId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<QueueJob>(`select id,queue_name,job_type,payload,attempts,max_attempts from job_queue where queue_name=$1 and status='queued' and available_at <= now() order by created_at for update skip locked limit 1`, [queueName]);
    const job = result.rows[0];
    if (!job) {
      await client.query("commit");
      return null;
    }
    const claimed = await client.query<QueueJob>(`update job_queue set status='running',attempts=attempts+1,locked_at=now(),locked_by=$2 where id=$1 returning id,queue_name,job_type,payload,attempts,max_attempts`, [job.id, workerId]);
    await client.query("commit");
    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeJob(jobId: string) {
  await pool.query(`update job_queue set status='completed',completed_at=now(),locked_at=null,locked_by=null where id=$1 and status='running'`, [jobId]);
}

export async function failJob(job: Pick<QueueJob, "id" | "attempts" | "max_attempts">, error: unknown, retryDelayMs = 30_000) {
  const message = error instanceof Error ? error.message : "Unknown queue failure";
  const terminal = job.attempts >= job.max_attempts;
  await pool.query(`update job_queue set status=$2,available_at=case when $2='queued' then now()+($3::int * interval '1 millisecond') else available_at end,last_error=$4,locked_at=null,locked_by=null where id=$1 and status='running'`, [job.id, terminal ? "dead_letter" : "queued", retryDelayMs, message.slice(0, 500)]);
}
