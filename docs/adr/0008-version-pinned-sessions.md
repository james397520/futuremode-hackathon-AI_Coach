# ADR-0008 — A session pins the scenario and persona versions it ran against

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part I §54 (TrainingSession core data), §53 (data model — ScenarioVersion, DocumentVersion, QuestionVersion), §38 (content approval), §28 (rubric calibration), §30 (conversation replay), §32 (compliance report), §12.5 (citation)

## Context

Part I §54 gives the `TrainingSession` shape and then states the requirement
directly:

> Scenario and Persona must be version-pinned, to avoid a situation where the
> configuration is changed after training completes and the report becomes
> irreproducible.

The scenario this prevents is concrete and, in an enterprise deployment,
inevitable:

1. A trainee runs the 保障缺口 scenario in March and scores 78 — two points
   under the pass threshold. The report says objection handling was weak, and
   quotes the exchange.
2. In April a coach edits the scenario: adds a required talking point, changes
   the success condition, softens the persona's opening resistance.
3. In May the trainee disputes the March result, or a manager reviews it during
   a promotion cycle, or an auditor asks why a mandatory pre-launch scenario was
   marked failed.
4. Without version pinning, the report now renders against May's scenario. The
   required talking points listed do not match what was asked of them. The
   success condition shown is not the one they were measured against. The
   persona's stated resistance does not explain the transcript.

The report has become not merely stale but **actively misleading**, and there is
no way to tell from looking at it. That is a problem well beyond a bug: Part I
§36 allows a scenario to be mandatory before a product launch, §32 makes
compliance findings part of a durable record, and Part I §28's rubric
calibration compares an evaluator's score against a human reviewer's — which is
meaningless if the two looked at different definitions.

## Decision

**A `TrainingSession` records the version of every piece of configuration that
shaped it, and the report renders against those pinned versions — never against
current state.**

From `TrainingSession` in `packages/shared/src/entities.ts`:

```ts
scenario_id: ID;
scenario_version: number;      // §54 — pinned
persona_id: ID;
persona_version: number;       // §54 — pinned
mode: SessionMode;             // training | assessment, fixed at start
runtime: 'webgpu' | 'wasm' | 'server';
voice_enabled: boolean;
score_live_enabled: boolean;
```

And, through the rubric and the citations:

- `Evaluation.rubric_id` → the `Rubric` carries its own `version`, so the
  weights and pass threshold that produced the score are recoverable.
- `Citation.document_version` → a citation resolves to the chunk of the document
  version that was actually retrieved, so a re-parsed or re-chunked document
  does not silently change what a past turn cited (Part I §12.5).

Supporting rules:

- **Versions are immutable once published.** `ContentStatus` (Part II §92) moves
  `draft → generated → review_required → approved → published → archived`.
  Editing a published scenario creates a new version; it does not mutate the
  old one. `archived` exists so an old version can be withdrawn from *new*
  sessions without being deleted out from under old reports.
- **The version is resolved once, at session start**, and written to the session
  row. Not looked up at report time.
- **A session in progress does not observe an edit.** The orchestrator reads the
  pinned version for the whole session, so a mid-session publish cannot change
  the rules a trainee is being judged against.
- **Reports display the pinned version**, and where it is not the current one,
  say so. A reader should be able to tell that they are looking at history.

## Consequences

### Good

- **Reports are reproducible.** The primary requirement of §54. A March report
  says in May exactly what it said in March.
- **Replay is coherent.** Part I §30's conversation replay and §31's persona
  state timeline replay against the configuration that produced them, so the
  transcript and the stated objectives agree.
- **Compliance findings are defensible.** A finding cites the policy rule that
  was in force. Part I §32's report becomes an audit artefact rather than a
  snapshot of current opinion — which matters most precisely when someone
  disputes it.
- **Rubric calibration is meaningful.** Part I §28 compares evaluator scores to
  human overrides. Both must reference the same rubric version or the
  comparison is noise.
- **Content authors can iterate freely.** The reason this decision is
  *enabling* rather than merely defensive: a coach can improve a scenario
  without a conversation about who might be affected. Editing is safe because
  history is pinned.
- **Fair assessment.** A trainee is measured against the configuration they
  actually faced. There is no path by which an edit changes a past result.

### Bad, and what we do about it

- **Version rows accumulate.** `ScenarioVersion`, `DocumentVersion` and
  `QuestionVersion` all exist in the §53 data model, and none can be pruned
  while a session references them. Accepted: the volume is small (configuration,
  not events), and retention (Part I §40.2) removes sessions before their
  configuration becomes unreferenced. Deleting a version that a session cites is
  a foreign-key violation, deliberately.
- **Every read is version-qualified.** A query for "the scenario" is always "the
  scenario at version N", which is an extra parameter through the session and
  report services. This is real friction on every such query, and the friction
  is the point — an unversioned read is the bug.
- **The chunk-version case is subtle.** Re-parsing a document creates
  `document_version` N+1 with new chunk ids. A citation from an old session
  points at a version-N chunk that is no longer indexed for retrieval. The
  citation must still *resolve for display*, so version-N chunks are retained
  and marked out of the retrieval set rather than deleted. `Chunk` carries
  `document_version` and `excluded_from_retrieval` for exactly this.
- **Version bumps need a policy, not a reflex.** Bumping on every keystroke of a
  draft edit produces useless history. The `ContentStatus` machine answers it:
  versions increment on transitions into `published`, and `draft` edits mutate
  the draft in place.
- **Report UI has to communicate it.** A report showing a pinned version without
  saying so is only half the fix — the reader has to know they are looking at
  history. This is Phase 1 UI work.
- **A published-version edit path must be closed at the API.** The rule is
  worthless if `PATCH /scenarios/{id}` can mutate a published row. Enforcing
  this belongs in the scenario router and is on the PR checklist for anything
  touching content status.
