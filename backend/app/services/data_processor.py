"""
Data processor service.

Parses uploaded business data files (CSV, Excel, JSON) using pandas
and converts them into:
  1. A structured summary for LLM context injection.
  2. Metadata (row count, column names, preview rows) for the frontend.
"""
import io
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


def _df_to_context_string(df: pd.DataFrame, max_rows: int = 50) -> str:
    """
    Convert a DataFrame into a compact text block for LLM context.

    Includes:
     - Column names and inferred types
     - Basic statistics for numeric columns
     - A sample of rows (up to max_rows)
    """
    lines: List[str] = []

    # Column info
    lines.append("COLUMNS:")
    for col in df.columns:
        dtype = str(df[col].dtype)
        try:
            n_unique = df[col].nunique(dropna=False)
        except TypeError:
            # Column contains unhashable types (e.g. dicts/lists) – stringify first
            n_unique = df[col].astype(str).nunique(dropna=False)
        lines.append(f"  - {col} (type: {dtype}, unique values: {n_unique})")

    lines.append(f"\nTOTAL ROWS: {len(df)}")

    # Numeric statistics
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    if numeric_cols:
        lines.append("\nNUMERIC STATISTICS:")
        stats = df[numeric_cols].describe().to_string()
        lines.append(stats)

    # Sample rows – stringify object columns to avoid repr issues
    sample = df.head(max_rows).copy()
    for col in sample.select_dtypes(include='object').columns:
        sample[col] = sample[col].astype(str)
    lines.append(f"\nDATA SAMPLE (first {min(max_rows, len(df))} rows):")
    lines.append(sample.to_string(index=False))

    return "\n".join(lines)


def parse_file(file_bytes: bytes, filename: str) -> Tuple[pd.DataFrame, str]:
    """
    Parse a business data file into a DataFrame and a context string.

    Supports: .csv, .xlsx, .xls, .json

    Returns:
        (dataframe, context_string)
    """
    suffix = Path(filename).suffix.lower()
    buf = io.BytesIO(file_bytes)

    if suffix == ".csv":
        # Try to auto-detect delimiter
        try:
            df = pd.read_csv(buf, sep=None, engine="python")
        except Exception:
            buf.seek(0)
            df = pd.read_csv(buf)

    elif suffix in (".xlsx", ".xls"):
        df = pd.read_excel(buf)

    elif suffix == ".json":
        raw = json.loads(file_bytes.decode("utf-8"))
        if isinstance(raw, list):
            df = pd.DataFrame(raw)
        elif isinstance(raw, dict):
            # Handle {"data": [...]} or flat dict-of-lists
            if any(isinstance(v, list) for v in raw.values()):
                df = pd.DataFrame(raw)
            else:
                df = pd.DataFrame([raw])
        else:
            raise ValueError("Unsupported JSON structure.")

    else:
        raise ValueError(f"Unsupported file type: {suffix}. Use CSV, Excel, or JSON.")

    # Clean up column names
    df.columns = [str(c).strip() for c in df.columns]

    context = _df_to_context_string(df)
    logger.info(f"Parsed '{filename}': {len(df)} rows, {len(df.columns)} columns")
    return df, context


def get_preview(df: pd.DataFrame, n: int = 5) -> List[Dict[str, Any]]:
    """Return first n rows as a list of dicts (JSON-serialisable)."""
    return df.head(n).fillna("").astype(str).to_dict(orient="records")


# ─── In-memory session store ──────────────────────────────────────────────────
# Maps session_id -> context string
# In production, replace with Redis or a database.
_session_contexts: Dict[str, str] = {}


def store_context(session_id: str, context: str) -> None:
    _session_contexts[session_id] = context


def get_context(session_id: str) -> str:
    return _session_contexts.get(session_id, "")


def clear_context(session_id: str) -> None:
    _session_contexts.pop(session_id, None)
