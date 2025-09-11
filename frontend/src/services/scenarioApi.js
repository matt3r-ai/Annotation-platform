import axios from 'axios';

// Determine API base URL safely (avoid mixed-content in HTTPS)
const getApiBase = () => {
  // 1) If explicitly set, respect it
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE.replace(/\/$/, '');

  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  // 2) Local dev → use http://localhost:8000
  if (isLocal) return 'http://localhost:8000';

  // 3) Production (HTTPS) → same-origin (empty base) and let Nginx proxy /api
  return '';
};

const API_BASE_URL = getApiBase();

// Get scenario list
export const fetchScenarios = async (queryParams) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/fetch`, queryParams);
    return response.data;
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    throw error;
  }
};

// Save review data
export const saveReviewData = async (reviewData) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/review`, reviewData);
    return response.data;
  } catch (error) {
    console.error('Error saving review data:', error);
    throw error;
  }
};

// Process scenarios
export const processScenarios = async (processParams) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/process`, processParams);
    return response.data;
  } catch (error) {
    console.error('Error processing scenarios:', error);
    throw error;
  }
};

// Get processing status
export const getProcessingStatus = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/status/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting processing status:', error);
    throw error;
  }
};

// Get scenario list
export const listScenarios = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/list`);
    return response.data;
  } catch (error) {
    console.error('Error listing scenarios:', error);
    throw error;
  }
};

// Download video
export const downloadVideo = async (scenarioId) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/download-video/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error downloading video:', error);
    throw error;
  }
};

// Get video status
export const getVideoStatus = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/video-status/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting video status:', error);
    throw error;
  }
};

// Get video URL
export const getVideoUrl = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/video-url/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting video URL:', error);
    throw error;
  }
};

// Get activity timeline
export const getActivityTimeline = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/activity-timeline/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting activity timeline:', error);
    throw error;
  }
};

// Test S3 access
export const testS3Access = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/test-s3-access`);
    return response.data;
  } catch (error) {
    console.error('Error testing S3 access:', error);
    throw error;
  }
};

// Extract IMU data
export const extractImuData = async (scenarioId) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/imu/extract`, {
      scenario_id: scenarioId
    });
    return response.data;
  } catch (error) {
    console.error('Error extracting IMU data:', error);
    throw error;
  }
};

export const cropDataByTimeRange = async (scenarioId, startTime, endTime, dataLinks, scenarioStartTime) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/crop-data`, {
      scenario_id: scenarioId,
      start_time: startTime,
      end_time: endTime,
      data_links: dataLinks,
      scenario_start_time: scenarioStartTime ?? null
    });
    return response.data;
  } catch (error) {
    console.error('Error cropping data:', error);
    throw error;
  }
};

export const cropDataByTimeRanges = async (scenarioId, segments, dataLinks, scenarioStartTime) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/crop-data-multi`, {
      scenario_id: scenarioId,
      segments: segments.map(s => ({ start_time: s.startTime, end_time: s.endTime })),
      data_links: dataLinks,
      scenario_start_time: scenarioStartTime ?? null
    });
    return response.data;
  } catch (error) {
    console.error('Error cropping multi-segment data:', error);
    throw error;
  }
};

export const downloadCroppedData = async (zipFilename) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/download-cropped-data/${zipFilename}`, {
      responseType: 'blob'
    });
    
    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', zipFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    
    return { success: true };
  } catch (error) {
    console.error('Error downloading cropped data:', error);
    throw error;
  }
};

// === Auto description (Gemini/VLM) ===
export const autoDescribeSegment = async (scenarioId, startTime, endTime, context, provider) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/auto-describe`, {
      scenario_id: scenarioId,
      start_time: startTime,
      end_time: endTime,
      context: context || null,
      provider: provider || 'gemini',
    });
    return response.data; // { text }
  } catch (error) {
    console.error('Error auto-describing segment:', error);
    throw error;
  }
};

// Save as NPZ
export const saveSegmentAsNpz = async ({ scenarioId, startTime, endTime, label, description, dataLinks }) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/save-npz`, {
      scenario_id: scenarioId,
      start_time: startTime,
      end_time: endTime,
      label: label || null,
      description: description || null,
      data_links: dataLinks || {},
    }, { responseType: 'blob' });

    // Download
    const disposition = response.headers['content-disposition'] || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : `segment_${scenarioId}.npz`;
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return { success: true };
  } catch (error) {
    console.error('Error saving NPZ:', error);
    throw error;
  }
};

 