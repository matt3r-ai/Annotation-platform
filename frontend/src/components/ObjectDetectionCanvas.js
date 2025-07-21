import React, { useRef, useEffect, useState } from 'react';
import '../styles/ObjectDetectionCanvas.css';

const ObjectDetectionCanvas = ({ 
  videoSrc, 
  detections = [], 
  onDetectionChange,
  currentFrame = 0,
  totalFrames = 0,
  isPlaying = false,
  onFrameChange 
}) => {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentDetections, setCurrentDetections] = useState(detections);

  useEffect(() => {
    setCurrentDetections(detections);
  }, [detections]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = currentFrame / 30; // 假设30fps
    }
  }, [currentFrame]);

  const drawDetections = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!canvas || !ctx) return;

    // 清除画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制检测框
    currentDetections.forEach((detection, index) => {
      const { x, y, width, height, label, confidence, color = '#00ff00' } = detection;
      
      // 绘制边界框
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // 绘制标签背景
      const labelText = `${label} ${(confidence * 100).toFixed(1)}%`;
      const labelWidth = ctx.measureText(labelText).width + 10;
      const labelHeight = 20;
      
      ctx.fillStyle = color;
      ctx.fillRect(x, y - labelHeight, labelWidth, labelHeight);

      // 绘制标签文字
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.fillText(labelText, x + 5, y - 5);
    });
  };

  useEffect(() => {
    drawDetections();
  }, [currentDetections]);

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDrawing(true);
    setStartPoint({ x, y });
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !startPoint) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 清除画布并重新绘制
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawDetections();

    // 绘制当前选择框
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      startPoint.x,
      startPoint.y,
      x - startPoint.x,
      y - startPoint.y
    );
    ctx.setLineDash([]);
  };

  const handleMouseUp = (e) => {
    if (!isDrawing || !startPoint) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newDetection = {
      id: Date.now(),
      x: Math.min(startPoint.x, x),
      y: Math.min(startPoint.y, y),
      width: Math.abs(x - startPoint.x),
      height: Math.abs(y - startPoint.y),
      label: 'object',
      confidence: 1.0,
      color: '#00ff00',
      frame: currentFrame
    };

    const updatedDetections = [...currentDetections, newDetection];
    setCurrentDetections(updatedDetections);
    onDetectionChange?.(updatedDetections);

    setIsDrawing(false);
    setStartPoint(null);
  };

  const handleVideoLoad = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (canvas && video) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
  };

  const handleVideoTimeUpdate = () => {
    if (videoRef.current && onFrameChange) {
      const currentTime = videoRef.current.currentTime;
      const frame = Math.round(currentTime * 30); // 假设30fps
      onFrameChange(frame);
    }
  };

  return (
    <div className="object-detection-canvas">
      <div className="canvas-container">
        <video
          ref={videoRef}
          src={videoSrc}
          onLoadedMetadata={handleVideoLoad}
          onTimeUpdate={handleVideoTimeUpdate}
          muted
          playsInline
          style={{ display: 'none' }}
        />
        <canvas
          ref={canvasRef}
          className="detection-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
      </div>
      
      <div className="canvas-controls">
        <div className="frame-info">
          Frame: {currentFrame} / {totalFrames}
        </div>
        <div className="detection-info">
          Detections: {currentDetections.length}
        </div>
      </div>
    </div>
  );
};

export default ObjectDetectionCanvas; 