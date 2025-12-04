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
# Storage for raw OOXML styling data (indexed by document_id -> element_id -> raw data)
raw_styles: dict[str, dict] = {}


def extract_raw_styles(tiptap_doc: dict) -> dict:
    """
    Extract raw OOXML styling data from TipTap document and return it separately.

    This removes rawXml, rawTblPr, rawTblGrid attributes from the TipTap doc
    and returns them indexed by element IDs for later restoration during export.

    Also removes colwidth/colwidths attributes since:
    1. They are in twips (1/1440 inch) which TipTap interprets as pixels
    2. The raw XML already contains proper width info for export
    """
    styles = {}

    def process_node(node: dict):
        if node.get("type") == "table":
            attrs = node.get("attrs", {})
            table_id = attrs.get("id")
            if table_id:
                table_styles = {}
                # Extract table-level raw XML
                if "rawTblPr" in attrs:
                    table_styles["rawTblPr"] = attrs.pop("rawTblPr")
                if "rawTblGrid" in attrs:
                    table_styles["rawTblGrid"] = attrs.pop("rawTblGrid")

                # Process rows
                row_styles = {}
                for row_idx, row in enumerate(node.get("content", [])):
                    row_attrs = row.get("attrs", {})
                    if "rawXml" in row_attrs:
                        row_styles[row_idx] = {
                            "rawXml": row_attrs.pop("rawXml")
                        }

                    # Process cells
                    cell_styles = {}
                    for cell_idx, cell in enumerate(row.get("content", [])):
                        cell_attrs = cell.get("attrs", {})
                        if "rawXml" in cell_attrs:
                            cell_styles[cell_idx] = {
                                "rawXml": cell_attrs.pop("rawXml")
                            }
                        # Remove width attributes - they're in twips which
                        # TipTap interprets as pixels, causing layout issues.
                        # The raw XML has the correct widths for export.
                        if "colwidth" in cell_attrs:
                            cell_attrs.pop("colwidth")

                    if cell_styles:
                        if row_idx not in row_styles:
                            row_styles[row_idx] = {}
                        row_styles[row_idx]["cells"] = cell_styles

                if row_styles:
                    table_styles["rows"] = row_styles

                if table_styles:
                    styles[table_id] = table_styles

        # Recurse into content
        for child in node.get("content", []):
            if isinstance(child, dict):
                process_node(child)

    process_node(tiptap_doc)
    return styles


def restore_raw_styles(tiptap_doc: dict, styles: dict) -> dict:
    """
    Restore raw OOXML styling data back into TipTap document before export.

    This merges the previously extracted raw XML back into the document
    based on element IDs.
    """
    import copy

    doc = copy.deepcopy(tiptap_doc)

    def process_node(node: dict):
        if node.get("type") == "table":
            attrs = node.get("attrs", {})
            table_id = attrs.get("id")
            if table_id and table_id in styles:
                table_styles = styles[table_id]

                # Restore table-level raw XML
                if "rawTblPr" in table_styles:
                    attrs["rawTblPr"] = table_styles["rawTblPr"]
                if "rawTblGrid" in table_styles:
                    attrs["rawTblGrid"] = table_styles["rawTblGrid"]

                # Restore row and cell styles
                row_styles = table_styles.get("rows", {})
                for row_idx, row in enumerate(node.get("content", [])):
                    if row_idx in row_styles:
                        row_style = row_styles[row_idx]
                        if "rawXml" in row_style:
                            if "attrs" not in row:
                                row["attrs"] = {}
                            row["attrs"]["rawXml"] = row_style["rawXml"]

                        # Restore cell styles
                        cell_styles = row_style.get("cells", {})
                        for cell_idx, cell in enumerate(row.get("content", [])):
                            if cell_idx in cell_styles:
                                if "attrs" not in cell:
                                    cell["attrs"] = {}
                                cell["attrs"]["rawXml"] = cell_styles[cell_idx][
                                    "rawXml"
                                ]

        # Recurse into content
        for child in node.get("content", []):
            if isinstance(child, dict):
                process_node(child)

    process_node(doc)
    return doc


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

        # Generate document ID
        import uuid

        doc_id = str(uuid.uuid4())

        # Extract raw OOXML styles and store them separately
        # This data is too large/complex for the frontend to handle
        # We'll merge it back during export
        styles = extract_raw_styles(tiptap_doc)
        raw_styles[doc_id] = styles

        documents[doc_id] = {
            "filename": file.filename,
            "intermediate": intermediate,
            "tiptap": tiptap_doc,  # Now has raw XML stripped out
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

        # Restore raw OOXML styles if we have them for this document
        tiptap_with_styles = request.tiptap
        if request.document_id and request.document_id in raw_styles:
            tiptap_with_styles = restore_raw_styles(
                request.tiptap, raw_styles[request.document_id]
            )

        # Convert TipTap JSON to DOCX
        docx_buffer = create_docx_from_tiptap(
            tiptap_with_styles, comments_list, template_bytes
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
