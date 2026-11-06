// Job store + runner. Jobs are kept in memory and mirrored to data/jobs/*.json
// so a gateway restart does not lose history. Status vocabulary matches MuAPI:
// pending | processing | completed | failed.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { newId } from './files.js';

const jobs = new Map();
const JOBS_DIR = path.join(DATA_DIR, 'jobs');

function persist(job) {
  const { apiKey, payload, ...safe } = job; // never write secrets or raw inputs to disk
  try { fs.writeFileSync(path.join(JOBS_DIR, `${job.request_id}.json`), JSON.stringify(safe)); } catch { /* best effort */ }
}

export function loadJobs() {
  try {
    for (const f of fs.readdirSync(JOBS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8'));
      if (j.status === 'pending' || j.status === 'processing') { j.status = 'failed'; j.error = 'gateway restarted'; }
      jobs.set(j.request_id, j);
    }
  } catch { /* first run */ }
}

export function createJob({ endpoint, payload, apiKey }) {
  const job = {
    request_id: newId(),
    endpoint,
    payload,
    apiKey: apiKey || null,
    status: 'pending',
    provider: null,
    workflow: null,
    outputs: [],
    url: null,
    error: null,
    logs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  jobs.set(job.request_id, job);
  persist(job);
  return job;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  const next = { ...job, ...patch, updated_at: new Date().toISOString() };
  jobs.set(id, next);
  persist(next);
  return next;
}

export function log(id, line) {
  const job = jobs.get(id);
  if (!job) return;
  const logs = [...job.logs, `${new Date().toISOString()} ${line}`].slice(-200);
  updateJob(id, { logs });
}

export function getJob(id) { return jobs.get(id) || null; }

export function listJobs(limit = 50) {
  return [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

// Public (MuAPI-shaped) view of a job: never leak the api key.
export function publicView(job) {
  const { apiKey, payload, logs, ...rest } = job;
  const out = {
    ...rest,
    outputs: job.outputs,
    url: job.url || job.outputs[0] || null,
    output: job.url ? { url: job.url } : undefined,
  };
  return out;
}
