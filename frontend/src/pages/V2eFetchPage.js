import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScenarios as fetchScenariosApi } from '../services/scenarioApi';
import '../styles/ScenarioAnalysisTool.css';

const V2eFetchPage = () => {
  const navigate = useNavigate();
  const [startDate, setStartDate] = React.useState(() => new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10));
  const [endDate, setEndDate] = React.useState(() => new Date().toISOString().slice(0,10));
  const [limit, setLimit] = React.useState(50);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState([]);
  const [message, setMessage] = React.useState('');

  function s3ToKey(url){
    if(!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    const m = trimmed.match(/^s3:\/\/[^/]+\/(.+)$/i);
    if(m){ return m[1]; }
    if(/^[a-z0-9][a-z0-9.\-]{2,}\/./i.test(trimmed)){
      return trimmed.replace(/^[^/]+\//, '');
    }
    return trimmed;
  }

  async function handleFetch(){
    setLoading(true);
    setMessage('');
    try{
      const res = await fetchScenariosApi({ event_types: [], start_date: startDate, end_date: endDate, limit });
      const scenarios = res?.scenarios || [];
      setItems(scenarios);
      setMessage(`Fetched ${scenarios.length} items`);
    }catch(err){
      setMessage(String(err?.message || err));
    }finally{
      setLoading(false);
    }
  }

  // 强制小巧款式（避免被全局 button 样式覆盖）
  const fetchBtnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg,#667eea 0%, #764ba2 100%)', color: '#fff',
    fontSize: 14, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
    boxShadow: '0 6px 16px rgba(118,75,162,0.35)', width: 'auto'
  };

  const previewBtnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg,#3498db 0%, #2980b9 100%)', color: '#fff',
    fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
    boxShadow: '0 4px 12px rgba(41,128,185,0.3)', width: 'auto', minWidth: 120
  };

  return (
    <div style={{ minHeight:'100vh', background:'#fff', color:'#222' }}>
      <div style={{ maxWidth: 1100, margin:'0 auto', padding:'24px 20px' }}>
        <h1 style={{ margin:'8px 0 16px', fontWeight:600 }}>Fetch Scenarios</h1>
        <div className="query-builder">
          <div className="query-section">
            <div className="form-row" style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
              <div className="form-group">
                <label>Start:</label>
                <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="select-input" />
              </div>
              <div className="form-group">
                <label>End:</label>
                <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="select-input" />
              </div>
              <div className="form-group">
                <label>Limit:</label>
                <input type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Number(e.target.value||50))} className="number-input" />
              </div>
            </div>
            <button onClick={handleFetch} disabled={loading} style={{...fetchBtnStyle, width:220, opacity: loading?0.7:1, marginTop: 12}}>{loading ? '⏳ Fetching...' : '🚀 Fetch Scenarios'}</button>
            {message && <div style={{ marginTop:8, fontSize:12, color:'#506176' }}>{message}</div>}
          </div>
        </div>

        {items.length>0 && (
          <div className="scenario-list" style={{ marginTop:16 }}>
            {items.map((item)=>{
              const links = item?.data_links || {};
              const video = links.video || {};
              const createdAt = item?.created_at || '';
              const frontUrl = video.front;
              const key = s3ToKey(frontUrl);
              return (
                <div key={item.id} className="scenario-item compact" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontWeight:600, color:'#1a55a5' }}>#{item.id}</div>
                    <div style={{ color:'#506176', fontSize:12 }}>{new Date(createdAt).toLocaleString()}</div>
                    <div style={{ color:'#6a7b91', fontSize:12, marginTop:4, wordBreak:'break-all' }}>{frontUrl || 'No front video'}</div>
                  </div>
                  <button onClick={()=>{ if(key) navigate('/video2everything/analyze', { state: { s3Key: key } }); }} disabled={!key} style={{...previewBtnStyle, width:120, minWidth:120, maxWidth:120, flex:'0 0 120px', opacity: key?1:0.5}}>Preview</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default V2eFetchPage;


