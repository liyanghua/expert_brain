# Docling worker (optional)

Converts PDF / DOCX / PPTX / images / HTML / etc. to Markdown using [Docling](https://github.com/docling-project/docling).

## Setup

```bash
cd apps/docling-worker
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

First run may download layout models (large).

Node (`tryDoclingConvert` in `@ebs/parsing`) uses **`EBS_PYTHON`** if set, otherwise **`apps/docling-worker/.venv/bin/python3`** when that file exists, otherwise system **`python3`**.

`convert.py` writes **`doc.md`** plus **`assets/`** (exported figures) when present, and records them in **`manifest.json`** (`asset_files`). Node copies `assets/` into `derived/assets/` for API `GET .../assets/:key`.

## CLI

```bash
python convert.py /path/to/file.pdf /path/to/out_dir
```

Exit `2` means Docling is not installed — the Node job-runner falls back to built-in parsers.
