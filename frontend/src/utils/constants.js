// API相关常量
export const API_ENDPOINTS = {
  GPS: {
    LOAD: '/api/gps/load',
    CLIP: '/api/video/clip',
  },
  S3: {
    ORGS: '/api/s3/orgs',
    KEYS: '/api/s3/orgs/:orgId/keys',
    FILES: '/api/s3/orgs/:orgId/keys/:keyId/files',
  },
  LOCAL: {
    CLIP: '/api/local/clip',
  },
  DETECTION: {
    UPLOAD: '/api/detection/upload',
    DETECT: '/api/detection/detect',
    SAVE: '/api/detection/save',
    ANNOTATIONS: '/api/detection/annotations',
  },
};

// 数据源类型
export const DATA_SOURCES = {
  LOCAL: 'local',
  S3: 's3',
};

// 工具类型
export const TOOL_TYPES = {
  GPS_VIDEO: 'gps-video',
  OBJECT_DETECTION: 'object-detection',
  EVENT_LABELING: 'event-labeling',
  LANE_DETECTION: 'lane-detection',
};

// 文件类型
export const FILE_TYPES = {
  PARQUET: '.parquet',
  VIDEO: ['.mp4', '.avi', '.mov', '.mkv'],
  IMAGE: ['.jpg', '.jpeg', '.png', '.bmp', '.tiff'],
  AUDIO: ['.wav', '.mp3', '.aac', '.flac'],
};

// 地图相关常量
export const MAP_CONFIG = {
  DEFAULT_CENTER: [39.9042, 116.4074], // 北京
  DEFAULT_ZOOM: 13,
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

// UI相关常量
export const UI_CONFIG = {
  MAX_SELECTED_POINTS: 2,
  PREVIEW_TIMEOUT: 30000,
  UPLOAD_MAX_SIZE: 100 * 1024 * 1024, // 100MB
};

// 错误消息
export const ERROR_MESSAGES = {
  NETWORK_ERROR: '网络连接错误，请检查网络连接',
  UPLOAD_ERROR: '文件上传失败，请重试',
  LOAD_ERROR: '数据加载失败，请重试',
  SAVE_ERROR: '保存失败，请重试',
  INVALID_FILE: '文件格式不支持',
  FILE_TOO_LARGE: '文件大小超过限制',
}; 