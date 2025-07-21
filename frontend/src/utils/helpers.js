import { FILE_TYPES, UI_CONFIG } from './constants';

/**
 * 验证文件类型
 * @param {File} file - 文件对象
 * @param {string} type - 文件类型 ('video', 'image', 'audio', 'parquet')
 * @returns {boolean} - 是否为有效文件类型
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
 * 验证文件大小
 * @param {File} file - 文件对象
 * @param {number} maxSize - 最大文件大小（字节）
 * @returns {boolean} - 文件大小是否有效
 */
export const validateFileSize = (file, maxSize = UI_CONFIG.UPLOAD_MAX_SIZE) => {
  return file.size <= maxSize;
};

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} - 格式化后的文件大小
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * 格式化时间戳
 * @param {number} timestamp - 时间戳
 * @returns {string} - 格式化后的时间
 */
export const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

/**
 * 从文件路径中提取org_id和key_id
 * @param {string} filePath - 文件路径
 * @returns {Object} - 包含org_id和key_id的对象
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
 * 计算两点之间的距离（米）
 * @param {Object} point1 - 第一个点 {lat, lon}
 * @param {Object} point2 - 第二个点 {lat, lon}
 * @returns {number} - 距离（米）
 */
export const calculateDistance = (point1, point2) => {
  const R = 6371e3; // 地球半径（米）
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
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} - 防抖后的函数
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
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} - 节流后的函数
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
 * 生成唯一ID
 * @returns {string} - 唯一ID
 */
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

/**
 * 深拷贝对象
 * @param {Object} obj - 要拷贝的对象
 * @returns {Object} - 拷贝后的对象
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