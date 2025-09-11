import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/HomePage.css';

const HomePage = () => {
  const navigate = useNavigate();

  const handleToolClick = (toolPath) => {
    navigate(toolPath);
  };

  return (
    <div className="homepage">
      <div className="homepage-container">
        {/* Header */}
        <header className="homepage-header">
          <h1 className="homepage-title">MATT3R Annotation Platform</h1>
          <p className="homepage-subtitle">Advanced Autonomous Vehicle Data Annotation Suite</p>
        </header>

        {/* Main Content */}
        <main className="homepage-main">
          {/* Vision Section */}
          <section className="vision-section">
            <h2 className="section-title">Platform Vision</h2>
            <p className="vision-text">
              A comprehensive suite of annotation tools designed for autonomous vehicle development,
              enabling precise data labeling across multiple sensor modalities and event types.
            </p>
          </section>

          {/* Tools Grid */}
          <section className="tools-section">
            <h2 className="section-title">Annotation Tools</h2>
            <div className="tools-grid">
              {/* GPS-Video Event Cropping */}
              <div className="tool-card active">
                <div className="tool-icon">🎯</div>
                <h3 className="tool-title">GPS-Video Event Cropping</h3>
                <p className="tool-description">
                  Extract and annotate specific events from GPS trajectory data synchronized with video streams.
                </p>
                <button 
                  className="tool-button"
                  onClick={() => handleToolClick('/annotation-tool')}
                >
                  Launch Tool
                </button>
              </div>

              {/* Event Labeling */}
              <div className="tool-card">
                <div className="tool-icon">🏷️</div>
                <h3 className="tool-title">Event Labeling</h3>
                <p className="tool-description">
                  Comprehensive event classification and labeling across multiple sensor modalities.
                </p>
                <button className="tool-button disabled" disabled>
                  Coming Soon
                </button>
              </div>

              {/* Object Detection/Tracking */}
              <div className="tool-card">
                <div className="tool-icon">🎯</div>
                <h3 className="tool-title">Object Detection & Tracking</h3>
                <p className="tool-description">
                  Advanced object detection and tracking annotation with multi-sensor fusion.
                </p>
                <button 
                  className="tool-button"
                  onClick={() => handleToolClick('/object-detection')}
                >
                  Launch Tool
                </button>
              </div>

              {/* Scenario Analysis */}
              <div className="tool-card">
                <div className="tool-icon">🔍</div>
                <h3 className="tool-title">Scenario Analysis</h3>
                <p className="tool-description">
                  Find and analyze interesting driving scenarios with automated detection and review tools.
                </p>
                <button 
                  className="tool-button"
                  onClick={() => handleToolClick('/scenario-analysis')}
                >
                  Launch Tool
                </button>
              </div>

              {/* Video2Everything */}
              <div className="tool-card active">
                <div className="tool-icon">🎞️</div>
                <h3 className="tool-title">Video2Everything</h3>
                <p className="tool-description">
                  One video in, multi-task outputs aggregated on a single page.
                </p>
                <button 
                  className="tool-button"
                  onClick={() => handleToolClick('/video2everything')}
                >
                  Launch Tool
                </button>
              </div>

              {/* Lane Follow Detection */}
              <div className="tool-card">
                <div className="tool-icon">🛣️</div>
                <h3 className="tool-title">Lane Follow Detection</h3>
                <p className="tool-description">
                  Lane detection and following behavior analysis with precise annotation tools.
                </p>
                <button className="tool-button disabled" disabled>
                  Coming Soon
                </button>
              </div>

              {/* VLM Analysis Tool */}
              <div className="tool-card active">
                <div className="tool-icon">🤖</div>
                <h3 className="tool-title">VLM Analysis Tool</h3>
                <p className="tool-description">
                  Upload a video, extract frames, run VLM inference, and choose labels.
                </p>
                <button 
                  className="tool-button"
                  onClick={() => handleToolClick('/vlm-analysis')}
                >
                  Launch Tool
                </button>
              </div>
            </div>
          </section>

          {/* Data Types Section */}
          <section className="data-section">
            <h2 className="section-title">Supported Data Types</h2>
            <div className="data-grid">
              <div className="data-item">
                <span className="data-icon">📍</span>
                <span className="data-label">GPS</span>
              </div>
              <div className="data-item">
                <span className="data-icon">📱</span>
                <span className="data-label">IMU</span>
              </div>
              <div className="data-item">
                <span className="data-icon">🎥</span>
                <span className="data-label">Video/Image</span>
              </div>
              <div className="data-item">
                <span className="data-icon">🔊</span>
                <span className="data-label">Sound</span>
              </div>
            </div>
          </section>

          {/* Data Sources Section */}
          <section className="sources-section">
            <h2 className="section-title">Data Sources</h2>
            <div className="sources-grid">
              <div className="source-item">
                <span className="source-icon">💻</span>
                <span className="source-label">Local Upload</span>
              </div>
              <div className="source-item">
                <span className="source-icon">☁️</span>
                <span className="source-label">Company S3</span>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="homepage-footer">
          <p className="footer-text">
            Empowering autonomous vehicle development through precise data annotation
          </p>
        </footer>
      </div>
    </div>
  );
};

export default HomePage; 