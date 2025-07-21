import React, { useState } from 'react';
import { s3VideoAPI } from '../services/api';

const ObjectDetectionTool = () => {
  const [dataSource, setDataSource] = useState('local');
  const [localFile, setLocalFile] = useState(null);
  const [localVideoUrl, setLocalVideoUrl] = useState('');
  const [orgIds, setOrgIds] = useState([]);
  const [keyIds, setKeyIds] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [s3Videos, setS3Videos] = useState([]);
  const [currentS3VideoIndex, setCurrentS3VideoIndex] = useState(0);
  const [s3VideoUrl, setS3VideoUrl] = useState('');
  const [frameUrls, setFrameUrls] = useState([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  
  // 标注相关状态
  const [boundingBoxes, setBoundingBoxes] = useState({}); // {frameIndex: [boxes]}
  // const [selectedBox, setSelectedBox] = useState(null); // <-- DELETE THIS LINE
  const [labels, setLabels] = useState(['car', 'truck', 'bus', 'person', 'bicycle', 'motorcycle', 'traffic_light', 'stop_sign']);
  const [trackingIds, setTrackingIds] = useState({}); // {boxId: trackingId}
  const [annotations, setAnnotations] = useState({}); // {frameIndex: [{x1,x2,y1,y2,label,trackingId}]}

  // 简化的状态管理
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const [startPoint, setStartPoint] = React.useState(null);
  const [currentBox, setCurrentBox] = React.useState(null);
  const [resizeStartPoint, setResizeStartPoint] = React.useState(null);
  const [originalBox, setOriginalBox] = React.useState(null);

  // --- BOX ANNOTATION CORE LOGIC REWRITE START ---

  // State for boxes, selected box, and interaction mode
  const [boxes, setBoxes] = React.useState([]); // [{id, x, y, w, h}] in image natural coordinates
  const [selectedId, setSelectedId] = React.useState(null);
  const [mode, setMode] = React.useState('idle'); // idle | drawing | moving | resizing
  const [drawStart, setDrawStart] = React.useState(null); // {x, y} in image coords
  const [moveStart, setMoveStart] = React.useState(null); // {x, y, box}
  const [resizeStart, setResizeStart] = React.useState(null); // {x, y, box, handle}

  // --- IMAGE DIMENSION STATE ---
  const [naturalWidth, setNaturalWidth] = React.useState(1280); // default fallback
  const [naturalHeight, setNaturalHeight] = React.useState(720);

  // When frame changes, preload image and set natural size
  React.useEffect(() => {
    if (!frameUrls[currentFrameIndex]) return;
    const img = new window.Image();
    img.onload = () => {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
    };
    img.src = frameUrls[currentFrameIndex];
  }, [frameUrls, currentFrameIndex]);

  // --- getImgInfo now uses canvasRef and state ---
  function getImgInfo() {
    const div = canvasRef.current;
    if (!div) return null;
    const rect = div.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      naturalWidth,
      naturalHeight,
      scaleX: rect.width / naturalWidth,
      scaleY: rect.height / naturalHeight,
    };
  }

  // Mouse event handlers
  function handleImgMouseDown(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = (e.clientX - info.left) / info.scaleX;
    const y = (e.clientY - info.top) / info.scaleY;
    // Check if on handle
    if (selectedId) {
      const sel = boxes.find(b => b.id === selectedId);
      if (sel) {
        const handle = getHandleAtPoint(sel, x, y);
        if (handle) {
          setMode('resizing');
          setResizeStart({ x, y, box: { ...sel }, handle });
          return;
        }
        // Check if inside box for moving
        if (pointInBox(sel, x, y)) {
          setMode('moving');
          setMoveStart({ x, y, box: { ...sel } });
          return;
        }
      }
    }
    // Otherwise, start drawing new box
    setMode('drawing');
    setDrawStart({ x, y });
  }

  function handleImgMouseMove(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = (e.clientX - info.left) / info.scaleX;
    const y = (e.clientY - info.top) / info.scaleY;
    if (mode === 'drawing' && drawStart) {
      // Preview box
      const newBox = {
        id: 'preview',
        x: Math.min(drawStart.x, x),
        y: Math.min(drawStart.y, y),
        w: Math.abs(drawStart.x - x),
        h: Math.abs(drawStart.y - y),
      };
      setBoxes(bs => bs.filter(b => b.id !== 'preview').concat(newBox));
    } else if (mode === 'moving' && moveStart) {
      const dx = x - moveStart.x;
      const dy = y - moveStart.y;
      setBoxes(bs => bs.map(b =>
        b.id === selectedId
          ? { ...b, x: clamp(moveStart.box.x + dx, 0, info.naturalWidth - b.w), y: clamp(moveStart.box.y + dy, 0, info.naturalHeight - b.h) }
          : b
      ));
    } else if (mode === 'resizing' && resizeStart) {
      setBoxes(bs => bs.map(b =>
        b.id === selectedId
          ? resizeBox(resizeStart.box, resizeStart.handle, x - resizeStart.x, y - resizeStart.y, info.naturalWidth, info.naturalHeight)
          : b
      ));
    }
  }

  function handleImgMouseUp(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = (e.clientX - info.left) / info.scaleX;
    const y = (e.clientY - info.top) / info.scaleY;
    if (mode === 'drawing' && drawStart) {
      const w = Math.abs(drawStart.x - x);
      const h = Math.abs(drawStart.y - y);
      if (w > 5 && h > 5) {
        const newBox = {
          id: Date.now().toString(),
          x: Math.min(drawStart.x, x),
          y: Math.min(drawStart.y, y),
          w,
          h,
        };
        setBoxes(bs => bs.filter(b => b.id !== 'preview').concat(newBox));
        setSelectedId(newBox.id);
      } else {
        setBoxes(bs => bs.filter(b => b.id !== 'preview'));
      }
    }
    setMode('idle');
    setDrawStart(null);
    setMoveStart(null);
    setResizeStart(null);
  }

  function handleImgDoubleClick(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = (e.clientX - info.left) / info.scaleX;
    const y = (e.clientY - info.top) / info.scaleY;
    // Select box if clicked inside
    const found = boxes.find(b => pointInBox(b, x, y));
    if (found) setSelectedId(found.id);
  }

  // --- Box/Handle helpers ---
  function pointInBox(box, x, y) {
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }
  function getHandleAtPoint(box, x, y) {
    const handles = getHandles(box);
    for (const h of handles) {
      const hx = h.x, hy = h.y;
      if (Math.abs(x - hx) < 8 && Math.abs(y - hy) < 8) return h.name;
    }
    return null;
  }
  function getHandles(box) {
    const { x, y, w, h } = box;
    return [
      { name: 'nw', x, y },
      { name: 'n', x: x + w / 2, y },
      { name: 'ne', x: x + w, y },
      { name: 'e', x: x + w, y: y + h / 2 },
      { name: 'se', x: x + w, y: y + h },
      { name: 's', x: x + w / 2, y: y + h },
      { name: 'sw', x, y: y + h },
      { name: 'w', x, y: y + h / 2 },
    ];
  }
  function resizeBox(box, handle, dx, dy, maxW, maxH) {
    let { x, y, w, h } = box;
    switch (handle) {
      case 'nw': x += dx; y += dy; w -= dx; h -= dy; break;
      case 'n': y += dy; h -= dy; break;
      case 'ne': w += dx; y += dy; h -= dy; break;
      case 'e': w += dx; break;
      case 'se': w += dx; h += dy; break;
      case 's': h += dy; break;
      case 'sw': x += dx; w -= dx; h += dy; break;
      case 'w': x += dx; w -= dx; break;
      default: break;
    }
    // Clamp
    if (w < 10) { x = box.x + box.w - 10; w = 10; }
    if (h < 10) { y = box.y + box.h - 10; h = 10; }
    x = clamp(x, 0, maxW - w); y = clamp(y, 0, maxH - h);
    w = Math.min(w, maxW - x); h = Math.min(h, maxH - y);
    return { ...box, x, y, w, h };
  }
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  // --- BOX ANNOTATION CORE LOGIC REWRITE END ---

  // --- Add single-click select and delete functionality ---

  // 1. Add click handler to select box
  function handleCanvasClick(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = (e.clientX - info.left) / info.scaleX;
    const y = (e.clientY - info.top) / info.scaleY;
    // Find topmost box under mouse
    const found = [...boxes].reverse().find(b => pointInBox(b, x, y));
    if (found) {
      setSelectedId(found.id);
    } else {
      setSelectedId(null);
    }
  }

  // 2. Add delete function
  function handleDeleteSelectedBox() {
    if (!selectedId) return;
    setBoxes(bs => bs.filter(b => b.id !== selectedId));
    setSelectedId(null);
  }

  // 3. In the annotation canvas div, add onClick
  // <div ... onClick={handleCanvasClick} ...>

  // 4. In the annotation panel, add a delete button when a box is selected
  // {selectedId && (
  //   <button onClick={handleDeleteSelectedBox} style={{ ... }}>Delete Selected Box</button>
  // )}

  React.useEffect(() => {
    if (dataSource === 's3') {
      const loadOrgIds = async () => {
        try {
          const response = await s3VideoAPI.getOrgs();
          setOrgIds(response.data.org_ids || []);
        } catch (error) {
          setOrgIds([]);
        }
      };
      loadOrgIds();
    }
  }, [dataSource]);

  // 全局鼠标事件处理，确保绘制状态正确重置
  React.useEffect(() => {
    const handleGlobalMouseUp = (e) => {
      console.log('全局 MouseUp 触发'); // 调试日志
      if (isDrawing) {
        console.log('全局 MouseUp 重置绘制状态'); // 调试日志
        // 如果有当前框，尝试保存
        if (currentBox && startPoint) {
          const width = Math.abs(currentBox.x2 - currentBox.x1);
          const height = Math.abs(currentBox.y2 - currentBox.y1);
          
          if (width > 5 && height > 5) {
            const newBox = { ...currentBox, id: Date.now() };
            console.log('全局 MouseUp 保存框:', newBox); // 调试日志
            
            setBoundingBoxes(prev => ({
              ...prev,
              [currentFrameIndex]: [...(prev[currentFrameIndex] || []), newBox]
            }));
            setSelectedId(newBox.id);
          }
        }
        setIsDrawing(false);
        setStartPoint(null);
        setCurrentBox(null);
      }
      
      // 结束调整大小
      if (isResizing) {
        console.log('全局 MouseUp 结束调整大小');
        setIsResizing(false);
        setResizeStartPoint(null);
        setOriginalBox(null);
      }
    };

    const handleGlobalMouseMove = (e) => {
      if (isDrawing && startPoint) {
        // 如果鼠标移出图片区域，停止绘制
        const imageElement = document.querySelector('img[src*="frame"]');
        if (imageElement) {
          const rect = imageElement.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || 
              e.clientY < rect.top || e.clientY > rect.bottom) {
            console.log('鼠标移出图片区域，停止绘制'); // 调试日志
            setIsDrawing(false);
            setStartPoint(null);
            setCurrentBox(null);
          }
        }
      }
      
      // 如果鼠标移出图片区域，停止调整
      if (isResizing && selectedId) {
        const imageElement = document.querySelector('img[src*="frame"]');
        if (imageElement) {
          const rect = imageElement.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || 
              e.clientY < rect.top || e.clientY > rect.bottom) {
            console.log('鼠标移出图片区域，停止调整'); // 调试日志
            setIsResizing(false);
            setResizeStartPoint(null);
            setOriginalBox(null);
          }
        }
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    document.addEventListener('mousemove', handleGlobalMouseMove);

    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [isDrawing, startPoint, currentBox, currentFrameIndex, isResizing, selectedId]);

  const handleOrgIdChange = async (orgId) => {
    setSelectedOrgId(orgId);
    setSelectedKeyId('');
    setKeyIds([]);
    setS3Videos([]);
    setS3VideoUrl('');
    if (orgId) {
      try {
        const response = await s3VideoAPI.getKeys(orgId);
        setKeyIds(response.data.key_ids || []);
      } catch (error) {
        setKeyIds([]);
      }
    }
  };

  const handleKeyIdChange = async (keyId) => {
    setSelectedKeyId(keyId);
    setS3Videos([]);
    setS3VideoUrl('');
    if (keyId) {
      try {
        const response = await s3VideoAPI.getFrontVideos(selectedOrgId, keyId);
        setS3Videos(response.data.videos || []);
        if (response.data.videos && response.data.videos.length > 0) {
          setCurrentS3VideoIndex(0);
          loadS3Video(response.data.videos[0]);
        }
      } catch (error) {
        setS3Videos([]);
      }
    }
  };

  // 修改loadS3Video为抽帧
  const loadS3Video = async (videoInfo) => {
    if (!videoInfo.key || !videoInfo.filename) {
      alert('Please select a complete video file');
      return;
    }
    try {
      setFrameUrls([]);
      setCurrentFrameIndex(0);
      const response = await s3VideoAPI.extractFrames({
        s3_key: videoInfo.key,
        filename: videoInfo.filename,
        fps: 3,
      });
      if (response.data.frames && response.data.frames.length > 0) {
        setFrameUrls(response.data.frames);
        console.log(`Loaded ${response.data.frames.length} frames`); // 调试日志
      }
    } catch (error) {
      setFrameUrls([]);
      console.error('Frame extraction error:', error);
    }
  };

  const handleNextVideo = () => {
    if (currentS3VideoIndex < s3Videos.length - 1) {
      const nextIndex = currentS3VideoIndex + 1;
      setCurrentS3VideoIndex(nextIndex);
      loadS3Video(s3Videos[nextIndex]);
    }
  };
  const handlePrevVideo = () => {
    if (currentS3VideoIndex > 0) {
      const prevIndex = currentS3VideoIndex - 1;
      setCurrentS3VideoIndex(prevIndex);
      loadS3Video(s3Videos[prevIndex]);
    }
  };

  const handleLocalFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'video/mp4') {
      setLocalFile(file);
      setLocalVideoUrl(URL.createObjectURL(file));
    } else {
      setLocalFile(null);
      setLocalVideoUrl('');
      alert('Please select a .mp4 video file.');
    }
  };

  // 标注相关函数
  // 简化的鼠标事件处理
  const handleMouseDown = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 获取图片的实际显示尺寸
    const img = e.target;
    const imgRect = img.getBoundingClientRect();
    const imgNaturalWidth = img.naturalWidth;
    const imgNaturalHeight = img.naturalHeight;
    const imgDisplayWidth = imgRect.width;
    const imgDisplayHeight = imgRect.height;
    
    // 计算缩放比例
    const scaleX = imgNaturalWidth / imgDisplayWidth;
    const scaleY = imgNaturalHeight / imgDisplayHeight;
    
    // 将鼠标坐标转换为图片坐标系
    const imgX = x * scaleX;
    const imgY = y * scaleY;
    
    // 检查是否点击了现有框
    const clickedBox = (boundingBoxes[currentFrameIndex] || []).find(box => {
      return imgX >= box.x1 && imgX <= box.x2 && imgY >= box.y1 && imgY <= box.y2;
    });
    
    if (clickedBox) {
      // 开始调整大小 - 无论点击框的哪个位置
      setIsResizing(true);
      setSelectedId(clickedBox.id);
      setResizeStartPoint({ x: e.clientX, y: e.clientY });
      setOriginalBox({ ...clickedBox });
      return;
    }
    
    // 开始绘制新框
    setIsDrawing(true);
    setStartPoint({ x: imgX, y: imgY });
    setCurrentBox({ x1: imgX, y1: imgY, x2: imgX, y2: imgY });
  };

  const handleMouseMove = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 获取图片的实际显示尺寸
    const img = e.target;
    const imgRect = img.getBoundingClientRect();
    const imgNaturalWidth = img.naturalWidth;
    const imgNaturalHeight = img.naturalHeight;
    const imgDisplayWidth = imgRect.width;
    const imgDisplayHeight = imgRect.height;
    
    // 计算缩放比例
    const scaleX = imgNaturalWidth / imgDisplayWidth;
    const scaleY = imgNaturalHeight / imgDisplayHeight;
    
    // 将鼠标坐标转换为图片坐标系
    const imgX = x * scaleX;
    const imgY = y * scaleY;
    
    // 处理绘制新框
    if (isDrawing && startPoint) {
      setCurrentBox({
        x1: Math.min(startPoint.x, imgX),
        y1: Math.min(startPoint.y, imgY),
        x2: Math.max(startPoint.x, imgX),
        y2: Math.max(startPoint.y, imgY)
      });
    }
    
    // 处理调整大小 - 实时响应鼠标位置
    if (isResizing && selectedId && resizeStartPoint && originalBox) {
      const deltaX = e.clientX - resizeStartPoint.x;
      const deltaY = e.clientY - resizeStartPoint.y;
      
      let updatedBox = { ...originalBox };
      
      // 根据鼠标在框内的相对位置来决定调整方式
      const boxWidth = originalBox.x2 - originalBox.x1;
      const boxHeight = originalBox.y2 - originalBox.y1;
      const mouseXInBox = (imgX - originalBox.x1) / boxWidth;
      const mouseYInBox = (imgY - originalBox.y1) / boxHeight;
      
      // 根据鼠标在框内的位置调整框的大小
      if (mouseXInBox < 0.5) {
        // 鼠标在左半边，调整左边界
        updatedBox.x1 = originalBox.x1 + (deltaX * scaleX);
      } else {
        // 鼠标在右半边，调整右边界
        updatedBox.x2 = originalBox.x2 + (deltaX * scaleX);
      }
      
      if (mouseYInBox < 0.5) {
        // 鼠标在上半边，调整上边界
        updatedBox.y1 = originalBox.y1 + (deltaY * scaleY);
      } else {
        // 鼠标在下半边，调整下边界
        updatedBox.y2 = originalBox.y2 + (deltaY * scaleY);
      }
      
      // 边界检查
      const minSize = 10;
      const maxX = imgNaturalWidth;
      const maxY = imgNaturalHeight;
      
      if (updatedBox.x2 - updatedBox.x1 < minSize) {
        if (mouseXInBox < 0.5) updatedBox.x1 = updatedBox.x2 - minSize;
        else updatedBox.x2 = updatedBox.x1 + minSize;
      }
      if (updatedBox.y2 - updatedBox.y1 < minSize) {
        if (mouseYInBox < 0.5) updatedBox.y1 = updatedBox.y2 - minSize;
        else updatedBox.y2 = updatedBox.y1 + minSize;
      }
      
      updatedBox.x1 = Math.max(0, Math.min(updatedBox.x1, maxX));
      updatedBox.y1 = Math.max(0, Math.min(updatedBox.y1, maxY));
      updatedBox.x2 = Math.max(0, Math.min(updatedBox.x2, maxX));
      updatedBox.y2 = Math.max(0, Math.min(updatedBox.y2, maxY));
      
      // setSelectedBox(updatedBox); // REMOVE THIS LINE
      setBoxes(bs => bs.map(b => b.id === selectedId ? updatedBox : b));
      
      // 更新框列表
      setBoundingBoxes(prev => ({
        ...prev,
        [currentFrameIndex]: (prev[currentFrameIndex] || []).map(box => 
          box.id === selectedId ? updatedBox : box
        )
      }));
    }
  };

  const handleMouseUp = (e) => {
    // 结束绘制
    if (isDrawing && currentBox && startPoint) {
      const width = Math.abs(currentBox.x2 - currentBox.x1);
      const height = Math.abs(currentBox.y2 - currentBox.y1);
      
      if (width > 5 && height > 5) {
        const newBox = { ...currentBox, id: Date.now() };
        setBoundingBoxes(prev => ({
          ...prev,
          [currentFrameIndex]: [...(prev[currentFrameIndex] || []), newBox]
        }));
        setSelectedId(newBox.id);
      }
      setIsDrawing(false);
      setStartPoint(null);
      setCurrentBox(null);
    }
    
    // 结束调整大小
    if (isResizing) {
      setIsResizing(false);
      setResizeStartPoint(null);
      setOriginalBox(null);
    }
  };

  const handleBoxClick = (box) => {
    setSelectedId(box.id);
  };

  const handleDeleteBox = (boxId) => {
    setBoundingBoxes(prev => ({
      ...prev,
      [currentFrameIndex]: prev[currentFrameIndex]?.filter(box => box.id !== boxId) || []
    }));
    setSelectedId(null);
  };

  const handleSaveAnnotation = (label, trackingId) => {
    const selectedBox = boxes.find(b => b.id === selectedId);
    if (selectedBox) {
      const annotation = {
        ...selectedBox,
        label,
        trackingId
      };
      setAnnotations(prev => ({
        ...prev,
        [currentFrameIndex]: [...(prev[currentFrameIndex] || []), annotation]
      }));
      setSelectedId(null);
    }
  };

  const handleExportAnnotations = () => {
    const csvData = [];
    Object.keys(annotations).forEach(frameIndex => {
      annotations[frameIndex].forEach(annotation => {
        csvData.push(`${frameIndex},${annotation.x1},${annotation.x2},${annotation.y1},${annotation.y2},${annotation.label},${annotation.trackingId}`);
      });
    });
    
    const csvContent = 'Frame,x1,x2,y1,y2,Label,Tracking_ID\n' + csvData.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations.csv';
    a.click();
  };

  // --- CANVAS REFACTOR START ---
  const canvasRef = React.useRef(null);

  // --- CANVAS REFACTOR END ---

  // Helper for handle cursor
  function getHandleCursor(name) {
    switch (name) {
      case 'nw': return 'nwse-resize';
      case 'n': return 'ns-resize';
      case 'ne': return 'nesw-resize';
      case 'e': return 'ew-resize';
      case 'se': return 'nwse-resize';
      case 's': return 'ns-resize';
      case 'sw': return 'nesw-resize';
      case 'w': return 'ew-resize';
      default: return 'pointer';
    }
  }

  return (
    <div className="object-detection-tool" style={{ 
      display: 'flex', 
      height: '100vh', 
      background: 'linear-gradient(135deg, #0f3460 0%, #16213e 50%, #0f3460 100%)',
      color: '#fff',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Left Panel */}
      <aside className="left-panel" style={{ width: 250, padding: 20, background: 'rgba(20,28,44,0.98)', borderRight: '1px solid #00ff96' }}>
        <div className="card" style={{ background: 'rgba(20,28,44,0.98)', borderRadius: 14, boxShadow: '0 2px 16px rgba(100,255,220,0.06)', border: '1px solid #00ff96', padding: 18, color: '#b0b0b0', fontSize: 13 }}>
          <div className="section-title" style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2, color: '#00ff96', marginBottom: 12, borderBottom: '1.5px solid #00ff96', paddingBottom: 6 }}>
            OBJECT DETECTION TOOL
          </div>
          
          {/* Data Source Selection */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#b0b0b0' }}>Data Source:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`test-button ${dataSource === 'local' ? 'active' : ''}`}
                onClick={() => setDataSource('local')}
                style={{ flex: 1, padding: '8px 12px', fontSize: 12 }}
              >
                Local File
              </button>
              <button
                className={`test-button ${dataSource === 's3' ? 'active' : ''}`}
                onClick={() => setDataSource('s3')}
                style={{ flex: 1, padding: '8px 12px', fontSize: 12 }}
              >
                S3 Storage
              </button>
            </div>
          </div>

          {/* Local File Upload */}
          {dataSource === 'local' && (
            <div className="form-group" style={{ marginBottom: 15 }}>
              <div style={{ color: '#b0b0b0', fontSize: 12, marginBottom: 4 }}>
                Select Video File
              </div>
              <input
                type="file"
                accept="video/*"
                onChange={handleLocalFileChange}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 12
                }}
              />
            </div>
          )}

          {/* S3 Configuration */}
          {dataSource === 's3' && (
            <>
              <div className="form-group" style={{ marginBottom: 15 }}>
                <div style={{ color: '#b0b0b0', fontSize: 12, marginBottom: 4 }}>
                  Organization ID
                </div>
                <select
                  value={selectedOrgId || ''}
                  onChange={(e) => handleOrgIdChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 6,
                    color: '#fff',
                    fontSize: 12
                  }}
                >
                  <option value="">Select Organization</option>
                  {orgIds.map(orgId => (
                    <option key={orgId} value={orgId}>{orgId}</option>
                  ))}
                </select>
              </div>
              {selectedOrgId && (
                <div className="form-group" style={{ marginBottom: 15 }}>
                  <div style={{ color: '#b0b0b0', fontSize: 12, marginBottom: 4 }}>
                    Key ID
                  </div>
                  <select
                    value={selectedKeyId || ''}
                    onChange={(e) => handleKeyIdChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 6,
                      color: '#fff',
                      fontSize: 12
                    }}
                  >
                    <option value="">Select Key</option>
                    {keyIds.map(keyId => (
                      <option key={keyId} value={keyId}>{keyId}</option>
                    ))}
                  </select>
                </div>
              )}
              {s3Videos.length > 0 && (
                <div className="form-group" style={{ marginTop: 10 }}>
                  <div style={{ color: '#b0b0b0', fontSize: 12, marginBottom: 4 }}>
                    Files <span style={{ color: '#00ff96' }}>({s3Videos.length})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <button className="test-button" onClick={handlePrevVideo} disabled={currentS3VideoIndex === 0}>⏮️</button>
                    <span style={{ fontWeight: 600, color: '#fff', fontSize: 12 }}>
                      {currentS3VideoIndex + 1} / {s3Videos.length}
                    </span>
                    <button className="test-button" onClick={handleNextVideo} disabled={currentS3VideoIndex === s3Videos.length - 1}>⏭️</button>
                  </div>
                  <div style={{ marginTop: 6, color: '#00ff96', fontWeight: 600, wordBreak: 'break-all', fontSize: 12 }}>
                    {s3Videos[currentS3VideoIndex]?.filename}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card video-preview-container" style={{ width: '100%', maxWidth: 900, minHeight: 480, margin: '0 auto', background: 'rgba(15,52,96,0.3)' }}>
          <div className="video-player-container" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(dataSource === 'local' && localVideoUrl) ? (
              <video src={localVideoUrl} controls style={{ width: '100%', maxWidth: 800, background: '#000', borderRadius: 12 }} />
            ) : (dataSource === 's3' && frameUrls.length > 0) ? (
              <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 200px)', minHeight: '400px' }}>
                <div
                  ref={canvasRef}
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 'calc(100vh - 200px)',
                    minHeight: 400,
                    background: frameUrls[currentFrameIndex]
                      ? `url(${frameUrls[currentFrameIndex]}) center center / contain no-repeat #000`
                      : '#000',
                    borderRadius: 12,
                    userSelect: 'none',
                    overflow: 'hidden',
                    cursor: mode === 'drawing' ? 'crosshair' : 'default',
                    display: 'block',
                  }}
                  onMouseDown={handleImgMouseDown}
                  onMouseMove={handleImgMouseMove}
                  onMouseUp={handleImgMouseUp}
                  onDoubleClick={handleImgDoubleClick}
                  onDragStart={e => e.preventDefault()}
                  onClick={handleCanvasClick}
                >
                  {/* Render bounding boxes and handles here, using the same scaling logic as before */}
                  {boxes.map(box => {
                    const info = getImgInfo();
                    if (!info) return null;
                    const scaleX = info.scaleX, scaleY = info.scaleY;
                    return (
                      <div
                        key={box.id}
                        style={{
                          position: 'absolute',
                          left: box.x * scaleX,
                          top: box.y * scaleY,
                          width: box.w * scaleX,
                          height: box.h * scaleY,
                          border: box.id === selectedId ? '2px solid #00ff96' : '2px solid #ff6b6b',
                          background: box.id === selectedId ? 'rgba(0,255,150,0.15)' : 'rgba(255,107,107,0.10)',
                          zIndex: 10,
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  })}
                  
                  {/* Current drawing box */}
                  {drawStart && (() => {
                    const info = getImgInfo();
                    if (!info) return null;
                    const scaleX = info.scaleX, scaleY = info.scaleY;
                    return (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${drawStart.x * scaleX}px`,
                          top: `${drawStart.y * scaleY}px`,
                          width: `${Math.abs(drawStart.x - (drawStart.x + drawStart.w)) * scaleX}px`,
                          height: `${Math.abs(drawStart.y - (drawStart.y + drawStart.h)) * scaleY}px`,
                          border: '2px dashed #00ff96',
                          background: 'rgba(0,255,150,0.08)',
                          zIndex: 11,
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  })()}
                  
                  {/* Floating pagination controls */}
                  <div 
                    style={{ 
                      position: 'absolute', 
                      bottom: '10px', 
                      left: '50%', 
                      transform: 'translateX(-50%)',
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 15, 
                      padding: '8px 16px', 
                      background: 'rgba(0,0,0,0.9)', 
                      borderRadius: 20,
                      backdropFilter: 'blur(10px)',
                      border: '1px solid rgba(0,255,150,0.4)',
                      zIndex: 1000
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseMove={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                  >
                    <button
                      className="test-button"
                      onClick={() => setCurrentFrameIndex(i => Math.max(0, i - 1))}
                      disabled={currentFrameIndex === 0}
                      style={{ padding: '6px 10px', fontSize: '14px' }}
                    >⏮️</button>
                    <span style={{ fontWeight: 600, color: '#fff', fontSize: 14, minWidth: '80px', textAlign: 'center' }}>
                      {currentFrameIndex + 1} / {frameUrls.length}
                    </span>
                    <button
                      className="test-button"
                      onClick={() => setCurrentFrameIndex(i => Math.min(frameUrls.length - 1, i + 1))}
                      disabled={currentFrameIndex === frameUrls.length - 1}
                      style={{ padding: '6px 10px', fontSize: '14px' }}
                    >⏭️</button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#888', textAlign: 'center', fontSize: 16 }}>
                Please select a video
                {dataSource === 's3' && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
                    Debug: frameUrls.length = {frameUrls.length}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      
      {/* Right Panel */}
      <aside className="right-panel">
        <div className="card selected-points-container" style={{ width: 200, minWidth: 180, background: 'rgba(20,28,44,0.98)', borderRadius: 14, boxShadow: '0 2px 16px rgba(100,255,220,0.06)', border: '1px solid #00ff96', padding: 18, color: '#b0b0b0', fontSize: 13 }}>
          <div style={{ width: '100%' }}>
            <div className="section-title" style={{ fontWeight: 700, fontSize: 15, letterSpacing: 2, color: '#00ff96', marginBottom: 12, borderBottom: '1.5px solid #00ff96', paddingBottom: 6 }}>
              ANNOTATION PANEL
            </div>
            
            {dataSource === 's3' && frameUrls.length > 0 ? (
              <div>
                {/* Annotation instructions */}
                <div style={{ marginBottom: 15, fontSize: 11, color: '#888' }}>
                  Drag to draw boxes. Click and drag inside existing boxes to resize them. Double-click to select boxes.
                </div>
                
                {/* Debug information */}
                <div style={{ marginBottom: 10, fontSize: 10, color: '#666', padding: '5px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                  <div>Selected Box: {selectedId ? 'Yes' : 'No'}</div>
                  <div>Drawing: {drawStart ? 'Yes' : 'No'}</div>
                  <div>Resizing: {resizeStart ? 'Yes' : 'No'}</div>
                  {selectedId && (
                    <div>Box Coords: ({Math.round(boxes.find(b => b.id === selectedId)?.x)},{Math.round(boxes.find(b => b.id === selectedId)?.y)}) - ({Math.round(boxes.find(b => b.id === selectedId)?.x + boxes.find(b => b.id === selectedId)?.w)},{Math.round(boxes.find(b => b.id === selectedId)?.y + boxes.find(b => b.id === selectedId)?.h)})</div>
                  )}
                </div>
                
                {/* Current selected box information */}
                {selectedId && (() => {
                  const info = getImgInfo();
                  if (!info) return null;
                  const box = boxes.find(b => b.id === selectedId);
                  if (!box) return null;
                  const scaleX = info.scaleX, scaleY = info.scaleY;
                  return (
                    <div style={{ marginBottom: 15, padding: 10, background: 'rgba(0,255,150,0.1)', borderRadius: 8, border: '1px solid rgba(0,255,150,0.3)' }}>
                      <div style={{ fontSize: 12, color: '#00ff96', marginBottom: 8 }}>Selected Box Info:</div>
                      <div style={{ fontSize: 10, marginBottom: 4 }}>X: {Math.round(box.x)}</div>
                      <div style={{ fontSize: 10, marginBottom: 4 }}>Y: {Math.round(box.y)}</div>
                      <div style={{ fontSize: 10, marginBottom: 4 }}>W: {Math.round(box.w)}</div>
                      <div style={{ fontSize: 10, marginBottom: 8 }}>H: {Math.round(box.h)}</div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: '#b0b0b0' }}>Label:</label>
                        <select
                          value={box.label || ''}
                          onChange={e => {
                            const label = e.target.value;
                            setBoxes(bs => bs.map(b => b.id === selectedId ? { ...b, label } : b));
                          }}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '4px 8px',
                            background: '#1a1a1a',
                            border: '1px solid #333',
                            borderRadius: 4,
                            color: '#fff',
                            fontSize: 11
                          }}
                        >
                          <option value="">Select label</option>
                          <option value="car">Car</option>
                          <option value="truck">Truck</option>
                          <option value="bus">Bus</option>
                          <option value="person">Person</option>
                          <option value="bicycle">Bicycle</option>
                          <option value="motorcycle">Motorcycle</option>
                          <option value="traffic_light">Traffic Light</option>
                          <option value="stop_sign">Stop Sign</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: '#b0b0b0' }}>Tracking ID:</label>
                        <input
                          type="number"
                          value={box.trackingId || ''}
                          onChange={e => {
                            const trackingId = e.target.value;
                            setBoxes(bs => bs.map(b => b.id === selectedId ? { ...b, trackingId } : b));
                          }}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '4px 8px',
                            background: '#1a1a1a',
                            border: '1px solid #333',
                            borderRadius: 4,
                            color: '#fff',
                            fontSize: 11
                          }}
                        />
                      </div>
                      <button
                        onClick={handleDeleteSelectedBox}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: '#ff6b6b',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                          marginTop: 8
                        }}
                      >
                        Delete Selected Box
                      </button>
                    </div>
                  );
                })()}
                
                {/* Statistics */}
                <div style={{ marginBottom: 15, fontSize: 11 }}>
                  <div>Current Frame Boxes: {(boundingBoxes[currentFrameIndex] || []).length}</div>
                  <div>Total Annotated Frames: {Object.keys(annotations).length}</div>
                </div>
                
                {/* Export button */}
                <button
                  onClick={handleExportAnnotations}
                  disabled={Object.keys(annotations).length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: Object.keys(annotations).length > 0 ? '#00ff96' : '#333',
                    color: Object.keys(annotations).length > 0 ? '#000' : '#666',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: Object.keys(annotations).length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  Export Annotations (CSV)
                </button>
              </div>
            ) : (
              <div style={{ color: '#888', textAlign: 'center', fontSize: 12 }}>
                Please select a video to start annotation
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};

export default ObjectDetectionTool; 