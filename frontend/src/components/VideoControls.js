import React, { useState, useRef } from 'react';
import '../styles/VideoControls.css';

const VideoControls = ({
  currentFrame = 0,
  totalFrames = 0,
  isPlaying = false,
  onPlayPause,
  onFrameChange,
  onStepForward,
  onStepBackward,
  onSeek,
  fps = 30
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const progressRef = useRef(null);

  const handleProgressClick = (e) => {
    if (!progressRef.current) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progressWidth = rect.width;
    const progress = clickX / progressWidth;
    const newFrame = Math.round(progress * totalFrames);
    
    onSeek?.(newFrame);
  };

  const handleProgressDrag = (e) => {
    if (!isDragging || !progressRef.current) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progressWidth = rect.width;
    const progress = Math.max(0, Math.min(1, clickX / progressWidth));
    const newFrame = Math.round(progress * totalFrames);
    
    onSeek?.(newFrame);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const formatTime = (frame) => {
    const seconds = Math.floor(frame / fps);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const progress = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;

  return (
    <div className="video-controls">
      <div className="controls-main">
        <button 
          className="control-btn play-btn"
          onClick={onPlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
        
        <button 
          className="control-btn step-btn"
          onClick={onStepBackward}
          title="Previous Frame"
        >
          ⏮️
        </button>
        
        <button 
          className="control-btn step-btn"
          onClick={onStepForward}
          title="Next Frame"
        >
          ⏭️
        </button>
      </div>

      <div className="progress-container">
        <div 
          ref={progressRef}
          className="progress-bar"
          onClick={handleProgressClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleProgressDrag}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div 
            className="progress-fill"
            style={{ width: `${progress}%` }}
          ></div>
          <div 
            className="progress-thumb"
            style={{ left: `${progress}%` }}
          ></div>
        </div>
        
        <div className="time-display">
          <span>{formatTime(currentFrame)}</span>
          <span>/</span>
          <span>{formatTime(totalFrames)}</span>
        </div>
      </div>

      <div className="frame-controls">
        <div className="frame-input-group">
          <label>Frame:</label>
          <input
            type="number"
            value={currentFrame}
            onChange={(e) => {
              const newFrame = parseInt(e.target.value) || 0;
              onSeek?.(Math.max(0, Math.min(totalFrames, newFrame)));
            }}
            min="0"
            max={totalFrames}
            className="frame-input"
          />
          <span>/ {totalFrames}</span>
        </div>
        
        <div className="fps-display">
          <span>{fps} FPS</span>
        </div>
      </div>

      <div className="control-actions">
        <button className="action-btn" title="Save Annotations">
          💾 Save
        </button>
        <button className="action-btn" title="Export Results">
          📤 Export
        </button>
        <button className="action-btn" title="Auto Detect">
          🤖 Auto Detect
        </button>
      </div>
    </div>
  );
};

export default VideoControls; 