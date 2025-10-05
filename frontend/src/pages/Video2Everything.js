import React from 'react';
import '../styles/App.css';

import { v2eApi, runYolov10OnS3, runEgoLanePlusOnS3, runDepthAnythingOnS3 } from '../services/v2eApi';
import { fetchScenarios as fetchScenariosApi, getVideoUrl, fetchJsonFromS3, downloadS3Object, renderYoloVideo, renderEgoLaneVideo, renderDepthVideo } from '../services/scenarioApi';
import { useLocation, useNavigate } from 'react-router-dom';

const DEFAULT_TASKS = ['detection', 'segmentation', 'depth', 'caption_tag'];

const Video2Everything = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [dataSource, setDataSource] = React.useState('local');
  const [localFile, setLocalFile] = React.useState(null);
  const [localVideoUrl, setLocalVideoUrl] = React.useState('');
  const [detectedUrl, setDetectedUrl] = React.useState('');
  const [egoLaneUrl, setEgoLaneUrl] = React.useState('');
  const [depthUrl, setDepthUrl] = React.useState('');
  const [s3Key, setS3Key] = React.useState('');
  const [inferenceResultPath, setInferenceResultPath] = React.useState('');
  const [inferenceRaw, setInferenceRaw] = React.useState('');
  const [isCalling, setIsCalling] = React.useState(false);
  // MCDB picker state
  const [mcdbStart, setMcdbStart] = React.useState(() => new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10));
  const [mcdbEnd, setMcdbEnd] = React.useState(() => new Date().toISOString().slice(0,10));
  const [mcdbLimit, setMcdbLimit] = React.useState(50);
  const [mcdbItems, setMcdbItems] = React.useState([]);
  const [mcdbLoading, setMcdbLoading] = React.useState(false);

  const [selectedTasks, setSelectedTasks] = React.useState(new Set(DEFAULT_TASKS));
  const [job, setJob] = React.useState(null); // { id, status, progressByTask, costUsd }
  const [events, setEvents] = React.useState([]); // recent log events

  const videoRef = React.useRef(null);
  const rightVideoRef = React.useRef(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [frameToBoxes, setFrameToBoxes] = React.useState(new Map());
  const [currentOverlay, setCurrentOverlay] = React.useState([]);
  const [overlayFps, setOverlayFps] = React.useState(6);
  const [inferenceLoading, setInferenceLoading] = React.useState(false);
  const [vizLoading, setVizLoading] = React.useState(false);
  const [inferenceDone, setInferenceDone] = React.useState(false);
  const [vizDone, setVizDone] = React.useState(false);
  const [selectedModels, setSelectedModels] = React.useState(new Set(['yolov10']));
  const [egoLaneResultPath, setEgoLaneResultPath] = React.useState('');
  const [depthResultPath, setDepthResultPath] = React.useState('');
  const [viewMode, setViewMode] = React.useState('fetch'); // 'fetch' | 'analyze'

  React.useEffect(()=>{
    const incomingKey = location?.state?.s3Key;
    if (incomingKey) {
      setS3Key(incomingKey);
      setDataSource('mcdb');
      setEvents(prev=>[`Loaded from fetch page: ${incomingKey}`, ...prev]);
      setViewMode('analyze');
    }
  }, [location?.state?.s3Key]);

  // Normalize an S3 path into { bucket, key }
  function normalizeS3Path(input, fallbackBucket = 'matt3r-ce-inference-output') {
    if (!input || typeof input !== 'string') return { bucket: fallbackBucket, key: '' };
    let p = input.trim();
    if (p.startsWith('s3://')) p = p.slice(5);
    if (p.startsWith('/')) p = p.slice(1);
    // If the string explicitly starts with fallback bucket, split it
    if (fallbackBucket && p.startsWith(fallbackBucket + '/')) {
      return { bucket: fallbackBucket, key: p.slice(fallbackBucket.length + 1) };
    }
    // If no fallback bucket (rare), try to split bucket/key
    if (!fallbackBucket) {
      const idx = p.indexOf('/');
      if (idx > 0) return { bucket: p.slice(0, idx), key: p.slice(idx + 1) };
      return { bucket: '', key: p };
    }
    // With a fallback bucket provided, treat p as key under that bucket by default
    // unless p itself contains a scheme or clearly another bucket was specified earlier (already handled).
    return { bucket: fallbackBucket, key: p };
  }

  function handleLocalFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      setLocalFile(null);
      setLocalVideoUrl('');
      setDetectedUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalFile(file);
    setLocalVideoUrl(url);
  }

  async function runDetectionDemo() {
    if (!localFile) { alert('Please select a local video first'); return; }
    setEvents(prev => ["Uploading and running detection...", ...prev]);
    try {
      const res = await v2eApi.uploadAndDetect(localFile, { fps: 1, queries: 'car,person,truck' });
      // Prefer the single detected preview (only boxes), fallback to side-by-side if needed
      setDetectedUrl(res.detected_preview || res.side_by_side || '');
      setEvents(prev => ["Detection done", ...prev]);
    } catch (e) {
      setEvents(prev => ["Detection failed", ...prev]);
      alert('Detection failed');
    }
  }

  function toggleTask(task) {
    setSelectedTasks(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(task)) next.delete(task); else next.add(task);
      return next;
    });
  }

  function toggleModel(modelId){
    setSelectedModels(prev => {
      const next = new Set(Array.from(prev));
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      return next;
    });
  }

  async function startJob() {
    if (!s3Key && dataSource === 'mcdb') {
      alert('Missing S3 key. Go back to Fetch page to pick one.');
      navigate('/video2everything/fetch');
      return;
    }
    if (dataSource === 'local' && !localFile) {
      alert('Please select a local video first.');
      return;
    }
    const tasks = Array.from(selectedTasks);
    const req = {
      source: dataSource,
      tasks,
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
    // Build panels dynamically: original video + one per selected model
    const panels = [];
    // Original video panel
    panels.push(
      <div key="original" className="video-player-container" style={{ border: '1px solid rgba(0,255,150,0.3)', borderRadius: 8, height: '56vh', background: '#fff' }}>
        {previewUrl || localVideoUrl ? (
          <video ref={videoRef} src={previewUrl || localVideoUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 8 }} />
        ) : (
          <div style={{ color: '#666' }}>Selected video preview</div>
        )}
      </div>
    );

    // YOLO detection panel
    if (selectedModels.has('yolov10')) {
      panels.push(
        <div key="yolov10" className="video-player-container" style={{ position:'relative', border: '1px solid rgba(0,123,255,0.3)', borderRadius: 8, height: '56vh', background: '#fff', overflow:'hidden' }}>
          {detectedUrl ? (
            <>
              <video ref={rightVideoRef} src={detectedUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 8 }}
                onTimeUpdate={(e)=>{
                  if(frameToBoxes.size===0) return;
                  const t = e.currentTarget.currentTime || 0;
                  const idx = Math.floor(t * overlayFps);
                  const boxes = frameToBoxes.get(idx) || [];
                  setCurrentOverlay(boxes);
                }}
              />
              <svg viewBox="0 0 1280 960" preserveAspectRatio="xMidYMid meet" style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
                {currentOverlay.map((d, idx) => (
                  <g key={idx}>
                    <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="none" stroke="#00e0ff" strokeWidth="2" />
                    <text x={d.x+4} y={Math.max(12, d.y-4)} fill="#00e0ff" fontSize="12">{d.label || 'obj'} {d.score ? (d.score*100).toFixed(0)+'%' : ''}</text>
                  </g>
                ))}
              </svg>
            </>
          ) : (
            <div style={{ color: '#aaa' }}>Visualization preview (will appear after inference)</div>
          )}
        </div>
      );
    }

    // Ego lane panel
    if (selectedModels.has('ego_lane_plus')) {
      panels.push(
        <div key="ego_lane_plus" className="video-player-container" style={{ border: '1px solid rgba(255,165,0,0.3)', borderRadius: 8, height: '56vh', background: '#fff' }}>
          {egoLaneUrl ? (
            <video src={egoLaneUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 8 }} />
          ) : (
            <div style={{ color: '#aaa', padding: 8, textAlign:'center' }}>
              Ego lane visualization will appear here.
              <div style={{ fontSize: 12, color:'#bbb', marginTop: 6 }}>
                Result path: {egoLaneResultPath || '(not ready)'}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Depth panel
    if (selectedModels.has('depth_anything_v2')) {
      panels.push(
        <div key="depth_anything_v2" className="video-player-container" style={{ border: '1px solid rgba(255,215,0,0.35)', borderRadius: 8, height: '56vh', background: '#fff' }}>
          {depthUrl ? (
            <video src={depthUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 8 }} />
          ) : (
            <div style={{ color: '#aaa', padding: 8, textAlign:'center' }}>
              Depth visualization will appear here.
              <div style={{ fontSize: 12, color:'#bbb', marginTop: 6 }}>
                Result path: {depthResultPath || '(not ready)'}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div style={{ marginTop: 10 }}>
        <div className="video-preview-container" style={{ width: '100%', minHeight: 360 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24, padding: 16 }}>
            {panels}
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
        {/* Left panel with model selection */}
        <div className="data-source-selection">
          <div className="selection-container">
            <h2>Workflow</h2>
            <p style={{ fontSize:12, color:'#aaa', textAlign:'left' }}>Select a model and run inference/visualization.</p>
            <div className="form-group" style={{ marginTop: 10, textAlign:'left' }}>
              <label style={{ color:'#9bd', fontSize:12 }}>Model Selection</label>
              {[ 
                { id:'yolov10', label:'yolov10', enabled:true },
                { id:'ego_lane_plus', label:'ego_lane_plus', enabled:true },
                { id:'depth_anything_v2', label:'depth_anything_v2', enabled:true },
                { id:'mask2former', label:'mask2former (in progress)', enabled:false },
                { id:'mask_rcnn', label:'mask_rcnn (in progress)', enabled:false },
                { id:'mmdet', label:'mmdet (in progress)', enabled:false },
                { id:'qdtrack', label:'qdtrack (in progress)', enabled:false },
                { id:'sc_depth', label:'sc_depth (in progress)', enabled:false },
                { id:'yolopv2', label:'yolopv2 (in progress)', enabled:false },
              ].map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
                  <input
                    type="checkbox"
                    checked={selectedModels.has(m.id)}
                    disabled={!m.enabled}
                    onChange={()=> toggleModel(m.id)}
                    style={{ marginRight: 8 }}
                  />
                  <span style={{ color: m.enabled ? '#fff' : '#8aa', fontSize:12 }}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main panel */}
        <div className="main-content">
          {viewMode==='fetch' ? (
            <div style={{ padding: 12 }}>
              {/* 用白底 Fetch 面板替换中间区域 */}
              <div style={{ background:'#fff', color:'#111', borderRadius:12, border:'1px solid #e9eef5', padding:16 }}>
                <h3 style={{ marginTop:0, marginBottom:12 }}>Fetch Scenarios</h3>
                <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>Start</label>
                    <input type="date" value={mcdbStart} onChange={e=>setMcdbStart(e.target.value)} className="select-input" style={{ width:180, background:'#fff', color:'#111' }} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>End</label>
                    <input type="date" value={mcdbEnd} onChange={e=>setMcdbEnd(e.target.value)} className="select-input" style={{ width:180, background:'#fff', color:'#111' }} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>Limit</label>
                    <input className="select-input" type="number" min={1} max={500} value={mcdbLimit} onChange={e=>setMcdbLimit(Number(e.target.value||50))} style={{ width: 120, background:'#fff', color:'#111' }} />
                  </div>
                  <button onClick={async ()=>{
                    setMcdbLoading(true);
                    setMcdbItems([]);
                    setEvents(prev=>["Fetching MCDB DMP (success) ...", ...prev]);
                    try{
                      const res = await fetchScenariosApi({ event_types: [], start_date: mcdbStart, end_date: mcdbEnd, limit: mcdbLimit });
                      const scenarios = res?.scenarios || [];
                      setMcdbItems(scenarios);
                      setEvents(prev=>[`Fetched ${scenarios.length} items`, ...prev]);
                    }catch(err){
                      setEvents(prev=>[String(err), ...prev]);
                      alert('Fetch MCDB failed');
                    }finally{
                      setMcdbLoading(false);
                    }
                  }} disabled={mcdbLoading} style={{
                    background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    padding:'10px 18px',
                    borderRadius:8,
                    fontWeight:700,
                    letterSpacing:'0.5px',
                    textTransform:'uppercase',
                    color:'#fff',
                    boxShadow:'0 6px 16px rgba(118,75,162,0.35)',
                    width: 220
                  }}>{mcdbLoading?'⏳ Fetching...':'🚀 Fetch Scenarios'}</button>
                </div>
                {mcdbItems.length>0 && (
                  <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto', textAlign: 'left', fontSize: 12, background:'#fff', border:'1px solid #e9eef5', borderRadius:12 }}>
                    {mcdbItems.map((item)=>{
                      const links = item?.data_links || {};
                      const video = links.video || {};
                      const frontUrl = video.front;
                      function s3ToKey(url){
                        if(!url || typeof url !== 'string') return '';
                        const m = url.trim().match(/^s3:\/\/[^/]+\/(.+)$/i);
                        if(m){ return m[1]; }
                        return url.replace(/^[^/]+\//, '');
                      }
                      const key = s3ToKey(frontUrl);
                      return (
                        <div key={item.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', borderBottom:'1px solid #eef3f8' }}>
                          <div>
                            <div style={{ color:'#1a55a5', fontWeight:600 }}>#{item.id}</div>
                            <div style={{ color:'#6a7b91', fontSize:12, wordBreak:'break-all' }}>{frontUrl || 'No front video'}</div>
                          </div>
                          <button style={{
                            background:'linear-gradient(135deg, #3498db 0%, #2980b9 100%)',
                            padding:'8px 14px',
                            borderRadius:8,
                            fontWeight:700,
                            letterSpacing:'0.5px',
                            textTransform:'uppercase',
                            color:'#fff',
                            width:120,
                            minWidth:120,
                            maxWidth:120,
                            flex:'0 0 120px',
                            boxShadow:'0 4px 12px rgba(41,128,185,0.3)',
                            display:'inline-flex', alignItems:'center', justifyContent:'center'
                          }} disabled={!key} onClick={async ()=>{
                            if(!key) return;
                            setS3Key(key);
                            setViewMode('analyze');
                            setEvents(prev=>[`Selected from fetch list → ${key}`, ...prev]);
                            try { const r = await getVideoUrl(item.id); if(r?.video_url) setPreviewUrl(r.video_url); } catch {}
                          }}>Preview</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {renderProgressBars()}
              {renderTabs()}
              {/* Actions: inference + one-click visualization */}
              <div style={{ marginTop: 12, display:'flex', gap: 12, justifyContent:'center' }}>
                <button className="clip-video-button" disabled={!s3Key || isCalling} onClick={async () => {
                  if(!s3Key){ setEvents(prev=>['No s3Key set. Select from Fetch first.', ...prev]); return; }
                  try {
                    setIsCalling(true);
                    setInferenceLoading(true);
                    setInferenceDone(false);
                    const wantYolo = selectedModels.has('yolov10');
                    const wantLane = selectedModels.has('ego_lane_plus');
                    const wantDepth = selectedModels.has('depth_anything_v2');
                    setEvents(prev => [`Run inference for ${s3Key} → ${[wantYolo?'yolov10':null, wantLane?'ego_lane_plus':null].filter(Boolean).join(', ')}`, ...prev]);

                    const calls = [];
                    if (wantYolo) calls.push(runYolov10OnS3({ s3_url: s3Key, file_type: 'video', fps: 3 }).then(r=>({model:'yolov10', res:r})));
                    if (wantLane) calls.push(runEgoLanePlusOnS3({ s3_url: s3Key, file_type: 'video', fps: 3 }).then(r=>({model:'ego_lane_plus', res:r})));
                    if (wantDepth) calls.push(runDepthAnythingOnS3({ s3_url: s3Key, file_type: 'video', fps: 3 }).then(r=>({model:'depth_anything_v2', res:r})));

                    const results = await Promise.all(calls);
                    for (const {model, res} of results){
                      const path = res?.path || '';
                      if(model==='yolov10') setInferenceResultPath(path);
                      if(model==='ego_lane_plus') setEgoLaneResultPath(path);
                      if(model==='depth_anything_v2') setDepthResultPath(path);
                      setEvents(prev => [`${model} → ${path || 'no path returned'}`, ...prev]);
                    }
                    try { setInferenceRaw(JSON.stringify(results ?? {}, null, 2)); } catch { setInferenceRaw(String(results)); }
                    setEvents(prev => ["Inference done", ...prev]);
                    setInferenceDone(true);
                  } catch (err) {
                    setEvents(prev => [String(err), ...prev]);
                    alert('Inference failed');
                  } finally {
                    setIsCalling(false);
                    setInferenceLoading(false);
                  }
                }}>Run Inference</button>
                <button className="clip-video-button" onClick={async ()=>{
                  try{
                    if(!s3Key || !/\.mp4$/i.test(s3Key)) { alert('Missing S3 video key. Please select from Fetch.'); return; }
                    const videoPath = s3Key;
                    const obj = JSON.parse(inferenceRaw || '[]');
                    const resultsArray = Array.isArray(obj) ? obj : [];
                    const { bucket: videoBucket, key: videoKey } = normalizeS3Path(videoPath, 'matt3r-driving-footage-us-west-2');
                    setVizLoading(true);
                    setVizDone(false);

                    // Render YOLO if selected
                    if (selectedModels.has('yolov10')) {
                      const yoloPath = (resultsArray.find(o=>o?.model==='yolov10')?.res?.path) || inferenceResultPath || '';
                      if (yoloPath) {
                        const folder = yoloPath.replace(/\/?yolov10\.json$/,'').replace(/\/?$/,'');
                        const { bucket: jsonBucket, key: jsonFolderKey } = normalizeS3Path(folder, 'matt3r-ce-inference-output');
                        const jsonKey = `${jsonFolderKey.replace(/\/?$/,'')}/yolov10.json`;
                        setEvents(prev=>[`Rendering YOLO with ${jsonBucket}/${jsonKey}`, ...prev]);
                        const r = await renderYoloVideo({ video_path: `${videoBucket}/${videoKey}`, result_json_path: `${jsonBucket}/${jsonKey}`, fps: 3 });
                        if(r?.success && r.video_url){ setDetectedUrl(r.video_url); setEvents(prev=>[`Show YOLO: ${r.video_url}`, ...prev]); }
                      }
                    }

                    // Render Ego Lane if selected
                    if (selectedModels.has('ego_lane_plus')) {
                      const lanePath = (resultsArray.find(o=>o?.model==='ego_lane_plus')?.res?.path) || egoLaneResultPath || '';
                      if (lanePath) {
                        const { bucket: resultBucket, key: resultKey } = normalizeS3Path(lanePath, 'matt3r-ce-inference-output');
                        const baseKeyNoSlash = resultKey.replace(/\/?$/,'');
                        const zipKey = /\.zip$/i.test(baseKeyNoSlash) ? baseKeyNoSlash : `${baseKeyNoSlash}/ego_lane_plus.zip`;
                        setEvents(prev=>[`Rendering Ego Lane with zip=${resultBucket}/${zipKey}`, ...prev]);
                        const r = await renderEgoLaneVideo({ video_path: `${videoBucket}/${videoKey}`, result_zip_path: `${resultBucket}/${zipKey}`, fps: 3 });
                        if(r?.success && r.video_url){ setEgoLaneUrl(r.video_url); setEvents(prev=>[`Show Ego Lane: ${r.video_url}`, ...prev]); }
                      }
                    }

                    // Render Depth if selected
                    if (selectedModels.has('depth_anything_v2')) {
                      const depthPath = (resultsArray.find(o=>o?.model==='depth_anything_v2')?.res?.path) || depthResultPath || '';
                      if (depthPath) {
                        const { bucket: resultBucket, key: resultKey } = normalizeS3Path(depthPath, 'matt3r-ce-inference-output');
                        const keyNoSlash = resultKey.replace(/\/?$/,'');
                        const zipKey = /\.zip$/i.test(keyNoSlash) ? keyNoSlash : `${keyNoSlash}/depth_anything_v2.zip`;
                        setEvents(prev=>[`Rendering Depth with zip=${resultBucket}/${zipKey}`, ...prev]);
                        const r = await renderDepthVideo({ video_path: `${videoBucket}/${videoKey}`, result_zip_path: `${resultBucket}/${zipKey}`, fps: 3 });
                        if(r?.success && r.video_url){ setDepthUrl(r.video_url); setEvents(prev=>[`Show Depth: ${r.video_url}`, ...prev]); }
                      }
                    }

                    setVizDone(true);
                  }catch(err){
                    const detail = err?.response?.data?.detail || err?.message || String(err);
                    console.error(detail);
                    alert(`Render failed: ${detail}`);
                  } finally { setVizLoading(false); }
                }}>Render Visualizations</button>
              </div>
            </>
          )}
        </div>

        {/* Right panel */}
        <div className="selected-points-container">
          <div style={{ marginBottom: 10 }}>
            <b>Recent Logs</b>
          </div>
          <div style={{ marginBottom: 8, textAlign:'left', color:'#9bd', fontSize:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>Inference: {inferenceLoading ? 'Running…' : 'Idle'}</span>
            {!inferenceLoading && inferenceDone && <span style={{ color:'#00ff96', fontWeight:700 }}>✓</span>}
          </div>
          <div style={{ marginBottom: 12, textAlign:'left', color:'#9bd', fontSize:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>Visualization: {vizLoading ? 'Rendering…' : 'Idle'}</span>
            {!vizLoading && vizDone && <span style={{ color:'#00ff96', fontWeight:700 }}>✓</span>}
          </div>
          <div style={{ marginBottom: 12, textAlign:'left' }}>
            <button className="clip-video-button" style={{ width:'100%', padding:'8px 10px' }}
              onClick={async ()=>{
                try{
                  // Parse inference results array
                  const parsed = JSON.parse(inferenceRaw || '[]');
                  const arr = Array.isArray(parsed) ? parsed : [];
                  const byModel = new Map(arr.map(o => [o?.model, o?.res?.path]));

                  const downloads = [];
                  const downloadJson = async (bucket, key, filename) => {
                    setEvents(prev=>[`Downloading ${filename} from ${bucket}/${key}`, ...prev]);
                    const res = await fetchJsonFromS3({ bucket, key });
                    const content = res?.json || res?.text || {};
                    const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename || (key.split('/').pop()) || 'result.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  };

                  const downloadZip = async (bucket, key, filename) => {
                    setEvents(prev=>[`Downloading ${filename} from ${bucket}/${key}`, ...prev]);
                    await downloadS3Object({ bucket, key, filename });
                  };

                  // YOLOv10 JSON
                  if (selectedModels.has('yolov10')) {
                    const base = byModel.get('yolov10') || inferenceResultPath || '';
                    if (base) {
                      const folder = base.replace(/\/?yolov10\.json$/,'').replace(/\/?$/,'');
                      const { bucket, key } = normalizeS3Path(folder, 'matt3r-ce-inference-output');
                      const jsonKey = `${key.replace(/\/?$/,'')}/yolov10.json`;
                      downloads.push(downloadJson(bucket, jsonKey, 'yolov10.json'));
                    }
                  }

                  // Ego lane JSON (derive if only zip path available)
                  if (selectedModels.has('ego_lane_plus')) {
                    const base = byModel.get('ego_lane_plus') || egoLaneResultPath || '';
                    if (base) {
                      const { bucket, key } = normalizeS3Path(base, 'matt3r-ce-inference-output');
                      const baseKey = key.replace(/\/?$/,'');
                      const zipKey = /\.zip$/i.test(baseKey) ? baseKey : `${baseKey}/ego_lane_plus.zip`;
                      downloads.push(downloadZip(bucket, zipKey, 'ego_lane_plus.zip'));
                    }
                  }

                  // Depth ZIP
                  if (selectedModels.has('depth_anything_v2')) {
                    const base = byModel.get('depth_anything_v2') || depthResultPath || '';
                    if (base) {
                      const { bucket, key } = normalizeS3Path(base, 'matt3r-ce-inference-output');
                      const baseKey = key.replace(/\/?$/,'');
                      const zipKey = /\.zip$/i.test(baseKey) ? baseKey : `${baseKey}/depth_anything_v2.zip`;
                      downloads.push(downloadZip(bucket, zipKey, 'depth_anything_v2.zip'));
                    }
                  }

                  await Promise.all(downloads);
                }catch(err){
                  setEvents(prev=>[String(err), ...prev]);
                  alert('Download failed');
                }
              }}>Download Selected Results</button>
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {events.length === 0 && <div style={{ color: '#888', fontSize: 12 }}>No logs yet</div>}
            {events.map((e, idx) => (
              <div key={idx} style={{ fontSize: 11, color: '#ccc', marginBottom: 6, whiteSpace:'pre-wrap' }}>{e}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Video2Everything;


