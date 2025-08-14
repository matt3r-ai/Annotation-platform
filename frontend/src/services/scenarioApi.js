import axios from 'axios';

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

export const cropDataByTimeRange = async (scenarioId, startTime, endTime, dataLinks) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/crop-data`, {
      scenario_id: scenarioId,
      start_time: startTime,
      end_time: endTime,
      data_links: dataLinks
    });
    return response.data;
  } catch (error) {
    console.error('Error cropping data:', error);
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

 