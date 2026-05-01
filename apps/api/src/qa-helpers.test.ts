import { describe, expect, it, vi } from "vitest";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import {
  candidateInputForQa,
  draftForQaContext,
} from "./qa-helpers.js";

describe("draftForQaContext", () => {
  it("uses an empty transient draft without running structuring when no draft exists", async () => {
    const runStructuring = vi.fn();

    const draft = await draftForQaContext({
      docId: "doc-qa",
      versionId: "v1",
      readDraft: () => null,
      runStructuring,
    });

    expect(draft).toEqual(emptyGroundTruthDraft("doc-qa", "v1"));
    expect(runStructuring).not.toHaveBeenCalled();
  });
});

describe("candidateInputForQa", () => {
  it("falls back invalid model fields to a writable schema field", () => {
    const candidate = candidateInputForQa({
      requestedTargetField: null,
      qa: {
        direct_answer: "成长品的区间用于解释为什么该商品有成长潜力。",
        rationale: "用户追问为什么，适合作为判断依据。",
        source_block_refs: [],
        target_field: "商品分类策略.成长品定义",
        suggested_writeback: {
          field_key: "商品分类策略.成长品定义",
          content: "成长品：近30天GMV排名在叶子类目TOP55%—TOP5‰的非新品。",
        },
      },
      evidenceBlockIds: ["b2", "b3"],
      question: "为什么成长品是这个区间？",
    });

    expect(candidate.fieldKey).toBe("judgment_basis");
    expect(candidate.content).toBe(
      "成长品：近30天GMV排名在叶子类目TOP55%—TOP5‰的非新品。",
    );
    expect(candidate.sourceBlockIds).toEqual(["b2", "b3"]);
  });
});
