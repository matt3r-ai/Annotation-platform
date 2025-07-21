import { useState, useCallback } from 'react';
import { ERROR_MESSAGES } from '../utils/constants';

/**
 * 通用API调用hook
 * @param {Function} apiCall - API调用函数
 * @returns {Object} - 包含loading, error, data, execute的状态
 */
export const useApi = (apiCall) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiCall(...args);
      setData(result.data);
      return result.data;
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || ERROR_MESSAGES.NETWORK_ERROR;
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  return { loading, error, data, execute };
};

/**
 * 文件上传hook
 * @returns {Object} - 文件上传相关状态和方法
 */
export const useFileUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const uploadFile = useCallback(async (file, uploadApi) => {
    setUploading(true);
    setUploadProgress(0);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await uploadApi(formData, {
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(progress);
        },
      });
      
      setUploadedFiles(prev => [...prev, response.data]);
      return response.data;
    } catch (error) {
      throw error;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, []);

  const clearUploadedFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  return {
    uploading,
    uploadProgress,
    uploadedFiles,
    uploadFile,
    clearUploadedFiles,
  };
}; 