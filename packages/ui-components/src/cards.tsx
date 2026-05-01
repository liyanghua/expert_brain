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
  fieldLabel?: string;
  message: string;
};

export function GapCard({ fieldKey, fieldLabel, message }: GapCardProps) {
  return (
    <div
      style={{
        border: "1px solid rgba(245, 166, 35, 0.38)",
        borderLeft: "4px solid var(--warn, #f5a623)",
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 8,
        background:
          "linear-gradient(135deg, rgba(245, 166, 35, 0.13), rgba(12, 15, 20, 0.92))",
        color: "var(--text, #e8ecf4)",
        boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <strong style={{ fontSize: 14 }}>
          {fieldLabel ?? fieldKey}
        </strong>
        <code
          style={{
            color: "var(--muted, #8b95a8)",
            fontSize: 11,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 999,
            padding: "2px 7px",
            whiteSpace: "nowrap",
          }}
        >
          {fieldKey}
        </code>
      </div>
      <p
        style={{
          margin: 0,
          color: "rgba(232, 236, 244, 0.9)",
          lineHeight: 1.5,
          fontSize: 13,
        }}
      >
        {message}
      </p>
    </div>
  );
}
