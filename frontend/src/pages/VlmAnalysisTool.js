import React from 'react';
import '../styles/App.css';
import { wiseadApi } from '../services/v2eApi';

const VlmAnalysisTool = () => {
  const [videoFile, setVideoFile] = React.useState(null);
  const [question, setQuestion] = React.useState('What driving maneuver is the car performing?');
  const [results, setResults] = React.useState([]);
  const [wiseadJson, setWiseadJson] = React.useState(null);
  const [selectedLabel, setSelectedLabel] = React.useState('');
  const [customLabel, setCustomLabel] = React.useState('');
  const videoRef = React.useRef(null);
  const [label, setLabel] = React.useState('');

  async function handleInfer() {
    if (!videoFile) { alert('Select a video first'); return; }
    try {
      const res = await wiseadApi.analyzeVideo(videoFile, { prompt: question, method: 'fps', fps: 1 });
      setWiseadJson(res);
      // Populate results table with a simple single-line summary row
      setResults([{ segment_id: 0, timestamp_s: 0, answer: res.result }]);
    } catch (e) {
      alert('Inference failed');
    }
  }

  function handleSaveJson() {
    if (!wiseadJson) { alert('Run inference first'); return; }
    const labelOut = selectedLabel === 'custom' ? (customLabel || '') : selectedLabel;
    if (!labelOut) { alert('Please choose a label'); return; }
    const payload = {
      result: wiseadJson.result,
      num_frames: wiseadJson.num_frames,
      timings: wiseadJson.timings,
      label: labelOut,
      created_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vlm_annotation.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">VLM ANALYSIS TOOL</div>
        <div className="tagline">Video → Frames → VLM Inference → Label</div>
      </header>
      <div className="App-content">
        <div className="data-source-selection">
          <div className="selection-container">
            <h2>Upload Video</h2>
            <input className="select-input" type="file" accept="video/*" onChange={e=>setVideoFile(e.target.files?.[0]||null)} />
            <div className="form-group" style={{marginTop:14}}>
              <label>Question</label>
              <input className="select-input" value={question} onChange={e=>setQuestion(e.target.value)} />
            </div>
            <button className="test-button" onClick={handleInfer} disabled={!videoFile}>Run Inference</button>
          </div>
        </div>

        <div className="main-content">
          <div className="video-preview-container" style={{minHeight:'60vh'}}>
            <div className="video-preview-header"><h3>Video Preview</h3></div>
            <div style={{padding:10, display:'flex', justifyContent:'center', height:'calc(60vh - 48px)'}}>
              {videoFile ? (
                <video ref={videoRef} src={URL.createObjectURL(videoFile)} controls style={{ width: '100%', height:'100%', background: '#000', borderRadius: 12, objectFit:'contain' }} />
              ) : (
                <div style={{ color: '#aaa' }}>Select a video to preview</div>
              )}
            </div>
          </div>
          <div className="video-preview-container" style={{minHeight:160, marginTop:10}}>
            <div className="video-preview-header"><h3>Inference Result</h3></div>
            <div style={{padding:'16px 16px 28px'}}>
              {!wiseadJson ? (
                <div style={{color:'#aaa'}}>No results yet</div>
              ) : (
                <>
                  <div style={{
                    maxWidth:900, margin:'0 auto 8px', textAlign:'center',
                    color:'#eaf6ff', fontSize:16, fontWeight:700, lineHeight:1.25,
                    textShadow:'0 0 6px rgba(0,255,150,0.12)'
                  }}>{wiseadJson.result}</div>
                  <div style={{display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap', marginTop:8}}>
                    {[{
                      title:'Frames', value: wiseadJson.num_frames ?? '-'
                    },{
                      title:'Infer (s)', value: (wiseadJson?.timings?.infer_s!==undefined?Number(wiseadJson.timings.infer_s).toFixed(3):'-')
                    }].map((m,idx)=> (
                      <div key={idx} style={{
                        background:'linear-gradient(135deg, rgba(0,255,150,0.08) 0%, rgba(0,212,255,0.08) 100%)',
                        border:'1px solid rgba(0,255,150,0.35)', borderRadius:10,
                        padding:'10px 16px', minWidth:160, textAlign:'center', boxShadow:'0 6px 18px rgba(0,0,0,0.25)'
                      }}>
                        <div style={{color:'#7ee8fa', fontSize:12, letterSpacing:0.3}}>{m.title}</div>
                        <div style={{color:'#eaf6ff', fontSize:18, fontWeight:800}}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="selected-points-container">
          <div style={{marginBottom:10}}><b>Select & Annotate Maneuver</b></div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {[
              { id:'left_turn', label:'Left Turn' },
              { id:'right_turn', label:'Right Turn' },
              { id:'left_lane_change', label:'Left Lane Change' },
              { id:'right_lane_change', label:'Right Lane Change' },
              { id:'curve_turn', label:'Curve Turn' },
              { id:'custom', label:'Custom' },
            ].map(opt => (
              <label key={opt.id} style={{color:'#eaf6ff', fontSize:12, display:'flex', alignItems:'center', gap:6}}>
                <input type="radio" name="maneuver" checked={selectedLabel===opt.id} onChange={()=>setSelectedLabel(opt.id)} />
                {opt.label}
              </label>
            ))}
            {selectedLabel==='custom' && (
              <input className="select-input" placeholder="Custom label" value={customLabel} onChange={e=>setCustomLabel(e.target.value)} />
            )}
            <button className="test-button" onClick={handleSaveJson} disabled={!wiseadJson} style={{marginTop:8}}>Generate Annotation JSON</button>
            <div style={{fontSize:12, color:'#888'}}>JSON 将包含 result/num_frames/timings 以及你选择的 label。</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VlmAnalysisTool;





