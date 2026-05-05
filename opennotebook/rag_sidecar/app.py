from __future__ import annotations

from typing import Any

try:
    from fastapi import FastAPI
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "fastapi is required to run opennotebook/rag_sidecar. "
        "Install fastapi and uvicorn in your local Python environment."
    ) from exc


app = FastAPI(title="OpenNotebook RAG Sidecar")


@app.get("/rag/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/rag/ingest-content-list")
def ingest_content_list(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "doc_id": payload.get("doc_id"),
        "version_id": payload.get("version_id"),
        "parse_mode": "sidecar_content_list",
        "retrieval_mode": "sidecar_hybrid",
    }


@app.post("/rag/ingest-file")
def ingest_file() -> dict[str, Any]:
    return {
        "ok": True,
        "parse_mode": "sidecar_file_ingest",
        "retrieval_mode": "sidecar_hybrid",
    }


@app.post("/rag/retrieve")
def retrieve(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "query": payload.get("query"),
        "hits": [],
    }


@app.post("/rag/build-evidence-pack")
def build_evidence_pack(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "field_key": payload.get("field_key"),
        "blocks": payload.get("blocks", []),
    }
