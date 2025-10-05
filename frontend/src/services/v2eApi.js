// Minimal mock API for Video2Everything page.
// It simulates a backend job with incremental progress per task
// and sends events to registered subscribers.

const subscribers = new Map(); // jobId -> callback
const jobs = new Map(); // jobId -> state

function uuid() {
  return 'v2e_' + Math.random().toString(36).slice(2, 10);
}

function emit(jobId, evt) {
  const cb = subscribers.get(jobId);
  if (cb) cb(evt);
}

function simulate(job) {
  const interval = setInterval(() => {
    const state = jobs.get(job.id);
    if (!state || state.status === 'cancelled' || state.status === 'completed') {
      clearInterval(interval);
      return;
    }
    // random task to progress
    const remaining = state.tasks.filter(t => (state.progressByTask[t] || 0) < 100);
    if (remaining.length === 0) {
      state.status = 'completed';
      emit(job.id, { type: 'status', payload: { status: state.status } });
      emit(job.id, { type: 'log', payload: 'Job completed' });
      clearInterval(interval);
      return;
    }
    const task = remaining[Math.floor(Math.random() * remaining.length)];
    const inc = 5 + Math.floor(Math.random() * 12);
    state.progressByTask[task] = Math.min(100, (state.progressByTask[task] || 0) + inc);
    state.costUsd += 0.002; // tiny cost growth
    emit(job.id, { type: 'progress', payload: { task, progress: state.progressByTask[task] } });
    emit(job.id, { type: 'cost', payload: { costUsd: state.costUsd } });
    emit(job.id, { type: 'log', payload: `Task ${task} progressed to ${state.progressByTask[task]}%` });
  }, 600);
}

export const v2eApi = {
  async createJob(request) {
    const jobId = uuid();
    const tasks = Array.isArray(request.tasks) && request.tasks.length > 0 ? request.tasks : ['detection'];
    const job = {
      id: jobId,
      status: 'running',
      tasks,
      progressByTask: tasks.reduce((m, t) => { m[t] = 0; return m; }, {}),
      progressOverall: 0,
      costUsd: 0,
    };
    jobs.set(jobId, job);
    emit(jobId, { type: 'log', payload: 'Job created' });
    simulate(job);
    return job;
  },
  subscribe(jobId, callback) {
    subscribers.set(jobId, callback);
  },
  cancelJob(jobId) {
    const state = jobs.get(jobId);
    if (state) {
      state.status = 'cancelled';
      emit(jobId, { type: 'status', payload: { status: 'cancelled' } });
      emit(jobId, { type: 'log', payload: 'Job cancelled' });
    }
  },

  async uploadAndDetect(file, { queries, fps = 1, threshold = 0.3 } = {}) {
    const form = new FormData();
    form.append('video', file);
    if (queries) form.append('queries', queries);
    form.append('fps', String(fps));
    form.append('score_threshold', String(threshold));
    const res = await fetch('/api/v2e/detect', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Detection request failed');
    return await res.json();
  }
};

export const vlmApi = {
  async extractFrames(file, fps = 1) {
    const form = new FormData();
    form.append('video', file);
    form.append('fps', String(fps));
    const res = await fetch('/api/vlm/extract-frames', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Frame extraction failed');
    return await res.json();
  },
  async infer(session, question) {
    const form = new FormData();
    form.append('session', session);
    if (question) form.append('question', question);
    const res = await fetch('/api/vlm/infer', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Inference failed');
    return await res.json();
  }
};

// External WiseAD API client (video direct inference)
const WISEAD_BASE = process.env.REACT_APP_WISEAD_API || 'http://127.0.0.1:9009';

export const wiseadApi = {
  async analyzeVideo(file, { prompt = 'What driving maneuver is the car performing?', method = 'fps', fps = 1 } = {}) {
    const form = new FormData();
    form.append('video', file);
    form.append('prompt', prompt);
    form.append('method', method);
    form.append('fps', String(fps));
    const res = await fetch(`${WISEAD_BASE}/infer/video`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error('WiseAD video inference failed');
    return await res.json();
  },
};

// Inference server (S3 → inference → S3 result) configuration
// Default behavior: use backend proxy to avoid CORS and env dependency.
// If you explicitly set REACT_APP_INFERENCE_DIRECT=1, we will use REACT_APP_INFERENCE_BASE.
const INFERENCE_DIRECT = String(process.env.REACT_APP_INFERENCE_DIRECT || '').trim() === '1';
const INFERENCE_BASE = INFERENCE_DIRECT
  ? (process.env.REACT_APP_INFERENCE_BASE || '').replace(/\/$/, '')
  : '';

/**
 * Call YOLOv10 inference on a remote inference server using an S3 input key.
 * Returns a JSON with fields like { path, latency, run_metadata } where
 * path is the S3 key of the result (e.g., matt3r-ce-inference-output/...).
 */
export async function runYolov10OnS3({ s3_url, file_type = 'video', fps = 3 }) {
  // Prefer backend proxy to avoid CORS; only use direct if explicitly enabled
  const endpoint = (INFERENCE_DIRECT && INFERENCE_BASE)
    ? `${INFERENCE_BASE}/serve/yolov10/1`
    : `/api/proxy/infer/yolov10`;
  const body = JSON.stringify({ s3_url, file_type, fps });
  const headers = { 'accept': 'application/json', 'Content-Type': 'application/json' };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || 'Inference request failed';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

/**
 * Call ego_lane_plus inference on a remote inference server using an S3 input key.
 */
export async function runEgoLanePlusOnS3({ s3_url, file_type = 'video', fps = 3 }) {
  const endpoint = (INFERENCE_DIRECT && INFERENCE_BASE)
    ? `${INFERENCE_BASE}/serve/ego_lane_plus/1`
    : `/api/proxy/infer/ego_lane_plus`;
  const body = JSON.stringify({ s3_url, file_type, fps });
  const headers = { 'accept': 'application/json', 'Content-Type': 'application/json' };
  const res = await fetch(endpoint, { method: 'POST', headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || 'Inference request failed';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

/**
 * Call depth_anything_v2 inference on a remote server using S3 input key.
 */
export async function runDepthAnythingOnS3({ s3_url, file_type = 'video', fps = 3 }) {
  const endpoint = (INFERENCE_DIRECT && INFERENCE_BASE)
    ? `${INFERENCE_BASE}/serve/depth_anything_v2/1`
    : `/api/proxy/infer/depth_anything_v2`;
  const body = JSON.stringify({ s3_url, file_type, fps });
  const headers = { 'accept': 'application/json', 'Content-Type': 'application/json' };
  const res = await fetch(endpoint, { method: 'POST', headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.detail || 'Inference request failed';
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}


