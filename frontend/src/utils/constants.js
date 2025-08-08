// API related constants
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

// Data source types
export const DATA_SOURCES = {
  LOCAL: 'local',
  S3: 's3',
};

// Tool types
export const TOOL_TYPES = {
  GPS_VIDEO: 'gps-video',
  OBJECT_DETECTION: 'object-detection',
  EVENT_LABELING: 'event-labeling',
  LANE_DETECTION: 'lane-detection',
};

// File types
export const FILE_TYPES = {
  PARQUET: '.parquet',
  VIDEO: ['.mp4', '.avi', '.mov', '.mkv'],
  IMAGE: ['.jpg', '.jpeg', '.png', '.bmp', '.tiff'],
  AUDIO: ['.wav', '.mp3', '.aac', '.flac'],
};

// Map related constants
export const MAP_CONFIG = {
  DEFAULT_CENTER: [39.9042, 116.4074], // Beijing
  DEFAULT_ZOOM: 13,
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

// UI related constants
export const UI_CONFIG = {
  MAX_SELECTED_POINTS: 2,
  PREVIEW_TIMEOUT: 30000,
  UPLOAD_MAX_SIZE: 100 * 1024 * 1024, // 100MB
};

// Error messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network connection error, please check your connection',
  UPLOAD_ERROR: 'File upload failed, please try again',
  LOAD_ERROR: 'Data loading failed, please try again',
  SAVE_ERROR: 'Save failed, please try again',
  INVALID_FILE: 'File format not supported',
  FILE_TOO_LARGE: 'File size exceeds limit',
}; 