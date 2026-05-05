import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../src/pipeline.js";

describe("agent mode pipeline", () => {
  it("runs all nine backend steps and writes observable artifacts", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-"));
    const run = await runPipeline({
      input: "data/fixtures/sample.md",
      outputRoot,
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    assert.deepEqual(
      run.steps.map((step) => step.status),
      Array.from({ length: 10 }, () => "completed"),
    );
    assert.ok(run.artifacts.includes("document_ir.json"));
    assert.ok(run.artifacts.includes("document_understanding.json"));
    assert.ok(run.artifacts.includes("agent_plan.v0.json"));
    assert.ok(run.artifacts.includes("score_delta.json"));
    assert.ok(run.artifacts.includes("run_summary.json"));

    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { final_status: string; artifact_count: number; parse_profile: string };
    assert.equal(summary.final_status, "completed");
    assert.equal(summary.parse_profile, "builtin");
    assert.ok(summary.artifact_count > 10);
  });

  it("runs from scene registry default document and uses scene profiles", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-scene-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const sceneBinding = JSON.parse(
      readFileSync(join(run.run_dir, "scene_binding.json"), "utf8"),
    ) as { scene_id: string; schema_profile_version: string };
    const plan = JSON.parse(
      readFileSync(join(run.run_dir, "agent_plan.v0.json"), "utf8"),
    ) as { steps: { target_field?: string; rationale: string }[] };

    assert.equal(sceneBinding.scene_id, "product_link_diagnosis");
    assert.equal(sceneBinding.schema_profile_version, "schema.product_link_diagnosis.v1");
    assert.ok(
      plan.steps.some((step) =>
        ["judgment_criteria", "validation_methods"].includes(step.target_field ?? ""),
      ),
    );
    assert.ok(plan.steps.some((step) => step.rationale.includes("优先补")));
  });

  it("runs Step 1 with the docling parse profile through a mock fixture", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-docling-"));
    const fixturePath = join(outputRoot, "docling-output.md");
    writeFileSync(
      fixturePath,
      ["# Mock Docling", "", "| Field | Value |", "| --- | --- |", "| goal | improve link |"].join(
        "\n",
      ),
      "utf8",
    );
    process.env.AGENT_MODE_RUNNER_DOCLING_MARKDOWN_FIXTURE = fixturePath;
    try {
      const run = await runPipeline({
        input: "data/fixtures/sample.md",
        outputRoot,
        parseProfile: "docling",
        approvalMode: "auto",
        reviewMode: "mock",
        toolProfile: "builtin",
      });

      assert.equal(run.status, "completed");
      const diagnostics = JSON.parse(
        readFileSync(join(run.run_dir, "parse_diagnostics.json"), "utf8"),
      ) as { parser_name: string; table_count: number; raw_docling_output_path?: string };
      const summary = JSON.parse(
        readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
      ) as { parse_profile: string };

      assert.equal(summary.parse_profile, "docling");
      assert.equal(diagnostics.parser_name, "docling");
      assert.equal(diagnostics.table_count, 1);
      assert.equal(diagnostics.raw_docling_output_path, "raw_docling_output.json");
      assert.ok(run.artifacts.includes("raw_docling_output.json"));
    } finally {
      delete process.env.AGENT_MODE_RUNNER_DOCLING_MARKDOWN_FIXTURE;
    }
  });

  it("records marked parse profile in summary and diagnostics", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-marked-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const diagnostics = JSON.parse(
      readFileSync(join(run.run_dir, "parse_diagnostics.json"), "utf8"),
    ) as { parser_name: string; table_count: number };
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { parse_profile: string };

    assert.equal(summary.parse_profile, "marked");
    assert.equal(diagnostics.parser_name, "marked_markdown_parser");
    assert.ok(diagnostics.table_count >= 1);
  });

  it("records profile_table understanding profile in summary and artifacts", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-understanding-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      understandingProfile: "profile_table",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { understanding_profile: string };
    const hints = JSON.parse(
      readFileSync(join(run.run_dir, "section_evidence_hints.json"), "utf8"),
    ) as { sections: { table_block_ids: string[] }[] };

    assert.equal(summary.understanding_profile, "profile_table");
    assert.ok(hints.sections.some((section) => section.table_block_ids.length > 0));
  });

  it("records hinted extraction profile and evidence trace", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-extraction-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      understandingProfile: "profile_table",
      extractionProfile: "hinted",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { extraction_profile: string };
    const trace = JSON.parse(
      readFileSync(join(run.run_dir, "extraction_evidence_trace.json"), "utf8"),
    ) as { fields: Record<string, { table_backed: boolean }> };

    assert.equal(summary.extraction_profile, "hinted");
    assert.ok(Object.values(trace.fields).some((field) => field.table_backed));
  });

  it("records structured_context understanding artifacts", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-structured-context-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      understandingProfile: "structured_context",
      extractionProfile: "hinted",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { understanding_profile: string };
    const sections = JSON.parse(
      readFileSync(join(run.run_dir, "structured_sections.json"), "utf8"),
    ) as { sections: unknown[] };
    const contextualized = JSON.parse(
      readFileSync(join(run.run_dir, "contextualized_blocks.json"), "utf8"),
    ) as { blocks: unknown[] };
    const enhancedUnits = JSON.parse(
      readFileSync(join(run.run_dir, "semantic_units.llm.v0.json"), "utf8"),
    ) as { units: { unit_title?: string; llm_summary?: string; schema_field_matches?: unknown[] }[] };
    const matches = JSON.parse(
      readFileSync(join(run.run_dir, "semantic_unit_schema_matches.v0.json"), "utf8"),
    ) as { units: { schema_field_matches?: { relation: string }[] }[] };
    const evaluation = JSON.parse(
      readFileSync(join(run.run_dir, "semantic_unit_evaluation_report.json"), "utf8"),
    ) as { semantic_navigation_score: number; metrics: Record<string, number> };
    const markdownReport = readFileSync(
      join(process.cwd(), "apps/agent-mode-runner/report/semantic_unit_schema_match_evaluation.md"),
      "utf8",
    );

    assert.equal(summary.understanding_profile, "structured_context");
    assert.ok(sections.sections.length > 0);
    assert.ok(contextualized.blocks.length > 0);
    assert.ok(enhancedUnits.units.some((unit) => unit.unit_title && unit.llm_summary));
    assert.ok(matches.units.some((unit) => unit.schema_field_matches?.some((match) => match.relation === "primary")));
    assert.ok(evaluation.semantic_navigation_score > 0);
    assert.match(markdownReport, /Semantic Unit & Schema Match Evaluation/);
    assert.ok(run.artifacts.includes("structured_section_summaries.json"));
    assert.ok(run.artifacts.includes("document_synthesis.json"));
    assert.ok(run.artifacts.includes("block_role_map.json"));
    assert.ok(run.artifacts.includes("semantic_units.llm.v0.json"));
  });

  it("records schema_guided extraction profile and source-grounded artifacts", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-schema-guided-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      understandingProfile: "structured_context",
      extractionProfile: "schema_guided",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { extraction_profile: string };
    const evidenceMap = JSON.parse(
      readFileSync(join(run.run_dir, "schema_guided_evidence_map.json"), "utf8"),
    ) as { fields: Record<string, { source_grounded: boolean }> };
    const validation = JSON.parse(
      readFileSync(join(run.run_dir, "schema_guided_validation_report.json"), "utf8"),
    ) as { typed_validation_pass_rate: number };

    assert.equal(summary.extraction_profile, "schema_guided");
    assert.ok(Object.values(evidenceMap.fields).some((field) => field.source_grounded));
    assert.ok(validation.typed_validation_pass_rate > 0);
    assert.ok(run.artifacts.includes("schema_guided_extraction_trace.json"));
  });

  it("records field-level score diagnostics for schema_guided scoring", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-scorecard-v2-"));
    const run = await runPipeline({
      sceneId: "product_link_diagnosis",
      outputRoot,
      parseProfile: "marked",
      understandingProfile: "structured_context",
      extractionProfile: "schema_guided",
      approvalMode: "auto",
      reviewMode: "mock",
      toolProfile: "builtin",
    });

    assert.equal(run.status, "completed");
    const diagnostics = JSON.parse(
      readFileSync(join(run.run_dir, "field_score_diagnostics.v0.json"), "utf8"),
    ) as { fields: Record<string, { validation_status: string; risk_reasons: string[] }> };
    const explanation = JSON.parse(
      readFileSync(join(run.run_dir, "score_explanation.v0.json"), "utf8"),
    ) as {
      top_risk_fields: { field_key: string }[];
      recommended_plan_targets: { target_field: string }[];
    };

    assert.ok(diagnostics.fields.page_screenshots?.validation_status);
    assert.ok(diagnostics.fields.page_screenshots?.risk_reasons.length);
    assert.ok(explanation.top_risk_fields.some((field) => field.field_key === "page_screenshots"));
    assert.ok(
      explanation.recommended_plan_targets.some((target) => target.target_field === "page_screenshots"),
    );
    assert.ok(run.artifacts.includes("field_score_diagnostics.v0.json"));
  });

  it("records planner profile in summary and writes planner generation trace", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "agent-mode-runner-planner-profile-"));
    process.env.AGENT_MODE_RUNNER_LLM_PLANNER_MOCK_RESPONSE = JSON.stringify({
      plan_id: "mock-pipeline-plan",
      goal: "补强页面截图证据",
      steps: [
        {
          step_id: "plan_step_1",
          title: "补强页面截图证据",
          target_metric: "field_coverage",
          target_field: "page_screenshots",
          rationale: "页面截图证据缺失，需要补齐来源。",
          evidence_block_ids: ["block_1"],
          action_type: "add_missing_field",
          expected_output: "补充页面截图证据。",
          status: "pending",
        },
      ],
      expected_improvement: { field_coverage: 0.1 },
      status: "draft",
    });
    let run: Awaited<ReturnType<typeof runPipeline>>;
    try {
      run = await runPipeline({
        sceneId: "product_link_diagnosis",
        outputRoot,
        parseProfile: "marked",
        understandingProfile: "structured_context",
        extractionProfile: "schema_guided",
        plannerProfile: "deepseek",
        approvalMode: "auto",
        reviewMode: "mock",
        toolProfile: "builtin",
      });
    } finally {
      delete process.env.AGENT_MODE_RUNNER_LLM_PLANNER_MOCK_RESPONSE;
    }

    assert.equal(run.status, "completed");
    const summary = JSON.parse(
      readFileSync(join(run.run_dir, "run_summary.json"), "utf8"),
    ) as { planner_profile: string };
    const trace = JSON.parse(
      readFileSync(join(run.run_dir, "agent_plan_generation_trace.json"), "utf8"),
    ) as { planner_provider: string; api_key?: string };

    assert.equal(summary.planner_profile, "deepseek");
    assert.equal(trace.planner_provider, "deepseek");
    assert.equal("api_key" in trace, false);
    assert.ok(run.artifacts.includes("agent_plan_generation_trace.json"));
  });
});
