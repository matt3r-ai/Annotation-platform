import React, { useState } from 'react';
import '../styles/DetectionList.css';

const DetectionList = ({ 
  detections = [], 
  onDetectionSelect, 
  onDetectionDelete,
  onDetectionUpdate,
  currentFrame = 0 
}) => {
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [editingLabel, setEditingLabel] = useState(null);

  const handleDetectionClick = (detection) => {
    setSelectedDetection(detection.id);
    onDetectionSelect?.(detection);
  };

  const handleDeleteDetection = (detectionId) => {
    onDetectionDelete?.(detectionId);
    if (selectedDetection === detectionId) {
      setSelectedDetection(null);
    }
  };

  const handleLabelEdit = (detectionId, newLabel) => {
    onDetectionUpdate?.(detectionId, { label: newLabel });
    setEditingLabel(null);
  };

  const handleLabelDoubleClick = (detectionId) => {
    setEditingLabel(detectionId);
  };

  const filteredDetections = detections.filter(d => d.frame === currentFrame);

  return (
    <div className="detection-list">
      <div className="detection-list-header">
        <h3>Detections (Frame {currentFrame})</h3>
        <span className="detection-count">{filteredDetections.length} objects</span>
      </div>
      
      <div className="detection-items">
        {filteredDetections.length === 0 ? (
          <div className="no-detections">
            <span>📷</span>
            <p>No detections in this frame</p>
            <p>Draw a box to add detection</p>
          </div>
        ) : (
          filteredDetections.map((detection) => (
            <div
              key={detection.id}
              className={`detection-item ${selectedDetection === detection.id ? 'selected' : ''}`}
              onClick={() => handleDetectionClick(detection)}
            >
              <div className="detection-color" style={{ backgroundColor: detection.color }}></div>
              
              <div className="detection-content">
                {editingLabel === detection.id ? (
                  <input
                    type="text"
                    value={detection.label}
                    onChange={(e) => onDetectionUpdate?.(detection.id, { label: e.target.value })}
                    onBlur={() => setEditingLabel(null)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleLabelEdit(detection.id, e.target.value);
                      }
                    }}
                    autoFocus
                    className="label-edit-input"
                  />
                ) : (
                  <span 
                    className="detection-label"
                    onDoubleClick={() => handleLabelDoubleClick(detection.id)}
                  >
                    {detection.label}
                  </span>
                )}
                
                <span className="detection-confidence">
                  {(detection.confidence * 100).toFixed(1)}%
                </span>
              </div>
              
              <div className="detection-actions">
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDetection(detection.id);
                  }}
                  title="Delete detection"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="detection-summary">
        <div className="summary-item">
          <span className="summary-label">Total Objects:</span>
          <span className="summary-value">{detections.length}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Current Frame:</span>
          <span className="summary-value">{filteredDetections.length}</span>
        </div>
      </div>
    </div>
  );
};

export default DetectionList; 