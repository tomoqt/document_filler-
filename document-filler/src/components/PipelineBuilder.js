import React, { useState, useRef, useEffect } from 'react';
import './PipelineBuilder.css';

const NODE_TYPES = {
  DOCUMENT_INPUT: {
    type: 'DOCUMENT_INPUT',
    title: 'Document Input',
    color: '#e3f2fd',
    inputs: [],
    outputs: ['document']
  },
  TEXT_INPUT: {
    type: 'TEXT_INPUT',
    title: 'Text Input',
    color: '#e8eaf6',
    inputs: [],
    outputs: ['text']
  },
  GPT_MODEL: {
    type: 'GPT_MODEL',
    title: 'GPT Model',
    color: '#f3e5f5',
    inputs: ['document', 'context'],
    outputs: ['filled_document']
  },
  TEMPLATE_MODEL: {
    type: 'TEMPLATE_MODEL',
    title: 'Template Model',
    color: '#e8f5e9',
    inputs: ['document', 'values'],
    outputs: ['filled_document']
  },
  DOCUMENT_OUTPUT: {
    type: 'DOCUMENT_OUTPUT',
    title: 'Document Output',
    color: '#fce4ec',
    inputs: ['document'],
    outputs: []
  }
};

function PipelineBuilder() {
  // Add persistence to state
  const [nodes, setNodes] = useState(() => {
    const savedNodes = localStorage.getItem('pipeline-nodes');
    return savedNodes ? JSON.parse(savedNodes) : [];
  });
  
  const [edges, setEdges] = useState(() => {
    const savedEdges = localStorage.getItem('pipeline-edges');
    return savedEdges ? JSON.parse(savedEdges) : [];
  });

  // Save state changes to localStorage
  useEffect(() => {
    localStorage.setItem('pipeline-nodes', JSON.stringify(nodes));
  }, [nodes]);

  useEffect(() => {
    localStorage.setItem('pipeline-edges', JSON.stringify(edges));
  }, [edges]);

  // Add cleanup on unmount
  useEffect(() => {
    return () => {
      // Optional: Save final state before unmount
      localStorage.setItem('pipeline-nodes', JSON.stringify(nodes));
      localStorage.setItem('pipeline-edges', JSON.stringify(edges));
    };
  }, []);

  const [selectedNode, setSelectedNode] = useState(null);
  const [draggingEdge, setDraggingEdge] = useState(null);
  const canvasRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Handle node dragging
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleNodeMouseDown = (e, nodeId) => {
    if (e.target.classList.contains('port')) return; // Don't start dragging on port click
    
    const node = nodes.find(n => n.id === nodeId);
    const rect = e.currentTarget.getBoundingClientRect();
    setDraggingNode(nodeId);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingNode) {
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - canvasRect.left - dragOffset.x;
        const y = e.clientY - canvasRect.top - dragOffset.y;
        moveNode(draggingNode, { x, y });
      }
    };

    const handleMouseUp = () => {
      setDraggingNode(null);
    };

    if (draggingNode) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingNode, dragOffset]);

  // Get port position for edges
  const getPortPosition = (node, portName, type) => {
    if (!node || !canvasRef.current) return null;
    
    const nodeElement = document.getElementById(node.id);
    if (!nodeElement) return null;

    const nodeRect = nodeElement.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();

    const portIndex = type === 'input' 
      ? NODE_TYPES[node.type].inputs.indexOf(portName)
      : NODE_TYPES[node.type].outputs.indexOf(portName);
    
    if (portIndex === -1) return null;
    
    const portCount = type === 'input' 
      ? NODE_TYPES[node.type].inputs.length 
      : NODE_TYPES[node.type].outputs.length;
    const portSpacing = nodeRect.width / (portCount + 1);
    
    return {
      x: nodeRect.left - canvasRect.left + (portIndex + 1) * portSpacing,
      y: type === 'input' ? nodeRect.top - canvasRect.top : nodeRect.bottom - canvasRect.top
    };
  };

  // Execute pipeline
  const executePipeline = async () => {
    try {
      // Convert nodes and edges to a processable format
      const pipeline = {
        blocks: nodes.map(node => ({
          id: node.id,
          type: node.type,
          selectedOptions: node.selectedOptions || {},
          config: {
            ...node.data,
            // Add connected nodes information
            inputs: edges
              .filter(e => e.targetId === node.id)
              .map(e => ({
                sourceId: e.sourceId,
                sourceOutput: e.sourceOutput,
                targetInput: e.targetInput
              })),
            outputs: edges
              .filter(e => e.sourceId === node.id)
              .map(e => ({
                targetId: e.targetId,
                sourceOutput: e.sourceOutput,
                targetInput: e.targetInput
              }))
          }
        }))
      };

      console.log('Sending pipeline config:', pipeline);

      // Find input nodes and their connected documents/text
      const inputNodes = nodes.filter(n => n.type === 'DOCUMENT_INPUT');
      const files = inputNodes
        .map(node => node.data?.file)
        .filter(file => file instanceof File); // Make sure we only have valid File objects

      if (inputNodes.length > 0 && files.length === 0) {
        throw new Error('Please upload a document in the Document Input node');
      }

      // Create FormData with all documents and pipeline configuration
      const formData = new FormData();
      
      // Add files from document input nodes
      files.forEach(file => {
        console.log('Appending file:', file.name);
        formData.append('files', file);
      });

      // Add pipeline configuration
      formData.append('pipeline_config', JSON.stringify(pipeline));

      console.log('Executing pipeline...');
      const response = await fetch('http://localhost:8000/api/pipeline/execute', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Full pipeline execution result:', result);
      
      // Update output nodes with results
      const outputNodes = nodes.filter(n => n.type === 'DOCUMENT_OUTPUT');
      console.log('Found output nodes:', outputNodes);
      
      outputNodes.forEach(node => {
        const inputEdge = edges.find(e => e.targetId === node.id);
        console.log('Found input edge for node:', inputEdge);
        
        if (inputEdge) {
          // Find the source node (GPT Model in this case)
          const sourceNode = nodes.find(n => n.id === inputEdge.sourceId);
          console.log('Source node:', sourceNode);
          
          // Find the corresponding result by tracing back to the document input
          const documentInputEdge = edges.find(e => e.targetId === sourceNode.id && e.targetInput === 'document');
          console.log('Document input edge:', documentInputEdge);
          
          if (documentInputEdge) {
            const documentInputNode = nodes.find(n => n.id === documentInputEdge.sourceId);
            console.log('Document input node:', documentInputNode);
            
            const resultFile = result.results.find(r => 
              documentInputNode && documentInputNode.data?.file?.name === r.filename
            );
            
            console.log('Found result file:', resultFile);
            
            if (resultFile) {
              // Make sure we're getting the content from the right place
              const content = resultFile.content || resultFile.metadata.output_content;
              console.log('Content to display:', content);
              
              updateNodeData(node.id, { 
                content: content,
                docxContent: resultFile.metadata.docx_content,
                docx_available: resultFile.metadata.output_format === 'docx'
              });
            }
          }
        }
      });

    } catch (error) {
      console.error('Pipeline execution failed:', error);
      alert(`Pipeline execution failed: ${error.message}`);
    }
  };

  // Node creation
  const createNode = (type, position) => {
    const nodeType = NODE_TYPES[type];
    const newNode = {
      id: `${type}-${Date.now()}`,
      type,
      title: nodeType.title,
      position,
      color: nodeType.color,
      inputs: nodeType.inputs,
      outputs: nodeType.outputs,
      data: {},
      width: 200,
      height: 100
    };
    setNodes([...nodes, newNode]);
    return newNode;
  };

  // Edge handling
  const startEdge = (nodeId, output, event) => {
    const sourceNode = nodes.find(n => n.id === nodeId);
    setDraggingEdge({
      sourceId: nodeId,
      sourceOutput: output,
      sourcePos: getPortPosition(sourceNode, output, 'output')
    });
  };

  const completeEdge = (targetId, targetInput) => {
    if (!draggingEdge) return;

    // Check if edge already exists
    const edgeExists = edges.some(edge => 
      edge.targetId === targetId && 
      edge.targetInput === targetInput
    );

    if (!edgeExists && draggingEdge.sourceId !== targetId) {
      const newEdge = {
        id: `edge-${Date.now()}`,
        sourceId: draggingEdge.sourceId,
        targetId: targetId,
        sourceOutput: draggingEdge.sourceOutput,
        targetInput: targetInput
      };
      
      setEdges([...edges, newEdge]);
    }
    
    setDraggingEdge(null);
  };

  // Node movement
  const moveNode = (nodeId, position) => {
    setNodes(nodes.map(node => 
      node.id === nodeId 
        ? { ...node, position }
        : node
    ));
  };

  // Node configuration
  const updateNodeData = (nodeId, data) => {
    console.log('Updating node data:', { nodeId, data });
    setNodes(nodes.map(node => {
      if (node.id === nodeId) {
        const updatedNode = {
          ...node,
          data: { ...node.data, ...data }
        };
        console.log('Updated node:', updatedNode);
        return updatedNode;
      }
      return node;
    }));
  };

  // Render functions
  const renderNode = (node) => {
    return (
      <div
        id={node.id}
        className="node"
        data-type={node.type}
        style={{
          left: node.position.x,
          top: node.position.y,
        }}
        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
      >
        <div className="node-title">{node.title}</div>
        <div className="node-inputs">
          {NODE_TYPES[node.type].inputs.map(input => renderPort(input, 'input', node.id))}
        </div>
        <div className="node-content">
          {renderNodeContent(node)}
        </div>
        <div className="node-outputs">
          {NODE_TYPES[node.type].outputs.map(output => renderPort(output, 'output', node.id))}
        </div>
      </div>
    );
  };

  const renderPort = (portName, type, nodeId) => (
    <div className={`port-wrapper ${type}-port`}>
      <div className="port-label">{portName}</div>
      <div
        className="port"
        data-port={portName}
        data-type={type}
        onClick={(e) => handlePortClick(e, nodeId, portName, type)}
      />
    </div>
  );

  const renderNodeContent = (node) => {
    switch (node.type) {
      case 'DOCUMENT_INPUT':
        return (
          <div className="node-content-wrapper">
            <input
              type="file"
              onChange={(e) => updateNodeData(node.id, { file: e.target.files[0] })}
            />
            {node.data?.file && <div className="file-name">{node.data.file.name}</div>}
          </div>
        );
      case 'TEXT_INPUT':
        return (
          <div className="node-content-wrapper">
            <label className="node-label">Context Text</label>
            <textarea
              className="node-textarea"
              value={node.data?.text || ''}
              onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
              placeholder="Enter context..."
            />
          </div>
        );
      case 'GPT_MODEL':
        return (
          <select
            value={node.data?.model || 'gpt-4o'} //don't change the name of the models
            onChange={(e) => updateNodeData(node.id, { model: e.target.value })}
            className="node-select"
          >
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
          </select>
        );
      case 'DOCUMENT_OUTPUT':
        console.log('Rendering output node with data:', node.data);
        return (
          <div className="node-content-wrapper">
            <div className="output-content">
              {node.data?.content ? (
                <>
                  <div className="output-text-container">
                    <pre className="output-text">{node.data.content}</pre>
                  </div>
                  {node.data.docx_available && (
                    <button 
                      className="download-button"
                      onClick={() => downloadOutput(node.data.content, node.id)}
                    >
                      Download DOCX
                    </button>
                  )}
                </>
              ) : (
                <span className="placeholder-text">Output will appear here...</span>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const downloadOutput = async (content, nodeId) => {
    try {
      // Find if we have base64 DOCX content
      const node = nodes.find(n => n.id === nodeId);
      const docxContent = node.data?.docxContent;

      const response = await fetch('http://localhost:8000/download-docx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          content: docxContent || content,
          isBase64: !!docxContent
        }),
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'output.docx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download DOCX file');
    }
  };

  const renderEdges = () => {
    if (!canvasRef.current) return null;

    return (
      <svg className="edges-layer">
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon 
              points="0 0, 10 3.5, 0 7" 
              fill={isDarkMode ? '#8ab4f8' : '#1a73e8'}
            />
          </marker>
        </defs>
        {edges.map(edge => {
          const sourceNode = nodes.find(n => n.id === edge.sourceId);
          const targetNode = nodes.find(n => n.id === edge.targetId);
          if (!sourceNode || !targetNode) return null;

          const sourcePos = getPortPosition(sourceNode, edge.sourceOutput, 'output');
          const targetPos = getPortPosition(targetNode, edge.targetInput, 'input');

          if (!sourcePos || !targetPos) return null;

          return (
            <path
              key={edge.id}
              d={`M ${sourcePos.x} ${sourcePos.y} C ${sourcePos.x + 100} ${sourcePos.y}, ${targetPos.x - 100} ${targetPos.y}, ${targetPos.x} ${targetPos.y}`}
              className="edge"
              markerEnd="url(#arrowhead)"
            />
          );
        })}
        
        {draggingEdge && draggingEdge.sourcePos && (
          <path
            d={`M ${draggingEdge.sourcePos.x} ${draggingEdge.sourcePos.y} C ${draggingEdge.sourcePos.x + 100} ${draggingEdge.sourcePos.y}, ${mousePos.x - 100} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`}
            className="edge edge-dragging"
          />
        )}
      </svg>
    );
  };

  // Add this function after other state declarations
  const clearPipeline = () => {
    if (window.confirm('Are you sure you want to clear the entire pipeline?')) {
      setNodes([]);
      setEdges([]);
      localStorage.removeItem('pipeline-nodes');
      localStorage.removeItem('pipeline-edges');
    }
  };

  // Add these state variables at the top of the component
  const [pipelineName, setPipelineName] = useState('');
  const [savedPipelines, setSavedPipelines] = useState([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Add these functions
  const loadSavedPipelines = async () => {
    try {
      const response = await fetch('http://localhost:8000/list-pipelines');
      if (!response.ok) throw new Error('Failed to load pipelines');
      const data = await response.json();
      setSavedPipelines(data.pipelines);
    } catch (error) {
      console.error('Failed to load pipelines:', error);
      alert('Failed to load saved pipelines');
    }
  };

  const savePipeline = async () => {
    try {
      if (!pipelineName.trim()) {
        alert('Please enter a pipeline name');
        return;
      }

      const pipeline = {
        name: pipelineName,
        nodes: nodes,
        edges: edges
      };

      const response = await fetch('http://localhost:8000/save-pipeline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pipeline)
      });

      if (!response.ok) throw new Error('Failed to save pipeline');
      
      alert('Pipeline saved successfully');
      setShowSaveDialog(false);
      setPipelineName('');
      loadSavedPipelines();
    } catch (error) {
      console.error('Failed to save pipeline:', error);
      alert('Failed to save pipeline');
    }
  };

  const loadPipeline = async (name) => {
    try {
      const response = await fetch(`http://localhost:8000/load-pipeline/${name}`);
      if (!response.ok) throw new Error('Failed to load pipeline');
      
      const pipeline = await response.json();
      
      // Clear existing pipeline first
      setNodes([]);
      setEdges([]);
      
      // Add small delay to ensure DOM is cleared
      setTimeout(() => {
        setNodes(pipeline.nodes);
        setEdges(pipeline.edges);
      }, 100);
      
    } catch (error) {
      console.error('Failed to load pipeline:', error);
      alert('Failed to load pipeline');
    }
  };

  // Load saved pipelines when component mounts
  useEffect(() => {
    loadSavedPipelines();
  }, []);

  // Add theme state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Add effect to handle theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Add this function near other event handlers
  const handlePortClick = (e, nodeId, portName, type) => {
    e.stopPropagation(); // Prevent node dragging when clicking ports
    
    if (type === 'output') {
      // Start drawing an edge from output port
      const node = nodes.find(n => n.id === nodeId);
      const portPos = getPortPosition(node, portName, type);
      setDraggingEdge({
        sourceId: nodeId,
        sourceOutput: portName,
        sourcePos: portPos
      });
    } else if (draggingEdge && type === 'input') {
      // Complete the edge connection to input port
      completeEdge(nodeId, portName);
    }
  };

  return (
    <div className="pipeline-builder">
      <div className="toolbar">
        <div className="toolbar-buttons">
          {Object.keys(NODE_TYPES).map(type => (
            <button
              key={type}
              onClick={() => createNode(type, { x: 100, y: 100 })}
              className="add-node-button"
            >
              Add {NODE_TYPES[type].title}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button 
            className="theme-toggle"
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label="Toggle theme"
          >
            {isDarkMode ? '🌞' : '🌙'}
          </button>
          <button 
            className="save-button"
            onClick={() => setShowSaveDialog(true)}
          >
            Save Pipeline
          </button>
          <select 
            className="load-select"
            onChange={(e) => e.target.value && loadPipeline(e.target.value)}
            value=""
          >
            <option value="">Load Pipeline</option>
            {savedPipelines.map(pipeline => (
              <option key={pipeline.name} value={pipeline.name}>
                {pipeline.name}
              </option>
            ))}
          </select>
          <button 
            className="clear-button"
            onClick={clearPipeline}
          >
            Clear Pipeline
          </button>
        </div>
      </div>
      
      <div 
        className="canvas"
        ref={canvasRef}
        onMouseMove={(e) => {
          const rect = canvasRef.current.getBoundingClientRect();
          setMousePos({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
          });
        }}
      >
        <svg className="edges-layer">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon 
                points="0 0, 10 3.5, 0 7" 
                fill={isDarkMode ? '#8ab4f8' : '#1a73e8'}
              />
            </marker>
          </defs>
          {edges.map(edge => {
            const sourceNode = nodes.find(n => n.id === edge.sourceId);
            const targetNode = nodes.find(n => n.id === edge.targetId);
            if (!sourceNode || !targetNode) return null;

            const sourcePos = getPortPosition(sourceNode, edge.sourceOutput, 'output');
            const targetPos = getPortPosition(targetNode, edge.targetInput, 'input');

            if (!sourcePos || !targetPos) return null;

            return (
              <path
                key={edge.id}
                d={`M ${sourcePos.x} ${sourcePos.y} C ${sourcePos.x + 100} ${sourcePos.y}, ${targetPos.x - 100} ${targetPos.y}, ${targetPos.x} ${targetPos.y}`}
                className="edge"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
          
          {draggingEdge && draggingEdge.sourcePos && (
            <path
              d={`M ${draggingEdge.sourcePos.x} ${draggingEdge.sourcePos.y} C ${draggingEdge.sourcePos.x + 100} ${draggingEdge.sourcePos.y}, ${mousePos.x - 100} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`}
              className="edge edge-dragging"
            />
          )}
        </svg>
        {nodes.map(renderNode)}
      </div>
      
      <button 
        className="execute-button"
        onClick={executePipeline}
      >
        Execute Pipeline
      </button>

      {/* Add save dialog */}
      {showSaveDialog && (
        <div className="save-dialog-overlay">
          <div className="save-dialog">
            <h3>Save Pipeline</h3>
            <input
              type="text"
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="Enter pipeline name"
            />
            <div className="save-dialog-buttons">
              <button onClick={savePipeline}>Save</button>
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PipelineBuilder; 