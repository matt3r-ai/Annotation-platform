import React from 'react';
import '../styles/App.css';

import { v2eApi } from '../services/v2eApi';

const DEFAULT_TASKS = ['detection', 'segmentation', 'depth', 'caption_tag'];

const Video2Everything = () => {
  const [dataSource, setDataSource] = React.useState('local');
  const [localFile, setLocalFile] = React.useState(null);
  const [localVideoUrl, setLocalVideoUrl] = React.useState('');

  const [selectedTasks, setSelectedTasks] = React.useState(new Set(DEFAULT_TASKS));
  const [job, setJob] = React.useState(null); // { id, status, progressByTask, costUsd }
  const [events, setEvents] = React.useState([]); // recent log events

  const videoRef = React.useRef(null);

  function handleLocalFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      setLocalFile(null);
      setLocalVideoUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalFile(file);
    setLocalVideoUrl(url);
  }

  function toggleTask(task) {
    setSelectedTasks(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(task)) next.delete(task); else next.add(task);
      return next;
    });
  }

  async function startJob() {
    if (dataSource === 'local' && !localFile) {
      alert('Please select a local video first.');
      return;
    }
    const tasks = Array.from(selectedTasks);
    const req = {
      source: dataSource,
      tasks,
      // For demo purposes we only estimate a tiny cost
      estimateOnly: false
    };
    const created = await v2eApi.createJob(req);
    setJob(created);
    setEvents([]);
    v2eApi.subscribe(created.id, (evt) => {
      // evt: { type: 'progress'|'complete'|'error'|'log', payload }
      setJob(j => {
        if (!j) return j;
        if (evt.type === 'progress') {
          const { task, progress } = evt.payload;
          const updated = { ...j.progressByTask, [task]: progress };
          const overall = Math.round(Object.values(updated).reduce((a, b) => a + b, 0) / Math.max(1, tasks.length));
          return { ...j, progressByTask: updated, progressOverall: overall };
        }
        if (evt.type === 'status') {
          return { ...j, status: evt.payload.status };
        }
        if (evt.type === 'cost') {
          return { ...j, costUsd: evt.payload.costUsd };
        }
        return j;
      });
      if (evt.type === 'log') setEvents(prev => [evt.payload, ...prev].slice(0, 100));
    });
  }

  function cancelJob() {
    if (job) v2eApi.cancelJob(job.id);
    setJob(j => j ? { ...j, status: 'cancelled' } : j);
  }

  function renderProgressBars() {
    if (!job) return null;
    const tasks = Object.keys(job.progressByTask || {});
    return (
      <div className="status-card">
        <h4>Job Progress</h4>
        <p><b>Status:</b> {job.status}</p>
        <p><b>Total Progress:</b> {job.progressOverall || 0}%</p>
        <p><b>Estimated Cost:</b> ${job.costUsd?.toFixed ? job.costUsd.toFixed(2) : (job.costUsd || 0)}</p>
        {tasks.map(t => (
          <div key={t} style={{ margin: '8px 0' }}>
            <div style={{ color: '#fff', fontSize: 12, marginBottom: 4 }}>{t}</div>
            <div style={{ height: 8, background: '#222', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(0,255,150,0.3)' }}>
              <div style={{ width: `${job.progressByTask[t]}%`, height: '100%', background: 'linear-gradient(90deg,#00ff96,#00d4ff)' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderTabs() {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="test-button">Detections</button>
          <button className="test-button">Segments</button>
          <button className="test-button">Depth</button>
          <button className="test-button">Captions/Tags</button>
        </div>
        <div className="video-preview-container" style={{ width: '100%', minHeight: 360 }}>
          <div className="video-player-container">
            {localVideoUrl ? (
              <video ref={videoRef} src={localVideoUrl} controls style={{ width: '100%', maxWidth: 900, background: '#000', borderRadius: 12 }} />
            ) : (
              <div style={{ color: '#aaa' }}>Preview will appear here</div>
            )}
          </div>
          <div className="video-preview-actions">
            <button className="clip-video-button" onClick={() => videoRef.current && videoRef.current.play()} disabled={!localVideoUrl}>Play</button>
            <button className="clip-video-button" onClick={() => videoRef.current && videoRef.current.pause()} disabled={!localVideoUrl}>Pause</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">VIDEO2EVERYTHING</div>
        <div className="tagline">One video in, everything out</div>
      </header>
      <div className="App-content">
        {/* Left panel */}
        <div className="data-source-selection">
          <div className="selection-container">
            <h2>Select Data Source</h2>
            <div className="selection-options">
              <div className={`option-card${dataSource === 'local' ? ' active' : ''}`} onClick={() => setDataSource('local')}>
                <div className="option-icon">📁</div>
                <h3>Local Upload</h3>
                <p>Upload local video file</p>
              </div>
              <div className={`option-card${dataSource === 'mcdb' ? ' active' : ''}`} onClick={() => setDataSource('mcdb')}>
                <div className="option-icon">🗂️</div>
                <h3>MCDB (DMP success)</h3>
                <p>Pick from MCDB entries (placeholder)</p>
              </div>
            </div>

            {dataSource === 'local' && (
              <div style={{ marginTop: 18 }}>
                <label className="select-label" style={{ color: '#b0b0b0', fontSize: 13, marginBottom: 6, display: 'block', textAlign: 'left' }}>Select Video File</label>
                <input type="file" accept="video/*" onChange={handleLocalFileChange} className="select-input" style={{ marginTop: 4 }} />
              </div>
            )}

            {/* Task selection */}
            <div className="form-group" style={{ marginTop: 14 }}>
              <label>Tasks</label>
              {DEFAULT_TASKS.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                  <input
                    id={`task-${t}`}
                    type="checkbox"
                    checked={selectedTasks.has(t)}
                    onChange={() => toggleTask(t)}
                    style={{ marginRight: 8 }}
                  />
                  <label htmlFor={`task-${t}`} style={{ color: '#eaeaea', fontSize: 12, cursor: 'pointer' }}>{t}</label>
                </div>
              ))}
            </div>

            <button className="test-button" onClick={startJob} style={{ marginTop: 10 }} disabled={dataSource === 'local' && !localFile}>Start Job</button>
            <button className="test-button" onClick={cancelJob} style={{ marginTop: 6 }} disabled={!job || job.status === 'completed' || job.status === 'cancelled'}>Cancel</button>

            {job && (
              <div className="status-card" style={{ marginTop: 10 }}>
                <h4>Job Info</h4>
                <p><b>ID:</b> {job.id}</p>
                <p><b>Status:</b> {job.status}</p>
                <p><b>Overall:</b> {job.progressOverall || 0}%</p>
              </div>
            )}
          </div>
        </div>

        {/* Main panel */}
        <div className="main-content">
          {renderProgressBars()}
          {renderTabs()}
        </div>

        {/* Right panel */}
        <div className="selected-points-container">
          <div style={{ marginBottom: 10 }}>
            <b>Recent Logs</b>
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {events.length === 0 && <div style={{ color: '#888', fontSize: 12 }}>No logs yet</div>}
            {events.map((e, idx) => (
              <div key={idx} style={{ fontSize: 11, color: '#ccc', marginBottom: 6 }}>{e}</div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="test-button" disabled={!job}>Export Manifest (mock)</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Video2Everything;


