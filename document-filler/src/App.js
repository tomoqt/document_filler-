import React, { useState } from 'react';
import './App.css';
import PipelineBuilder from './components/PipelineBuilder';

function App() {
  const [file, setFile] = useState(null);
  const [context, setContext] = useState('');
  const [example, setExample] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentView, setCurrentView] = useState('simple'); // 'simple' or 'pipeline'
  const [pipelineInstance, setPipelineInstance] = useState(null); // Keep pipeline instance

  const handleViewChange = (view) => {
    setCurrentView(view);
    // Clear simple form state when switching to pipeline
    if (view === 'pipeline') {
      setFile(null);
      setContext('');
      setExample('');
      setResult('');
      setError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const requestData = JSON.stringify({
        context: context,
        example: example || undefined
      });

      formData.append('request', requestData);

      const response = await fetch('http://localhost:8000/convert-and-fill', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("Received response from server:", data);
      console.log("Filled document content:", data.filled_document);
      setResult(data.filled_document);
    } catch (err) {
      console.error("Error in handleSubmit:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Document Processing</h1>
        <nav className="App-nav">
          <button 
            className={`nav-button ${currentView === 'simple' ? 'active' : ''}`}
            onClick={() => handleViewChange('simple')}
          >
            Simple Filler
          </button>
          <button 
            className={`nav-button ${currentView === 'pipeline' ? 'active' : ''}`}
            onClick={() => handleViewChange('pipeline')}
          >
            Pipeline Builder
          </button>
        </nav>
      </header>

      <main className="App-main">
        {currentView === 'simple' ? (
          <div className="simple-filler">
            <form onSubmit={handleSubmit} className="form-container">
              <div className="form-group">
                <label htmlFor="file">Upload Document (DOCX only)</label>
                <input
                  type="file"
                  id="file"
                  accept=".docx"
                  onChange={(e) => setFile(e.target.files[0])}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="context">Context</label>
                <textarea
                  id="context"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Provide context for filling the document..."
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="example">Example (Optional)</label>
                <textarea
                  id="example"
                  value={example}
                  onChange={(e) => setExample(e.target.value)}
                  placeholder="Provide an example of how to fill the document..."
                />
              </div>

              <button type="submit" disabled={loading}>
                {loading ? 'Processing...' : 'Fill Document'}
              </button>
            </form>

            {error && <div className="error-message">{error}</div>}

            {result && (
              <div className="result-container">
                <h2>Filled Document</h2>
                <pre className="result-content">
                  {result}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: currentView === 'pipeline' ? 'block' : 'none' }}>
            <PipelineBuilder 
              key="pipeline-builder"
              ref={instance => {
                if (instance && !pipelineInstance) {
                  setPipelineInstance(instance);
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
