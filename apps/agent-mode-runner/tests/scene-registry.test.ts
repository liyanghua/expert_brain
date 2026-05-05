import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadSceneProfiles, resolveScene } from "../src/config/scene-registry.js";

describe("scene registry", () => {
  it("loads product_link_diagnosis scene assets and profiles", () => {
    const resolved = resolveScene("product_link_diagnosis");
    const profiles = loadSceneProfiles("product_link_diagnosis");

    assert.equal(resolved.scene.scene_id, "product_link_diagnosis");
    assert.equal(resolved.scene.scene_name, "商品链接诊断");
    assert.ok(resolved.paths.source_document.endsWith("source.md"));
    assert.ok(profiles.schema_profile.required_fields.includes("judgment_criteria"));
    assert.ok(profiles.schema_profile.optional_fields.includes("termination_conditions"));
    assert.ok(
      profiles.expert_guidance_profile.planning_guidance.some((line) =>
        line.includes("judgment_criteria"),
      ),
    );
    assert.equal(
      profiles.evaluation_profile.metric_thresholds.field_coverage?.target,
      0.85,
    );
    assert.equal(profiles.evaluation_profile.gap_priority_rules[0]?.field_key, "judgment_criteria");
  });
});
