import axios from 'axios';

// Auto-detect API base URL based on current location
const getApiBase = () => {
  // If environment variable is set, use it
  if (process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE;
  }
  
  // Auto-detect based on current hostname
  const hostname = window.location.hostname;
  const port = window.location.port;
  
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

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Can add authentication token here
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// GPS related API
export const gpsAPI = {
  loadData: (params) => apiClient.post('/api/gps/load', params),
  clipVideo: (params) => apiClient.post('/api/video/clip', params),
};

// S3 related API
export const s3API = {
  getOrgs: () => apiClient.get('/api/s3/orgs'),
  getKeys: (orgId) => apiClient.get(`/api/s3/orgs/${orgId}/keys`),
  getFiles: (orgId, keyId) => apiClient.get(`/api/s3/orgs/${orgId}/keys/${keyId}/files`),
};

// S3 video related API
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

// Local file related API
export const localAPI = {
  clipVideo: (params) => apiClient.post('/api/local/clip', params),
};

// Object Detection related API (prepared for future features)
export const detectionAPI = {
  uploadImage: (formData) => apiClient.post('/api/detection/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  detectObjects: (params) => apiClient.post('/api/detection/detect', params),
  saveAnnotations: (params) => apiClient.post('/api/detection/save', params),
  getAnnotations: (params) => apiClient.get('/api/detection/annotations', { params }),
};

export default apiClient; 