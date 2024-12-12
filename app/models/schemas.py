from pydantic import BaseModel
from typing import Optional, List, Dict

class DocumentFillRequest(BaseModel):
    context: str
    example: Optional[str] = None
    batch_size: Optional[int] = 30  # Default to 3 pages per batch

class DocumentFillResponse(BaseModel):
    filled_document: str

class BlankFill(BaseModel):
    original: str
    filled: str

class PageFills(BaseModel):
    page_number: int
    blanks: List[BlankFill] 