import React, { useState, useEffect, useRef } from 'react';
import { fetchScenarios, saveReviewData, processScenarios, getVideoUrl, getActivityTimeline } from '../services/scenarioApi';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import FitBoundsOnPoints from '../components/FitBoundsOnPoints';
import L from 'leaflet';
import '../styles/ScenarioAnalysisTool.css';

// Leaflet 图标配置
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

const ScenarioAnalysisTool = () => {
  // Step management
  const [currentStep, setCurrentStep] = useState(1);
  const [dataSource, setDataSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Step 1: Fetch scenarios
  const [eventTypes, setEventTypes] = useState(['fcw', 'harsh-brake']);
  const [newEventType, setNewEventType] = useState('');
  const [daysBack, setDaysBack] = useState(7);
  const [limit, setLimit] = useState(50);
  const [scenarios, setScenarios] = useState([]);
  
  // Pagination and display settings
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [displayMode, setDisplayMode] = useState('list'); // 'list', 'large-grid'

  // Step 2: Review scenarios
  const [currentScenario, setCurrentScenario] = useState(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const [segments, setSegments] = useState([]);
  const [isReviewing, setIsReviewing] = useState(false);
  
  // Video player state
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activities, setActivities] = useState([]);
  const [segmentStart, setSegmentStart] = useState(0);
  const [segmentEnd, setSegmentEnd] = useState(0);
  const videoRef = useRef(null);

  // New labeling functionality - shared between video and GPS modes
  const [markedStartTime, setMarkedStartTime] = useState(null);
  const [markedEndTime, setMarkedEndTime] = useState(null);
  const [savedSegments, setSavedSegments] = useState([]);
  const [allLabeledData, setAllLabeledData] = useState([]);
  


  // GPS functionality
  const [viewMode, setViewMode] = useState('video'); // 'video' or 'gps'
  const [gpsPoints, setGpsPoints] = useState([]);
  const [selectedGpsPoints, setSelectedGpsPoints] = useState([]);
  const [clipResult, setClipResult] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const mapRef = useRef(null);
  
  // 地图缩放控制 - 只有按住Alt键才能缩放
  useEffect(() => {
    // 处理滚轮事件
    const handleWheel = (e) => {
      const mapContainer = e.target.closest('.map-container');
      if (mapContainer) {
        if (e.altKey && mapRef.current) {
          // Alt键按下时，手动控制缩放
          e.preventDefault();
          const delta = e.deltaY > 0 ? -1 : 1;
          const currentZoom = mapRef.current.getZoom();
          const newZoom = Math.max(1, Math.min(18, currentZoom + delta * 0.5));
          mapRef.current.setZoom(newZoom);
        } else if (!e.altKey) {
          // 没有按Alt键时，阻止默认的滚轮缩放
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    
    document.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Step 3: Process scenarios
  const [processingOptions, setProcessingOptions] = useState({
    generateVideos: true,
    extractData: true,
    createVisualizations: true
  });
  const [processingStatus, setProcessingStatus] = useState({});

  // Predefined event types
  const predefinedEventTypes = [
    'fcw', 'harsh-brake', 'lane-departure', 'left-turn', 'right-turn', 
    'u-turn', 'pedestrian-crossing', 'traffic-light', 'stop-sign',
    'yield-sign', 'speed-limit', 'construction-zone', 'school-zone',
    'emergency-vehicle', 'weather-condition', 'road-condition'
  ];

  // Event type display mapping
  const eventTypeDisplay = {
    'fcw': 'Forward Collision Warning',
    'harsh-brake': 'Harsh Braking',
    'lane-departure': 'Lane Departure',
    'left-turn': 'Left Turn',
    'right-turn': 'Right Turn',
    'u-turn': 'U-Turn',
    'pedestrian-crossing': 'Pedestrian Crossing',
    'traffic-light': 'Traffic Light',
    'stop-sign': 'Stop Sign',
    'yield-sign': 'Yield Sign',
    'speed-limit': 'Speed Limit',
    'construction-zone': 'Construction Zone',
    'school-zone': 'School Zone',
    'emergency-vehicle': 'Emergency Vehicle',
    'weather-condition': 'Weather Condition',
    'road-condition': 'Road Condition',
    'unknown': 'Unknown Event'
  };

  // Handle data source selection
  const handleDataSourceSelect = (source) => {
    setDataSource(source);
    setCurrentStep(1);
  };

  // Handle adding new event type
  const handleAddEventType = () => {
    if (newEventType.trim() && !eventTypes.includes(newEventType.trim().toLowerCase())) {
      setEventTypes([...eventTypes, newEventType.trim().toLowerCase()]);
      setNewEventType('');
    }
  };

  // Handle removing event type
  const handleRemoveEventType = (eventType) => {
    setEventTypes(eventTypes.filter(type => type !== eventType));
  };

  // Handle fetching scenarios
  const handleFetchScenarios = async () => {
    setLoading(true);
    setMessage('');
    
    try {
      const query = {
        event_types: eventTypes,
        days_back: daysBack,
        limit: limit
      };
      
      const result = await fetchScenarios(query);
      
      // Process scenarios to improve event type detection
      const processedScenarios = result.scenarios.map(scenario => {
        // Try to determine event type from data_links
        let detectedEventType = scenario.event_type;
        
        if (scenario.data_links && typeof scenario.data_links === 'object') {
          const coremlEvents = scenario.data_links.coreml;
          if (Array.isArray(coremlEvents)) {
            for (const event of coremlEvents) {
              if (event && typeof event === 'object' && event.event) {
                detectedEventType = event.event;
                break;
              }
            }
          }
        }
        
        // If still unknown, try to infer from other data
        if (detectedEventType === 'unknown' || !detectedEventType) {
          // Check if any of our event types are mentioned in the data
          for (const eventType of eventTypes) {
            if (JSON.stringify(scenario.data_links).toLowerCase().includes(eventType.toLowerCase())) {
              detectedEventType = eventType;
              break;
            }
          }
        }
        
        return {
          ...scenario,
          event_type: detectedEventType || 'unknown',
          display_event_type: eventTypeDisplay[detectedEventType] || 'Unknown Event'
        };
      });
      
      setScenarios(processedScenarios);
      setCurrentPage(1); // Reset to first page when new scenarios are fetched
      setMessage(`✅ Successfully fetched ${result.total} scenarios`);
      
    } catch (error) {
      setMessage(`❌ Error fetching scenarios: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle starting review
  const handleStartReview = async (scenario) => {
    setLoading(true);
    setMessage('');
    setVideoError(null);
    setActivities([]);
    setGpsPoints([]);
    setSelectedGpsPoints([]);
    setViewMode('video');
    
    try {
      console.log(`Starting review for scenario ${scenario.id}`);
      
      // 获取视频URL
      const videoResult = await getVideoUrl(scenario.id);
      console.log('Video result:', videoResult);
      
      if (videoResult.status === 'success') {
        setCurrentVideoUrl(videoResult.video_url);
        setCurrentScenario(scenario);
        setSegments([]);
        setIsReviewing(true);
        setCurrentStep(2);
        setMessage(`✅ Started reviewing scenario ${scenario.id}`);
        console.log('Video URL:', videoResult.video_url);
        
        // 获取activity时间节点
        try {
          const activityResult = await getActivityTimeline(scenario.id);
          if (activityResult.status === 'success') {
            setActivities(activityResult.activities);
            console.log('Activities loaded:', activityResult.activities);
          }
        } catch (activityError) {
          console.error('Error loading activities:', activityError);
        }

        // 提取GPS数据
        if (scenario.data_links && scenario.data_links.trip) {
          try {
            const gpsData = await extractGpsData(scenario.data_links);
            if (gpsData && gpsData.length > 0) {
              setGpsPoints(gpsData);
              console.log('GPS data loaded:', gpsData.length, 'points');
            }
          } catch (gpsError) {
            console.error('Error loading GPS data:', gpsError);
          }
        }
      } else {
        setVideoError(videoResult.message);
        setMessage(`❌ Error getting video URL: ${videoResult.message}`);
        console.error('Video error:', videoResult);
      }
    } catch (error) {
      setVideoError(error.message);
      setMessage(`❌ Error starting review: ${error.message}`);
      console.error('Review error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Extract GPS data from data_links
  const extractGpsData = async (dataLinks) => {
    try {
      // 这里需要根据实际的数据结构来提取GPS数据
      // 假设GPS数据在 trip.console_trip 中
      if (dataLinks.trip && dataLinks.trip.console_trip) {
        // 这里需要调用后端API来解析GPS数据
        const response = await fetch('/api/scenarios/gps/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            console_trip_url: dataLinks.trip.console_trip
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          return data.points || [];
        }
      }
      return [];
    } catch (error) {
      console.error('Error extracting GPS data:', error);
      return [];
    }
  };

  // GPS marker click handler
  const handleGpsMarkerClick = (point) => {
    if (selectedGpsPoints.length < 2) {
      // 避免重复选同一个点
      if (!selectedGpsPoints.find(p => p.timestamp === point.timestamp)) {
        setSelectedGpsPoints([...selectedGpsPoints, point]);
      }
    } else {
      setSelectedGpsPoints([point]); // 超过2个则重置
    }
  };

  // GPS mode labeling functions - simplified
  const handleGpsSaveSegment = () => {
    if (selectedGpsPoints.length === 2) {
      // 自动比较时间顺序，小的作为开始，大的作为结束
      const [p1, p2] = selectedGpsPoints;
      const startPoint = p1.timestamp < p2.timestamp ? p1 : p2;
      const endPoint = p1.timestamp < p2.timestamp ? p2 : p1;
      
      // GPS点的timestamp是绝对时间戳，需要计算相对于视频开始时间的偏移量
      const videoStartTime = currentScenario.start_time || 0;
      const relativeStartTime = startPoint.timestamp - videoStartTime;
      const relativeEndTime = endPoint.timestamp - videoStartTime;
      
      console.log('GPS segment:', {
        startPoint: startPoint,
        endPoint: endPoint,
        videoStartTime: videoStartTime,
        relativeStartTime: relativeStartTime,
        relativeEndTime: relativeEndTime
      });
      
      const newSegment = {
        id: Date.now(),
        scenarioId: currentScenario.id,
        videoName: currentScenario.video_name || `Scenario_${currentScenario.id}`,
        startTime: Math.round(startPoint.timestamp),
        endTime: Math.round(endPoint.timestamp),
        localStartTime: relativeStartTime,
        localEndTime: relativeEndTime,
        scenario: currentScenario,
        mode: 'gps',
        startPoint: startPoint,
        endPoint: endPoint
      };
      
      setSavedSegments([...savedSegments, newSegment]);
      setSelectedGpsPoints([]);
    }
  };

  // Preview video based on GPS selection
  const handlePreviewVideo = async () => {
    // 使用选中的GPS点
    if (selectedGpsPoints.length !== 2) {
      setClipResult('Please select exactly 2 points on the map');
      return;
    }
    
    // 自动比较时间顺序，小的作为开始，大的作为结束
    const [p1, p2] = selectedGpsPoints;
    const startPoint = p1.timestamp < p2.timestamp ? p1 : p2;
    const endPoint = p1.timestamp < p2.timestamp ? p2 : p1;
    
    // GPS点的timestamp是绝对时间戳，需要计算相对于视频开始时间的偏移量
    const videoStartTime = currentScenario.start_time || 0;
    const start_ts = startPoint.timestamp - videoStartTime;
    const end_ts = endPoint.timestamp - videoStartTime;
    
    console.log('GPS preview time calculation:', {
      startPoint: startPoint,
      endPoint: endPoint,
      videoStartTime: videoStartTime,
      start_ts: start_ts,
      end_ts: end_ts,
      duration: end_ts - start_ts,
      originalStartTimestamp: startPoint.timestamp,
      originalEndTimestamp: endPoint.timestamp
    });
    
    setClipResult('Preparing preview...');
    
    try {
      const res = await fetch('/api/scenarios/video/clip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scenario_id: currentScenario.id,
          start_ts,
          end_ts,
          preview_mode: true
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          setPreviewData(data);
          setIsPreviewMode(true);
          setClipResult(null);
        } else {
          setClipResult(`Error: ${data.error}`);
        }
      } else {
        setClipResult('Error: Failed to preview video');
      }
    } catch (e) {
      setClipResult('Error: ' + e.message);
    }
  };

  // Save video based on GPS selection
  const handleSaveVideo = async () => {
    if (!previewData) return;
    
    // 使用选中的GPS点
    if (selectedGpsPoints.length !== 2) {
      setClipResult('Please select exactly 2 points on the map');
      return;
    }
    
    // 自动比较时间顺序，小的作为开始，大的作为结束
    const [p1, p2] = selectedGpsPoints;
    const startPoint = p1.timestamp < p2.timestamp ? p1 : p2;
    const endPoint = p1.timestamp < p2.timestamp ? p2 : p1;
    
    // GPS点的timestamp是绝对时间戳，需要计算相对于视频开始时间的偏移量
    const videoStartTime = currentScenario.start_time || 0;
    
    setClipResult('Saving video...');
    try {
      const res = await fetch('/api/scenarios/video/clip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scenario_id: currentScenario.id,
          start_ts: startPoint.timestamp - videoStartTime,
          end_ts: endPoint.timestamp - videoStartTime,
          preview_mode: false
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          setClipResult(`Video saved to: ${data.file}`);
          setPreviewData(null);
          setIsPreviewMode(false);
        } else {
          setClipResult(`Error: ${data.error}`);
        }
      } else {
        setClipResult('Error: Failed to save video');
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

  // Video player controls
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Handle video click to play/pause
  const handleVideoClick = () => {
    handlePlayPause();
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Only handle space key when video is focused or when not typing in input fields
      if (event.code === 'Space' && !event.target.matches('input, textarea')) {
        event.preventDefault(); // Prevent page scrolling
        handlePlayPause();
      }
    };

    // Add event listener to document
    document.addEventListener('keydown', handleKeyPress);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [isPlaying]); // Re-add listener when isPlaying changes

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handlePlaybackRateChange = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  // New labeling functions
  const handleMarkStart = () => {
    setMarkedStartTime(currentTime);
  };

  const handleMarkEnd = () => {
    setMarkedEndTime(currentTime);
  };

  const handleSaveSegment = () => {
    if (markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime) {
      // 从scenario对象中获取视频的开始时间
      const videoStartTime = currentScenario.start_time || 0;
      const globalStartTime = videoStartTime + markedStartTime;
      const globalEndTime = videoStartTime + markedEndTime;
      
      // 调试信息：打印scenario对象的结构
      console.log('Current scenario object:', currentScenario);
      console.log('Video start time:', videoStartTime);
      console.log('Marked times:', { start: markedStartTime, end: markedEndTime });
      console.log('Global times:', { start: globalStartTime, end: globalEndTime });
      
      const newSegment = {
        id: Date.now(),
        scenarioId: currentScenario.id,
        videoName: currentScenario.video_name || `Scenario_${currentScenario.id}`,
        startTime: Math.round(globalStartTime), // 确保是整数
        endTime: Math.round(globalEndTime), // 确保是整数
        localStartTime: markedStartTime,
        localEndTime: markedEndTime,
        scenario: currentScenario,
        mode: 'video'
      };
      
      setSavedSegments([...savedSegments, newSegment]);
      setMarkedStartTime(null);
      setMarkedEndTime(null);
    }
  };

  const handleRemoveSegment = (segmentId) => {
    setSavedSegments(savedSegments.filter(seg => seg.id !== segmentId));
  };

  const handleSaveToFile = () => {
    if (savedSegments.length === 0) {
      alert('No segments to save!');
      return;
    }

    const csvData = savedSegments.map(segment => {
      const scenario = segment.scenario;
      
      // 调试信息：打印每个segment的scenario对象
      console.log('Processing segment:', segment.id);
      console.log('Scenario object:', scenario);
      
      const csvRow = {
        id: scenario.id,
        org_id: scenario.org_id || scenario.orgId || '',
        key_id: scenario.key_id || scenario.keyId || '',
        vin: scenario.vin || '',
        start_time: scenario.start_time || '',
        end_time: scenario.end_time || '',
        data_links: JSON.stringify(scenario.data_links || {}),
        data_source_status: scenario.data_source_status || scenario.dataSourceStatus || '',
        dmp_status: scenario.dmp_status || scenario.dmpStatus || '',
        created_at: scenario.created_at || scenario.createdAt || '',
        updated_at: scenario.updated_at || scenario.updatedAt || '',
        osm_tags: scenario.osm_tags || scenario.osmTags || '',
        interesting: scenario.interesting || '',
        segment_start: segment.startTime,
        segment_end: segment.endTime
      };
      
      console.log('CSV row:', csvRow);
      return csvRow;
    });

    const csvHeaders = [
      'id', 'org_id', 'key_id', 'vin', 'start_time', 'end_time', 
      'data_links', 'data_source_status', 'dmp_status', 'created_at', 
      'updated_at', 'osm_tags', 'interesting', 'segment_start', 'segment_end'
    ];

    const csvContent = [
      csvHeaders.join(','),
      ...csvData.map(row => 
        csvHeaders.map(header => {
          const value = row[header];
          // Escape quotes and wrap in quotes if contains comma or quote
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `labeled_segments_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get activity icon
  const getActivityIcon = (activityType) => {
    const iconMap = {
      'fcw': '⚠️',
      'harsh-brake': '🛑',
      'lane-departure': '🛣️',
      'left-turn': '↶',
      'right-turn': '↷',
      'u-turn': '↻',
      'pedestrian': '🚶',
      'traffic-light': '🚦',
      'stop-sign': '🛑',
      'yield-sign': '⚠️',
      'speed-limit': '🚗',
      'construction-zone': '🚧',
      'school-zone': '🏫',
      'emergency-vehicle': '🚨',
      'weather-condition': '🌧️',
      'road-condition': '🛣️',
      'unknown': '❓'
    };
    return iconMap[activityType] || '❓';
  };

  // Handle processing scenarios
  const handleProcessScenarios = async () => {
    setLoading(true);
    setMessage('');
    
    try {
      const selectedScenarios = scenarios.filter(s => s.selected);
      const result = await processScenarios({
        scenario_ids: selectedScenarios.map(s => s.id),
        ...processingOptions
      });
      
      setProcessingStatus(result);
      setMessage(`✅ Processing started for ${selectedScenarios.length} scenarios`);
      
    } catch (error) {
      setMessage(`❌ Error processing scenarios: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Unknown';
    
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (error) {
      return timestamp;
    }
  };

  // Get event type icon
  const getEventTypeIcon = (eventType) => {
    const iconMap = {
      'fcw': '⚠️',
      'harsh-brake': '🛑',
      'lane-departure': '🛣️',
      'left-turn': '↶',
      'right-turn': '↷',
      'u-turn': '↻',
      'pedestrian-crossing': '🚶',
      'traffic-light': '🚦',
      'stop-sign': '🛑',
      'yield-sign': '⚠️',
      'speed-limit': '🚗',
      'construction-zone': '🚧',
      'school-zone': '🏫',
      'emergency-vehicle': '🚨',
      'weather-condition': '🌧️',
      'road-condition': '🛣️',
      'unknown': '❓'
    };
    return iconMap[eventType] || '❓';
  };

  // Pagination calculations
  const totalPages = Math.ceil(scenarios.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentScenarios = scenarios.slice(startIndex, endIndex);

  // Display mode components
  const renderScenarioCard = (scenario) => (
    <div key={scenario.id} className={`scenario-card ${displayMode}`}>
      <div className="scenario-header">
        <span className="scenario-id">#{scenario.id}</span>
        <span className={`scenario-status ${scenario.status || 'pending'}`}>
          {scenario.status || 'PENDING'}
        </span>
      </div>
      
      <div className="scenario-details">
        <div className="detail-item">
          <span className="detail-label">
            <span className="detail-icon">{getEventTypeIcon(scenario.event_type)}</span>
            Event:
          </span>
          <span className={`detail-value ${scenario.event_type === 'unknown' ? 'unknown-event' : ''}`}>
            {scenario.display_event_type || scenario.event_type}
          </span>
        </div>
        <div className="detail-item">
          <span className="detail-label">
            <span className="detail-icon">🕒</span>
            Time:
          </span>
          <span className="detail-value">{formatTimestamp(scenario.timestamp)}</span>
        </div>
        {scenario.console_trip && (
          <div className="detail-item">
            <span className="detail-label">
              <span className="detail-icon">🗂️</span>
              Trip:
            </span>
            <span className="detail-value trip-path">{scenario.console_trip}</span>
          </div>
        )}
        {scenario.video_url && (
          <div className="detail-item">
            <span className="detail-label">
              <span className="detail-icon">🎬</span>
              Video:
            </span>
            <span className="detail-value available">✅ Available</span>
          </div>
        )}
      </div>
      
      <div className="scenario-actions">
        <button
          className="review-button"
          onClick={() => handleStartReview(scenario)}
          disabled={loading}
        >
          🎬 Review
        </button>
      </div>
    </div>
  );

  const renderScenarioCompact = (scenario) => (
    <div key={scenario.id} className={`scenario-compact ${displayMode}`}>
      <div className="compact-header">
        <span className="compact-id">#{scenario.id}</span>
        <span className="compact-event-icon">{getEventTypeIcon(scenario.event_type)}</span>
        <span className="compact-status">{scenario.status || 'PENDING'}</span>
      </div>
      <div className="compact-info">
        <span className="compact-time">{formatTimestamp(scenario.timestamp)}</span>
        <span className="compact-event">{scenario.display_event_type || scenario.event_type}</span>
      </div>
      <button
        className="compact-review-btn"
        onClick={() => handleStartReview(scenario)}
        disabled={loading}
      >
        Review
      </button>
    </div>
  );

  // Render Step 1: Fetch scenarios
  const renderStep1 = () => (
    <div className="step-content">
      <div className="step-header">
        <h2>🔍 Fetch Scenarios</h2>
        <p className="step-description">Query and retrieve driving scenarios from the database</p>
      </div>
      
      <div className="query-builder">
        <div className="query-section">
          <h3>📊 Query Parameters</h3>
          
          <div className="form-group">
            <label>Event Types:</label>
            <div className="event-types-container">
              <div className="event-types-list">
                {eventTypes.map(type => (
                  <div key={type} className="event-type-tag">
                    <span className="event-type-label">{type.toUpperCase()}</span>
                    <button 
                      className="remove-event-type"
                      onClick={() => handleRemoveEventType(type)}
                      title="Remove event type"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              
              <div className="add-event-type">
                <div className="input-group">
                  <input
                    type="text"
                    value={newEventType}
                    onChange={(e) => setNewEventType(e.target.value)}
                    placeholder="Enter new event type..."
                    className="event-type-input"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleAddEventType();
                      }
                    }}
                  />
                  <button 
                    className="add-event-button"
                    onClick={handleAddEventType}
                    disabled={!newEventType.trim()}
                  >
                    +
                  </button>
                </div>
                
                <div className="predefined-events">
                  <p className="predefined-label">Quick add:</p>
                  <div className="predefined-buttons">
                    {predefinedEventTypes
                      .filter(type => !eventTypes.includes(type))
                      .slice(0, 8) // Show first 8 available
                      .map(type => (
                        <button
                          key={type}
                          className="predefined-event-button"
                          onClick={() => {
                            if (!eventTypes.includes(type)) {
                              setEventTypes([...eventTypes, type]);
                            }
                          }}
                        >
                          {type.replace('-', ' ').toUpperCase()}
                        </button>
                      ))
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Days Back:</label>
              <input
                type="number"
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value))}
                min="1"
                max="30"
                className="number-input"
              />
            </div>
            
            <div className="form-group">
              <label>Limit:</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                min="1"
                max="100"
                className="number-input"
              />
            </div>
          </div>
          
          <button 
            className="primary-button"
            onClick={handleFetchScenarios}
            disabled={loading}
          >
            {loading ? '⏳ Fetching...' : '🚀 Fetch Scenarios'}
          </button>
        </div>
      </div>
      
      {scenarios.length > 0 && (
        <div className="scenario-list">
          <div className="scenarios-header">
            <div className="header-left">
              <h3>📋 Scenarios ({scenarios.length})</h3>
              <p className="scenarios-subtitle">Click "Review" to analyze any scenario</p>
            </div>
            
            <div className="header-controls">
              <div className="display-controls">
                <span className="control-label">Display:</span>
                <div className="display-buttons">
                  <button
                    className={`display-btn ${displayMode === 'list' ? 'active' : ''}`}
                    onClick={() => setDisplayMode('list')}
                    title="List view"
                  >
                    📋
                  </button>
                  <button
                    className={`display-btn ${displayMode === 'large-grid' ? 'active' : ''}`}
                    onClick={() => setDisplayMode('large-grid')}
                    title="Large grid"
                  >
                    🔳
                  </button>
                </div>
              </div>
              
              <div className="pagination-controls">
                <span className="control-label">Per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(parseInt(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="items-per-page-select"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className={`scenario-container ${displayMode}`}>
            {displayMode === 'list' ? (
              <div className="scenario-list-view">
                {currentScenarios.map(scenario => renderScenarioCompact(scenario))}
              </div>
            ) : (
              <div className="scenario-grid large-grid">
                {currentScenarios.map(scenario => renderScenarioCard(scenario))}
              </div>
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                ← Previous
              </button>
              
              <div className="page-numbers">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pageNum = i + 1;
                  return (
                    <button
                      key={pageNum}
                      className={`page-btn ${currentPage === pageNum ? 'active' : ''}`}
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                {totalPages > 5 && (
                  <>
                    {currentPage > 3 && <span className="page-ellipsis">...</span>}
                    <button
                      className={`page-btn ${currentPage === totalPages ? 'active' : ''}`}
                      onClick={() => setCurrentPage(totalPages)}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </div>
              
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Render Step 2: Review scenarios with Video/GPS toggle
  const renderStep2 = () => (
    <div className="review-step">
      <div className="step-header">
        <h2>🎬 Review & Mark Scenarios</h2>
        <p className="step-description">Analyze video content and mark interesting segments</p>
      </div>
      
      {currentScenario && (
        <div className="video-reviewer-container">
          <div className="scenario-info">
            <h3>📹 Reviewing Scenario #{currentScenario.id}</h3>
            <div className="scenario-meta">
              <span className="meta-item">
                <span className="meta-icon">{getEventTypeIcon(currentScenario.event_type)}</span>
                Event: {currentScenario.display_event_type || currentScenario.event_type}
              </span>
              <span className="meta-item">
                <span className="meta-icon">🕒</span>
                Time: {formatTimestamp(currentScenario.timestamp)}
              </span>
            </div>
            
            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button 
                className={`toggle-btn ${viewMode === 'video' ? 'active' : ''}`}
                onClick={() => setViewMode('video')}
              >
                🎬 Video Mode
              </button>
              <button 
                className={`toggle-btn ${viewMode === 'gps' ? 'active' : ''}`}
                onClick={() => setViewMode('gps')}
                disabled={gpsPoints.length === 0}
              >
                🗺️ GPS Mode {gpsPoints.length > 0 && `(${gpsPoints.length} points)`}
              </button>
            </div>
          </div>
          
          {viewMode === 'video' ? (
            // Video Mode
            currentVideoUrl ? (
              <div className="video-player-vertical">
                <div className="video-player">
                  <video 
                    ref={videoRef}
                    controls={false}
                    width="100%" 
                    height="400"
                    src={currentVideoUrl}
                    className="video-element"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onError={(e) => {
                      console.error('Video error:', e);
                      setVideoError('Failed to load video');
                    }}
                    onClick={handleVideoClick}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
                <div className="speed-controls-above-timeline">
                  {[0.5, 1, 2, 3].map(rate => (
                    <button
                      key={rate}
                      className={`speed-btn-above ${playbackRate === rate ? 'active' : ''}`}
                      onClick={() => handlePlaybackRateChange(rate)}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
                <div className="unified-timeline">
                  <div className="timeline-header">
                    <span className="timeline-title">Activity Timeline</span>
                    <span className="timeline-count">{activities.length} activities</span>
                  </div>
                  <div className="timeline-track">
                    <div className="timeline-ticks">
                      {videoDuration > 0 && Array.from({ length: Math.floor(videoDuration / 10) + 1 }, (_, i) => (
                        <div 
                          key={i} 
                          className="timeline-tick"
                          style={{ left: `${(i * 10 / videoDuration) * 100}%` }}
                        >
                          <span className="tick-label">{formatTime(i * 10)}</span>
                        </div>
                      ))}
                    </div>
                    {activities.map((activity, index) => (
                      <div
                        key={index}
                        className="activity-marker"
                        style={{
                          left: videoDuration > 0 ? `${(activity.timestamp / videoDuration) * 100}%` : '0%'
                        }}
                        title={`${activity.type}: ${activity.description} (${formatTime(activity.timestamp)})`}
                        onClick={() => handleSeek(activity.timestamp)}
                      >
                        <span className="activity-icon">{getActivityIcon(activity.type)}</span>
                        <div className="activity-tooltip">
                          <div className="activity-type">{activity.type.toUpperCase()}</div>
                          <div className="activity-time">{formatTime(activity.timestamp)}</div>
                          <div className="activity-confidence">Confidence: {Math.round(activity.confidence * 100)}%</div>
                        </div>
                      </div>
                    ))}
                    <input
                      type="range"
                      min="0"
                      max={videoDuration || 0}
                      value={currentTime}
                      onChange={(e) => {
                        const newTime = parseFloat(e.target.value);
                        setCurrentTime(newTime);
                        if (videoRef.current) {
                          videoRef.current.currentTime = newTime;
                        }
                      }}
                      className="unified-timeline-range"
                    />
                    <div 
                      className="current-time-indicator"
                      style={{
                        left: videoDuration > 0 ? `${(currentTime / videoDuration) * 100}%` : '0%'
                      }}
                    ></div>
                  </div>
                  <div className="time-display-unified">
                    {formatTime(currentTime)} / {formatTime(videoDuration)}
                  </div>
                </div>
                <div className="video-controls-compact">
                  <div className="labeling-controls">
                    <div className="marking-buttons">
                      <button 
                        className={`mark-btn ${markedStartTime !== null ? 'marked' : ''}`}
                        onClick={handleMarkStart}
                      >
                        🎯 Mark Start
                      </button>
                      <button 
                        className={`mark-btn ${markedEndTime !== null ? 'marked' : ''}`}
                        onClick={handleMarkEnd}
                      >
                        🎯 Mark End
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
                  
                  {savedSegments.length > 0 && (
                    <div className="saved-segments">
                      <div className="segments-header">
                        <span className="segments-title">📝 Saved Segments ({savedSegments.length})</span>
                        <button 
                          className="save-file-btn"
                          onClick={handleSaveToFile}
                        >
                          💾 Save File
                        </button>
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
                            </div>
                            <button 
                              className="remove-segment-btn"
                              onClick={() => handleRemoveSegment(segment.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="video-placeholder">
                <div className="placeholder-content">
                  <div className="placeholder-icon">🎬</div>
                  <p>Loading video...</p>
                  {videoError && (
                    <div className="video-error">
                      <p><strong>Error:</strong> {videoError}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            // GPS Mode
            isPreviewMode ? (
              <div className="video-preview-container">
                <div className="video-preview-header">
                  <h3>Video Preview</h3>
                  <button 
                    onClick={handleExitPreview}
                    className="exit-preview-btn"
                  >
                    Exit Preview
                  </button>
                </div>
                <div className="video-player-container">
                  <video
                    ref={videoRef}
                    controls
                    style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                    src={previewData?.preview_url}
                    onLoadedMetadata={() => {
                      if (videoRef.current && previewData) {
                        if (previewData.is_clipped) {
                          // 如果是截取的视频，从0开始播放
                          videoRef.current.currentTime = 0;
                          console.log(`🎬 Playing clipped video from start`);
                        } else {
                          // 如果是原始视频，设置起始时间
                          videoRef.current.currentTime = previewData.clip_start || 0;
                          console.log(`🎬 Set video start time to: ${previewData.clip_start}`);
                        }
                      }
                    }}
                    onTimeUpdate={() => {
                      if (videoRef.current && previewData) {
                        if (previewData.is_clipped) {
                          // 如果是截取的视频，不需要额外的时间控制
                          return;
                        } else {
                          // 如果是原始视频，控制播放范围
                          const currentTime = videoRef.current.currentTime;
                          const endTime = previewData.clip_end || videoRef.current.duration;
                          
                          // 如果播放时间超过了结束时间，暂停视频
                          if (currentTime >= endTime) {
                            videoRef.current.pause();
                            console.log(`⏹️ Video reached end time: ${endTime}`);
                          }
                        }
                      }
                    }}
                  >
                    Your browser does not support the video tag.
                  </video>
                  {previewData && (
                    <div className="video-time-info">
                      {previewData.is_clipped ? (
                        <>
                          <span>🎬 Clipped Video</span>
                          <span>Duration: {formatTime(previewData.clip_duration || 0)}</span>
                        </>
                      ) : (
                        <>
                          <span>Clip Start: {formatTime(previewData.clip_start || 0)}</span>
                          <span>Clip End: {formatTime(previewData.clip_end || 0)}</span>
                          <span>Clip Duration: {formatTime(previewData.clip_duration || 0)}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="video-preview-actions">
                  <button 
                    onClick={handleSaveVideo}
                    className="save-video-btn"
                  >
                    Save Video
                  </button>
                </div>
              </div>
            ) : (
              <div className="gps-container">
                <div className="map-container">
                  <div className="map-zoom-hint">
                  </div>
                  <MapContainer
                    center={[37.7749, -122.4194]}
                    zoom={13}
                    style={{ height: "400px", width: "100%" }}
                    whenCreated={mapInstance => { 
                      mapRef.current = mapInstance; 
                    }}
                    scrollWheelZoom={true}
                    wheelPxPerZoomLevel={1000}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'
                    />
                    {gpsPoints.map((point, idx) => (
                      <Marker 
                        key={idx} 
                        position={[point.lat, point.lon]} 
                        eventHandlers={{ click: () => handleGpsMarkerClick(point) }}
                      >
                        <Popup>
                          {`Timestamp: ${point.timestamp}`}
                        </Popup>
                      </Marker>
                    ))}
                    <FitBoundsOnPoints points={gpsPoints} />
                  </MapContainer>
                </div>
                
                <div className="gps-controls-compact">
                  <div className="gps-labeling-controls">
                    <div className="gps-marking-buttons">
                      <button 
                        className="gps-save-segment-btn"
                        onClick={handleGpsSaveSegment}
                        disabled={selectedGpsPoints.length !== 2}
                      >
                        💾 Save Segment
                      </button>
                      <button 
                        onClick={handlePreviewVideo} 
                        disabled={selectedGpsPoints.length !== 2}
                        className="gps-preview-btn"
                      >
                        🎬 Preview
                      </button>
                    </div>
                    
                    <div className="gps-marking-status">
                      {selectedGpsPoints.length === 2 && (
                        <>
                          {(() => {
                            const [p1, p2] = selectedGpsPoints;
                            const startPoint = p1.timestamp < p2.timestamp ? p1 : p2;
                            const endPoint = p1.timestamp < p2.timestamp ? p2 : p1;
                            const videoStartTime = currentScenario.start_time || 0;
                            const relativeStartTime = startPoint.timestamp - videoStartTime;
                            const relativeEndTime = endPoint.timestamp - videoStartTime;
                            const duration = relativeEndTime - relativeStartTime;
                            
                            return (
                              <>
                                <span className="status-item">
                                  Start: {formatTime(relativeStartTime)} ({Math.round(relativeStartTime)}s)
                                </span>
                                <span className="status-item">
                                  End: {formatTime(relativeEndTime)} ({Math.round(relativeEndTime)}s)
                                </span>
                                <span className="status-item">
                                  Duration: {formatTime(duration)}
                                </span>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="selected-points-compact">
                    <div className="points-header">
                      <span className="points-title">📍 Selected Points</span>
                      <span className="points-count">({selectedGpsPoints.length}/2)</span>
                    </div>
                    {selectedGpsPoints.length === 0 ? (
                      <div className="no-points">
                        <span className="no-points-text">Click on map to select points</span>
                      </div>
                    ) : (
                      <div className="points-list">
                        {selectedGpsPoints.map((p, i) => (
                          <div key={i} className={`point-item ${i === 0 ? 'start' : 'end'}`}>
                            <span className="point-number">#{i + 1}</span>
                            <span className="point-time">{formatTime(p.timestamp - (currentScenario.start_time || 0))}</span>
                            <button 
                              className="remove-point-btn"
                              onClick={() => {
                                const newPoints = selectedGpsPoints.filter((_, idx) => idx !== i);
                                setSelectedGpsPoints(newPoints);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  

                  
                  {clipResult && (
                    <div className="clip-result-compact">
                      {clipResult}
                    </div>
                  )}
                  
                  {savedSegments.length > 0 && (
                    <div className="saved-segments">
                      <div className="segments-header">
                        <span className="segments-title">📝 Saved Segments ({savedSegments.length})</span>
                        <button 
                          className="save-file-btn"
                          onClick={handleSaveToFile}
                        >
                          💾 Save File
                        </button>
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
                            </div>
                            <button 
                              className="remove-segment-btn"
                              onClick={() => handleRemoveSegment(segment.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
      

    </div>
  );

  const renderStep3 = () => (
    <div className="process-step">
      <div className="step-header">
        <h2>⚙️ Process & Extract</h2>
        <p className="step-description">Generate processed data and visualizations</p>
      </div>
      
      <div className="processing-options">
        <h3>🔧 Processing Options</h3>
        <div className="options-grid">
          <label className="option-item">
            <input 
              type="checkbox" 
              checked={processingOptions.generateVideos}
              onChange={(e) => setProcessingOptions({
                ...processingOptions,
                generateVideos: e.target.checked
              })}
            />
            <span className="option-icon">🎬</span>
            <span className="option-text">Generate cropped videos</span>
          </label>
          <label className="option-item">
            <input 
              type="checkbox" 
              checked={processingOptions.extractData}
              onChange={(e) => setProcessingOptions({
                ...processingOptions,
                extractData: e.target.checked
              })}
            />
            <span className="option-icon">📊</span>
            <span className="option-text">Extract trip data</span>
          </label>
          <label className="option-item">
            <input 
              type="checkbox" 
              checked={processingOptions.createVisualizations}
              onChange={(e) => setProcessingOptions({
                ...processingOptions,
                createVisualizations: e.target.checked
              })}
            />
            <span className="option-icon">📈</span>
            <span className="option-text">Create visualizations</span>
          </label>
        </div>
        
        <button 
          className="primary-button"
          onClick={handleProcessScenarios}
          disabled={loading}
        >
          {loading ? '⏳ Processing...' : '🚀 Process Scenarios'}
        </button>
      </div>
      
      <div className="processing-status">
        <h3>📊 Processing Status</h3>
        {processingStatus && (
          <div className="status-content">
            <div className="progress-bar">
              <div className="progress-fill" style={{width: loading ? '60%' : '100%'}}></div>
            </div>
            <div className="status-message">{processingStatus}</div>
          </div>
        )}
      </div>
      
      <div className="results-preview">
        <h3>📋 Results Preview</h3>
        <div className="results-grid">
          <div className="result-placeholder">
            <div className="placeholder-icon">📋</div>
            <p>Results will appear here after processing</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">SCENARIO ANALYSIS TOOL</div>
        <div className="tagline">Keeping drivers safe through AI innovation</div>
      </header>
      
      <div className="App-content">
        {!dataSource ? (
          // 数据源选择页面
          <div className="data-source-selection">
            <div className="selection-container">
              <h2>Select Data Source</h2>
              <div className="selection-options">
                <div className="option-card" onClick={() => handleDataSourceSelect('scenario-analysis')}>
                  <div className="option-icon">🔍</div>
                  <h3>Scenario Analysis</h3>
                  <p>Find and analyze interesting driving scenarios</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="sidebar">
              <h3>Workflow Steps</h3>
              <div className="workflow-steps">
                <div 
                  className={`step ${currentStep === 1 ? 'active' : ''}`}
                  onClick={() => setCurrentStep(1)}
                >
                  <div className="step-icon">🔍</div>
                  <div className="step-title">Fetch & Download</div>
                </div>
                <div 
                  className={`step ${currentStep === 2 ? 'active' : ''}`}
                  onClick={() => setCurrentStep(2)}
                >
                  <div className="step-icon">🎬</div>
                  <div className="step-title">Review & Mark</div>
                </div>
                <div 
                  className={`step ${currentStep === 3 ? 'active' : ''}`}
                  onClick={() => setCurrentStep(3)}
                >
                  <div className="step-icon">⚙️</div>
                  <div className="step-title">Process & Extract</div>
                </div>
              </div>
              
              <div className="status-card">
                <h4>Status</h4>
                <div className="status-item">
                  <span className="status-label">Current Step:</span>
                  <span className="status-value">{currentStep}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Scenarios Found:</span>
                  <span className="status-value">{scenarios.length}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Segments Marked:</span>
                  <span className="status-value">{segments.length}</span>
                </div>
                {message && (
                  <div className="status-item">
                    <span className="status-label">Message:</span>
                    <span className="status-value">{message}</span>
                  </div>
                )}
              </div>
              
              <button 
                className="change-source-button"
                onClick={() => setDataSource(null)}
              >
                Change Data Source
              </button>
            </div>
            
            <div className="main-content">
              {currentStep === 1 && renderStep1()}
              {currentStep === 2 && renderStep2()}
              {currentStep === 3 && renderStep3()}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ScenarioAnalysisTool; 