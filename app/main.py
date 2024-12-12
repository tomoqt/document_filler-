from fastapi import FastAPI, UploadFile, HTTPException, Form, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from .services.document_converter import DocumentConverter
from .services.openai_service import OpenAIService
from .models.schemas import DocumentFillRequest, DocumentFillResponse
import json
from typing import List
from fastapi.responses import FileResponse, Response
import io
import os
from pathlib import Path
import time

app = FastAPI(title="Document Filler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/convert-and-fill", response_model=DocumentFillResponse)
async def convert_and_fill(
    file: UploadFile = File(...),
    request: str = Form(...)
):
    try:
        print(f"\n[convert_and_fill] Starting processing for file: {file.filename}")
        
        # Parse the JSON string from form data
        request_data = json.loads(request)
        request_obj = DocumentFillRequest(**request_data)
        print(f"[convert_and_fill] Parsed request with batch_size: {request_obj.batch_size}")
        
        if not file.filename.endswith('.docx'):
            print("[convert_and_fill] Error: Invalid file type")
            raise HTTPException(status_code=400, detail="Only .docx files are supported")
        
        # Read the file content
        file_content = await file.read()
        print(f"[convert_and_fill] Read file content: {len(file_content)} bytes")
        
        # Convert DOCX to Markdown
        converter = DocumentConverter()
        markdown_text = converter.docx_to_markdown(file_content)
        print(f"[convert_and_fill] Converted to markdown: {len(markdown_text)} characters")
        print("[convert_and_fill] First 200 chars of markdown:", markdown_text[:200])
        
        # Initialize OpenAI service
        print("[convert_and_fill] Initializing OpenAI service")
        openai_service = OpenAIService()
        
        # Fill the blanks with batch processing
        print("[convert_and_fill] Starting blank filling process")
        filled_document = openai_service.fill_blanks(
            markdown_text,
            request_obj.context,
            request_obj.example,
            request_obj.batch_size
        )
        print("[convert_and_fill] Completed blank filling")
        print("[convert_and_fill] First 200 chars of filled document:", filled_document[:200])
        
        response = DocumentFillResponse(filled_document=filled_document)
        print("[convert_and_fill] Response created, first 200 chars:", response.filled_document[:200])
        return response

    except json.JSONDecodeError:
        print("[convert_and_fill] Error: Invalid JSON in request")
        raise HTTPException(status_code=400, detail="Invalid JSON in request field")
    except Exception as e:
        print(f"[convert_and_fill] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/api/pipeline/execute")
async def execute_pipeline(
    files: List[UploadFile] = File(...),
    pipeline_config: str = Form(...)
):
    try:
        config = json.loads(pipeline_config)
        results = []
        
        for file in files:
            result = await process_file_through_pipeline(file, config['blocks'])
            
            # Convert binary content to base64 if it's DOCX
            if result["metadata"].get("output_format") == "docx":
                import base64
                docx_content = result["metadata"].get("docx_content")
                if docx_content:
                    result["metadata"]["docx_content"] = base64.b64encode(docx_content).decode('utf-8')
            
            results.append({
                "filename": file.filename,
                "content": result["content"].decode('utf-8', errors='ignore') if isinstance(result["content"], bytes) else result["content"],
                "metadata": result["metadata"]
            })
            
        return {"results": results}
    except Exception as e:
        print(f"Pipeline execution error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def process_file_through_pipeline(file: UploadFile, blocks: List[dict]):
    try:
        current_content = await file.read()
        metadata = {
            "filename": file.filename,
            "original_size": len(current_content),
            "output_format": "markdown"  # Default format
        }
        
        # Convert DOCX to markdown immediately if it's a DOCX file
        original_docx = None
        if file.filename.endswith('.docx'):
            original_docx = current_content  # Keep original for later conversion
            converter = DocumentConverter()
            current_content = converter.docx_to_markdown(current_content)
            print(f"[process_file] Converted DOCX to markdown: {len(current_content)} characters")
            print(f"[process_file] First 200 chars: {current_content[:200]}")
        
        for block in blocks:
            if block['type'] == 'DOCUMENT_INPUT':
                metadata['input_type'] = 'document'
                
            elif block['type'] == 'TEXT_INPUT':
                if isinstance(current_content, bytes):
                    current_content = current_content.decode('utf-8', errors='ignore')
                metadata['input_type'] = 'text'
                
            elif block['type'] == 'BLANK_FINDER':
                if isinstance(current_content, bytes):
                    current_content = current_content.decode('utf-8', errors='ignore')
                finder = DocumentConverter()
                blanks = finder.find_blanks(current_content)
                metadata['blanks_found'] = blanks
                print(f"[process_file] Found blanks: {blanks}")
                
            elif block['type'] == 'GPT_MODEL':
                # Get context from connected TEXT_INPUT nodes
                context = ""
                for input_conn in block['config'].get('inputs', []):
                    if input_conn['targetInput'] == 'context':
                        source_node_id = input_conn['sourceId']
                        # Find the source node's text in the pipeline config
                        for node in blocks:
                            if node['id'] == source_node_id:
                                context = node['config'].get('text', '')
                                break
                
                print(f"[process_file] Using context: {context}")
                
                # Use OpenAI to fill blanks
                openai_service = OpenAIService()
                current_content = openai_service.fill_blanks(
                    current_content,
                    context,
                    batch_size=15
                )
                
            elif block['type'] == 'TEMPLATE_MODEL':
                if isinstance(current_content, bytes):
                    current_content = current_content.decode('utf-8', errors='ignore')
                template_values = block['config'].get('template_values', {})
                for key, value in template_values.items():
                    current_content = current_content.replace(f"[{key}]", value)
                    
            elif block['type'] == 'DOCUMENT_OUTPUT':
                print("[process_file] Processing DOCUMENT_OUTPUT block")
                if isinstance(current_content, bytes):
                    current_content = current_content.decode('utf-8', errors='ignore')
                
                print(f"[process_file] Current content type: {type(current_content)}")
                print(f"[process_file] Current content preview: {current_content[:200]}")
                
                # Convert back to DOCX if original was DOCX
                if original_docx is not None:
                    print("[process_file] Converting back to DOCX")
                    converter = DocumentConverter()
                    docx_content = converter.markdown_to_docx(current_content)
                    metadata['docx_content'] = docx_content
                    metadata['output_format'] = 'docx'
                    print("[process_file] DOCX conversion complete")
                
                metadata['output_content'] = current_content
                
        return {
            "content": current_content,
            "metadata": metadata
        }
        
    except Exception as e:
        print(f"Error processing file {file.filename}: {str(e)}")
        raise

@app.post("/download-docx")
async def download_docx(content: dict):
    try:
        # Check if we received base64 encoded content
        if content.get('isBase64'):
            import base64
            docx_content = base64.b64decode(content['content'])
        else:
            # Convert markdown to DOCX
            converter = DocumentConverter()
            docx_content = converter.markdown_to_docx(content['content'])
        
        # Return the content directly as a response with appropriate headers
        return Response(
            content=docx_content,
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            headers={
                'Content-Disposition': 'attachment; filename="output.docx"'
            }
        )
    except Exception as e:
        print(f"Download error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save-pipeline")
async def save_pipeline(pipeline: dict):
    try:
        # Create pipelines directory if it doesn't exist
        pipeline_dir = Path("saved_pipelines")
        pipeline_dir.mkdir(exist_ok=True)
        
        # Save pipeline with timestamp
        pipeline_name = pipeline.get('name', f'pipeline_{int(time.time())}')
        file_path = pipeline_dir / f"{pipeline_name}.json"
        
        with open(file_path, 'w') as f:
            json.dump(pipeline, f, indent=2)
            
        return {"message": f"Pipeline saved as {pipeline_name}"}
    except Exception as e:
        print(f"Save pipeline error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/list-pipelines")
async def list_pipelines():
    try:
        pipeline_dir = Path("saved_pipelines")
        pipeline_dir.mkdir(exist_ok=True)
        
        pipelines = []
        for file in pipeline_dir.glob("*.json"):
            pipelines.append({
                "name": file.stem,
                "file": file.name,
                "modified": os.path.getmtime(file)
            })
            
        return {"pipelines": sorted(pipelines, key=lambda x: x['modified'], reverse=True)}
    except Exception as e:
        print(f"List pipelines error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/load-pipeline/{name}")
async def load_pipeline(name: str):
    try:
        file_path = Path("saved_pipelines") / f"{name}.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Pipeline not found")
            
        with open(file_path, 'r') as f:
            pipeline = json.load(f)
            
        return pipeline
    except Exception as e:
        print(f"Load pipeline error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
 