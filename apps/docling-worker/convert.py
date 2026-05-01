"""
Convert a document to Markdown via Docling. Exit codes:
  0 — success (doc.md + manifest.json written; assets/ when figures exist)
  2 — docling not installed (caller should fallback)
  1 — conversion error
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def _normalize_markdown_asset_paths(md_text: str) -> str:
    """Rewrite absolute .../assets/file.ext links to ./assets/file.ext for portability."""
    return re.sub(
        r"\]\((?:file://)?[^)]*?/assets/([^)]+\.(?:png|jpe?g|gif|webp|svg))\)",
        r"](./assets/\1)",
        md_text,
        flags=re.IGNORECASE,
    )


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: convert.py <input_file> <output_dir>", file=sys.stderr)
        sys.exit(1)

    try:
        from docling.document_converter import DocumentConverter
        from docling_core.types.doc.base import ImageRefMode
    except ImportError:
        sys.exit(2)

    inp = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    assets_dir = out / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    try:
        converter = DocumentConverter()
        result = converter.convert(str(inp))
        md_path = out / "doc.md"
        result.document.save_as_markdown(
            md_path,
            artifacts_dir=assets_dir,
            image_mode=ImageRefMode.REFERENCED,
        )
        md_raw = md_path.read_text(encoding="utf-8")
        md_path.write_text(_normalize_markdown_asset_paths(md_raw), encoding="utf-8")

        asset_files = sorted(
            p.name for p in assets_dir.iterdir() if p.is_file()
        )
        manifest = {
            "ok": True,
            "input": str(inp),
            "markdown_file": "doc.md",
            "assets_dir": "assets",
            "asset_files": asset_files,
        }
        (out / "manifest.json").write_text(
            json.dumps(manifest, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
