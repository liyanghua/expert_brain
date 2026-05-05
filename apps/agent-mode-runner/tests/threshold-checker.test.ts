import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkThresholds } from "../src/tools/threshold-checker.js";

describe("threshold checker", () => {
  it("marks measured metrics as pass, warn, or fail from YAML thresholds", () => {
    const report = checkThresholds({
      stepId: "step_1_parse_normalize",
      metrics: {
        parse_success_rate: { value: 1, measurement_status: "measured" },
        block_integrity_rate: { value: 0.88, measurement_status: "proxy" },
        heading_preservation_rate: { value: 0.5, measurement_status: "measured" },
      },
    });

    assert.equal(report.overall_status, "fail");
    assert.equal(report.results.parse_success_rate?.status, "pass");
    assert.equal(report.results.block_integrity_rate?.status, "warn");
    assert.equal(report.results.heading_preservation_rate?.status, "fail");
    assert.equal(report.results.block_integrity_rate?.measurement_status, "proxy");
  });
});
