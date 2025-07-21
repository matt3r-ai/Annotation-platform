 import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token等
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// GPS相关API
export const gpsAPI = {
  loadData: (params) => apiClient.post('/api/gps/load', params),
  clipVideo: (params) => apiClient.post('/api/video/clip', params),
};

// S3相关API
export const s3API = {
  getOrgs: () => apiClient.get('/api/s3/orgs'),
  getKeys: (orgId) => apiClient.get(`/api/s3/orgs/${orgId}/keys`),
  getFiles: (orgId, keyId) => apiClient.get(`/api/s3/orgs/${orgId}/keys/${keyId}/files`),
};

// S3视频相关API
export const s3VideoAPI = {
  getOrgs: () => apiClient.get('/api/video/orgs'),
  getKeys: (orgId) => apiClient.get(`/api/video/orgs/${orgId}/keys`),
  getFrontVideos: (orgId, keyId) => apiClient.get(`/api/video/orgs/${orgId}/keys/${keyId}/videos`),
  getAllVideos: (orgId, keyId) => apiClient.get(`/api/video/orgs/${orgId}/keys/${keyId}/videos/all`),
  getVideoUrl: (key) => apiClient.get(`/api/video/url/${encodeURIComponent(key)}`),
  downloadVideoToLocal: (key) => apiClient.post('/api/video/download-to-local', { key }),
  extractFrames: ({ s3_key, filename, fps = 3 }) =>
    apiClient.post('/api/video/extract-frames', { s3_key, filename, fps }),
};

// 本地文件相关API
export const localAPI = {
  clipVideo: (params) => apiClient.post('/api/local/clip', params),
};

// Object Detection相关API (为后续功能准备)
export const detectionAPI = {
  uploadImage: (formData) => apiClient.post('/api/detection/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  detectObjects: (params) => apiClient.post('/api/detection/detect', params),
  saveAnnotations: (params) => apiClient.post('/api/detection/save', params),
  getAnnotations: (params) => apiClient.get('/api/detection/annotations', { params }),
};

export default apiClient; 