import { describe, expect, it, vi } from "vitest";
import { NotebookRagClient } from "./rag-client.js";

describe("NotebookRagClient", () => {
  it("returns unhealthy when sidecar is unavailable", async () => {
    const client = new NotebookRagClient({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    });

    await expect(client.health()).resolves.toBe(false);
  });

  it("posts content list payloads to the sidecar ingest endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          doc_id: "doc-1",
          version_id: "v1",
          parse_mode: "sidecar_content_list",
          retrieval_mode: "sidecar_hybrid",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ) as typeof fetch;
    const client = new NotebookRagClient({
      baseUrl: "http://127.0.0.1:8790",
      fetchImpl,
    });

    const response = await client.ingestContentList({
      docId: "doc-1",
      versionId: "v1",
      contentList: [{ id: "b1", node_type: "text", text: "hello" }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8790/rag/ingest-content-list",
    );
    expect(response.parse_mode).toBe("sidecar_content_list");
  });
});
