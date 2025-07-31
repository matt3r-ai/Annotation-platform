import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// 获取场景列表
export const fetchScenarios = async (queryParams) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/fetch`, queryParams);
    return response.data;
  } catch (error) {
    console.error('Error fetching scenarios:', error);
    throw error;
  }
};

// 保存审核数据
export const saveReviewData = async (reviewData) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/review`, reviewData);
    return response.data;
  } catch (error) {
    console.error('Error saving review data:', error);
    throw error;
  }
};

// 处理场景
export const processScenarios = async (processParams) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/process`, processParams);
    return response.data;
  } catch (error) {
    console.error('Error processing scenarios:', error);
    throw error;
  }
};

// 获取处理状态
export const getProcessingStatus = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/status/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting processing status:', error);
    throw error;
  }
};

// 获取场景列表
export const listScenarios = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/list`);
    return response.data;
  } catch (error) {
    console.error('Error listing scenarios:', error);
    throw error;
  }
};

// 下载视频
export const downloadVideo = async (scenarioId) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/scenarios/download-video/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error downloading video:', error);
    throw error;
  }
};

// 获取视频状态
export const getVideoStatus = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/video-status/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting video status:', error);
    throw error;
  }
};

// 获取视频URL
export const getVideoUrl = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/video-url/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting video URL:', error);
    throw error;
  }
};

// 获取activity时间节点
export const getActivityTimeline = async (scenarioId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/activity-timeline/${scenarioId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting activity timeline:', error);
    throw error;
  }
};

// 测试S3访问
export const testS3Access = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/scenarios/test-s3-access`);
    return response.data;
  } catch (error) {
    console.error('Error testing S3 access:', error);
    throw error;
  }
}; 