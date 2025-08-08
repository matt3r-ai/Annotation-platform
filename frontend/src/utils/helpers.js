import { FILE_TYPES, UI_CONFIG } from './constants';

/**
 * Validate file type
 * @param {File} file - File object
 * @param {string} type - File type ('video', 'image', 'audio', 'parquet')
 * @returns {boolean} - Whether it's a valid file type
 */
export const validateFileType = (file, type) => {
  const fileName = file.name.toLowerCase();
  
  switch (type) {
    case 'video':
      return FILE_TYPES.VIDEO.some(ext => fileName.endsWith(ext));
    case 'image':
      return FILE_TYPES.IMAGE.some(ext => fileName.endsWith(ext));
    case 'audio':
      return FILE_TYPES.AUDIO.some(ext => fileName.endsWith(ext));
    case 'parquet':
      return fileName.endsWith(FILE_TYPES.PARQUET);
    default:
      return false;
  }
};

/**
 * Validate file size
 * @param {File} file - File object
 * @param {number} maxSize - Maximum file size (bytes)
 * @returns {boolean} - Whether file size is valid
 */
export const validateFileSize = (file, maxSize = UI_CONFIG.UPLOAD_MAX_SIZE) => {
  return file.size <= maxSize;
};

/**
 * Format file size
 * @param {number} bytes - Number of bytes
 * @returns {string} - Formatted file size
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format timestamp
 * @param {number} timestamp - Timestamp
 * @returns {string} - Formatted time
 */
export const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

/**
 * Extract org_id and key_id from file path
 * @param {string} filePath - File path
 * @returns {Object} - Object containing org_id and key_id
 */
export const extractIdsFromPath = (filePath) => {
  const pathParts = filePath.split('/');
  const orgIdIndex = pathParts.findIndex(part => part.includes('org_'));
  const keyIdIndex = pathParts.findIndex(part => part.includes('key_'));
  
  return {
    org_id: orgIdIndex !== -1 ? pathParts[orgIdIndex] : '',
    key_id: keyIdIndex !== -1 ? pathParts[keyIdIndex] : '',
  };
};

/**
 * Calculate distance between two points (meters)
 * @param {Object} point1 - First point {lat, lon}
 * @param {Object} point2 - Second point {lat, lon}
 * @returns {number} - Distance (meters)
 */
export const calculateDistance = (point1, point2) => {
  const R = 6371e3; // Earth radius (meters)
  const φ1 = point1.lat * Math.PI / 180;
  const φ2 = point2.lat * Math.PI / 180;
  const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
  const Δλ = (point2.lon - point1.lon) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time (milliseconds)
 * @returns {Function} - Debounced function
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Limit time (milliseconds)
 * @returns {Function} - Throttled function
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Generate unique ID
 * @returns {string} - Unique ID
 */
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

/**
 * Deep clone object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}; 