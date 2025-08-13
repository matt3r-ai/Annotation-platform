import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from 'recharts';
import '../styles/ImuVisualization.css';

const ImuVisualization = ({
  imuData,
  onSegmentSelect,
  savedSegments,
  onSaveSegment,
  onRemoveSegment,
  onSaveToFile,
  onWriteBack,
  onCropData,
  markedStartTime,
  setMarkedStartTime,
  markedEndTime,
  setMarkedEndTime,
  selectedTime,
  setSelectedTime,
  onTimeSync // 新增GPS同步回调
}) => {
  const rulerRef = useRef(null);
  const [chartData, setChartData] = useState([]);
  const [timeRange, setTimeRange] = useState({ min: 0, max: 60 });
  const [dataStartTime, setDataStartTime] = useState(0);
  const [dataEndTime, setDataEndTime] = useState(60);
  const [duration, setDuration] = useState(60);
  
  // 处理IMU数据，转换为图表格式
  useEffect(() => {
    if (!imuData || (!imuData.gyro && !imuData.accel)) {
      setChartData([]);
      return;
    }
    
    const processedData = [];
    
    // 找到数据的时间范围
    let allTimestamps = [];
    
    if (imuData.gyro) {
      imuData.gyro.forEach(point => {
        allTimestamps.push(point.timestamp);
      });
    }
    if (imuData.accel) {
      imuData.accel.forEach(point => {
        allTimestamps.push(point.timestamp);
      });
    }
    
    if (allTimestamps.length === 0) {
      setChartData([]);
      return;
    }
    
    // 计算数据的时间范围
    const minTimestamp = Math.min(...allTimestamps);
    const maxTimestamp = Math.max(...allTimestamps);
    const dataDuration = maxTimestamp - minTimestamp;
    
    setDataStartTime(minTimestamp);
    setDataEndTime(maxTimestamp);
    setDuration(dataDuration);
    
    console.log(`📊 IMU Data time range: ${minTimestamp} to ${maxTimestamp}, duration: ${dataDuration} seconds`);
    
    // 合并gyro和accel数据，但限制数据点数量
    const uniqueTimestamps = new Set();
    
    // 收集时间戳，但限制数量
    if (imuData.gyro) {
      // 只取每10个点中的1个，减少数据量
      imuData.gyro.forEach((point, index) => {
        if (index % 10 === 0) {
          uniqueTimestamps.add(point.timestamp);
        }
      });
    }
    if (imuData.accel) {
      // 只取每10个点中的1个，减少数据量
      imuData.accel.forEach((point, index) => {
        if (index % 10 === 0) {
          uniqueTimestamps.add(point.timestamp);
        }
      });
    }
    
    // 按时间戳排序
    const sortedTimestamps = Array.from(uniqueTimestamps).sort((a, b) => a - b);
    
    // 进一步限制数据点数量，最多200个点
    const maxPoints = 200;
    const step = Math.max(1, Math.floor(sortedTimestamps.length / maxPoints));
    const sampledTimestamps = [];
    for (let i = 0; i < sortedTimestamps.length; i += step) {
      sampledTimestamps.push(sortedTimestamps[i]);
    }
    
    // 为每个时间戳创建数据点，转换为相对时间
    sampledTimestamps.forEach(timestamp => {
      const relativeTime = timestamp - minTimestamp; // 转换为相对时间
      
      const dataPoint = {
        time: relativeTime, // 使用相对时间
        // Gyro data (车辆坐标系)
        gyro_x: 0,  // Left-Right Gyro
        gyro_y: 0,  // Backward-Forward Gyro  
        gyro_z: 0,  // Vertical Gyro (最重要)
        // Accel data (车辆坐标系)
        accel_x: 0, // Left-Right Acceleration (第二重要)
        accel_y: 0, // Backward-Forward Acceleration (第三重要)
        accel_z: 0  // Vertical Acceleration
      };
      
      // 找到对应的gyro数据
      if (imuData.gyro) {
        const gyroPoint = imuData.gyro.find(p => p.timestamp === timestamp);
        if (gyroPoint) {
          dataPoint.gyro_x = gyroPoint.x; // lr_w
          dataPoint.gyro_y = gyroPoint.y; // bf_w
          dataPoint.gyro_z = gyroPoint.z; // vert_w
        }
      }
      
      // 找到对应的accel数据
      if (imuData.accel) {
        const accelPoint = imuData.accel.find(p => p.timestamp === timestamp);
        if (accelPoint) {
          dataPoint.accel_x = accelPoint.x; // lr_acc
          dataPoint.accel_y = accelPoint.y; // bf_acc
          dataPoint.accel_z = accelPoint.z; // vert_acc
        }
      }
      
      processedData.push(dataPoint);
    });
    
    console.log(`📊 Processed ${processedData.length} data points (reduced from ${sortedTimestamps.length})`);
    setChartData(processedData);
    
    if (processedData.length > 0) {
      setTimeRange({
        min: processedData[0].time,
        max: processedData[processedData.length - 1].time
      });
    }
  }, [imuData]);
  
  // 处理标记开始时间
  const handleMarkStart = () => {
    if (selectedTime !== null) {
      setMarkedStartTime(selectedTime);
      
      // 同步到GPS
      if (onTimeSync) {
        onTimeSync('start', selectedTime);
      }
      
      console.log('IMU Marked start time:', selectedTime);
    }
  };

  // 处理标记结束时间
  const handleMarkEnd = () => {
    if (selectedTime !== null) {
      setMarkedEndTime(selectedTime);
      
      // 同步到GPS
      if (onTimeSync) {
        onTimeSync('end', selectedTime);
      }
      
      console.log('IMU Marked end time:', selectedTime);
    }
  };

  // 保存选中的区域
  const handleSaveSegment = () => {
    if (markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime) {
      onSaveSegment({
        startTime: markedStartTime,
        endTime: markedEndTime,
        mode: 'imu'
      });
      setMarkedStartTime(null);
      setMarkedEndTime(null);
    }
  };

  // 处理时间轴点击
  const handleRulerClick = (e) => {
    if (!rulerRef.current) return;
    
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    const clickedTime = Math.round(clickPercent * duration);
    
    console.log('IMU Timeline clicked:', { clickX, clickPercent, clickedTime });
    
    // 只设置选中的时间点，不直接设置开始或结束时间
    setSelectedTime(clickedTime);
    console.log('IMU Selected time:', clickedTime);
  };
  
  // 格式化时间显示 - 使用相对时间
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 格式化X轴时间显示 - 使用相对时间
  const formatXAxisTime = (timestamp) => {
    // 将时间戳转换为相对时间
    return Math.round(timestamp);
  };

  // 渲染选择区域的高亮显示
  const renderSelectionArea = () => {
    if (markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime) {
      return (
        <ReferenceArea
          x1={markedStartTime}
          x2={markedEndTime}
          fill="rgba(0, 123, 255, 0.2)"
          stroke="rgba(0, 123, 255, 0.8)"
          strokeDasharray="5,5"
        />
      );
    }
    return null;
  };

  // 渲染当前选中时间的垂直指针
  const renderSelectedTimePointer = () => {
    if (selectedTime !== null) {
      return (
        <ReferenceArea
          x1={selectedTime}
          x2={selectedTime}
          fill="rgba(255, 0, 0, 0.8)"
          stroke="rgba(255, 0, 0, 1)"
          strokeWidth={2}
        />
      );
    }
    return null;
  };
  
  if (!imuData || (!imuData.gyro && !imuData.accel)) {
    return (
      <div className="imu-placeholder">
        <div className="placeholder-content">
          <div className="placeholder-icon">📊</div>
          <p>No IMU data available</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="imu-visualization">
      <div className="imu-header">
        <h3>📊 IMU Data Visualization</h3>
        <div className="time-info">
          <span>Duration: {Math.round(duration)}s</span>
          <span>Range: {Math.round(dataStartTime)} - {Math.round(dataEndTime)}</span>
        </div>
      </div>
      
      <div className="imu-charts-container">
        {/* Individual Channel Charts */}
        <div className="channel-chart">
          <h4>🔄 Vertical Gyro (Most Important)</h4>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tickFormatter={formatXAxisTime}
                tickCount={7}
                domain={[0, duration]}
                type="number"
              />
              <YAxis domain={['auto', 'auto']} />
              <Tooltip />
              <Line type="monotone" dataKey="gyro_z" stroke="#e74c3c" strokeWidth={2} dot={false} />
              {renderSelectionArea()}
              {renderSelectedTimePointer()}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="channel-chart">
          <h4>📈 Left-Right Acceleration</h4>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tickFormatter={formatXAxisTime}
                tickCount={7}
                domain={[0, duration]}
                type="number"
              />
              <YAxis domain={['auto', 'auto']} />
              <Tooltip />
              <Line type="monotone" dataKey="accel_x" stroke="#f39c12" strokeWidth={2} dot={false} />
              {renderSelectionArea()}
              {renderSelectedTimePointer()}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="channel-chart">
          <h4>📈 Backward-Forward Acceleration</h4>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tickFormatter={formatXAxisTime}
                tickCount={7}
                domain={[0, duration]}
                type="number"
              />
              <YAxis domain={['auto', 'auto']} />
              <Tooltip />
              <Line type="monotone" dataKey="accel_y" stroke="#27ae60" strokeWidth={2} dot={false} />
              {renderSelectionArea()}
              {renderSelectedTimePointer()}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Video-style Timeline */}
      <div className="timeline-container">
        <div className="timeline-header">
          <h4>⏱️ Time Selection</h4>
          <div className="time-display">
            <span>{formatTime(markedStartTime || 0)}</span>
            <span>/</span>
            <span>{formatTime(markedEndTime || duration)}</span>
          </div>
        </div>

        <div className="progress-container">
          <div 
            ref={rulerRef}
            className="progress-bar"
            onClick={handleRulerClick}
          >
            <div className="progress-fill"></div>
            {selectedTime !== null && (
              <div 
                className="progress-thumb selected-thumb"
                style={{ left: `${(selectedTime / duration) * 100}%` }}
              ></div>
            )}
            {markedStartTime !== null && (
              <div 
                className="progress-thumb start-thumb"
                style={{ left: `${(markedStartTime / duration) * 100}%` }}
              ></div>
            )}
            {markedEndTime !== null && (
              <div 
                className="progress-thumb end-thumb"
                style={{ left: `${(markedEndTime / duration) * 100}%` }}
              ></div>
            )}
            {markedStartTime !== null && markedEndTime !== null && (
              <div 
                className="progress-selection"
                style={{ 
                  left: `${(markedStartTime / duration) * 100}%`,
                  width: `${((markedEndTime - markedStartTime) / duration) * 100}%`
                }}
              ></div>
            )}
          </div>
          
          <div className="timeline-scale">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="scale-mark">
                {Math.round((i * duration) / 6)}s
              </span>
            ))}
          </div>
        </div>
      </div>
      
      {/* Marking Controls */}
      <div className="imu-marking-controls">
        <div className="marking-buttons">
          <button 
            className={`mark-btn ${markedStartTime !== null ? 'marked' : ''}`}
            onClick={handleMarkStart}
            disabled={selectedTime === null}
          >
            🎯 Mark Start {selectedTime !== null && `(${Math.round(selectedTime)}s)`}
          </button>
          <button 
            className={`mark-btn ${markedEndTime !== null ? 'marked' : ''}`}
            onClick={handleMarkEnd}
            disabled={selectedTime === null}
          >
            🎯 Mark End {selectedTime !== null && `(${Math.round(selectedTime)}s)`}
          </button>
          <button 
            className="save-segment-btn"
            onClick={handleSaveSegment}
            disabled={markedStartTime === null || markedEndTime === null || markedStartTime >= markedEndTime}
          >
            💾 Save Segment
          </button>
        </div>
        
        <div className="marking-status">
          {selectedTime !== null && (
            <span className="status-item selected">
              Selected: {formatTime(selectedTime)} ({Math.round(selectedTime)}s)
            </span>
          )}
          {markedStartTime !== null && (
            <span className="status-item">
              Start: {formatTime(markedStartTime)} ({Math.round(markedStartTime)}s)
            </span>
          )}
          {markedEndTime !== null && (
            <span className="status-item">
              End: {formatTime(markedEndTime)} ({Math.round(markedEndTime)}s)
            </span>
          )}
        </div>
      </div>
      
      {/* Saved Segments */}
      {savedSegments.length > 0 && (
        <div className="saved-segments">
          <div className="segments-header">
            <span className="segments-title">📝 Saved Segments ({savedSegments.length})</span>
            <div className="segment-actions">
              <button 
                className="write-back-btn"
                onClick={onWriteBack}
              >
                💾 Write Back
              </button>
              <button 
                className="save-file-btn"
                onClick={onSaveToFile}
              >
                💾 Save File
              </button>
              <button 
                className="crop-data-btn"
                onClick={onCropData}
                disabled={savedSegments.length === 0}
              >
                ✂️ Crop Data
              </button>
            </div>
          </div>
          <div className="segments-list">
            {savedSegments.map((segment) => (
              <div key={segment.id} className="saved-segment-item">
                <div className="segment-info">
                  <span className="segment-video-name">
                    {segment.scenario.org_id || segment.scenario.orgId || 'Unknown'} / 
                    {segment.scenario.key_id || segment.scenario.keyId || 'Unknown'} / 
                    {segment.videoName}
                    <span className="segment-mode"> ({segment.mode})</span>
                  </span>
                  <span className="segment-time-global">
                    {Math.round(segment.startTime)} - {Math.round(segment.endTime)}
                  </span>
                  <span className="segment-time-local">
                    ({formatTime(segment.localStartTime)} - {formatTime(segment.localEndTime)})
                  </span>
                  {segment.description && (
                    <span className="segment-description">
                      📝 {segment.description}
                    </span>
                  )}
                </div>
                <button 
                  className="remove-segment-btn"
                  onClick={() => onRemoveSegment(segment.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImuVisualization; 