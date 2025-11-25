"""
FastAPI backend for the document editor.

Provides endpoints for:
- Uploading DOCX files and converting to Tiptap JSON
- Retrieving converted documents
"""

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from parser import parse_docx, to_tiptap
from parser.docx_parser import elements_to_dict

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

        # Parse the document
        elements = parse_docx(content)

        # Convert to both formats
        intermediate = elements_to_dict(elements)
        tiptap_doc = to_tiptap(elements)

        # Generate document ID and store
        import uuid

        doc_id = str(uuid.uuid4())
        documents[doc_id] = {
            "filename": file.filename,
            "intermediate": intermediate,
            "tiptap": tiptap_doc,
        }

        return {
            "id": doc_id,
            "filename": file.filename,
            "tiptap": tiptap_doc,
            "intermediate": intermediate,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
