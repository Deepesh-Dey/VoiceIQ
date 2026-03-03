from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
import uuid
import logging

from app.services.data_processor import parse_file, get_preview, store_context
from app.models.schemas import UploadResponse

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json"}


@router.post("/", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    Upload a business data file (CSV / Excel / JSON).

    The file is parsed, a compact text summary is stored server-side
    under a new session_id, and metadata + a row preview are returned
    to the frontend so the user can confirm the upload was successful.
    """
    filename = file.filename or "upload"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: CSV, XLSX, XLS, JSON.",
        )

    try:
        file_bytes = await file.read()
        df, context = parse_file(file_bytes, filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"File parse error: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse file.")

    session_id = str(uuid.uuid4())
    store_context(session_id, context)

    return UploadResponse(
        session_id=session_id,
        filename=filename,
        rows=len(df),
        columns=list(df.columns),
        preview=get_preview(df, n=5),
        message=f"File '{filename}' loaded successfully. You can now start asking questions.",
    )
