import React, { useState } from 'react';
import '../styles/DataSourceSelector.css';

const DataSourceSelector = ({
  onDataSourceSelect,
  onLocalFileSelect,
  onS3FileSelect,
  orgIds = [],
  keyIds = [],
  selectedOrgId = '',
  selectedKeyId = '',
  onOrgIdChange,
  onKeyIdChange,
  localFiles = [],
  s3Files = [],
  currentLocalFileIndex = 0,
  currentS3FileIndex = 0,
  onLocalFileChange,
  onS3FileChange
}) => {
  const [dataSource, setDataSource] = useState('local'); // 'local' or 's3'
  const [showFileSelector, setShowFileSelector] = useState(false);

  const handleDataSourceChange = (source) => {
    setDataSource(source);
    onDataSourceSelect?.(source);
  };

  const handleLocalFolderSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.accept = 'video/*,image/*';
    
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      onLocalFileSelect?.(files);
    };
    
    input.click();
  };

  const handleS3FileSelect = (fileIndex) => {
    onS3FileChange?.(fileIndex);
  };

  const handleLocalFileSelect = (fileIndex) => {
    onLocalFileChange?.(fileIndex);
  };

  return (
    <div className="data-source-selector">
      <div className="selector-header">
        <h3>SELECT DATA SOURCE</h3>
      </div>

      <div className="source-options">
        {/* Local Upload Option */}
        <div 
          className={`source-option ${dataSource === 'local' ? 'active' : ''}`}
          onClick={() => handleDataSourceChange('local')}
        >
          <div className="source-icon">📁</div>
          <div className="source-content">
            <h4>LOCAL UPLOAD</h4>
            <p>Upload video files from your local machine</p>
          </div>
        </div>

        {/* S3 Option */}
        <div 
          className={`source-option ${dataSource === 's3' ? 'active' : ''}`}
          onClick={() => handleDataSourceChange('s3')}
        >
          <div className="source-icon">☁️</div>
          <div className="source-content">
            <h4>DIRECT S3 LINK</h4>
            <p>Connect directly to S3 bucket</p>
          </div>
        </div>
      </div>

      {/* Local File Selection */}
      {dataSource === 'local' && (
        <div className="file-selection local-selection">
          <div className="selection-header">
            <h4>Local Files</h4>
            <button 
              className="upload-btn"
              onClick={handleLocalFolderSelect}
            >
              📁 Select Folder
            </button>
          </div>
          
          {localFiles.length > 0 ? (
            <div className="file-list">
              <div className="file-list-header">
                <span>Files ({localFiles.length})</span>
                <div className="file-navigation">
                  <button 
                    className="nav-btn"
                    onClick={() => handleLocalFileSelect(currentLocalFileIndex - 1)}
                    disabled={currentLocalFileIndex <= 0}
                  >
                    ⏮️
                  </button>
                  <span className="file-counter">
                    {currentLocalFileIndex + 1} / {localFiles.length}
                  </span>
                  <button 
                    className="nav-btn"
                    onClick={() => handleLocalFileSelect(currentLocalFileIndex + 1)}
                    disabled={currentLocalFileIndex >= localFiles.length - 1}
                  >
                    ⏭️
                  </button>
                </div>
              </div>
              
              <div className="current-file">
                <span className="file-name">
                  {localFiles[currentLocalFileIndex]?.name || 'No file selected'}
                </span>
                <span className="file-size">
                  {localFiles[currentLocalFileIndex]?.size ? 
                    `${(localFiles[currentLocalFileIndex].size / 1024 / 1024).toFixed(1)} MB` : 
                    ''
                  }
                </span>
              </div>
            </div>
          ) : (
            <div className="no-files">
              <span>📁</span>
              <p>No files selected</p>
              <p>Click "Select Folder" to choose video files</p>
            </div>
          )}
        </div>
      )}

      {/* S3 File Selection */}
      {dataSource === 's3' && (
        <div className="file-selection s3-selection">
          <div className="s3-controls">
            {/* Organization Selection */}
            <div className="select-group">
              <label>Organization:</label>
              <select 
                value={selectedOrgId} 
                onChange={(e) => onOrgIdChange?.(e.target.value)}
                className="select-input"
              >
                <option value="">Select Organization</option>
                {orgIds.map(orgId => (
                  <option key={orgId} value={orgId}>{orgId}</option>
                ))}
              </select>
            </div>

            {/* Key Selection */}
            {selectedOrgId && (
              <div className="select-group">
                <label>Key:</label>
                <select 
                  value={selectedKeyId} 
                  onChange={(e) => onKeyIdChange?.(e.target.value)}
                  className="select-input"
                >
                  <option value="">Select Key</option>
                  {keyIds.map(keyId => (
                    <option key={keyId} value={keyId}>{keyId}</option>
                  ))}
                </select>
              </div>
            )}

            {/* File Selection */}
            {selectedKeyId && s3Files.length > 0 && (
              <div className="file-list">
                <div className="file-list-header">
                  <span>Files ({s3Files.length})</span>
                  <div className="file-navigation">
                    <button 
                      className="nav-btn"
                      onClick={() => handleS3FileSelect(currentS3FileIndex - 1)}
                      disabled={currentS3FileIndex <= 0}
                    >
                      ⏮️
                    </button>
                    <span className="file-counter">
                      {currentS3FileIndex + 1} / {s3Files.length}
                    </span>
                    <button 
                      className="nav-btn"
                      onClick={() => handleS3FileSelect(currentS3FileIndex + 1)}
                      disabled={currentS3FileIndex >= s3Files.length - 1}
                    >
                      ⏭️
                    </button>
                  </div>
                </div>
                
                                 <div className="current-file">
                   <span className="file-name">
                     {s3Files[currentS3FileIndex]?.filename || 'No file selected'}
                   </span>
                   <span className="file-size">
                     {s3Files[currentS3FileIndex]?.size ? 
                       `${(s3Files[currentS3FileIndex].size / 1024 / 1024).toFixed(1)} MB` : 
                       ''
                     }
                   </span>
                   <span className="file-timestamp">
                     {s3Files[currentS3FileIndex]?.timestamp || ''}
                   </span>
                 </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DataSourceSelector; 