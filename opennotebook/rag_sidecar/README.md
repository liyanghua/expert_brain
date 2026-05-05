# OpenNotebook RAG Sidecar

这是 `opennotebook/` 内部使用的本地多模态 sidecar 骨架。

当前能力：

- `GET /rag/health`
- `POST /rag/ingest-content-list`
- `POST /rag/ingest-file`
- `POST /rag/retrieve`
- `POST /rag/build-evidence-pack`

设计目标：

- 优先作为 `RAG-Anything` 的接缝层
- 当前环境没安装 `uv / fastapi / pydantic` 时，主系统会自动 fallback 到 Node 侧本地 retrieval
- 后续只需要在这个目录内替换具体实现，不需要改 `opennotebook/server`

## 建议运行方式

依赖安装完后：

```bash
cd opennotebook/rag_sidecar
python3 -m uvicorn app:app --host 127.0.0.1 --port 8790 --reload
```
