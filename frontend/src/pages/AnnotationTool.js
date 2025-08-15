import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../styles/App.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import FitBoundsOnPoints from '../components/FitBoundsOnPoints';
import L from 'leaflet';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

function AnnotationTool() {
  const [orgIds, setOrgIds] = useState([]);
  const [keyIds, setKeyIds] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [gpsPoints, setGpsPoints] = useState([]);
  const [fileList, setFileList] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [selectedPoints, setSelectedPoints] = useState([]);
  const [clipResult, setClipResult] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [dataSource, setDataSource] = useState(null); // 'local' or 's3'
  const [localFiles, setLocalFiles] = useState([]);
  const [currentLocalFileIndex, setCurrentLocalFileIndex] = useState(0);
  const [currentLocalFilePath, setCurrentLocalFilePath] = useState(''); // Add local file path state
  const [currentLocalOrgId, setCurrentLocalOrgId] = useState(''); // Add local file org_id state
  const [currentLocalKeyId, setCurrentLocalKeyId] = useState(''); // Add local file key_id state
  const mapRef = useRef();

  // Auto-detect API base URL based on current location
  const getApiBase = () => {
    // If environment variable is set, use it
    if (process.env.REACT_APP_API_BASE) {
      return process.env.REACT_APP_API_BASE;
    }
    
    // Auto-detect based on current hostname
    const hostname = window.location.hostname;
    
    // If accessing via localhost, use localhost:8000
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:8000';
    }
    
    // If accessing via IP address, use the same IP with port 8000
    if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return `http://${hostname}:8000`;
    }
    
    // If accessing via server IP (production), use the server IP
    if (hostname === '192.168.10.100' || hostname === '192.168.1.200') {
      return `http://${hostname}:8000`;
    }
    
    // Default fallback - use server IP for production
    return 'http://192.168.10.100:8000';
  };

  const API_BASE = getApiBase();

  useEffect(() => {
    loadOrgIds();
  }, []);

  const loadOrgIds = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/s3/orgs`);
      setOrgIds(response.data.org_ids || []);
      setMessage('Organization list loaded successfully');
    } catch (error) {
      setMessage('Failed to load organization list: ' + error.message);
      console.error(error);
    }
  };

  // When org changes, load key ids and reset file list
  const handleOrgIdChange = async (orgId) => {
    setSelectedOrgId(orgId);
    setSelectedKeyId('');
    setFileList([]);
    setCurrentFileIndex(0);
    setGpsPoints([]);
    if (orgId) {
      try {
        const response = await axios.get(`${API_BASE}/api/s3/orgs/${orgId}/keys`);
        setKeyIds(response.data.key_ids || []);
        setMessage('Key list loaded successfully');
      } catch (error) {
        setMessage('Failed to load key list: ' + error.message);
        console.error(error);
      }
    }
  };

  // When key changes, load all parquet files under this key
  useEffect(() => {
    const fetchFiles = async () => {
      if (selectedOrgId && selectedKeyId) {
        try {
          const res = await axios.get(`${API_BASE}/api/s3/orgs/${selectedOrgId}/keys/${selectedKeyId}/files`);
          setFileList(res.data.files || []);
          setCurrentFileIndex(0);
        } catch (error) {
          setFileList([]);
          setCurrentFileIndex(0);
        }
      } else {
        setFileList([]);
        setCurrentFileIndex(0);
      }
    };
    fetchFiles();
  }, [selectedOrgId, selectedKeyId]);

  // Load GPS data for a specific file index
  const loadGpsDataByIndex = async (fileIndex) => {
    if (!selectedOrgId || !selectedKeyId || fileList.length === 0) return;
    setLoading(true);
    try {
      const response = await axios.post(
        `${API_BASE}/api/gps/load`,
        { org_id: selectedOrgId, key_id: selectedKeyId, file_index: fileIndex },
        { headers: { 'Content-Type': 'application/json' } }
      );
      setGpsPoints(response.data.points || []);
      setCurrentFileName(response.data.file_name || '');
      setMessage(`GPS data loaded: ${response.data.total_points} points`);
    } catch (error) {
      setMessage('Failed to load GPS data: ' + error.message);
      setGpsPoints([]);
    } finally {
      setLoading(false);
    }
  };

  // Load first file when clicking the button
  const testGPSData = () => {
    setCurrentFileIndex(0);
    loadGpsDataByIndex(0);
  };

  // Previous/Next file buttons
  const handlePrev = () => {
    if (currentFileIndex > 0) {
      const newIndex = currentFileIndex - 1;
      setCurrentFileIndex(newIndex);
      loadGpsDataByIndex(newIndex);
    }
  };
  const handleNext = () => {
    // If in preview mode, exit preview first
    if (isPreviewMode) {
      handleExitPreview();
    }
    
    if (currentFileIndex < fileList.length - 1) {
      const newIndex = currentFileIndex + 1;
      setCurrentFileIndex(newIndex);
      loadGpsDataByIndex(newIndex);
    }
  };

  useEffect(() => {
    console.log("Triggering fitBounds, gpsPoints:", gpsPoints);
    if (gpsPoints.length > 0 && mapRef.current) {
      const bounds = gpsPoints.map(p => [p.lat, p.lon]);
      console.log("MapRef object:", mapRef.current);
      mapRef.current.fitBounds(bounds);  // ⬅️ Check if there's an error here
    }
  }, [gpsPoints]);

  // Marker click event
  const handleMarkerClick = (point) => {
    if (selectedPoints.length < 2) {
      // Avoid selecting the same point repeatedly
      if (!selectedPoints.find(p => p.timestamp === point.timestamp)) {
        setSelectedPoints([...selectedPoints, point]);
      }
    } else {
      setSelectedPoints([point]); // Reset if more than 2 points
    }
  };

  // Preview video
  const handlePreviewVideo = async () => {
    if (selectedPoints.length !== 2) return;
    const [p1, p2] = selectedPoints;
    const start_ts = Math.min(p1.timestamp, p2.timestamp);
    const end_ts = Math.max(p1.timestamp, p2.timestamp);
    setClipResult('Preparing preview...');
    
    try {
      let res;
      if (dataSource === 'local') {
        // Local file preview
        res = await axios.post(`${API_BASE}/api/local/clip`, {
          file_path: currentLocalFilePath,
          start_ts,
          end_ts,
          preview_mode: true
        });
      } else {
        // S3 file preview
        res = await axios.post(`${API_BASE}/api/video/clip`, {
          org_id: selectedOrgId,
          key_id: selectedKeyId,
          start_ts,
          end_ts,
          preview_mode: true
        });
      }
      
      if (res.data.status === 'ok') {
        setPreviewData(res.data);
        setIsPreviewMode(true);
        setClipResult(null);
      } else {
        setClipResult(`Error: ${res.data.error}`);
      }
    } catch (e) {
      setClipResult('Error: ' + e.message);
    }
  };

  // Save video
  const handleSaveVideo = async () => {
    if (!previewData) return;
    setClipResult('Saving video...');
    try {
      let res;
      if (dataSource === 'local') {
        // Local file save
        res = await axios.post(`${API_BASE}/api/local/clip`, {
          file_path: currentLocalFilePath,
          start_ts: Math.min(selectedPoints[0].timestamp, selectedPoints[1].timestamp),
          end_ts: Math.max(selectedPoints[0].timestamp, selectedPoints[1].timestamp),
          preview_mode: false
        });
      } else {
        // S3 file save
        res = await axios.post(`${API_BASE}/api/video/clip`, {
          org_id: selectedOrgId,
          key_id: selectedKeyId,
          start_ts: Math.min(selectedPoints[0].timestamp, selectedPoints[1].timestamp),
          end_ts: Math.max(selectedPoints[0].timestamp, selectedPoints[1].timestamp),
          preview_mode: false
        });
      }
      
      if (res.data.status === 'ok') {
        setClipResult(`Video saved to: ${res.data.file}`);
        setPreviewData(null);
        setIsPreviewMode(false);
      } else {
        setClipResult(`Error: ${res.data.error}`);
      }
    } catch (e) {
      setClipResult('Error: ' + e.message);
    }
  };

  // Exit preview mode
  const handleExitPreview = () => {
    setIsPreviewMode(false);
    setPreviewData(null);
    setClipResult(null);
  };

  // 选择数据源
  const handleDataSourceSelect = (source) => {
    // 如果当前在预览模式，先退出预览
    if (isPreviewMode) {
      handleExitPreview();
    }
    setIsPreviewMode(false);
    setPreviewData(null);
    setGpsPoints([]); // 清空地图点
    setSelectedPoints([]); // 清空选中点
    setDataSource(source);
    if (source === 's3') {
      // 重置S3相关状态
      setSelectedOrgId('');
      setSelectedKeyId('');
      setFileList([]);
      setCurrentFileName('');
      setCurrentFileIndex(0);
      setMessage('');
      setClipResult(null);
    } else if (source === 'local') {
      // 重置本地相关状态
      setLocalFiles([]);
      setCurrentLocalFileIndex(0);
      setCurrentLocalFilePath('');
      setCurrentLocalOrgId('');
      setCurrentLocalKeyId('');
      setMessage('');
      setClipResult(null);
    }
  };

  // 处理本地文件夹选择
  const handleLocalFolderSelect = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      
      input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        const parquetFiles = files.filter(file => 
          file.name === 'processed_console_trip.parquet'
        );
        
        if (parquetFiles.length === 0) {
          setMessage('No processed_console_trip.parquet files found in selected folder');
          return;
        }
        
        setLocalFiles(parquetFiles);
        setCurrentLocalFileIndex(0);
        setMessage(`Found ${parquetFiles.length} parquet files`);
        
        // 加载第一个文件
        await loadLocalParquetFile(parquetFiles[0]);
      };
      
      input.click();
    } catch (error) {
      setMessage('Error selecting folder: ' + error.message);
    }
  };

  // 加载本地parquet文件
  const loadLocalParquetFile = async (file) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // 保存文件路径用于后续预览
      const filePath = file.webkitRelativePath || file.name;
      setCurrentLocalFilePath(filePath);
      
      // 从路径中提取org_id和key_id
      const pathParts = filePath.split('/');
      const orgId = pathParts[0] || 'local_unknown';
      const keyId = pathParts[1] || 'local_unknown';
      setCurrentLocalOrgId(orgId);
      setCurrentLocalKeyId(keyId);
      
      const response = await axios.post(
        `${API_BASE}/api/local/load`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      
      setGpsPoints(response.data.points || []);
      setMessage(`Loaded ${response.data.total_points} points from local file`);
    } catch (error) {
      setMessage('Failed to load local file: ' + error.message);
      setGpsPoints([]);
    } finally {
      setLoading(false);
    }
  };

  // 本地文件导航
  const handleLocalPrev = () => {
    if (currentLocalFileIndex > 0) {
      const newIndex = currentLocalFileIndex - 1;
      setCurrentLocalFileIndex(newIndex);
      loadLocalParquetFile(localFiles[newIndex]);
    }
  };

  const handleLocalNext = () => {
    if (currentLocalFileIndex < localFiles.length - 1) {
      const newIndex = currentLocalFileIndex + 1;
      setCurrentLocalFileIndex(newIndex);
      loadLocalParquetFile(localFiles[newIndex]);
    }
  };

  // ... (JSX from the original App component) ...

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">GPS-Video Event Cropping</div>
        <div className="tagline">Keeping drivers safe through AI innovation</div>
      </header>
      <div className="App-content">
        {!dataSource ? (
          // 数据源选择页面
          <div className="data-source-selection">
            <div className="selection-container">
              <h2>Select Data Source</h2>
              <div className="selection-options">
                <div className="option-card" onClick={() => handleDataSourceSelect('local')}>
                  <div className="option-icon">📁</div>
                  <h3>Local Upload</h3>
                  <p>Upload DMP folder from your local machine</p>
                </div>
                <div className="option-card" onClick={() => handleDataSourceSelect('s3')}>
                  <div className="option-icon">☁️</div>
                  <h3>Direct S3 Link</h3>
                  <p>Connect directly to S3 bucket</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="sidebar">
            <h3>Data Selection</h3>
            {dataSource === 'local' ? (
              // 本地文件选择界面
              <div>
                <div className="form-group">
                  <label>Local Folder:</label>
                  <button 
                    onClick={handleLocalFolderSelect}
                    className="test-button"
                    style={{ marginBottom: '10px' }}
                  >
                    Select Folder
                  </button>
                </div>
                {localFiles.length > 0 && (
                  <div className="status-card">
                    <h4>Local Files</h4>
                    <p>Total Files: {localFiles.length}</p>
                    <p>Current File: {currentLocalFileIndex + 1}/{localFiles.length}</p>
                    <p>Current: {localFiles[currentLocalFileIndex]?.name || 'None'}</p>
                    <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                      <button onClick={handleLocalPrev} disabled={currentLocalFileIndex <= 0}>Previous</button>
                      <button onClick={handleLocalNext} disabled={currentLocalFileIndex >= localFiles.length - 1}>Next</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // S3选择界面
              <div>
                <div className="form-group">
                  <label>Organization ID:</label>
                  <select 
                    value={selectedOrgId} 
                    onChange={(e) => handleOrgIdChange(e.target.value)}
                    className="select-input"
                  >
                    <option value="">Select Organization ID</option>
                    {orgIds.map(orgId => (
                      <option key={orgId} value={orgId}>{orgId}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Key ID:</label>
                  <select 
                    value={selectedKeyId} 
                    onChange={(e) => setSelectedKeyId(e.target.value)}
                    className="select-input"
                    disabled={!selectedOrgId}
                  >
                    <option value="">Select Key ID</option>
                    {keyIds.map(keyId => (
                      <option key={keyId} value={keyId}>{keyId}</option>
                    ))}
                  </select>
                </div>
                <button 
                  onClick={testGPSData}
                  disabled={loading || fileList.length === 0}
                  className="test-button"
                >
                  {loading ? 'Loading...' : 'Load GPS Data'}
                </button>
                <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                  <button onClick={handlePrev} disabled={currentFileIndex <= 0 || fileList.length === 0}>Previous</button>
                  <button onClick={handleNext} disabled={currentFileIndex >= fileList.length - 1 || fileList.length === 0}>Next</button>
                </div>
              </div>
            )}
            <div className="status-card">
              <h4>Status</h4>
              <p>Data Source: {dataSource === 'local' ? 'Local Files' : 'S3'}</p>
              {dataSource === 's3' && (
                <>
                  <p>Selected Organization: {selectedOrgId || 'None'}</p>
                  <p>Selected Key ID: {selectedKeyId || 'None'}</p>
                  <p>Available Organizations: {orgIds.length}</p>
                  <p>Available Key IDs: {keyIds.length}</p>
                  <p>Available GPS Files: {fileList.length}</p>
                  <p>
                    Current File:<br />
                    <span style={{ wordBreak: 'break-all' }}>
                      {currentFileName ? currentFileName : 'None'}
                    </span><br />
                    <span>
                      {fileList.length > 0 ? `(${currentFileIndex + 1}/${fileList.length})` : ''}
                    </span>
                  </p>
                </>
              )}
              {dataSource === 'local' && (
                <>
                  <p>Local Files: {localFiles.length}</p>
                  <p>Current File: {currentLocalFileIndex + 1}/{localFiles.length}</p>
                  <p>Current: {localFiles[currentLocalFileIndex]?.name || 'None'}</p>
                  <p>Org ID: {currentLocalOrgId || 'None'}</p>
                  <p>Key ID: {currentLocalKeyId || 'None'}</p>
                  <p style={{ 
                    wordBreak: 'break-all', 
                    wordWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    fontSize: '9px',
                    lineHeight: '1.2',
                    maxHeight: '40px',
                    overflow: 'hidden'
                  }}>
                    Path: {currentLocalFilePath || 'None'}
                  </p>
                </>
              )}
              <p>Message: {message}</p>
            </div>
            <button 
              onClick={() => handleDataSourceSelect(null)}
              style={{
                width: '100%',
                padding: '8px',
                background: 'linear-gradient(135deg, #666666 0%, #888888 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                marginTop: '10px'
              }}
            >
              Change Data Source
            </button>
          </div>
        )}
        <div className="main-content">
          {isPreviewMode ? (
            <div className="video-preview-container">
              <div className="video-preview-header">
                <h3>Video Preview</h3>
                <button 
                  onClick={handleExitPreview}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, #666666 0%, #888888 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}
                >
                  Exit Preview
                </button>
              </div>
              <div className="video-player-container">
                <video
                  controls
                  style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                  src={previewData?.preview_url}
                >
                  Your browser does not support the video tag.
                </video>
              </div>
              <div className="video-preview-actions">
                <button 
                  onClick={handleSaveVideo}
                  style={{
                    padding: '12px 24px',
                    background: 'linear-gradient(135deg, #00ff96 0%, #00d4ff 100%)',
                    color: '#000000',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}
                >
                  Save Video
                </button>
              </div>
            </div>
          ) : (
            <div className="map-placeholder">
              <MapContainer
                center={[37.7749, -122.4194]}
                zoom={13}
                style={{ height: "100%", width: "100%" }}
                whenCreated={mapInstance => { mapRef.current = mapInstance; }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                {gpsPoints.map((point, idx) => (
                  <Marker key={idx} position={[point.lat, point.lon]} eventHandlers={{ click: () => handleMarkerClick(point) }}>
                    <Popup>
                      {`Timestamp: ${point.timestamp}`}
                    </Popup>
                  </Marker>
                ))}
                <FitBoundsOnPoints points={gpsPoints} />
              </MapContainer>
            </div>
          )}
        </div>
        <div className="selected-points-container">
          <div>
            <b>Selected Points:</b>
            {selectedPoints.length === 0 && <span> None</span>}
            {selectedPoints.map((p, i) => (
              <div key={i} style={{ 
                marginTop: 10, 
                padding: 15, 
                backgroundColor: i === 0 ? 'rgba(0, 255, 150, 0.1)' : 'rgba(0, 212, 255, 0.1)', 
                border: `2px solid ${i === 0 ? '#00ff96' : '#00d4ff'}`,
                borderRadius: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: `0 4px 15px ${i === 0 ? 'rgba(0, 255, 150, 0.2)' : 'rgba(0, 212, 255, 0.2)'}`,
                backdropFilter: 'blur(10px)'
              }}>
                <span style={{ fontWeight: 'bold', color: i === 0 ? '#00ff96' : '#00d4ff', textTransform: 'uppercase', letterSpacing: '1.5px', fontFamily: 'JetBrains Mono, Inter, monospace' }}>
                  Point {i + 1}:
                </span>
                <span style={{ color: '#ffffff', fontFamily: 'Inter, sans-serif' }}>{p.timestamp}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button 
              onClick={handlePreviewVideo} 
              disabled={selectedPoints.length !== 2 || (dataSource === 's3' ? (!selectedOrgId || !selectedKeyId) : !currentLocalFilePath)}
              style={{
                padding: '10px 16px',
                background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                flex: 1
              }}
            >
              Preview
            </button>
            <button 
              onClick={handleSaveVideo} 
              disabled={!previewData || !isPreviewMode}
              style={{
                padding: '10px 16px',
                background: 'linear-gradient(135deg, #00ff96 0%, #00d4ff 100%)',
                color: '#000000',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                flex: 1
              }}
            >
              Save
            </button>
          </div>
          {clipResult && <div style={{ 
            marginTop: 8, 
            padding: 6, 
            backgroundColor: 'rgba(26, 26, 46, 0.6)', 
            borderRadius: 4, 
            color: '#cccccc',
            border: '1px solid rgba(0, 255, 150, 0.2)',
            backdropFilter: 'blur(10px)',
            fontFamily: 'Inter, sans-serif',
            fontSize: '11px',
            lineHeight: '1.3',
            wordBreak: 'break-all',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            maxHeight: '60px',
            overflow: 'hidden',
            width: '100%',
            maxWidth: '260px',
            boxSizing: 'border-box'
          }}>
            {clipResult.includes('Video file:') ? 
              `Video saved to:\n${clipResult.replace('Video file: ', '')}` : 
              clipResult
            }
          </div>}
        </div>
      </div>
    </div>
  );
}

export default AnnotationTool; 