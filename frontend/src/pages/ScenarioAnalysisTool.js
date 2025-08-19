import React, { useState, useEffect, useRef } from 'react';
import { fetchScenarios, saveReviewData, getVideoUrl, getActivityTimeline, extractImuData, cropDataByTimeRange, cropDataByTimeRanges, downloadCroppedData } from '../services/scenarioApi';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import FitBoundsOnPoints from '../components/FitBoundsOnPoints';
import ImuVisualization from '../components/ImuVisualization';
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
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days ago
    endDate: new Date().toISOString().split('T')[0] // today
  });
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
  const timelineTrackRef = useRef(null);
  const [eventTooltip, setEventTooltip] = useState({
    visible: false,
    left: 0,
    top: 0,
    type: '',
    time: 0,
    desc: '',
    conf: null
  });

  const showEventTooltip = (activity, e) => {
    const rect = timelineTrackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setEventTooltip({
      visible: true,
      left: Math.max(0, Math.min(e.clientX - rect.left + 12, rect.width - 10)),
      top: Math.max(0, e.clientY - rect.top - 16),
      type: activity.type || 'event',
      time: activity.timestamp || 0,
      desc: activity.description || '',
      conf: typeof activity.confidence === 'number' ? activity.confidence : null
    });
  };

  const moveEventTooltip = (e) => {
    const rect = timelineTrackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setEventTooltip(t => t.visible ? {
      ...t,
      left: Math.max(0, Math.min(e.clientX - rect.left + 12, rect.width - 10)),
      top: Math.max(0, e.clientY - rect.top - 16)
    } : t);
  };

  const hideEventTooltip = () => {
    setEventTooltip(t => ({ ...t, visible: false }));
  };

  const togglePlayPause = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  // New labeling functionality - shared between video, GPS, and IMU modes
  const [markedStartTime, setMarkedStartTime] = useState(null);
  const [markedEndTime, setMarkedEndTime] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [videoStartTimeForSync, setVideoStartTimeForSync] = useState(null); // 用于同步的临时开始时间
  const [savedSegments, setSavedSegments] = useState([]);
  const [allLabeledData, setAllLabeledData] = useState([]);
  const [segmentLabel, setSegmentLabel] = useState('');
  
  // GPS time alignment functionality
  const [gpsStartTime, setGpsStartTime] = useState(null);
  const [gpsEndTime, setGpsEndTime] = useState(null);
  


  // GPS functionality
  const [viewMode, setViewMode] = useState('video'); // 'video', 'gps', or 'imu'
  const [gpsPoints, setGpsPoints] = useState([]);
  const [selectedGpsPoints, setSelectedGpsPoints] = useState([]);
  const [clipResult, setClipResult] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const mapRef = useRef(null);
  
  // IMU functionality
  const [imuData, setImuData] = useState(null);
  const [imuLoading, setImuLoading] = useState(false);
  
  // Cropping functionality
  const [croppingData, setCroppingData] = useState(false);
  const [cropProgress, setCropProgress] = useState('');
  const [cropResult, setCropResult] = useState(null);
  
  // History (local) - store saved CSV snapshots
  const [historyItems, setHistoryItems] = useLocalStorage('scenario_history', []);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [historyDetail, setHistoryDetail] = useState(null);
  
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

  // Scenario navigation helpers
  const getCurrentScenarioIndex = () => {
    if (!currentScenario) return -1;
    return scenarios.findIndex(s => s.id === currentScenario.id);
  };

  const handlePrevScenario = () => {
    const idx = getCurrentScenarioIndex();
    if (idx > 0) {
      handleStartReview(scenarios[idx - 1]);
    }
  };

  const handleNextScenario = () => {
    const idx = getCurrentScenarioIndex();
    if (idx >= 0 && idx < scenarios.length - 1) {
      handleStartReview(scenarios[idx + 1]);
    }
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
        start_date: dateRange.startDate,
        end_date: dateRange.endDate,
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
        
        // 提取IMU数据
        if (scenario.data_links && scenario.data_links.imu) {
          try {
            setImuLoading(true);
            const imuResult = await extractImuData(scenario.id);
            if (imuResult.status === 'success') {
              setImuData(imuResult.imu_data);
              console.log('IMU data loaded:', imuResult.imu_data);
            }
          } catch (imuError) {
            console.error('Error loading IMU data:', imuError);
          } finally {
            setImuLoading(false);
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
        
        // 同步到Video/IMU时间
        const videoTime = convertGpsTimeToVideoTime(point.timestamp);
        if (selectedGpsPoints.length === 0) {
          // 第一个点设为开始时间
          setMarkedStartTime(videoTime);
          setGpsStartTime(point.timestamp);
        } else {
          // 第二个点设为结束时间
          setMarkedEndTime(videoTime);
          setGpsEndTime(point.timestamp);
        }
      }
    } else {
      setSelectedGpsPoints([point]); // 超过2个则重置
      // 重置Video/IMU时间
      setMarkedStartTime(null);
      setMarkedEndTime(null);
      setGpsStartTime(null);
      setGpsEndTime(null);
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
        label: segmentLabel || null,
        startPoint: startPoint,
        endPoint: endPoint
      };
      
      setSavedSegments([...savedSegments, newSegment]);
      
      // 更新annotations
      const scenarioId = currentScenario.id;
      const currentAnnotations = annotations[scenarioId] || [];
      const newAnnotation = {
        id: newSegment.id,
        mode: 'gps',
        startTime: Math.round(startPoint.timestamp),
        endTime: Math.round(endPoint.timestamp),
        localStartTime: relativeStartTime,
        localEndTime: relativeEndTime,
        label: segmentLabel || null,
        startPoint: startPoint,
        endPoint: endPoint,
        timestamp: new Date().toISOString()
      };
      
      setAnnotations({
        ...annotations,
        [scenarioId]: [...currentAnnotations, newAnnotation]
      });
      
      // Reset shared selection state across all channels after saving via GPS
      setMarkedStartTime(null);
      setMarkedEndTime(null);
      setSelectedTime(null);
      setSelectedGpsPoints([]);
      setGpsStartTime(null);
      setGpsEndTime(null);
      setSegmentLabel('');
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
    setVideoStartTimeForSync(currentTime); // 保存开始时间用于同步
    
    // 同步到GPS时间
    const gpsTime = convertVideoTimeToGpsTime(currentTime);
    const nearestGpsPoint = findNearestGpsPoint(currentTime);
    if (nearestGpsPoint) {
      setGpsStartTime(nearestGpsPoint.timestamp);
      // 自动选中对应的GPS点
      setSelectedGpsPoints([nearestGpsPoint]);
    }
    
    console.log('Video marked start time:', currentTime, 'GPS time:', gpsTime, 'Selected GPS point:', nearestGpsPoint);
  };

  const handleMarkEnd = () => {
    setMarkedEndTime(currentTime);
    
    // 同步到GPS时间
    const gpsTime = convertVideoTimeToGpsTime(currentTime);
    const nearestGpsPoint = findNearestGpsPoint(currentTime);
    if (nearestGpsPoint) {
      setGpsEndTime(nearestGpsPoint.timestamp);
      
      // 获取开始时间对应的GPS点 - 使用保存的开始时间
      const startGpsPoint = findNearestGpsPoint(videoStartTimeForSync || 0);
      
      console.log('Mark end debug:', {
        currentTime,
        videoStartTimeForSync,
        startGpsPoint: startGpsPoint?.timestamp,
        endGpsPoint: nearestGpsPoint?.timestamp,
        areDifferent: startGpsPoint && startGpsPoint.timestamp !== nearestGpsPoint.timestamp
      });
      
      // 如果开始和结束是不同的GPS点，则选中两个点
      if (startGpsPoint && startGpsPoint.timestamp !== nearestGpsPoint.timestamp) {
        setSelectedGpsPoints([startGpsPoint, nearestGpsPoint]);
        console.log('Selected two GPS points:', startGpsPoint.timestamp, nearestGpsPoint.timestamp);
      } else {
        setSelectedGpsPoints([nearestGpsPoint]);
        console.log('Selected one GPS point:', nearestGpsPoint.timestamp);
      }
    }
    
    console.log('Video marked end time:', currentTime, 'GPS time:', gpsTime, 'Selected GPS points:', selectedGpsPoints.length);
  };

  const [segmentDescription, setSegmentDescription] = useState('');
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [pendingSegment, setPendingSegment] = useState(null);
  const [annotations, setAnnotations] = useState({}); // 存储每个scenario的标注信息

  const handleSaveSegment = () => {
    if (markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime) {
      setShowDescriptionModal(true);
    }
  };

  const handleSaveSegmentWithDescription = () => {
    if (markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime) {
      // 从scenario对象中获取视频的开始时间
      const videoStartTime = currentScenario.start_time || 0;
      const globalStartTime = videoStartTime + markedStartTime;
      const globalEndTime = videoStartTime + markedEndTime;
      
      const newSegment = {
        id: Date.now(),
        scenarioId: currentScenario.id,
        videoName: currentScenario.video_name || `Scenario_${currentScenario.id}`,
        startTime: Math.round(globalStartTime),
        endTime: Math.round(globalEndTime),
        localStartTime: markedStartTime,
        localEndTime: markedEndTime,
        scenario: currentScenario,
        mode: 'video',
        label: segmentLabel || null,
        description: segmentDescription
      };
      
      setSavedSegments([...savedSegments, newSegment]);
      
      // 更新annotations
      const scenarioId = currentScenario.id;
      const currentAnnotations = annotations[scenarioId] || [];
      const newAnnotation = {
        id: newSegment.id,
        mode: 'video',
        startTime: Math.round(globalStartTime),
        endTime: Math.round(globalEndTime),
        localStartTime: markedStartTime,
        localEndTime: markedEndTime,
        label: segmentLabel || null,
        description: segmentDescription,
        timestamp: new Date().toISOString()
      };
      
      setAnnotations({
        ...annotations,
        [scenarioId]: [...currentAnnotations, newAnnotation]
      });
      
      setMarkedStartTime(null);
      setMarkedEndTime(null);
      setSelectedTime(null);
      setSelectedGpsPoints([]);
      setGpsStartTime(null);
      setGpsEndTime(null);
      setVideoStartTimeForSync(null);
      setSegmentDescription('');
      setSegmentLabel('');
      setShowDescriptionModal(false);
    }
  };

  const handleRemoveSegment = (segmentId) => {
    setSavedSegments(savedSegments.filter(seg => seg.id !== segmentId));
  };

  const generateAnnotationsJson = () => {
    const annotationsData = {};
    
    Object.keys(annotations).forEach(scenarioId => {
      const scenarioAnnotations = annotations[scenarioId];
      if (scenarioAnnotations && scenarioAnnotations.length > 0) {
        annotationsData[scenarioId] = scenarioAnnotations.map(annotation => ({
          id: annotation.id,
          start_time: annotation.startTime,
          end_time: annotation.endTime,
          local_start_time: annotation.localStartTime,
          local_end_time: annotation.localEndTime,
            label: annotation.label || null,
          description: annotation.description || null,
          created_at: annotation.timestamp
        }));
      }
    });
    
    return annotationsData;
  };

  // Write back function
  const writeAnnotationsToDb = async () => {
    const annotationsJson = generateAnnotationsJson();
    if (Object.keys(annotationsJson).length === 0) {
      alert('No annotations to write back. Please create some annotations first.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/scenarios/annotations/write-back', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          annotations: annotationsJson
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        alert(`✅ Successfully wrote back ${result.updated_count} annotations to database!`);
        console.log('Write-back result:', result);
      } else {
        const errorData = await response.json();
        alert(`❌ Failed to write back annotations: ${errorData.detail}`);
        console.error('Write-back error:', errorData);
      }
    } catch (error) {
      alert(`❌ Network error: ${error.message}`);
      console.error('Write-back network error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Cropping function
  const handleCropData = async () => {
    if (!currentScenario || savedSegments.length === 0) {
      alert('Please select a scenario and save at least one segment first.');
      return;
    }

    // Get the first saved segment for cropping (or let user choose)
    const segmentToCrop = savedSegments[0];
    
    if (!segmentToCrop) {
      alert('No segments available for cropping.');
      return;
    }

    try {
      setCroppingData(true);
      setCropProgress('Starting data cropping...');
      
      // Prepare data links from current scenario
      const dataLinks = currentScenario.data_links || {};
      
      console.log('Cropping data links:', dataLinks);
      console.log('Current scenario:', currentScenario);
      
      setCropProgress('Cropping video files...');
      
      // Call single or multi-segment cropping API
      let result;
      if (savedSegments.length > 1) {
        const segments = savedSegments.map(s => ({ startTime: s.startTime, endTime: s.endTime }));
        if (window && window.console) {
          console.log('Cropping multiple segments:', segments);
        }
        result = await cropDataByTimeRanges(
          currentScenario.id,
          segments,
          dataLinks,
          currentScenario.start_time || null
        );
      } else {
        result = await cropDataByTimeRange(
          currentScenario.id,
          segmentToCrop.startTime,
          segmentToCrop.endTime,
          dataLinks,
          currentScenario.start_time || null
        );
      }

      if (result.success) {
        // Normalize files list for UI rendering
        const normalizedFiles = result.files || (result.segment_results ? result.segment_results.flatMap(seg => seg.files || []) : []);
        setCropResult({ ...result, files: normalizedFiles });
        setCropProgress('Cropping completed! Preparing download...');
        
        // Use the zip_filename from backend result
        const zipFilename = result.zip_filename;
        
        if (zipFilename) {
          setCropProgress('Downloading zip file...');
          
          // Download the zip file
          await downloadCroppedData(zipFilename);
          
          setCropProgress('✅ Download completed!');
          const filesForAlert = normalizedFiles || [];
          alert(`✅ Data cropping completed successfully!\n\nFiles processed:\n${filesForAlert.map(f => `- ${f.type}: ${f.video_type || f.imu_type || 'GPS'} (${f.success ? 'Success' : 'Failed'})`).join('\n')}`);
        } else {
          setCropProgress('❌ Could not extract zip filename');
          alert('❌ Cropping completed but could not download file.');
        }
      } else {
        setCropProgress(`❌ Cropping failed: ${result.error || 'Unknown error'}`);
        alert(`❌ Data cropping failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error during cropping:', error);
      setCropProgress(`❌ Error: ${error.message}`);
      alert(`❌ Error during cropping: ${error.message}`);
    } finally {
      setCroppingData(false);
    }
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
        segment_end: segment.endTime,
        label: segment.label || '',
        description: segment.description || ''
      };
      
      console.log('CSV row:', csvRow);
      return csvRow;
    });

    const csvHeaders = [
      'id', 'org_id', 'key_id', 'vin', 'start_time', 'end_time', 
      'data_links', 'data_source_status', 'dmp_status', 'created_at', 
      'updated_at', 'osm_tags', 'interesting', 'segment_start', 'segment_end', 'label', 'description'
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

    // Add to history automatically when saving file
    try {
      const item = {
        id: Date.now(),
        scenarioId: currentScenario?.id || null,
        createdAt: new Date().toISOString(),
        type: 'csv',
        filename: a.download,
        count: savedSegments.length,
        rows: csvData,
      };
      setHistoryItems([item, ...(historyItems || [])].slice(0, 200));
    } catch (e) {
      console.warn('Failed to add history snapshot:', e);
    }
  };

  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get activity icon
  const getActivityIcon = (activityType) => {
    // 所有活动类型都返回空字符串，因为现在用CSS样式显示红色小点
    return '';
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

  // Find nearest GPS point to a given time
  const findNearestGpsPoint = (targetTime) => {
    if (!gpsPoints || gpsPoints.length === 0) return null;
    
    // Convert target time to seconds if it's not already
    const targetSeconds = typeof targetTime === 'number' ? targetTime : parseFloat(targetTime);
    
    // 如果targetTime是相对时间（从0开始），需要转换为绝对时间
    const videoStartTime = currentScenario.start_time || 0;
    const absoluteTargetTime = targetSeconds + videoStartTime;
    
    let nearestPoint = gpsPoints[0];
    let minDistance = Math.abs(nearestPoint.timestamp - absoluteTargetTime);
    
    for (const point of gpsPoints) {
      const distance = Math.abs(point.timestamp - absoluteTargetTime);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    }
    
    console.log('findNearestGpsPoint debug:', {
      targetTime,
      targetSeconds,
      videoStartTime,
      absoluteTargetTime,
      nearestPoint: nearestPoint?.timestamp,
      minDistance
    });
    
    return nearestPoint;
  };

  // Convert GPS time to video/IMU time
  const convertGpsTimeToVideoTime = (gpsTime) => {
    if (!gpsPoints || gpsPoints.length === 0) return gpsTime;
    
    // Find the GPS point with this timestamp
    const gpsPoint = gpsPoints.find(p => p.timestamp === gpsTime);
    if (!gpsPoint) return gpsTime;
    
    // Calculate relative time (assuming first GPS point is at time 0)
    const firstGpsTime = gpsPoints[0].timestamp;
    return gpsPoint.timestamp - firstGpsTime;
  };

  // Convert video/IMU time to GPS time
  const convertVideoTimeToGpsTime = (videoTime) => {
    if (!gpsPoints || gpsPoints.length === 0) return videoTime;
    
    // Find nearest GPS point to this video time
    const nearestPoint = findNearestGpsPoint(videoTime);
    if (!nearestPoint) return videoTime;
    
    return nearestPoint.timestamp;
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
            <div className="form-group date-range-group">
              <label>Date Range:</label>
              <div className="date-inputs-container">
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({
                    ...dateRange,
                    startDate: e.target.value
                  })}
                  max={dateRange.endDate}
                  className="date-input compact"
                  placeholder="Start"
                />
                <span className="date-separator">to</span>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({
                    ...dateRange,
                    endDate: e.target.value
                  })}
                  min={dateRange.startDate}
                  max={new Date().toISOString().split('T')[0]}
                  className="date-input compact"
                  placeholder="End"
                />
              </div>
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
            {/* Navigation between scenarios */}
            {/* Moved navigation below visualizations; keep index badge here only */}
            {/* removed inline index badge at top to avoid duplication */}
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
                onClick={() => {
                  setViewMode('video');
                  // 保持标记状态，因为现在是共享的
                }}
              >
                🎬 Video Mode
              </button>
              <button 
                className={`toggle-btn ${viewMode === 'gps' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('gps');
                  // 保持标记状态，因为现在是共享的
                }}
                disabled={gpsPoints.length === 0}
              >
                🗺️ GPS Mode {gpsPoints.length > 0 && `(${gpsPoints.length} points)`}
              </button>
              <button 
                className={`toggle-btn ${viewMode === 'imu' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('imu');
                  // 保持标记状态，因为现在是共享的
                }}
                disabled={!imuData || (!imuData.gyro && !imuData.accel)}
              >
                📊 IMU Mode {imuData && (imuData.gyro || imuData.accel) && '(Available)'}
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
                  <button
                    className={`play-toggle-btn ${isPlaying ? 'playing' : ''}`}
                    onClick={togglePlayPause}
                    title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  >
                    {isPlaying ? '⏸︎' : '▶︎'}
                  </button>
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
                  <div className="timeline-track" ref={timelineTrackRef}>
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
                        onMouseEnter={(e) => showEventTooltip(activity, e)}
                        onMouseMove={moveEventTooltip}
                        onMouseLeave={hideEventTooltip}
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

                    {eventTooltip.visible && (
                      <div
                        className="floating-tooltip"
                        style={{ left: eventTooltip.left, top: eventTooltip.top }}
                      >
                        <div className="ft-type">{(eventTooltip.type || '').toUpperCase()}</div>
                        <div className="ft-time">{formatTime(eventTooltip.time)}</div>
                        {eventTooltip.conf !== null && (
                          <div className="ft-conf">Conf: {Math.round(eventTooltip.conf * 100)}%</div>
                        )}
                        {eventTooltip.desc && (
                          <div className="ft-desc">{eventTooltip.desc}</div>
                        )}
                      </div>
                    )}
                    
                    {/* IMU Shared Markers */}
                    {markedStartTime !== null && (
                      <div
                        className="imu-marker start-marker"
                        style={{
                          left: videoDuration > 0 ? `${(markedStartTime / videoDuration) * 100}%` : '0%'
                        }}
                        title={`IMU Start: ${formatTime(markedStartTime)}`}
                      ></div>
                    )}
                    {markedEndTime !== null && (
                      <div
                        className="imu-marker end-marker"
                        style={{
                          left: videoDuration > 0 ? `${(markedEndTime / videoDuration) * 100}%` : '0%'
                        }}
                        title={`IMU End: ${formatTime(markedEndTime)}`}
                      ></div>
                    )}
                    {markedStartTime !== null && markedEndTime !== null && markedStartTime < markedEndTime && (
                      <div
                        className="imu-selection-area"
                        style={{
                          left: videoDuration > 0 ? `${(markedStartTime / videoDuration) * 100}%` : '0%',
                          width: videoDuration > 0 ? `${((markedEndTime - markedStartTime) / videoDuration) * 100}%` : '0%'
                        }}
                      ></div>
                    )}
                    
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

                {/* Scenario navigation placed directly below visualizations */}
                {scenarios && scenarios.length > 0 && (() => {
                  const currentIndex = scenarios.findIndex(s => s.id === (currentScenario ? currentScenario.id : null));
                  const total = scenarios.length;
                  return (
                    <div className="scenario-nav" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'center',marginTop:12}}>
                      <button 
                        className="compact-review-btn"
                        onClick={handlePrevScenario}
                        disabled={loading || currentIndex <= 0}
                      >
                        ← Previous
                      </button>
                      <span className="scenario-index">{currentIndex + 1} / {total}</span>
                      <button 
                        className="compact-review-btn"
                        onClick={handleNextScenario}
                        disabled={loading || currentIndex >= total - 1}
                      >
                        Next →
                      </button>
                    </div>
                  );
                })()}
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
                    <select
                      value={segmentLabel || ''}
                      onChange={(e) => setSegmentLabel(e.target.value)}
                      className="label-select"
                    >
                      <option value="">Select label...</option>
                      <option value="left_turn">left turn</option>
                      <option value="right_turn">right turn</option>
                      <option value="left_lane_change">left lane change</option>
                      <option value="right_lane_change">right lane change</option>
                      <option value="u_turn">u-turn</option>
                      <option value="harsh_brake">harsh brake</option>
                      <option value="bump">bump</option>
                    </select>
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
                  
                  {/* Description Modal */}
                  {showDescriptionModal && (
                    <div className="description-modal-overlay">
                      <div className="description-modal">
                        <div className="modal-header">
                          <h3>📝 Add Segment Description</h3>
                          <button 
                            className="close-modal-btn"
                            onClick={() => {
                              setShowDescriptionModal(false);
                              setSegmentDescription('');
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="modal-content">
                          <div className="segment-info-display">
                            <span>Time Range: {formatTime(markedStartTime)} - {formatTime(markedEndTime)}</span>
                            <span>Duration: {formatTime(markedEndTime - markedStartTime)}</span>
                          </div>
                          <div className="description-input-group">
                            <label htmlFor="segment-description">Description:</label>
                            <textarea
                              id="segment-description"
                              value={segmentDescription}
                              onChange={(e) => setSegmentDescription(e.target.value)}
                              placeholder="Enter a description for this segment..."
                              rows="3"
                              className="description-textarea"
                            />
                          </div>
                        </div>
                        <div className="modal-actions">
                          <button 
                            className="cancel-btn"
                            onClick={() => {
                              setShowDescriptionModal(false);
                              setSegmentDescription('');
                            }}
                          >
                            Cancel
                          </button>
                          <button 
                            className="save-btn"
                            onClick={handleSaveSegmentWithDescription}
                            disabled={!segmentDescription.trim()}
                          >
                            Save Segment
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {savedSegments.length > 0 && (
                    <div className="saved-segments">
                      <div className="segments-header">
                        <span className="segments-title">📝 Saved Segments ({savedSegments.length})</span>
                        <div className="segment-actions">
                          <button 
                            className="write-back-btn"
                            onClick={writeAnnotationsToDb}
                            disabled
                            title="Temporarily disabled"
                          >
                            💾 Write Back
                          </button>
                          <button 
                            className="save-file-btn"
                            onClick={handleSaveToFile}
                          >
                            💾 Save File
                          </button>
                  <button 
                    className="save-file-btn"
                    onClick={() => {
                      try {
                        const item = {
                          id: Date.now(),
                          scenarioId: currentScenario?.id || null,
                          createdAt: new Date().toISOString(),
                          type: 'snapshot',
                          title: `Segments x${savedSegments.length}`,
                          rows: savedSegments.map(s => ({
                            id: s.scenario?.id,
                            org_id: s.scenario?.org_id || s.scenario?.orgId || '',
                            key_id: s.scenario?.key_id || s.scenario?.keyId || '',
                            vin: s.scenario?.vin || '',
                            start_time: s.scenario?.start_time || '',
                            end_time: s.scenario?.end_time || '',
                            mode: s.mode,
                            segment_start: s.startTime,
                            segment_end: s.endTime,
                            label: s.label || '',
                            description: s.description || ''
                          }))
                        };
                        setHistoryItems([item, ...(historyItems || [])].slice(0, 200));
                        alert('✅ Added to history');
                      } catch (e) {
                        alert('❌ Failed to add to history');
                      }
                    }}
                  >
                    🕘 Add to History
                  </button>
                          <button 
                            className="crop-data-btn"
                            onClick={handleCropData}
                            disabled={croppingData || savedSegments.length === 0}
                          >
                            {croppingData ? '⏳ Cropping...' : '✂️ Crop Data'}
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
                  
                  {/* Cropping Progress */}
                  {croppingData && (
                    <div className="cropping-progress">
                      <p className="progress-text">{cropProgress}</p>
                    </div>
                  )}
                  
                  {/* Cropping Result */}
                  {cropResult && !croppingData && (
                    <div className="cropping-progress">
                      <p className="progress-text progress-success">
                        ✅ Cropping completed successfully!
                      </p>
                      <p className="progress-text">
                        Files processed: {cropResult.files.filter(f => f.success).length}/{cropResult.files.length}
                      </p>
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
                {/* Scenario navigation below placeholder as well */}
                {scenarios && scenarios.length > 0 && (() => {
                  const currentIndex = scenarios.findIndex(s => s.id === (currentScenario ? currentScenario.id : null));
                  const total = scenarios.length;
                  return (
                    <div className="scenario-nav" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'center',marginTop:12}}>
                      <button className="compact-review-btn" onClick={handlePrevScenario} disabled={loading || currentIndex <= 0}>← Previous</button>
                      <span className="scenario-index">{currentIndex + 1} / {total}</span>
                      <button className="compact-review-btn" onClick={handleNextScenario} disabled={loading || currentIndex >= total - 1}>Next →</button>
                    </div>
                  );
                })()}
              </div>
            )
          ) : viewMode === 'imu' ? (
            // IMU Mode
            imuLoading ? (
              <div className="imu-placeholder">
                <div className="placeholder-content">
                  <div className="placeholder-icon">⏳</div>
                  <p>Loading IMU data...</p>
                </div>
              </div>
            ) : (
              <>
              <ImuVisualization
                imuData={imuData}
                savedSegments={savedSegments}
                onSaveSegment={(segmentData) => {
                  const videoStartTime = currentScenario.start_time || 0;
                  const globalStartTime = videoStartTime + segmentData.startTime;
                  const globalEndTime = videoStartTime + segmentData.endTime;
                  
                  const newSegment = {
                    id: Date.now(),
                    scenarioId: currentScenario.id,
                    videoName: currentScenario.video_name || `Scenario_${currentScenario.id}`,
                    startTime: Math.round(globalStartTime),
                    endTime: Math.round(globalEndTime),
                    localStartTime: segmentData.startTime,
                    localEndTime: segmentData.endTime,
                    scenario: currentScenario,
                    mode: 'imu',
                    label: segmentData.label || segmentLabel || null
                  };
                  
                  setSavedSegments([...savedSegments, newSegment]);
                  
                  // 更新annotations
                  const scenarioId = currentScenario.id;
                  const currentAnnotations = annotations[scenarioId] || [];
                  const newAnnotation = {
                    id: newSegment.id,
                    startTime: newSegment.startTime,
                    endTime: newSegment.endTime,
                    localStartTime: newSegment.localStartTime,
                    localEndTime: newSegment.localEndTime,
                    mode: 'imu',
                    label: newSegment.label || null,
                    timestamp: new Date().toISOString()
                  };
                  
                  setAnnotations({
                    ...annotations,
                    [scenarioId]: [...currentAnnotations, newAnnotation]
                  });

                  // Reset shared selection state across all channels after saving via IMU
                  setMarkedStartTime(null);
                  setMarkedEndTime(null);
                  setSelectedTime(null);
                  setSelectedGpsPoints([]);
                  setGpsStartTime(null);
                  setGpsEndTime(null);
                  setVideoStartTimeForSync(null);
                  setSegmentLabel('');
                }}
                onRemoveSegment={handleRemoveSegment}
                onSaveToFile={handleSaveToFile}
                onWriteBack={writeAnnotationsToDb}
                onCropData={handleCropData}
                segmentLabel={segmentLabel}
                setSegmentLabel={setSegmentLabel}
                markedStartTime={markedStartTime}
                setMarkedStartTime={setMarkedStartTime}
                markedEndTime={markedEndTime}
                setMarkedEndTime={setMarkedEndTime}
                selectedTime={selectedTime}
                setSelectedTime={setSelectedTime}
                renderNavigation={() => {
                  const currentIndex = scenarios.findIndex(s => s.id === (currentScenario ? currentScenario.id : null));
                  const total = scenarios.length;
                  return (
                    <div className="scenario-nav" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'center'}}>
                      <button className="compact-review-btn" onClick={handlePrevScenario} disabled={loading || currentIndex <= 0}>← Previous</button>
                      <span className="scenario-index">{currentIndex + 1} / {total}</span>
                      <button className="compact-review-btn" onClick={handleNextScenario} disabled={loading || currentIndex >= total - 1}>Next →</button>
                    </div>
                  );
                }}
              />
              </>
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
                    {gpsPoints.map((point, idx) => {
                      // 检查这个点是否被选中
                      const isSelected = selectedGpsPoints.find(p => p.timestamp === point.timestamp);
                      const selectedIndex = selectedGpsPoints.findIndex(p => p.timestamp === point.timestamp);
                      
                      // 确定标记的颜色
                      let markerColor = '#95a5a6'; // 默认灰色
                      if (isSelected) {
                        if (selectedIndex === 0) {
                          markerColor = '#e74c3c'; // 红色 - 开始点
                        } else {
                          markerColor = '#3498db'; // 蓝色 - 结束点
                        }
                      }
                      
                      return (
                        <Marker 
                          key={idx} 
                          position={[point.lat, point.lon]} 
                          eventHandlers={{ click: () => handleGpsMarkerClick(point) }}
                          icon={L.divIcon({
                            className: 'custom-marker',
                            html: `<div style="
                              width: 12px; 
                              height: 12px; 
                              background-color: ${markerColor}; 
                              border: 2px solid white; 
                              border-radius: 50%; 
                              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                              cursor: pointer;
                            "></div>`,
                            iconSize: [12, 12],
                            iconAnchor: [6, 6]
                          })}
                        >
                          <Popup>
                            {`Timestamp: ${point.timestamp}`}
                          </Popup>
                        </Marker>
                      );
                    })}
                    <FitBoundsOnPoints points={gpsPoints} />
                  </MapContainer>
                </div>
                {/* GPS navigation */}
                {scenarios && scenarios.length > 0 && (() => {
                  const currentIndex = scenarios.findIndex(s => s.id === (currentScenario ? currentScenario.id : null));
                  const total = scenarios.length;
                  return (
                    <div className="scenario-nav" style={{display:'flex',gap:8,alignItems:'center',justifyContent:'center',marginTop:12}}>
                      <button className="compact-review-btn" onClick={handlePrevScenario} disabled={loading || currentIndex <= 0}>← Previous</button>
                      <span className="scenario-index">{currentIndex + 1} / {total}</span>
                      <button className="compact-review-btn" onClick={handleNextScenario} disabled={loading || currentIndex >= total - 1}>Next →</button>
                    </div>
                  );
                })()}

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
                                  GPS Start: {formatTime(relativeStartTime)} ({Math.round(relativeStartTime)}s)
                                </span>
                                <span className="status-item">
                                  GPS End: {formatTime(relativeEndTime)} ({Math.round(relativeEndTime)}s)
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
                        <div className="segment-actions">
                          <button 
                            className="write-back-btn"
                            onClick={writeAnnotationsToDb}
                            disabled
                            title="Temporarily disabled"
                          >
                            💾 Write Back
                          </button>
                          <button 
                            className="save-file-btn"
                            onClick={handleSaveToFile}
                          >
                            💾 Save File
                          </button>
                  <button 
                    className="save-file-btn"
                    onClick={() => {
                      try {
                        const item = {
                          id: Date.now(),
                          scenarioId: currentScenario?.id || null,
                          createdAt: new Date().toISOString(),
                          type: 'snapshot',
                          title: `Segments x${savedSegments.length}`,
                          rows: savedSegments.map(s => ({
                            id: s.scenario?.id,
                            org_id: s.scenario?.org_id || s.scenario?.orgId || '',
                            key_id: s.scenario?.key_id || s.scenario?.keyId || '',
                            vin: s.scenario?.vin || '',
                            start_time: s.scenario?.start_time || '',
                            end_time: s.scenario?.end_time || '',
                            mode: s.mode,
                            segment_start: s.startTime,
                            segment_end: s.endTime,
                            label: s.label || '',
                            description: s.description || ''
                          }))
                        };
                        setHistoryItems([item, ...(historyItems || [])].slice(0, 200));
                        alert('✅ Added to history');
                      } catch (e) {
                        alert('❌ Failed to add to history');
                      }
                    }}
                  >
                    🕘 Add to History
                  </button>
                          <button 
                            className="crop-data-btn"
                            onClick={handleCropData}
                            disabled={croppingData || savedSegments.length === 0}
                          >
                            {croppingData ? '⏳ Cropping...' : '✂️ Crop Data'}
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
                  
                  {/* Cropping Progress */}
                  {croppingData && (
                    <div className="cropping-progress">
                      <p className="progress-text">{cropProgress}</p>
                    </div>
                  )}
                  
                  {/* Cropping Result */}
                  {cropResult && !croppingData && (
                    <div className="cropping-progress">
                      <p className="progress-text progress-success">
                        ✅ Cropping completed successfully!
                      </p>
                      <p className="progress-text">
                        Files processed: {cropResult.files.filter(f => f.success).length}/{cropResult.files.length}
                      </p>
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

              {/* History Panel */}
              <div className="status-card" style={{ marginTop: '16px' }}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <h4 style={{margin:0}}>History</h4>
                  <div style={{display:'flex',gap:6}}>
                    <button className="compact-btn" onClick={() => setIsHistoryOpen(!isHistoryOpen)}>
                      {isHistoryOpen ? 'Hide' : 'Show'}
                    </button>
                    <button className="compact-btn" onClick={() => {
                      if (window.confirm('Clear all history?')) {
                        setHistoryItems([]);
                      }
                    }}>
                      Clear
                    </button>
                  </div>
                </div>
                {isHistoryOpen && (
                  <div className="history-list" style={{maxHeight: '260px', overflowY: 'auto', marginTop: '8px'}}>
                    {(historyItems || []).length === 0 ? (
                      <div className="status-item">No history yet</div>
                    ) : (
                      (historyItems || []).map((h) => (
                        <div 
                          key={h.id} 
                          className="status-item"
                          style={{cursor:'pointer'}}
                          onClick={() => setHistoryDetail(h)}
                          title="View details"
                        >
                          <span className="status-label">{new Date(h.createdAt).toLocaleString()}</span>
                          <span className="status-value">{h.title || h.filename || `${h.type} (${h.count||0})`}</span>
                          <button 
                            className="remove-segment-btn"
                            style={{marginLeft: 6}}
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryItems((historyItems || []).filter(item => item.id !== h.id));
                            }}
                            title="Delete"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className="main-content">
              {currentStep === 1 && renderStep1()}
              {currentStep === 2 && renderStep2()}
            </div>
            
            {/* History Detail Drawer */}
            {historyDetail && (
              <div className="description-modal-overlay" onClick={() => setHistoryDetail(null)}>
                <div className="description-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>🕘 History Detail</h3>
                    <button 
                      className="close-modal-btn"
                      onClick={() => setHistoryDetail(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="modal-content" style={{maxHeight:'60vh', overflowY:'auto'}}>
                    <div className="segment-info-display" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                      <span>Scenario: {historyDetail.scenarioId ?? '—'}</span>
                      <span>Created: {new Date(historyDetail.createdAt).toLocaleString()}</span>
                      <span>Type: {historyDetail.type}</span>
                      {historyDetail.filename && <span>File: {historyDetail.filename}</span>}
                      {historyDetail.title && <span>Title: {historyDetail.title}</span>}
                    </div>
                    <div style={{marginTop:12}}>
                      {(historyDetail.rows || []).length === 0 ? (
                        <div className="no-points">No rows</div>
                      ) : (
                        <table className="history-table" style={{width:'100%', fontSize:12}}>
                          <thead>
                            <tr>
                              {Object.keys(historyDetail.rows[0]).map((k) => (
                                <th key={k} style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #2b3a44'}}>{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {historyDetail.rows.map((r, idx) => (
                              <tr key={idx}>
                                {Object.keys(historyDetail.rows[0]).map((k) => (
                                  <td key={k} style={{padding:'6px 8px', borderBottom:'1px dashed #2b3a44'}}>
                                    {String(r[k] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  <div className="modal-actions">
                    <button 
                      className="cancel-btn"
                      onClick={() => setHistoryDetail(null)}
                    >
                      Close
                    </button>
                    <button 
                      className="save-btn"
                      onClick={() => {
                        try {
                          const headers = Object.keys((historyDetail.rows || [])[0] || {});
                          const csv = [
                            headers.join(','),
                            ... (historyDetail.rows || []).map(row => headers.map(h => {
                              const v = row[h];
                              return typeof v === 'string' && (v.includes(',') || v.includes('"'))
                                ? `"${v.replace(/"/g, '""')}"`
                                : v;
                            }).join(','))
                          ].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = historyDetail.filename || `history_${historyDetail.id}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          alert('Export failed');
                        }
                      }}
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ScenarioAnalysisTool; 