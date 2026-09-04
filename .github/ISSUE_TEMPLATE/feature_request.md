---
name: Feature request
about: Propose something the platform should do
title: "[feat] "
labels: ["enhancement", "needs-triage"]
---

<!--
This repository is built against a specification, so the first question for any
feature request is: is this already in the spec, or is it new scope?

Both are legitimate. But they get triaged completely differently — a spec item
is scheduling work, and new scope is a product decision.
-->

## Which is it?

- [ ] **Already specified.** `docs/spec/AI_Coach_Spec_v3.md` describes it and it
      is not built yet. → This is a scheduling request; see `docs/ROADMAP.md`
      before filing, in case it is already phased.
- [ ] **New scope.** The spec does not cover it.
- [ ] **Changes the spec.** The spec says something different and you think it
      is wrong.

<!--
The spec has TWO numbering sequences — Part I (product, §1–§61) and Part II
(UI / architecture, §0–§102) — so write e.g. "Part II §65" rather than a bare
number. Note also that Part I is authoritative for product and business rules
when the two parts conflict; Part II is authoritative for visual and frontend
engineering.
-->

Spec section (if any):

Roadmap phase (if any):

## The problem

<!-- Who is blocked, and on what. Describe the situation, not the solution. -->

## Who needs it

- [ ] Trainee
- [ ] Coach
- [ ] Manager
- [ ] Admin
- [ ] Reviewer
- [ ] Enterprise buyer / procurement
- [ ] Us (developer experience, operability)

## Proposed behaviour

<!-- What should happen. Be concrete enough to argue with. -->

## What it touches

- [ ] New or changed cross-language contract — `packages/shared-types`
      (**and therefore** `apps/api/app/domain`; see `docs/adr/0002`)
- [ ] New streaming event (Part II §55) or state-machine state (§92)
- [ ] New API endpoint (§56)
- [ ] New page or navigation entry (§57 / §58)
- [ ] New agent, or a change to the orchestration loop (§19 / §66)
- [ ] Evaluation, rubric, or scoring behaviour (§26–§28)
- [ ] RBAC, tenant isolation, or the safety/compliance layer (§9 / §73 / §74)
- [ ] Client inference runtime (§51–§62)
- [ ] A new external integration or vendor dependency (§43)
- [ ] Infra, deployment, or CI

## Constraints it must respect

The ones that get forgotten, so they are pre-listed:

- [ ] Works with WebGPU unavailable — core function never depends on it (§51)
- [ ] Server stays authoritative for safety, reranking and scoring (§51–§55)
- [ ] No provider credential reaches the browser (§56 / §70 / §71)
- [ ] Every new tenant-scoped row carries `tenant_id` + `workspace_id` (§74)
- [ ] Any AI-generated content is reviewable and cites its source (§15 / §12.5)
- [ ] Any score is accompanied by evidence — a bare number is forbidden (§27)
- [ ] Scenario and persona stay version-pinned so reports remain reproducible
      (§54 / `docs/adr/0008`)
- [ ] Colours from design tokens only; nothing on the §99 forbidden list

## Alternatives considered

<!-- Including "do nothing" and why that is not acceptable. -->

## How we would know it worked

<!--
An acceptance criterion, ideally one that maps onto a row of the §60 matrix or
the §100 final acceptance definition. "Users are happier" is not one.
-->
