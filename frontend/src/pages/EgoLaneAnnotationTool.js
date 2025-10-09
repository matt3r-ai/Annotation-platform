import React from 'react';
import { s3VideoAPI } from '../services/api';
import { fetchScenarios as fetchScenariosApi } from '../services/scenarioApi';
import { runEgoLanePlusOnS3 } from '../services/v2eApi';
import '../styles/App.css';

/**
 * Ego Lane Annotation Tool (scaffold)
 * - Shares the same frame extraction flow as ObjectDetectionTool (3 fps).
 * - Replaces YOLO autofill with ego_lane_plus inference.
 * - Includes a simple brush/eraser overlay for manual mask edits (per-frame strokes).
 *
 * NOTE: This is a first-pass skeleton. We will iterate to add mask IO (zip/npys),
 * snap-to-lane postproc, and export formats after initial review.
 */
export default function EgoLaneAnnotationTool() {
  // 与 ObjectDetectionTool 保持一致的页面布局状态
  const [dataSource, setDataSource] = React.useState('s3');
  const [viewMode, setViewMode] = React.useState('fetch'); // 'fetch' | 'annotate'

  const [frameUrls, setFrameUrls] = React.useState([]);
  const [currentFrameIndex, setCurrentFrameIndex] = React.useState(0);
  const [currentS3Key, setCurrentS3Key] = React.useState('');
  const [isLoadingFrames, setIsLoadingFrames] = React.useState(false);
  const [isAutofilling, setIsAutofilling] = React.useState(false);
  const [inferencePath, setInferencePath] = React.useState('');

  // Simple stroke overlay state
  const [tool, setTool] = React.useState('brush'); // 'brush' | 'eraser'
  const [brushSize, setBrushSize] = React.useState(12);
  const [strokesByFrame, setStrokesByFrame] = React.useState({}); // {frameIndex: [{x,y,size,tool}]}

  const canvasRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const isDrawingRef = React.useRef(false);

  // Load frames helper (same as ObjectDetectionTool)
  async function loadFramesFromS3Key(key) {
    if (!key) { alert('Missing S3 video key'); return; }
    try {
      setIsLoadingFrames(true);
      setFrameUrls([]);
      setCurrentFrameIndex(0);
      setCurrentS3Key(key);
      const filename = key.split('/').pop() || 'video.mp4';
      const response = await s3VideoAPI.extractFrames({ s3_key: key, filename, fps: 3 });
      const frames = response.data?.frames || response.frames || [];
      setFrameUrls(frames);
      setViewMode('annotate');
    } catch (e) {
      console.error(e);
      alert('Extract frames failed');
    } finally {
      setIsLoadingFrames(false);
    }
  }

  // Very simple mock of scenario fetcher: allow user to input a key quickly
  const [manualKey, setManualKey] = React.useState('');
  // Scenarios fetch panel (mirror ObjectDetectionTool)
  const [mcdbStart, setMcdbStart] = React.useState(() => new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10));
  const [mcdbEnd, setMcdbEnd] = React.useState(() => new Date().toISOString().slice(0,10));
  const [mcdbLimit, setMcdbLimit] = React.useState(50);
  const [mcdbItems, setMcdbItems] = React.useState([]);
  const [mcdbLoading, setMcdbLoading] = React.useState(false);

  // Ego lane autofill (proxy → ego_lane_plus)
  async function handleAutofillEgoLane() {
    if (!currentS3Key) { alert('Please load frames from an S3 key first.'); return; }
    try {
      setIsAutofilling(true);
      const res = await runEgoLanePlusOnS3({ s3_url: currentS3Key, file_type: 'video', fps: 3 });
      const p = res?.path || '';
      setInferencePath(p);
      if (!p) {
        alert('ego_lane_plus inference returned no path');
      } else {
        alert('ego_lane_plus inference submitted. Result path: ' + p + '\n(Visualization to be added in next step)');
      }
    } catch (e) {
      console.error(e);
      alert('Autofill failed: ' + (e?.message || 'unknown error'));
    } finally {
      setIsAutofilling(false);
    }
  }

  // Basic drawing on overlay canvas
  function handlePointerDown(e) {
    if (!canvasRef.current) return;
    isDrawingRef.current = true;
    addStrokePoint(e);
  }
  function handlePointerMove(e) {
    if (!isDrawingRef.current) return;
    addStrokePoint(e);
  }
  function handlePointerUp() {
    isDrawingRef.current = false;
  }
  function getCanvasPos(evt) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    return { x, y };
  }
  function addStrokePoint(evt) {
    const p = getCanvasPos(evt);
    setStrokesByFrame(prev => {
      const list = prev[currentFrameIndex] ? [...prev[currentFrameIndex]] : [];
      list.push({ x: p.x, y: p.y, size: brushSize, tool });
      return { ...prev, [currentFrameIndex]: list };
    });
  }

  // Render strokes whenever frame or strokes change
  React.useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!ctx || !canvas || !img) return;

    // Fit canvas to image container
    canvas.width = img.clientWidth || 800;
    canvas.height = img.clientHeight || 450;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Build a binary mask first to avoid additive alpha in overlap regions
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.clearRect(0, 0, mask.width, mask.height);

    const list = strokesByFrame[currentFrameIndex] || [];
    list.forEach(s => {
      mctx.beginPath();
      mctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      if (s.tool === 'eraser') {
        mctx.globalCompositeOperation = 'destination-out';
      } else {
        mctx.globalCompositeOperation = 'source-over';
        mctx.fillStyle = '#000'; // opaque mask
      }
      mctx.fill();
    });
    mctx.globalCompositeOperation = 'source-over';

    // Colorize the mask with uniform semi-transparency
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff96';
    ctx.globalAlpha = 0.4; // uniform half-transparent overlay
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }, [strokesByFrame, currentFrameIndex, brushSize]);

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">EGO LANE ANNOTATION TOOL</div>
        <div className="tagline">Keeping drivers safe through AI innovation</div>
      </header>
      <div className="App-content">
        {/* 左侧数据源选择（视觉上与 ObjectDetectionTool 一致，仅启用 S3） */}
        <div className="data-source-selection">
          <div className="selection-container">
            <h2>Select Data Source</h2>
            <div className="selection-options">
              <div className={`option-card${dataSource === 'local' ? ' active' : ''}`} style={{ opacity: 0.5, pointerEvents: 'none' }}>
                <div className="option-icon">📁</div>
                <h3>Local Upload</h3>
                <p>Upload DMP folder from your local machine</p>
              </div>
              <div
                className={`option-card${dataSource === 's3' ? ' active' : ''}`}
                onClick={() => { setDataSource('s3'); setViewMode('fetch'); }}
              >
                <div className="option-icon">☁️</div>
                <h3>Direct S3 Link</h3>
                <p>Connect directly to S3 bucket</p>
              </div>
            </div>
            {/* 直接 S3 Key 输入（保持与现有功能一致） */}
            <div style={{ marginTop: 18 }}>
              <label className="select-label" style={{ color: '#b0b0b0', fontSize: 13, marginBottom: 6, display: 'block', textAlign: 'left' }}>Direct S3 Key</label>
              <input
                className="select-input"
                placeholder="org/key/.../video.mp4"
                value={manualKey}
                onChange={(e)=>setManualKey(e.target.value)}
              />
              <button className="test-button" style={{ width:'100%', marginTop: 8 }} onClick={()=>loadFramesFromS3Key(manualKey)} disabled={!manualKey || isLoadingFrames}>
                Load Frames (3 fps)
              </button>
            </div>
          </div>
        </div>
        {/* 中央内容：完全复用 ObjectDetectionTool 的 Fetch 面板布局 */}
        <div className="main-content">
          {viewMode === 'fetch' ? (
            <div style={{ padding: 12 }}>
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
                    try{
                      const res = await fetchScenariosApi({ event_types: [], start_date: mcdbStart, end_date: mcdbEnd, limit: mcdbLimit });
                      const scenarios = res?.scenarios || [];
                      setMcdbItems(scenarios);
                    }catch(err){
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
                    boxShadow:'0 6px 16px rgba(118,75,162,0.35)'
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
                          <button className="test-button" disabled={!key} onClick={()=> loadFramesFromS3Key(key)} style={{ minWidth:160 }}>
                            Load Frames (3 fps)
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 帧标注视图：保持 Ego Lane 原有功能，仅换容器与尺寸 */
            <div className="video-preview-container" style={{ width: '100%', maxWidth: 900, minHeight: 480, margin: '0 auto', background: 'rgba(15,52,96,0.3)' }}>
              <div className="video-player-container" style={{ position: 'relative', height: 'calc(100vh - 200px)' }}>
                {frameUrls[currentFrameIndex] ? (
                  <>
                    <img ref={imgRef} src={frameUrls[currentFrameIndex]} alt="frame" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    <canvas
                      ref={canvasRef}
                      style={{ position: 'absolute', inset: 0, cursor: tool==='brush'?'crosshair':'cell' }}
                      onMouseDown={handlePointerDown}
                      onMouseMove={handlePointerMove}
                      onMouseUp={handlePointerUp}
                      onMouseLeave={handlePointerUp}
                    />
                  </>
                ) : (
                  <div style={{ color: '#888', textAlign: 'center', fontSize: 16 }}>
                    {isLoadingFrames ? 'Loading frames…' : 'Please load frames via S3 key'}
                  </div>
                )}
                {frameUrls.length>0 && (
                  <div style={{ position:'absolute', left:'50%', bottom:10, transform:'translateX(-50%)', background:'rgba(0,0,0,0.9)', color:'#fff', borderRadius: 20, padding:'8px 16px', display:'flex', gap:15, border:'1px solid rgba(0,255,150,0.4)' }}>
                    <button className="test-button" onClick={()=>setCurrentFrameIndex(i=>Math.max(0,i-1))} disabled={currentFrameIndex===0}>⏮️</button>
                    <span style={{ fontWeight:600, fontSize:14, minWidth:80, textAlign:'center' }}>{currentFrameIndex+1} / {frameUrls.length}</span>
                    <button className="test-button" onClick={()=>setCurrentFrameIndex(i=>Math.min(frameUrls.length-1,i+1))} disabled={currentFrameIndex===frameUrls.length-1}>⏭️</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* 右侧操作面板：对齐 ObjectDetectionTool 的右栏样式容器 */}
        <div className="selected-points-container">
          <div style={{ marginBottom: 15, fontSize: 11, color:'#888' }}>Use brush/eraser to refine ego-lane mask. Autofill generates an initial mask from ego_lane_plus.</div>
          <button className="test-button" style={{ width:'100%', marginBottom: 8 }} onClick={handleAutofillEgoLane} disabled={frameUrls.length===0 || isAutofilling}>
            {isAutofilling ? 'Running ego_lane_plus…' : 'Ego Lane Autofill (3 fps)'}
          </button>
          <div style={{ marginBottom: 8, fontSize: 12, color:'#b0b0b0' }}>Brush/Eraser</div>
          <div style={{ display:'flex', gap:8, marginBottom:12 }}>
            <button className="test-button" onClick={()=>setTool('brush')} style={{ background: tool==='brush'?'#00ff96':'#333', color: tool==='brush'?'#000':'#fff' }}>Brush</button>
            <button className="test-button" onClick={()=>setTool('eraser')} style={{ background: tool==='eraser'?'#ff6b6b':'#333', color: tool==='eraser'?'#000':'#fff' }}>Eraser</button>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize:12, color:'#b0b0b0' }}>Brush size</label>
            <input type="range" min={4} max={40} value={brushSize} onChange={(e)=>setBrushSize(Number(e.target.value))} style={{ width:'100%' }} />
          </div>
          {inferencePath && (
            <div style={{ marginTop: 12, fontSize: 12, color:'#6a7b91', wordBreak:'break-all' }}>
              Result path: {inferencePath}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


