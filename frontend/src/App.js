import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnnotationTool from './pages/AnnotationTool';
import ObjectDetectionTool from './pages/ObjectDetectionTool';
import EgoLaneAnnotationTool from './pages/EgoLaneAnnotationTool';
import ScenarioAnalysisTool from './pages/ScenarioAnalysisTool';
import Video2Everything from './pages/Video2Everything';
import VlmAnalysisTool from './pages/VlmAnalysisTool';

function AppRouter() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/annotation-tool" element={<AnnotationTool />} />
        <Route path="/object-detection" element={<ObjectDetectionTool />} />
        <Route path="/ego-lane-annotation" element={<EgoLaneAnnotationTool />} />
        <Route path="/scenario-analysis" element={<ScenarioAnalysisTool />} />
        <Route path="/video2everything" element={<Video2Everything />} />
        <Route path="/vlm-analysis" element={<VlmAnalysisTool />} />
      </Routes>
    </Router>
  );
}

export default AppRouter; 