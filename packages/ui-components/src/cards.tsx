import type { SuggestionRecord } from "@ebs/ground-truth-schema";

export type SuggestionCardProps = {
  suggestion: SuggestionRecord;
  onAccept: () => void;
  onEditAccept: () => void;
  onReject: () => void;
  onDefer: () => void;
};

export function SuggestionCard({
  suggestion,
  onAccept,
  onEditAccept,
  onReject,
  onDefer,
}: SuggestionCardProps) {
  return (
    <article
      style={{
        border: "1px solid var(--border, #ccc)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        background: "var(--card-bg, #fafafa)",
      }}
    >
      <header style={{ fontSize: 12, opacity: 0.8 }}>
        {suggestion.suggestion_type} · block {suggestion.target_block_id.slice(0, 8)}…
      </header>
      <p style={{ margin: "8px 0" }}>{suggestion.suggestion_text}</p>
      <small style={{ display: "block", marginBottom: 8 }}>
        {suggestion.rationale}
      </small>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={onAccept}>
          接受
        </button>
        <button type="button" onClick={onEditAccept}>
          编辑后接受
        </button>
        <button type="button" onClick={onReject}>
          拒绝
        </button>
        <button type="button" onClick={onDefer}>
          稍后处理
        </button>
      </div>
    </article>
  );
}

export type GapCardProps = {
  fieldKey: string;
  message: string;
};

export function GapCard({ fieldKey, message }: GapCardProps) {
  return (
    <div
      style={{
        borderLeft: "4px solid #f5a623",
        padding: "6px 10px",
        marginBottom: 6,
        background: "#fff9ed",
      }}
    >
      <strong>{fieldKey}</strong> — {message}
    </div>
  );
}
