# Semantic Unit Research Program

## Goal
Improve semantic unit understanding before changing UI behavior.

## Fixed Evaluation Loop
Run the same scene and compare `semantic_navigation_score` across experiments:

```bash
pnpm --filter @ebs/agent-mode-runner smoke -- \
  --run-id semantic-unit-research \
  --parse-profile marked \
  --understanding-profile structured_context \
  --semantic-coherence-profile embedding \
  --semantic-unit-enhancement-profile llm \
  --semantic-unit-match-profile llm \
  --semantic-unit-eval-report true \
  --extraction-profile schema_guided \
  --planner-profile baseline
```

## Editable Surface
Agents may propose changes to:

- `src/understanding/semantic-unit-llm-enhancer.ts`
- `src/understanding/semantic-unit-match-validator.ts`
- `src/evaluation/semantic-unit-evaluator.ts`
- scene-level schema boundary rules

Agents must not edit:

- source documents
- golden or seed review examples, once added
- the scoring formula without recording a new metric version
- UI presentation files during semantic-unit research runs

## Primary Metric
Use `semantic_navigation_score` from `semantic_unit_experiment_log.json`.

Higher is better. Keep an experiment only if it improves the primary metric without increasing `heading_overuse_rate` or `over_tag_rate`.

## Current No-Golden-Set Policy
Metrics are proxy checks until a human-reviewed seed set exists. Treat LLM-as-judge and heuristic metrics as directional, not as ground truth.
