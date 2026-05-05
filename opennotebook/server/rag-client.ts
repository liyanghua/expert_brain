type FetchLike = typeof fetch;

export type RagHealthResponse = {
  ok: boolean;
};

export type RagIngestResponse = {
  ok: boolean;
  doc_id: string;
  version_id: string;
  parse_mode: string;
  retrieval_mode: string;
  fallback_reason?: string;
};

export class NotebookRagClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(input?: { baseUrl?: string; fetchImpl?: FetchLike }) {
    this.baseUrl = input?.baseUrl ?? process.env.OPENNOTEBOOK_RAG_URL ?? "http://127.0.0.1:8790";
    this.fetchImpl = input?.fetchImpl ?? fetch;
  }

  async health() {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/rag/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async ingestContentList(input: {
    docId: string;
    versionId: string;
    contentList: unknown[];
  }): Promise<RagIngestResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/rag/ingest-content-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_id: input.docId,
        version_id: input.versionId,
        content_list: input.contentList,
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as RagIngestResponse;
  }
}
