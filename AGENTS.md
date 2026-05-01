# AGENTS.md

## 1. Project Overview

Expert Brain Studio is an AI-native document enhancement and Ground Truth production system for industry experts. The first product form is a **two-pane workspace**:

* **Left pane:** source document and structured document views
* **Right pane:** human-Agent collaboration panel for QA, clarification, revision, gap detection, and versioned refinement

The system takes a business document such as an SOP, playbook, diagnosis guide, process note, XMind, spreadsheet, PDF, or screenshot pack, and turns it into:

* a normalized document representation
* a structured Ground Truth draft
* a versioned review trail
* reusable knowledge assets for later wiki / ontology / skill compilation

This repository is for building the first practical product stage:
**document import → structured extraction → contextual QA → revision suggestions → expert confirmation → versioned Ground Truth**

---

## 2. Product Goal

The product goal is to help industry experts and internal teams transform raw business documents into **clear, structured, reviewable, and reusable Ground Truth assets** with minimal friction.

### Primary goals

1. Extract core structured elements from a business document
2. Support contextual QA on any selected document block
3. Generate modification / addition / clarification suggestions
4. Let experts confirm and edit changes with low friction
5. Create versioned, traceable document evolution
6. Prepare outputs for future wiki, ontology, and industrial skill compilation

### First-stage product promise

This is **not** a general-purpose chat app.
It is a **document-centered expert knowledge refinement workspace**.

---

## 3. Core Domain Concepts

### 3.1 Source Document

Any uploaded or imported business knowledge source:

* markdown
* pdf
* docx
* xlsx
* xmind
* image / screenshot

### 3.2 Document IR

The normalized intermediate representation of all document inputs.
All downstream Agents operate on Document IR rather than raw files directly.

### 3.3 GroundTruthDraft

A structured extraction object built from the source document.
It represents the current best machine-readable interpretation of the document.

### 3.4 Block

The smallest meaningful UI and processing unit in a document:

* heading
* paragraph
* list
* table
* image
* outline block

### 3.5 Suggestion

An AI-generated proposal to improve the document or the GroundTruthDraft:

* rewrite
* add
* clarify
* split
* merge
* validation-needed

### 3.6 Version

A snapshot of both:

* document content
* structured GroundTruthDraft

### 3.7 Ground Truth

A reviewed, structured, traceable version of a business document that is reliable enough for downstream consumption.

### 3.8 Process Spine

A canonical process flow asset, such as a main business SOP, used as the navigation and mounting backbone for future knowledge assets.

### 3.9 Ontology Candidate

A structured object extracted from documents that may later become a formal domain concept, rule, decision, evidence, artifact, or metric.

### 3.10 Skill Candidate

A reusable operational pattern derived from reviewed knowledge that may later become an industrial skill.

---

## 4. Architecture

The system should be implemented as a layered architecture.

### Layer 1: Input Adapters

Responsibilities:

* accept multiple file types
* classify source type
* trigger correct parsing route

Examples:

* markdown parser
* pdf parser
* docx parser
* xlsx parser
* xmind parser
* image parser

### Layer 2: Normalization

Responsibilities:

* convert all sources into Document IR
* preserve source provenance
* preserve block-level references
* preserve attachment references

### Layer 3: Structuring

Responsibilities:

* map document content into GroundTruthDraft fields
* detect missing fields
* assign confidence
* bind source refs

### Layer 4: Agent Collaboration

Responsibilities:

* contextual QA
* suggestion generation
* gap detection
* revision support
* version writeback

### Layer 5: Version and Governance

Responsibilities:

* version snapshots
* diff generation
* suggestion state management
* review status
* publication gating

### Layer 6: Downstream Asset Preparation

Responsibilities:

* export normalized markdown
* export GroundTruth JSON
* prepare wiki candidates
* prepare ontology candidates
* prepare skill candidates

---

## 5. Repository Structure

Recommended structure:

```text
repo/
├── apps/
│   ├── web/                         # Frontend application
│   ├── api/                         # Backend API service
│   └── workers/                     # Async parsing / extraction / diff jobs
├── packages/
│   ├── document-ir/                 # Document IR schema and utilities
│   ├── ground-truth-schema/         # GroundTruthDraft schema
│   ├── agent-core/                  # Agent orchestration primitives
│   ├── parsing/                     # Parsers for md/pdf/docx/xlsx/xmind/images
│   ├── suggestions/                 # Suggestion generation logic
│   ├── diff-engine/                 # Document and structured diff
│   ├── domain-profiles/             # Domain injection profiles
│   └── ui-components/               # Shared frontend components
├── data/
│   ├── fixtures/                    # Test documents and structured fixtures
│   ├── evals/                       # Evaluation datasets
│   └── prompts/                     # Prompt and skill definitions
├── docs/
│   ├── product/                     # PRD, interaction docs, field specs
│   ├── architecture/                # System architecture docs
│   ├── schemas/                     # JSON/YAML schemas
│   └── examples/                    # Example documents and expected outputs
├── scripts/
│   ├── ingest/
│   ├── eval/
│   ├── migrations/
│   └── dev/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── eval/
├── AGENTS.md
├── README.md
└── package.json / pyproject.toml / etc.
```

If the repository is monorepo-based, keep schemas and prompts in shared packages, not buried in app code.

---

## 6. Development Commands

Commands should be standardized and documented in the actual repository README and package manager config. Typical command categories:

### Install

* install dependencies
* bootstrap workspace
* install browser / parser dependencies if needed

### Run

* start frontend dev server
* start backend API
* start worker processes

### Test

* run unit tests
* run integration tests
* run end-to-end tests
* run eval suite

### Lint / Typecheck

* lint code
* format code
* typecheck code
* validate schemas

### Data / Eval

* run ingestion on fixture documents
* regenerate normalized outputs
* regenerate GroundTruthDraft fixtures
* run extraction eval
* run suggestion eval

Do not hardcode commands in code comments. Keep them centralized in package configuration and README.

---

## 7. Coding Guidelines

### 7.1 General

* Prefer clarity over cleverness
* Keep business logic explicit
* Avoid hidden coupling between frontend UI logic and extraction logic
* Every important transformation must be traceable

### 7.2 Backend

* Strongly typed schemas for Document IR, GroundTruthDraft, Suggestion, Version
* Separate parsing, extraction, and persistence layers
* Keep Agent orchestration stateless where practical
* Preserve provenance at every stage

### 7.3 Frontend

* Build UI around document blocks and contextual interactions
* Keep the default interface simple
* Advanced views should be progressive disclosure, not the default
* Every suggestion must map to a target block and/or target structured field

### 7.4 Prompt / Agent Code

* Prompts must be versioned
* Structured output must be validated before persistence
* No silent fallback from malformed LLM output into database writes
* Every Agent output must either pass schema validation or be rejected

### 7.5 Reliability

* Avoid writing directly into canonical content without a draft/review step
* Never overwrite raw source files
* Every write should be reversible through version history

---

## 8. Data Model Principles

### 8.1 Raw is Immutable

Raw inputs are immutable source materials and must not be edited in place.

### 8.2 Document IR is Canonical for Processing

All internal extraction, suggestion, and QA flows should use Document IR.

### 8.3 Structured Drafts are First-Class Objects

GroundTruthDraft is not a derived afterthought. It is a primary product artifact.

### 8.4 Provenance is Mandatory

Every important extracted field and suggestion should preserve source references where possible.

### 8.5 Versions must Cover Both Content and Structure

Versioning applies to:

* rendered/editable document content
* structured GroundTruthDraft

### 8.6 Suggestions are Reviewable Objects

Suggestions are never implicit. They must exist as explicit records with:

* type
* target
* rationale
* status

### 8.7 Domain Knowledge Injection is Configurable

Domain profiles must be loadable and replaceable without changing core parsing code.

---

## 9. Agent Workflow

The first-stage system should implement the following Agent workflow.

### A1. Document Structuring Agent

Responsibilities:

* parse normalized blocks
* extract structured fields
* detect gaps
* assign confidence
* bind source refs

### A2. Doc QA Agent

Responsibilities:

* answer questions about selected content
* explain field mapping
* explain extraction rationale
* answer with context awareness

### A3. Revision Agent

Responsibilities:

* generate rewrite suggestions
* generate add/clarify/split/merge suggestions
* recommend missing fields or stronger formulations

### A4. Ground Truth Editor Agent

Responsibilities:

* apply accepted suggestions to draft content
* update GroundTruthDraft
* generate change summary and diffs

### A5. Gap Detection Agent

Responsibilities:

* identify missing or weak fields
* suggest what to add next
* prioritize completion work

### A6. Version Governance Agent

Responsibilities:

* evaluate publication readiness
* enforce status transitions
* check completeness and review thresholds

### Workflow Sequence

1. Import file(s)
2. Normalize into Document IR
3. Run initial structuring
4. Detect gaps
5. User selects block or field
6. QA and/or suggestion generation
7. User accepts/edits/rejects suggestion
8. Apply to draft and structured state
9. Generate new version
10. Evaluate readiness for approval/publish

---

## 10. Testing and Evaluation

Testing must include both software correctness and AI output quality.

### 10.1 Unit Tests

Cover:

* parsing
* normalization
* schema validation
* diff generation
* state transitions
* suggestion application logic

### 10.2 Integration Tests

Cover:

* upload → parse → extract → render
* block selection → QA → suggestion generation
* suggestion acceptance → draft update → version snapshot

### 10.3 End-to-End Tests

Cover:

* realistic document upload
* first extraction flow
* expert revision flow
* version creation
* structured completeness updates

### 10.4 Evaluation

Create explicit eval sets for:

* field extraction accuracy
* source ref correctness
* suggestion usefulness
* suggestion acceptance rate
* gap detection precision
* block-to-field mapping quality

### 10.5 Minimum Eval Metrics

Track at minimum:

* field completeness
* field correctness
* source grounding rate
* suggestion accept rate
* false positive suggestion rate
* unresolved gap count
* version quality improvement over time

---

## 11. Definition of Done

A feature is done only if all of the following are true:

### Functional

* The feature works end-to-end for the intended workflow
* Required schemas validate successfully
* Required state transitions behave correctly

### UX

* The feature is understandable without extra operator explanation
* The default path is simple and low-friction
* Error and edge states are handled visibly

### Data

* Important outputs are persisted
* Provenance is stored where required
* Versions and diffs are generated where applicable

### Quality

* Tests are added or updated
* Eval coverage is added if the feature changes Agent behavior
* Logging is sufficient for debugging

### Documentation

* Product behavior is documented
* Relevant schema changes are documented
* Any new prompt / skill / eval assets are versioned

---

## 12. Prompt / Skill / Eval Management

### 12.1 Prompt Management

* Prompts must live in versioned files, not inline in random source code
* Each prompt should have:

  * id
  * version
  * purpose
  * input contract
  * output contract

### 12.2 Skill Management

Skills should be modeled as reusable units, not one-off prompt fragments.

Each skill should ideally define:

* skill_id
* description
* use case
* required context
* input schema
* output schema
* validation rules

### 12.3 Eval Management

Every important prompt/skill should have:

* fixture inputs
* expected structured outputs
* measurable pass criteria

### 12.4 Change Control

When changing prompts or skills:

* bump version
* preserve prior version
* rerun relevant evals
* compare against previous metrics

---

## 13. Security and Permissions

### 13.1 Raw Source Safety

* Never mutate uploaded source files
* Restrict deletion / overwrite behavior
* Keep source references immutable

### 13.2 Access Control

Users should have scoped access by:

* workspace
* project
* document
* version
* review permission
* publish permission

### 13.3 Sensitive Content

* Do not expose raw source content outside authorized workspace boundaries
* Preserve auditability of changes
* Treat uploaded business documents as sensitive

### 13.4 Agent Write Permissions

Agents should not directly publish final content without explicit workflow approval.
Default policy:

* Agent can propose
* Human confirms
* System versions
* Governance decides publishability

---

## 14. Do Not

* Do not overwrite raw source documents
* Do not let malformed LLM output write directly into canonical state
* Do not mix UI presentation models with persistence schemas
* Do not treat chat transcripts as the primary product artifact
* Do not hide provenance
* Do not auto-promote draft suggestions into published Ground Truth
* Do not implement heavyweight graph editing in the first-stage MVP
* Do not collapse all document types into the same parsing path without type-aware routing
* Do not build the first version as a generic chatbot
* Do not lose block-level mapping between UI and structured extraction

---

## 15. Final Response Format

When an Agent or backend workflow returns a user-facing result, it should follow a structured format appropriate to the task.

### 15.1 For QA Responses

Return:

* direct answer
* brief rationale
* source block references when available
* optional next-step suggestion

### 15.2 For Suggestion Responses

Return:

* suggestion type
* target block
* target field
* suggested text
* rationale
* action options

### 15.3 For Structuring Responses

Return:

* extracted fields
* confidence by field
* missing fields
* source references

### 15.4 For Version Actions

Return:

* new version id
* summary of changes
* affected fields
* diff availability

### 15.5 For Publish Readiness

Return:

* readiness status
* blocking issues
* completeness summary
* review summary

All user-facing responses should prefer concise, structured, human-readable output over raw model dumps or internal JSON unless the caller explicitly requests machine-readable output.
