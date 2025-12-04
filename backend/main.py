"""
FastAPI backend for the document editor.

Provides endpoints for:
- Uploading DOCX files and converting to Tiptap JSON
- Retrieving converted documents
"""

from enum import Enum
from typing import Optional

from docx2tiptap import (
    comments_to_dict,
    create_docx_from_tiptap,
    elements_to_dict,
    parse_docx,
    to_tiptap,
)
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(
    title="Document Editor API",
    description="Convert DOCX files to Tiptap-compatible JSON",
    version="0.1.0",
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for PoC
documents: dict[str, dict] = {}
# Storage for custom templates
templates: dict[str, bytes] = {}


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Document Editor API"}


@app.post("/upload")
async def upload_document(file: UploadFile):
    """
    Upload a DOCX file and convert it to Tiptap JSON.

    Returns both the intermediate format and the Tiptap document.
    """
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(
            status_code=400, detail="File must be a .docx document"
        )

    try:
        content = await file.read()

        # Parse the document (now returns elements and comments)
        elements, comments = parse_docx(content)

        # Convert to both formats
        intermediate = elements_to_dict(elements)
        tiptap_doc = to_tiptap(elements, comments)
        comments_list = comments_to_dict(comments)

        # Generate document ID and store
        import uuid

        doc_id = str(uuid.uuid4())
        documents[doc_id] = {
            "filename": file.filename,
            "intermediate": intermediate,
            "tiptap": tiptap_doc,
            "comments": comments_list,
            "original_bytes": content,  # Store original for template use
        }

        return {
            "id": doc_id,
            "filename": file.filename,
            "tiptap": tiptap_doc,
            "intermediate": intermediate,
            "comments": comments_list,
        }

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Failed to parse document: {str(e)}"
        )


@app.get("/documents/{doc_id}")
async def get_document(doc_id: str):
    """Retrieve a previously uploaded document."""
    if doc_id not in documents:
        raise HTTPException(status_code=404, detail="Document not found")

    return documents[doc_id]


@app.get("/documents")
async def list_documents():
    """List all uploaded documents."""
    return [
        {"id": doc_id, "filename": doc["filename"]}
        for doc_id, doc in documents.items()
    ]


class CommentExport(BaseModel):
    """Comment data for export."""

    id: str
    author: str
    text: str
    date: str | None = None
    initials: str | None = None


class TemplateOption(str, Enum):
    """Template options for export."""

    NONE = "none"  # No template (default python-docx)
    ORIGINAL = "original"  # Use original uploaded document as template
    CUSTOM = "custom"  # Use a custom uploaded template


class ExportRequest(BaseModel):
    """Request body for exporting a document."""

    tiptap: dict
    filename: str = "document.docx"
    comments: list[CommentExport] = []
    template: TemplateOption = TemplateOption.NONE
    document_id: str | None = None  # Required if template is "original"
    template_id: str | None = None  # Required if template is "custom"


@app.post("/templates/upload")
async def upload_template(file: UploadFile):
    """
    Upload a custom template document.

    Returns a template ID that can be used in export requests.
    """
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(
            status_code=400, detail="Template must be a .docx document"
        )

    try:
        import uuid

        content = await file.read()
        template_id = str(uuid.uuid4())
        templates[template_id] = content

        return {
            "id": template_id,
            "filename": file.filename,
            "message": "Template uploaded successfully",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to upload template: {str(e)}"
        )


@app.get("/templates")
async def list_templates():
    """List all uploaded templates."""
    return [{"id": tid} for tid in templates.keys()]


@app.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    """Delete a custom template."""
    if template_id not in templates:
        raise HTTPException(status_code=404, detail="Template not found")

    del templates[template_id]
    return {"message": "Template deleted"}


@app.post("/export")
async def export_document(request: ExportRequest):
    """
    Export TipTap JSON back to a Word document.

    Takes the current editor state and converts it to a .docx file.

    Template options:
    - none: Use default python-docx template (blank)
    - original: Use the original uploaded document as template (preserves styles)
    - custom: Use a previously uploaded custom template
    """
    try:
        # Convert comments to dict format
        comments_list = [c.model_dump() for c in request.comments]

        # Determine template bytes
        template_bytes: Optional[bytes] = None

        if request.template == TemplateOption.ORIGINAL:
            if not request.document_id:
                raise HTTPException(
                    status_code=400,
                    detail="document_id required when using original template",
                )
            if request.document_id not in documents:
                raise HTTPException(
                    status_code=404, detail="Document not found"
                )
            template_bytes = documents[request.document_id].get(
                "original_bytes"
            )

        elif request.template == TemplateOption.CUSTOM:
            if not request.template_id:
                raise HTTPException(
                    status_code=400,
                    detail="template_id required when using custom template",
                )
            if request.template_id not in templates:
                raise HTTPException(
                    status_code=404, detail="Template not found"
                )
            template_bytes = templates[request.template_id]

        # Convert TipTap JSON to DOCX
        docx_buffer = create_docx_from_tiptap(
            request.tiptap, comments_list, template_bytes
        )

        # Ensure filename ends with .docx
        filename = request.filename
        if not filename.endswith(".docx"):
            filename = filename.rsplit(".", 1)[0] + ".docx"

        return StreamingResponse(
            docx_buffer,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Failed to export document: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
