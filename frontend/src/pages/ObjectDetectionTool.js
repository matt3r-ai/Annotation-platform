import React, { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import ReactDOM from 'react-dom';
import { s3VideoAPI } from '../services/api';
import { runYolov10OnS3 } from '../services/v2eApi';
import { fetchJsonFromS3, fetchScenarios as fetchScenariosApi } from '../services/scenarioApi';
import '../styles/App.css';

const ObjectDetectionTool = () => {
  const [dataSource, setDataSource] = useState('local');
  const [viewMode, setViewMode] = useState('annotate'); // 'fetch' | 'annotate'
  const [localFile, setLocalFile] = useState(null);
  const [localVideoUrl, setLocalVideoUrl] = useState('');
  const [localFolderFiles, setLocalFolderFiles] = useState([]); // [{type:'image'|'txt', file, name, url}]
  const [localImageList, setLocalImageList] = useState([]); // [{name, file, url, width, height}]
  const folderInputRef = React.useRef(null);
  const [frameTags, setFrameTags] = useState({}); // {frameIndex: 'day,night'}
  const [orgIds, setOrgIds] = useState([]);
  const [keyIds, setKeyIds] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [s3Videos, setS3Videos] = useState([]);
  const [currentS3VideoIndex, setCurrentS3VideoIndex] = useState(0);
  const [s3VideoUrl, setS3VideoUrl] = useState('');
  const [currentS3Key, setCurrentS3Key] = useState('');
  const [frameUrls, setFrameUrls] = useState([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isLoadingFrames, setIsLoadingFrames] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  
  // 标注相关状态
  const [boundingBoxes, setBoundingBoxes] = useState({}); // {frameIndex: [boxes]}
  // const [selectedBox, setSelectedBox] = useState(null); // <-- DELETE THIS LINE
  // Class map (id -> name) provided by teammate
  const classIdToName = {
    0: 'person',
    1: 'light-vehicle',
    2: 'heavy-vehicle',
    3: 'bike',
    4: 'traffic-light',
    5: 'traffic-sign',
    6: 'construction',
    7: 'train',
    8: 'animal',
    9: 'emergency-vehicle',
    10: 'shopping-cart',
  };
  const nameToClassId = Object.fromEntries(Object.entries(classIdToName).map(([id, name]) => [name, Number(id)]));
  const [labels, setLabels] = useState(Object.values(classIdToName));
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
  const [frameBoxes, setFrameBoxes] = React.useState({}); // {frameIndex: [boxes]}
  const [boxes, setBoxes] = React.useState([]); // 当前帧的 boxes
  const [selectedId, setSelectedId] = React.useState(null);
  const [mode, setMode] = React.useState('idle'); // idle | drawing | moving | resizing
  const [drawStart, setDrawStart] = React.useState(null); // {x, y} in image coords
  const [moveStart, setMoveStart] = React.useState(null); // {x, y, box}
  const [resizeStart, setResizeStart] = React.useState(null); // {x, y, box, handle}

  // --- ZOOM STATE MANAGEMENT ---
  const [zoom, setZoom] = React.useState(1); // 缩放比例
  const [zoomCenter, setZoomCenter] = React.useState({ x: 0, y: 0 }); // 缩放中心点

  // --- UNDO/REDO SYSTEM ---
  const [history, setHistory] = React.useState([]); // 操作历史
  const [historyIndex, setHistoryIndex] = React.useState(-1); // 当前历史位置
  const [maxHistorySize] = React.useState(50); // 最大历史记录数

  // 保存当前状态到历史记录
  const saveToHistory = React.useCallback((action, description) => {
    setHistory(prev => {
      const currentState = {
        frameBoxes: JSON.parse(JSON.stringify(frameBoxes)),
        selectedId,
        action,
        description,
        timestamp: Date.now()
      };

      // 移除当前位置之后的历史记录
      const newHistory = prev.slice(0, historyIndex + 1);
      // 添加新状态
      newHistory.push(currentState);
      // 限制历史记录大小
      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
  }, [frameBoxes, selectedId, historyIndex, maxHistorySize]);

  // 撤回操作
  const undo = React.useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const previousState = history[newIndex];
      setFrameBoxes(previousState.frameBoxes);
      setSelectedId(previousState.selectedId);
      setHistoryIndex(newIndex);
      // 更新当前帧的 boxes
      if (previousState.frameBoxes[currentFrameIndex]) {
        setBoxes(previousState.frameBoxes[currentFrameIndex]);
      } else {
        setBoxes([]);
      }
    }
  }, [history, historyIndex, currentFrameIndex]);

  // 重做操作
  const redo = React.useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextState = history[newIndex];
      setFrameBoxes(nextState.frameBoxes);
      setSelectedId(nextState.selectedId);
      setHistoryIndex(newIndex);
      // 更新当前帧的 boxes
      if (nextState.frameBoxes[currentFrameIndex]) {
        setBoxes(nextState.frameBoxes[currentFrameIndex]);
      } else {
        setBoxes([]);
      }
    }
  }, [history, historyIndex, currentFrameIndex]);

  // 键盘事件处理
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Z: 撤回
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Y 或 Ctrl+Shift+Z: 重做
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        redo();
      }
      // Delete: 删除选中的框
      if (e.key === 'Delete' && selectedId) {
        e.preventDefault();
        handleDeleteSelectedBox();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectedId]);

  // 初始化历史记录
  React.useEffect(() => {
    if (history.length === 0) {
      saveToHistory('init', '初始化');
    }
  }, []);

  // 切换帧时，自动加载 boxes
  React.useEffect(() => {
    // 延迟到下一次绘制，保证 <img> onLoad 已触发（避免尺寸尚未就绪时计算 overlay）
    const handle = requestAnimationFrame(() => {
      if (frameBoxes[currentFrameIndex]) {
        setBoxes(frameBoxes[currentFrameIndex]);
      } else {
        let found = false;
        for (let i = currentFrameIndex - 1; i >= 0; i--) {
          if (frameBoxes[i] && frameBoxes[i].length > 0) {
            const prevBoxes = frameBoxes[i].map(b => ({ ...b, id: Date.now() + Math.random() }));
            setBoxes(prevBoxes);
            setFrameBoxes(prev => ({ ...prev, [currentFrameIndex]: prevBoxes }));
            found = true;
            break;
          }
        }
        if (!found) {
          setBoxes([]);
        }
      }
      setSelectedId(null);
    });
    return () => cancelAnimationFrame(handle);
    // eslint-disable-next-line
  }, [currentFrameIndex]);

  // boxes 变化时，自动保存到 frameBoxes
  React.useEffect(() => {
    setFrameBoxes(prev => ({ ...prev, [currentFrameIndex]: boxes }));
    // eslint-disable-next-line
  }, [boxes, currentFrameIndex]);

  // --- IMAGE DIMENSION STATE ---
  const [naturalWidth, setNaturalWidth] = React.useState(1280); // default fallback
  const [naturalHeight, setNaturalHeight] = React.useState(720);
  const imgRef = React.useRef(null);
  // Force re-render after img element finishes loading current frame
  const [imgVersion, setImgVersion] = React.useState(0);

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

  // 获取 <img> 的实际显示区域
  function getImgRect() {
    if (!imgRef.current) return null;
    return imgRef.current.getBoundingClientRect();
  }

  // 固定图片尺寸
  const FIXED_NATURAL_WIDTH = 1280;
  const FIXED_NATURAL_HEIGHT = 960;

  // getImgInfo 现在基于固定naturalWidth/Height，并考虑缩放
  function getImgInfo() {
    if (!canvasRef.current || !imgRef.current) return null;
  
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const imgElement = imgRef.current;
  
    const naturalWidth = imgElement.naturalWidth;
    const naturalHeight = imgElement.naturalHeight;
  
    const canvasWidth = canvasRect.width;
    const canvasHeight = canvasRect.height;
  
    const aspectImage = naturalWidth / naturalHeight;
    const aspectCanvas = canvasWidth / canvasHeight;
  
    let displayWidth, displayHeight, offsetX, offsetY;
  
    if (aspectImage > aspectCanvas) {
      // 图像更宽，宽度填满
      displayWidth = canvasWidth;
      displayHeight = canvasWidth / aspectImage;
      offsetX = 0;
      offsetY = (canvasHeight - displayHeight) / 2;
    } else {
      // 图像更高，高度填满
      displayHeight = canvasHeight;
      displayWidth = canvasHeight * aspectImage;
      offsetY = 0;
      offsetX = (canvasWidth - displayWidth) / 2;
    }

    // 应用缩放 - 图片使用 transform: scale()，所以这里需要计算缩放后的实际尺寸
    const scaledDisplayWidth = displayWidth * zoom;
    const scaledDisplayHeight = displayHeight * zoom;
    
    // 由于图片使用 transform: scale() 且 transformOrigin: 'center center'
    // 缩放后的偏移量需要重新计算
    const scaledOffsetX = offsetX - (scaledDisplayWidth - displayWidth) / 2;
    const scaledOffsetY = offsetY - (scaledDisplayHeight - displayHeight) / 2;
  
    return {
      left: canvasRect.left + scaledOffsetX, // ← 这是图像实际显示区域的左上角（相对屏幕）
      top: canvasRect.top + scaledOffsetY,
      width: scaledDisplayWidth,
      height: scaledDisplayHeight,
      naturalWidth,
      naturalHeight,
      scaleX: scaledDisplayWidth / naturalWidth,
      scaleY: scaledDisplayHeight / naturalHeight,
      offsetX: scaledOffsetX,
      offsetY: scaledOffsetY,
      zoom
    };
  }

  // 滚轮缩放处理函数
  function handleWheel(e) {
    e.preventDefault();
    
    const info = getImgInfo();
    if (!info) return;

    // 获取鼠标在画布上的位置
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;

    // 计算缩放前的图像坐标
    const oldImgX = (mouseX - info.offsetX) / info.scaleX;
    const oldImgY = (mouseY - info.offsetY) / info.scaleY;

    // 计算新的缩放比例
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(zoom * delta, 5)); // 限制缩放范围 0.1x - 5x

    // 更新缩放状态
    setZoom(newZoom);
  }

  // 重置缩放
  function resetZoom() {
    setZoom(1);
  }
  

  // Mouse event handlers
  function handleImgMouseDown(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = ((e.clientX - info.left) / info.scaleX);
    const y = ((e.clientY - info.top) / info.scaleY);
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
    const x = ((e.clientX - info.left) / info.scaleX);
    const y = ((e.clientY - info.top) / info.scaleY);
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
    const x = ((e.clientX - info.left) / info.scaleX);
    const y = ((e.clientY - info.top) / info.scaleY);
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
        setBoxes(bs => {
          const newBoxes = bs.filter(b => b.id !== 'preview').concat(newBox);
          // 保存到历史记录
          setTimeout(() => saveToHistory('draw', `绘制框 ${newBox.id}`), 0);
          return newBoxes;
        });
        setSelectedId(newBox.id);
      } else {
        setBoxes(bs => bs.filter(b => b.id !== 'preview'));
      }
    } else if (mode === 'moving' || mode === 'resizing') {
      // 移动或调整大小操作完成后保存到历史记录
      setTimeout(() => saveToHistory('modify', `${mode === 'moving' ? '移动' : '调整大小'} 框 ${selectedId}`), 0);
    }
    setMode('idle');
    setDrawStart(null);
    setMoveStart(null);
    setResizeStart(null);
  }

  function handleImgDoubleClick(e) {
    const info = getImgInfo();
    if (!info) return;
    const x = ((e.clientX - info.left) / info.scaleX);
    const y = ((e.clientY - info.top) / info.scaleY);
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
    const x = ((e.clientX - info.left) / info.scaleX);
    const y = ((e.clientY - info.top) / info.scaleY);
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
    const deletedBox = boxes.find(b => b.id === selectedId);
    setBoxes(bs => bs.filter(b => b.id !== selectedId));
    setSelectedId(null);
    // 保存删除操作到历史记录
    setTimeout(() => saveToHistory('delete', `删除框 ${selectedId}`), 0);
  }

  // 3. In the annotation canvas div, add onClick
  // <div ... onClick={handleCanvasClick} ...>

  // 4. In the annotation panel, add a delete button when a box is selected
  // {selectedId && (
  //   <button onClick={handleDeleteSelectedBox} style={{ ... }}>Delete Selected Box</button>
  // )}

  React.useEffect(() => {
    if (dataSource === 's3') {
      setViewMode('fetch');
    } else {
      setViewMode('annotate');
    }
  }, [dataSource]);

  // 全局鼠标事件处理，确保绘制状态正确重置
  React.useEffect(() => {
    const handleGlobalMouseUp = (e) => {
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

  const handleOrgIdChange = async () => {};

  // 修改loadS3Video为抽帧
  const loadS3Video = async (videoInfo) => {
    if (!videoInfo.key || !videoInfo.filename) {
      alert('Please select a complete video file');
      return;
    }
    try {
      setIsLoadingFrames(true);
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
    } finally {
      setIsLoadingFrames(false);
    }
  };

  const handleNextVideo = () => {};
  const handlePrevVideo = () => {};

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

  // Handle local folder upload: read images only (txts imported via Import modal)
  const handleLocalFolderChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Separate images and txts
    const images = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f.name));
    setLocalFolderFiles(files);
    // Prepare image list with dims
    const imageItems = await Promise.all(images.map(f => new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => resolve({ name: f.name, file: f, url, width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
    })));
    // Build frameUrls and initial boxes from YOLO per-image txts if present
    const urls = imageItems.map(it => it.url);
    setLocalImageList(imageItems);
    setFrameUrls(urls);
    setCurrentFrameIndex(0);
    // Do not auto-import txts here; handled via Import modal
    setFrameBoxes({});
    setBoxes([]);
    setViewMode('annotate');
    // 清空并初始化帧标签
    setFrameTags({});
  };

  function stem(filename) {
    const i = filename.lastIndexOf('.');
    return i >= 0 ? filename.slice(0, i) : filename;
  }



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



  // 加入 handleLoadS3Video
  const handleLoadS3Video = async () => {};

  // --- MCDB filter like Video2Everything ---
  const [mcdbStart, setMcdbStart] = useState(() => new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10));
  const [mcdbEnd, setMcdbEnd] = useState(() => new Date().toISOString().slice(0,10));
  const [mcdbLimit, setMcdbLimit] = useState(50);
  const [mcdbItems, setMcdbItems] = useState([]);
  const [mcdbLoading, setMcdbLoading] = useState(false);

  async function loadFramesFromS3Key(key) {
    if (!key) { alert('Missing S3 video key'); return; }
    try {
      setIsLoadingFrames(true);
        setFrameUrls([]);
      setCurrentFrameIndex(0);
      setCurrentS3Key(key);
      const filename = key.split('/').pop() || 'video.mp4';
      const response = await s3VideoAPI.extractFrames({ s3_key: key, filename, fps: 3 });
      const frames = response.data?.frames || response.frames || [];
      setFrameUrls(frames);
      setViewMode('annotate');
    } catch (e) {
      console.error(e);
      alert('Extract frames failed');
    } finally {
      setIsLoadingFrames(false);
    }
  }

  // Helper: select datasource with view mode management
  const handleSelectDataSource = (source) => {
    setDataSource(source);
    if (source === 's3') setViewMode('fetch'); else setViewMode('annotate');
  };

  // --- Helpers for YOLOv10 autofill ---
  function normalizeS3Path(input, fallbackBucket = 'matt3r-ce-inference-output') {
    if (!input || typeof input !== 'string') return { bucket: fallbackBucket, key: '' };
    let p = input.trim();
    if (p.startsWith('s3://')) p = p.slice(5);
    if (p.startsWith('/')) p = p.slice(1);
    if (fallbackBucket && p.startsWith(fallbackBucket + '/')) {
      return { bucket: fallbackBucket, key: p.slice(fallbackBucket.length + 1) };
    }
    const idx = p.indexOf('/');
    if (idx > 0) return { bucket: p.slice(0, idx), key: p.slice(idx + 1) };
    return { bucket: fallbackBucket, key: p };
  }

  function parseYoloFrames(payload) {
    if (!payload || typeof payload !== 'object') return [];
    // Accept several structures:
    // 1) { yolov10: [ { frame_index, detections:[...] } ] }
    // 2) { yolov10: { frames:[...] } }
    // 3) { yolov10: { 0:{...}, 1:{...} } }
    // 4) 同理支持 yolo / YOLO / frames 顶层
    // 5) 直接数组或按索引字典
    let root = payload?.yolov10 ?? payload?.yolo ?? payload?.YOLO ?? payload?.frames ?? payload;
    if (root && typeof root === 'object' && !Array.isArray(root) && Array.isArray(root.frames)) {
      root = root.frames;
    }
    if (!Array.isArray(root)) {
      if (root && typeof root === 'object') {
        const entries = Object.entries(root).filter(([k,v]) => /^\d+$/.test(String(k)) && typeof v === 'object');
        if (entries.length > 0) {
          entries.sort((a,b) => Number(a[0]) - Number(b[0]));
          root = entries.map(([k,v]) => ({ frame_index: Number(k), ...(typeof v==='object'?v:{}) }));
        } else {
          root = [];
        }
      } else {
        root = [];
      }
    }
    console.log('[YOLO Autofill] root sample =', Array.isArray(root) ? root[0] : root);
    return root.map((item, idx) => {
      const detections = item?.detections || item?.boxes || item?.objects || item || [];
      const list = Array.isArray(detections) ? detections : [];
      const fi = (typeof item?.frame_index === 'number' ? item.frame_index
                : typeof item?.frame === 'number' ? item.frame
                : idx);
      return { frame_index: fi, detections: list };
    });
  }

  function toBoxes(dets) {
    const out = [];
    for (const d of dets) {
      let x, y, w, h;
      if (Array.isArray(d?.box) && d.box.length >= 4) {
        const [a,b,c,dv] = d.box.map(Number);
        if (c > a && dv > b) { x=a; y=b; w=c-a; h=dv-b; } else { x=a; y=b; w=c; h=dv; }
      } else if (Array.isArray(d?.bbox) && d.bbox.length >= 4) {
        const [a,b,c,dv] = d.bbox.map(Number);
        if (c > a && dv > b) { x=a; y=b; w=c-a; h=dv-b; } else { x=a; y=b; w=c; h=dv; }
      } else if (Array.isArray(d?.xyxy) && d.xyxy.length >= 4) {
        const [x1,y1,x2,y2] = d.xyxy.map(Number); x=x1; y=y1; w=x2-x1; h=y2-y1;
      } else if ([d?.x1,d?.y1,d?.x2,d?.y2].every(v => typeof v === 'number')) {
        x=Number(d.x1); y=Number(d.y1); w=Number(d.x2)-x; h=Number(d.y2)-y;
      } else if ([d?.x,d?.y,d?.w,d?.h].every(v => typeof v === 'number')) {
        x=Number(d.x); y=Number(d.y); w=Number(d.w); h=Number(d.h);
      } else {
        continue;
      }
      if (w <= 0 || h <= 0) continue;
      out.push({ id: Date.now() + Math.random(), x, y, w, h, label: d?.label || '', trackingId: d?.tracking_id || d?.track_id || '' });
    }
    return out;
  }

  const handleAutofillYolov10 = async () => {
    try {
      if (frameUrls.length === 0) { alert('Please load S3 frames first'); return; }
      if (!currentS3Key) { alert('Missing S3 video key'); return; }
      setIsAutoDetecting(true);
      // 1) Inference at 3fps
      const inf = await runYolov10OnS3({ s3_url: currentS3Key, file_type: 'video', fps: 3 });
      const basePath = inf?.path || '';
      console.log('[YOLO Autofill] inference response =', inf);
      if (!basePath) { alert('Inference returned no path'); setIsAutoDetecting(false); return; }
      const jsonPath = basePath.toLowerCase().endsWith('yolov10.json') ? basePath : `${basePath.replace(/\/?$/, '')}/yolov10.json`;
      console.log('[YOLO Autofill] jsonPath =', jsonPath);
      const { bucket, key } = normalizeS3Path(jsonPath, 'matt3r-ce-inference-output');
      console.log('[YOLO Autofill] normalized json =', bucket, key);
      // 2) Fetch JSON
      const res = await fetchJsonFromS3({ bucket, key });
      console.log('[YOLO Autofill] fetchJsonFromS3 response sample =', Object.keys(res || {}));
      let payload = res?.json;
      if (!payload && typeof res?.text === 'string') {
        try { payload = JSON.parse(res.text); } catch { payload = {}; }
      }
      if (!payload || Object.keys(payload).length === 0) {
        alert('Result JSON is empty');
        setIsAutoDetecting(false);
        return;
      }
      console.log('[YOLO Autofill] payload keys =', Object.keys(payload));
      const frames = parseYoloFrames(payload);
      console.log('[YOLO Autofill] parsed frames =', frames.length);
      if (!frames || frames.length === 0) { alert('No detections in result'); setIsAutoDetecting(false); return; }
      // 3) Map detections to our extracted frames count
      const n = frameUrls.length;
      const m = frames.length;
      if (n === 0) { alert('No extracted frames to apply'); setIsAutoDetecting(false); return; }
      const mapped = {};
      for (let i = 0; i < n; i++) {
        const j = m > 1 ? Math.round(i * (m - 1) / (n - 1)) : 0;
        const dets = frames[j]?.detections || [];
        mapped[i] = toBoxes(dets);
      }
      setFrameBoxes(mapped);
      setBoxes(mapped[currentFrameIndex] || []);
      console.log('[YOLO Autofill] mapped boxes for frame 0 =', mapped[0]?.length || 0);
    } catch (e) {
      console.error(e);
      alert('Autofill failed');
    } finally {
      setIsAutoDetecting(false);
    }
  };

  // label 到 classnumber 的映射
  // New mapping helpers
  const classToLabel = classId => classIdToName[classId] || '';

  // 导出为TXT
  const [exportFormat, setExportFormat] = useState('combined'); // 'combined' | 'yolo_per_image'

  const handleExportFrameBoxesTxt = () => {
    let lines = [];
    let lastBoxes = [];
    for (let i = 0; i < frameUrls.length; i++) {
      let boxes = frameBoxes[i];
      if (!boxes || boxes.length === 0) {
        boxes = lastBoxes; // 用上一帧的
      } else {
        lastBoxes = boxes;
      }
      (boxes || []).forEach(box => {
        const classnumber = (typeof box.classId === 'number') ? box.classId : (nameToClassId[box.label] ?? -1);
        if (exportFormat === 'combined') {
          lines.push(`${i}\t${Math.round(box.x)} ${Math.round(box.x + box.w)} ${Math.round(box.y)} ${Math.round(box.y + box.h)} ${classnumber} ${box.trackingId || -1}`);
        }
      });
    }
    if (exportFormat === 'combined') {
      const txtContent = lines.join('\n');
      const blob = new Blob([txtContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotations.txt';
      a.click();
    } else {
      // YOLO per-image export: bundle all .txt into one ZIP
      const zip = new JSZip();
      for (let i = 0; i < frameUrls.length; i++) {
        const it = localImageList[i];
        const boxes = frameBoxes[i] || [];
        if (!it) continue;
        const tagsStr = String(frameTags[i] || '').trim();
        const linesTxt = boxes.map(b => {
          const cls = (typeof b.classId === 'number') ? b.classId : (nameToClassId[b.label] ?? -1);
          const cx = (b.x + b.w / 2) / it.width;
          const cy = (b.y + b.h / 2) / it.height;
          const ww = b.w / it.width;
          const hh = b.h / it.height;
          const base = `${cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${ww.toFixed(6)} ${hh.toFixed(6)}`;
          const withTrack = `${base} ${b.trackingId || -1}`;
          return tagsStr ? `${withTrack} ${tagsStr}` : withTrack;
        }).join('\n');
        zip.file(`${stem(it.name)}.txt`, linesTxt);
      }
      zip.generateAsync({ type: 'blob' }).then((blob) => {
        saveAs(blob, 'annotations_yolo.zip');
      });
    }
  };

  // 导入TXT功能
  const [importTxt, setImportTxt] = useState('');
  const [showImport, setShowImport] = useState(false);
  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setImportTxt(evt.target.result);
      };
      reader.readAsText(file);
    }
  };
  
  // New: Import a folder of YOLO per-image txt files and map by filename stem
  const handleImportTxtFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const txts = files.filter(f => /\.txt$/i.test(f.name));
    const byStem = {};
    await Promise.all(txts.map(f => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { byStem[stem(f.name)] = String(reader.result || ''); resolve(); };
      reader.readAsText(f);
    })));
    // Build boxes per frame based on localImageList
    const newFrameBoxes = {};
    const newFrameTags = { ...frameTags };
    localImageList.forEach((img, idx) => {
      const content = byStem[stem(img.name)];
      if (!content) return;
      const lines = content.split(/\r?\n/).filter(Boolean);
      const list = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const cls = Number(parts[0]);
        const cx = parseFloat(parts[1]);
        const cy = parseFloat(parts[2]);
        const w = parseFloat(parts[3]);
        const h = parseFloat(parts[4]);
        const x = (cx - w / 2) * img.width;
        const y = (cy - h / 2) * img.height;
        const pw = w * img.width;
        const ph = h * img.height;
        let trackingId = '';
        if (parts.length >= 6) trackingId = parts[5];
        // Optional tags after 6th token
        if (parts.length > 6) {
          const tags = parts.slice(6).join(' ');
          newFrameTags[idx] = tags;
        }
        list.push({ id: Date.now() + Math.random(), x, y, w: pw, h: ph, label: classIdToName[cls] || '', classId: cls, trackingId });
      }
      if (list.length > 0) newFrameBoxes[idx] = list;
    });
    setFrameBoxes(prev => ({ ...prev, ...newFrameBoxes }));
    if (newFrameBoxes[currentFrameIndex]) setBoxes(newFrameBoxes[currentFrameIndex]);
    setFrameTags(newFrameTags);
    setShowImport(false);
  };
  const handleImportFrameBoxesTxt = () => {
    const lines = importTxt.split(/\r?\n/).filter(Boolean);
    const newFrameBoxes = {};
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 7) {
        const frame = parseInt(parts[0], 10);
        const x1 = parseFloat(parts[1]);
        const x2 = parseFloat(parts[2]);
        const y1 = parseFloat(parts[3]);
        const y2 = parseFloat(parts[4]);
        const classnumber = parseInt(parts[5], 10);
        const trackingId = parts[6];
        const label = classToLabel[classnumber] || '';
        const box = {
          id: Date.now() + Math.random(),
          x: x1,
          y: y1,
          w: x2 - x1,
          h: y2 - y1,
          label,
          trackingId
        };
        if (!newFrameBoxes[frame]) newFrameBoxes[frame] = [];
        newFrameBoxes[frame].push(box);
      }
    });
    setFrameBoxes(prev => ({ ...prev, ...newFrameBoxes }));
    // 自动切换到第一个有box的帧并显示
    const frames = Object.keys(newFrameBoxes).map(Number).sort((a, b) => a - b);
    if (frames.length > 0) {
      setCurrentFrameIndex(frames[0]);
      setBoxes(newFrameBoxes[frames[0]] || []);
    }
    setShowImport(false);
    setImportTxt('');
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="company-name">OBJECT DETECTION TOOL</div>
        <div className="tagline">Keeping drivers safe through AI innovation</div>
      </header>
      <div className="App-content">
        {/* Left Panel: Data Source Selection */}
        <div className="data-source-selection">
          <div className="selection-container">
            <h2>Select Data Source</h2>
            <div className="selection-options">
              <div
                className={`option-card${dataSource === 'local' ? ' active' : ''}`}
                onClick={() => { handleSelectDataSource('local'); setTimeout(() => folderInputRef.current && folderInputRef.current.click(), 0); }}
              >
                <div className="option-icon">📁</div>
                <h3>Local Upload</h3>
                <p>Upload DMP folder from your local machine</p>
              </div>
              <div
                className={`option-card${dataSource === 's3' ? ' active' : ''}`}
                onClick={() => handleSelectDataSource('s3')}
              >
                <div className="option-icon">☁️</div>
                <h3>Direct S3 Link</h3>
                <p>Connect directly to S3 bucket</p>
              </div>
            </div>
            {/* Local file input */}
            {dataSource === 'local' && (
              <>
                {/* Hidden folder picker, triggered by clicking the Local Upload card */}
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  onChange={handleLocalFolderChange}
                  style={{ display: 'none' }}
                  webkitdirectory=""
                  directory=""
                />
                <div style={{ marginTop: 18 }}>
                  <label className="select-label" style={{ color: '#b0b0b0', fontSize: 13, marginBottom: 6, display: 'block', textAlign: 'left' }}>Or, select a video file</label>
                  <input type="file" accept="video/*" onChange={handleLocalFileChange} className="select-input" style={{ marginTop: 4 }} />
                </div>
              </>
            )}
            {/* MCDB filter moved to center panel; nothing here in sidebar now for S3 */}
          </div>
        </div>
        {/* Main Content: Annotation Canvas/Video/Tool */}
        <div className="main-content">
          {viewMode === 'fetch' ? (
            <div style={{ padding: 12 }}>
              <div style={{ background:'#fff', color:'#111', borderRadius:12, border:'1px solid #e9eef5', padding:16 }}>
                <h3 style={{ marginTop:0, marginBottom:12 }}>Fetch Scenarios</h3>
                <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>Start</label>
                    <input type="date" value={mcdbStart} onChange={e=>setMcdbStart(e.target.value)} className="select-input" style={{ width:180, background:'#fff', color:'#111' }} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>End</label>
                    <input type="date" value={mcdbEnd} onChange={e=>setMcdbEnd(e.target.value)} className="select-input" style={{ width:180, background:'#fff', color:'#111' }} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column' }}>
                    <label style={{ fontSize:12, color:'#506176', marginBottom:6 }}>Limit</label>
                    <input className="select-input" type="number" min={1} max={500} value={mcdbLimit} onChange={e=>setMcdbLimit(Number(e.target.value||50))} style={{ width: 120, background:'#fff', color:'#111' }} />
                  </div>
                  <button onClick={async ()=>{
                    setMcdbLoading(true);
                    setMcdbItems([]);
                    try{
                      const res = await fetchScenariosApi({ event_types: [], start_date: mcdbStart, end_date: mcdbEnd, limit: mcdbLimit });
                      const scenarios = res?.scenarios || [];
                      setMcdbItems(scenarios);
                    }catch(err){
                      alert('Fetch MCDB failed');
                    }finally{
                      setMcdbLoading(false);
                    }
                  }} disabled={mcdbLoading} style={{
                    background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    padding:'10px 18px',
                    borderRadius:8,
                    fontWeight:700,
                    letterSpacing:'0.5px',
                    textTransform:'uppercase',
                    color:'#fff',
                    boxShadow:'0 6px 16px rgba(118,75,162,0.35)'
                  }}>{mcdbLoading?'⏳ Fetching...':'🚀 Fetch Scenarios'}</button>
                </div>
                {mcdbItems.length>0 && (
                  <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto', textAlign: 'left', fontSize: 12, background:'#fff', border:'1px solid #e9eef5', borderRadius:12 }}>
                    {mcdbItems.map((item)=>{
                      const links = item?.data_links || {};
                      const video = links.video || {};
                      const frontUrl = video.front;
                      function s3ToKey(url){
                        if(!url || typeof url !== 'string') return '';
                        const m = url.trim().match(/^s3:\/\/[^/]+\/(.+)$/i);
                        if(m){ return m[1]; }
                        return url.replace(/^[^/]+\//, '');
                      }
                      const key = s3ToKey(frontUrl);
                      return (
                        <div key={item.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', borderBottom:'1px solid #eef3f8' }}>
                          <div>
                            <div style={{ color:'#1a55a5', fontWeight:600 }}>#{item.id}</div>
                            <div style={{ color:'#6a7b91', fontSize:12, wordBreak:'break-all' }}>{frontUrl || 'No front video'}</div>
                          </div>
                          <button className="test-button" disabled={!key} onClick={()=> loadFramesFromS3Key(key)} style={{ minWidth:160 }}>
                            Load Frames (3 fps)
                </button>
                        </div>
                      );
                    })}
              </div>
            )}
          </div>
        </div>
          ) : (
          /* 预览容器：优先显示已加载的帧（本地或S3），否则显示本地视频或提示 */
          <div className="video-preview-container" style={{ width: '100%', maxWidth: 900, minHeight: 480, margin: '0 auto', background: 'rgba(15,52,96,0.3)' }}>
            <div className="video-player-container" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {frameUrls.length > 0 ? (
                <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 200px)', minHeight: '400px' }}>
                  <div
                    ref={canvasRef}
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
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
                    onWheel={handleWheel} // 添加滚轮缩放事件
                  >
                    {/* 图片层 */}
                    {frameUrls[currentFrameIndex] && (
                      <img
                        ref={imgRef}
                        src={frameUrls[currentFrameIndex]}
                        alt="frame"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          display: 'block',
                          pointerEvents: 'none',
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          transform: `scale(${zoom})`,
                          transformOrigin: 'center center',
                        }}
                        onLoad={() => {
                          // Trigger a re-render so getImgInfo() can compute positions with image dimensions ready
                          setImgVersion(v => v + 1);
                          // Re-apply current frame boxes to ensure overlay shows immediately after image load
                          setBoxes(frameBoxes[currentFrameIndex] || []);
                        }}
                      />
                    )}
                    {/* bounding box 层 */}
                    {(() => {
                      const info = getImgInfo();
                      if (!info) return null;
                      return boxes.map(box => (
                        <div
                          key={box.id}
                          style={{
                            position: 'absolute',
                            left: box.x * info.scaleX + info.offsetX,
                            top: box.y * info.scaleY + info.offsetY,
                            width: Math.max(1, box.w * info.scaleX),
                            height: Math.max(1, box.h * info.scaleY),
                            border: box.id === selectedId ? '2px solid #00ff96' : '2px solid #ff6b6b',
                            background: box.id === selectedId ? 'rgba(0,255,150,0.15)' : 'rgba(255,107,107,0.10)',
                            zIndex: 10,
                            pointerEvents: 'none',
                          }}
                        />
                      ));
                    })()}
                    {/* Current drawing box */}
                    {drawStart && (() => {
                      const info = getImgInfo();
                      if (!info) return null;
                      const scaleX = info.scaleX, scaleY = info.scaleY;
                      return (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${drawStart.x * scaleX + info.offsetX}px`,
                            top: `${drawStart.y * scaleY + info.offsetY}px`,
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
              ) : (dataSource === 'local' && localVideoUrl) ? (
                <video src={localVideoUrl} controls style={{ width: '100%', maxWidth: 800, background: '#000', borderRadius: 12 }} />
              ) : (
                <div style={{ color: '#888', textAlign: 'center', fontSize: 16 }}>
                  Please select a folder or video
                  {dataSource === 's3' && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>Use the Fetch Scenarios panel to select a video.</div>
                  )}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
        {/* Right Panel: Annotation Panel */}
        <div className="selected-points-container">
          {/* ...右侧 annotation panel 内容，全部用 AnnotationTool.js 的 className ... */}
          {/* Annotation instructions */}
          <div style={{ marginBottom: 15, fontSize: 11, color: '#888' }}>
            Drag to draw boxes. Click and drag inside existing boxes to resize them. Double-click to select boxes.
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
                  <label style={{ fontSize: 11, color: '#b0b0b0' }}>Category (ID · Name):</label>
                  <select
                    value={String((typeof box.classId === 'number') ? box.classId : (nameToClassId[box.label] ?? ''))}
                    onChange={e => {
                      const clsId = Number(e.target.value);
                      const label = classIdToName[clsId] || '';
                      setBoxes(bs => bs.map(b => b.id === selectedId ? { ...b, classId: clsId, label } : b));
                      // 保存标签更改到历史记录
                      setTimeout(() => saveToHistory('label', `更改框 ${selectedId} 类别为 ${clsId}:${label}`), 0);
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
                    <option value="">Select class</option>
                    {Object.entries(classIdToName).map(([id, name]) => (
                      <option key={id} value={id}>{id} · {name}</option>
                    ))}
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
                      // 保存跟踪ID更改到历史记录
                      setTimeout(() => saveToHistory('tracking', `更改框 ${selectedId} 跟踪ID为 ${trackingId}`), 0);
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
          {/* Frame-level tags input */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: '#b0b0b0' }}>Image tags (comma-separated):</label>
            <input
              type="text"
              value={frameTags[currentFrameIndex] || ''}
              onChange={e => setFrameTags(prev => ({ ...prev, [currentFrameIndex]: e.target.value }))}
              className="select-input"
              placeholder="day,night"
              style={{ width: '100%', background:'#1a1a1a', color:'#fff', marginTop: 4 }}
            />
            <div style={{ display:'flex', gap:8, marginTop:6 }}>
              {['day','night','rain','snow'].map(t => (
                <button key={t} className="test-button" onClick={()=>{
                  const cur = String(frameTags[currentFrameIndex]||'').split(',').map(s=>s.trim()).filter(Boolean);
                  const has = cur.includes(t);
                  const next = has ? cur.filter(x=>x!==t) : cur.concat(t);
                  setFrameTags(prev=>({ ...prev, [currentFrameIndex]: next.join(',') }));
                }} style={{ padding:'4px 8px' }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: '#b0b0b0' }}>Export format:</label>
            <select value={exportFormat} onChange={e=>setExportFormat(e.target.value)} className="select-input" style={{ width: '100%', background:'#1a1a1a', color:'#fff' }}>
              <option value="combined">Combined TXT (frame idx, xyxy, class, track)</option>
              <option value="yolo_per_image">YOLO per-image (normalized + track id + tags)</option>
            </select>
          </div>
          <button
            onClick={handleAutofillYolov10}
            className="test-button"
            style={{ width: '100%', marginBottom: 8 }}
            disabled={(dataSource !== 's3') || frameUrls.length === 0 || isAutoDetecting}
          >{isAutoDetecting ? 'Running YOLOv10…' : 'YOLOv10 Autofill (S3)'}
          </button>
          
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
          <button
            onClick={handleExportFrameBoxesTxt}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#00bfff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
              marginTop: 8
            }}
            disabled={Object.keys(frameBoxes).length === 0}
          >
            Export
          </button>
          <button
            onClick={() => setShowImport(true)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#00bfff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
              marginTop: 8
            }}
          >
            Import TXT
          </button>
          {showImport && ReactDOM.createPortal(
            <div style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#222', padding: 24, borderRadius: 10, minWidth: 300, maxWidth: '95vw', width: 480, boxSizing: 'border-box', boxShadow: '0 4px 32px #0008' }}>
                <div style={{ color: '#fff', marginBottom: 8, fontWeight: 600 }}>Import options:</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom: 12 }}>
                  <div>
                    <div style={{ color:'#ddd', fontSize:12, marginBottom:4 }}>Single combined TXT</div>
                    <input type="file" accept=".txt" onChange={handleImportFile} style={{ display: 'block', width: '100%', background: '#fff', color: '#000', borderRadius: 4, padding: 6, border: '1px solid #888' }} />
                  </div>
                  <div>
                    <div style={{ color:'#ddd', fontSize:12, marginBottom:4 }}>Folder of per-image YOLO txts</div>
                    <input type="file" multiple onChange={handleImportTxtFolder} style={{ display: 'block', width: '100%', background: '#fff', color: '#000', borderRadius: 4, padding: 6, border: '1px solid #888' }} webkitdirectory="" directory="" />
                  </div>
                </div>
                <textarea
                  value={importTxt}
                  onChange={e => setImportTxt(e.target.value)}
                  rows={10}
                  style={{ width: '100%', marginBottom: 12, background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 8, fontSize: 14, resize: 'vertical' }}
                  placeholder={'0\t374 649 389 664 0 1\n1\t374 649 389 664 0 1 ...'}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleImportFrameBoxesTxt} style={{ flex: 1, background: '#00ff96', color: '#000', border: 'none', borderRadius: 6, padding: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Import Combined TXT</button>
                  <button onClick={() => { setShowImport(false); setImportTxt(''); }} style={{ flex: 1, background: '#444', color: '#fff', border: 'none', borderRadius: 6, padding: 10, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
};

export default ObjectDetectionTool; 