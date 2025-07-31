import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnnotationTool from './pages/AnnotationTool';
import ObjectDetectionTool from './pages/ObjectDetectionTool';
import ScenarioAnalysisTool from './pages/ScenarioAnalysisTool';

function AppRouter() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/annotation-tool" element={<AnnotationTool />} />
        <Route path="/object-detection" element={<ObjectDetectionTool />} />
        <Route path="/scenario-analysis" element={<ScenarioAnalysisTool />} />
      </Routes>
    </Router>
  );
}

export default AppRouter; 