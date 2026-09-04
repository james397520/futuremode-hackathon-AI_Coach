# 智慧對話式場景模擬與人才培訓評估平台
# 功能複查與缺漏檢核報告

> 文件版本：v1.0 Functional Review  
> 複查基準：`AI_Coach_Complete_Product_UI_WebGPU_Spec_v3.md`  
> 文件用途：產品功能 Freeze 前複查、PM / UIUX / Frontend / Backend / AI / QA 共用驗收清單  
> 複查原則：**本文件檢查的是「規格是否完整」，不代表功能已經實作完成。**  
> 結論：核心功能已完整，剩餘缺口主要集中於企業級身份治理、版本可重現、失敗恢復、評分覆核、資料治理、營運監控與 API 安全。

---

# 0. 狀態圖例

| 標記 | 意義 |
|---|---|
| ✅ | 規格已明確涵蓋，可直接進開發 |
| 🟡 | 已有方向，但驗收條件或邊界流程需補強 |
| 🔴 | 建議補入正式規格，否則後期可能重構 |
| ⚪ | 非 MVP 必要，可排 Phase 2 / Phase 3 |
| P0 | 企業 MVP / POC 前必須處理 |
| P1 | Beta / 第一批正式客戶前處理 |
| P2 | 商業化或規模化後擴充 |

---

# 1. 複查總結

## 1.1 原始三大需求是否缺漏

### 知識庫與題庫建置

- ✅ PDF / DOCX / PPTX / TXT / CSV / URL / Manual Text
- ✅ OCR
- ✅ 文件結構解析
- ✅ Semantic Chunking
- ✅ Metadata
- ✅ Embedding
- ✅ Qdrant / ChromaDB / FAISS
- ✅ Retrieval Playground
- ✅ Citation
- ✅ Question Bank
- ✅ AI 自動出題
- ✅ Human Review
- ✅ Knowledge Mining
- ✅ Top Sales Pitch / Golden Phrase / Objection Mining

### Multi-Agent 與語音對練

- ✅ Scenario Director
- ✅ Customer Agent
- ✅ Coach Agent
- ✅ Knowledge Agent
- ✅ Evaluator Agent
- ✅ Compliance Agent
- ✅ Intent Recovery
- ✅ Persona State
- ✅ Dynamic Difficulty
- ✅ OpenAI
- ✅ ElevenLabs
- ✅ STT / TTS
- ✅ VAD
- ✅ Barge-in
- ✅ Partial Transcript
- ✅ WebRTC / Web Audio

### 評測報告與安全審計

- ✅ 10 大能力評估維度
- ✅ Evidence-based Scoring
- ✅ Rubric Calibration
- ✅ Conversation Replay
- ✅ Compliance Report
- ✅ Closed-loop Adaptive Learning
- ✅ PII / Prompt Injection / Jailbreak
- ✅ RBAC
- ✅ Tenant Isolation
- ✅ Audit Log
- ✅ CertiK / equivalent external audit provider 定位
- ✅ WebGPU → WASM → Server fallback

**結論：原始核心需求沒有重大功能缺漏。**

---

# 2. 本次複查發現的主要補強項目

## P0 — 正式 MVP 前應補

1. 🔴 Authentication 完整生命週期
2. 🔴 Session 完整 Version Snapshot
3. 🔴 Session Autosave / Crash Recovery
4. 🔴 Document / RAG Processing Failure Recovery
5. 🔴 Evaluation Low-confidence Review Queue
6. 🔴 Compliance Rule Version Pinning
7. 🔴 Audit Log 防竄改與保存策略
8. 🔴 Data Retention / Delete / Export Workflow
9. 🔴 API / Webhook Security
10. 🔴 Usage / Cost Guardrail
11. 🔴 Admin Operational Health Dashboard
12. 🔴 Model / Prompt / Agent Config Version Registry

## P1 — Beta 前應補

13. 🟡 Assignment 進階規則
14. 🟡 Notification Preferences
15. 🟡 Scheduled Reports
16. 🟡 Connector Incremental Sync
17. 🟡 Knowledge Staleness / Expiration
18. 🟡 Review / Approval Comment Workflow
19. 🟡 Evaluation Benchmark Governance
20. 🟡 Voice Consent / Recording Retention
21. 🟡 Organization Onboarding Wizard
22. 🟡 API / Webhook Delivery Log

## P2 — 可延後

23. ⚪ A/B Scenario Experiment
24. ⚪ Template Marketplace
25. ⚪ 3D Avatar / Lip Sync
26. ⚪ Advanced PWA Offline
27. ⚪ Cross-organization Benchmark
28. ⚪ Advanced Gamification

---

# 3. 模組級完整複查矩陣

| # | 模組 | 狀態 | 複查結論 | Priority |
|---|---|---|---|---|
| 1 | Authentication / Identity | 🟡 | RBAC/SSO 有，登入生命週期需補 | P0 |
| 2 | Workspace / Tenant | ✅ | 架構完整 | P0 |
| 3 | Knowledge Base | ✅ | 核心完整，補 failure lifecycle | P0 |
| 4 | Advanced RAG | ✅ | 完整，補 freshness/version governance | P1 |
| 5 | Knowledge Mining | ✅ | 完整 | P1 |
| 6 | Question Bank | ✅ | 完整 | P0 |
| 7 | Persona Builder | ✅ | 完整 | P0 |
| 8 | Scenario Builder | ✅ | 完整 | P0 |
| 9 | Dynamic Difficulty | ✅ | 完整 | P0 |
| 10 | Multi-Agent | ✅ | 完整，補 agent config version | P0 |
| 11 | Intent Recovery | ✅ | 完整 | P0 |
| 12 | Voice | ✅ | 核心完整，補 consent / retention | P0 |
| 13 | Live Simulation | ✅ | 核心完整，補 recovery | P0 |
| 14 | Evaluation | ✅ | 完整，補 low-confidence routing | P0 |
| 15 | Rubric Calibration | ✅ | 完整 | P1 |
| 16 | Reports | ✅ | 完整，補 scheduled delivery | P1 |
| 17 | Adaptive Learning | ✅ | 完整 | P1 |
| 18 | Assignment | 🟡 | 核心完整，補 recurring / exemption | P1 |
| 19 | Content Approval | 🟡 | 有流程，補 comment / resubmit | P1 |
| 20 | Security | ✅ | 核心完整，補 MFA / IP / immutable audit | P0 |
| 21 | Integrations | ✅ | 核心完整，補 sync/delivery log | P1 |
| 22 | Billing / Quota | 🟡 | 有概念，補 hard limit / budget | P1 |
| 23 | WebGPU Runtime | ✅ | 完整 | P0 |
| 24 | Light / Dark / System | ✅ | 完整 | P0 |
| 25 | Accessibility / i18n | ✅ | 完整 | P1 |
| 26 | Observability | 🟡 | 技術有定義，缺 Admin UI | P0 |
| 27 | Backup / DR | 🟡 | 有 backup 概念，缺 RPO / RTO | P1 |
| 28 | B2C Mode | 🟡 | 功能有，但商業流程未完整 | P2 |

---

# 4. Authentication / Identity 功能複查

## 已有

- ✅ Organization
- ✅ Workspace
- ✅ Team
- ✅ User
- ✅ Role
- ✅ RBAC
- ✅ SSO
- ✅ OAuth / OIDC
- ✅ SCIM 可擴充
- ✅ Tenant Isolation

## P0 建議補入

- [ ] Email / Password Login（若非 SSO-only）
- [ ] Forgot Password
- [ ] Reset Password
- [ ] Email Verification
- [ ] Invitation Flow
- [ ] Invitation Expiration
- [ ] Resend Invitation
- [ ] Disable / Suspend User
- [ ] Delete User
- [ ] Session Revocation
- [ ] Logout All Devices
- [ ] Concurrent Session Policy
- [ ] Idle Timeout
- [ ] MFA / TOTP
- [ ] Recovery Code
- [ ] Brute-force Protection
- [ ] Account Lock Policy

## P1

- [ ] IP Allowlist
- [ ] Domain Allowlist
- [ ] JIT Provisioning
- [ ] SCIM User Sync
- [ ] SCIM Group Sync
- [ ] SSO Enforcement by Workspace

### 驗收案例

```text
Given 使用者已被 Admin 停權
When 使用者仍持有舊 session token
Then API 必須拒絕存取
And 現有 WebSocket / Realtime Session 必須中止
```

---

# 5. Workspace / Tenant 複查

## 已有

- ✅ Organization → Workspace → Department → Team → User
- ✅ Knowledge ownership
- ✅ ACL
- ✅ tenant_id
- ✅ workspace_id

## 補強

- [ ] Workspace Create Wizard
- [ ] Workspace Rename
- [ ] Archive / Delete
- [ ] Transfer Owner
- [ ] Default Locale
- [ ] Timezone
- [ ] Data Region
- [ ] AI Runtime Policy
- [ ] Storage / Voice / Simulation Quota

### 必要規則

所有敏感資料存取必須由 Server 強制：

```text
tenant_id
+
workspace_id
+
ACL / RBAC
```

不可只依賴前端 filter。

---

# 6. Knowledge Base 複查

## 已完整

- ✅ Create / Rename / Duplicate / Archive / Delete
- ✅ Transfer Ownership
- ✅ Publish / Unpublish
- ✅ Drag & Drop / Folder / URL / Connector
- ✅ MIME Validation
- ✅ Virus Scan
- ✅ Duplicate Detection
- ✅ OCR
- ✅ Structure / Heading / Table / Metadata
- ✅ Semantic Chunking
- ✅ Chunk Editor
- ✅ Version / Rollback
- ✅ Re-embed

## P0 — Processing Failure Lifecycle

正式定義：

```text
uploaded
→ validating
→ queued
→ parsing
→ ocr
→ structuring
→ chunking
→ embedding
→ indexing
→ ready
```

失敗狀態：

```text
validation_failed
parse_failed
ocr_failed
embedding_failed
index_failed
partially_ready
cancelled
```

功能：

- [ ] Retry from failed stage
- [ ] Retry all
- [ ] Cancel processing
- [ ] Error details
- [ ] Worker Job ID
- [ ] Reprocess after parser upgrade
- [ ] Partial page failure handling
- [ ] Manual OCR correction
- [ ] Dead-letter queue visibility

## P1 — Knowledge Freshness

- [ ] Effective Date
- [ ] Expiration Date
- [ ] Stale Warning
- [ ] Superseded By
- [ ] Auto-unpublish expired source
- [ ] Alert when scenario uses outdated source

---

# 7. Connector / Sync 複查

Connector Import 已有，但企業正式使用建議補：

- [ ] Full Sync
- [ ] Incremental Sync
- [ ] Scheduled Sync
- [ ] Manual Sync
- [ ] Sync Cursor
- [ ] Last Successful Sync
- [ ] Last Failed Sync
- [ ] Added / Updated / Removed Counts
- [ ] Deletion Propagation Policy
- [ ] Conflict Handling
- [ ] Sync Log
- [ ] Credential Expired / Re-auth

Connector 狀態：

```text
connected
syncing
degraded
auth_expired
rate_limited
error
disconnected
```

---

# 8. Embedding / Vector DB / RAG 複查

## 已完整

- ✅ BGE / multilingual-e5
- ✅ OpenAI External Embedding
- ✅ Qdrant / ChromaDB / FAISS
- ✅ Top-K / Threshold / Metadata Filter
- ✅ Hybrid / Keyword
- ✅ Reranker
- ✅ Query Rewrite
- ✅ Multi-query Retrieval
- ✅ Parent Expansion
- ✅ Citation
- ✅ Insufficient Knowledge Handling

## 補強

- [ ] Index Version
- [ ] Embedding Model Version
- [ ] Reranker Version
- [ ] Index Rebuild
- [ ] Blue/Green Index Switch
- [ ] Retrieval Trace
- [ ] Retrieval Debug Export
- [ ] Retrieval Test Dataset
- [ ] Precision@K Regression
- [ ] Search Quality Regression Test

正式 Session 必須知道使用哪一版：

```text
Knowledge Snapshot
Embedding Index Version
Retrieval Config Version
```

---

# 9. Knowledge Mining 複查

## 已完整

- ✅ Transcript
- ✅ Anonymization
- ✅ Segmentation
- ✅ Intent / Objection Extraction
- ✅ Best Response Mining
- ✅ Human Review
- ✅ Golden Phrase
- ✅ Anti-pattern
- ✅ Scenario Seed

## 補強

- [ ] Duplicate Phrase Merge
- [ ] Source Provenance
- [ ] Minimum Sample Count
- [ ] Reviewer Confidence
- [ ] Expiration / Invalidation
- [ ] Industry / Persona Tags
- [ ] Do not learn from Critical Compliance sessions
- [ ] PII removal verification

---

# 10. Question Bank 複查

## 已完整

- ✅ MCQ
- ✅ True / False
- ✅ Short Answer
- ✅ Open-ended
- ✅ Scenario
- ✅ Voice Response
- ✅ Role-play
- ✅ Compliance
- ✅ Objection Handling
- ✅ Knowledge Check
- ✅ Draft → Generated → Review → Approved → Published → Archived

## 補強

- [ ] Question Pool
- [ ] Randomization
- [ ] Attempts Policy
- [ ] Time Limit
- [ ] Pass Threshold
- [ ] Retake Random Sampling
- [ ] Question Statistics
- [ ] Bulk Edit
- [ ] Import / Export
- [ ] Duplicate Detection

### AI 出題發布條件

```text
Source Exists
+
Source Active
+
Correct Answer Reviewed
+
Reviewer Approved
+
Compliance Passed
```

---

# 11. Persona Builder 複查

## 已完整

- ✅ Identity / Occupation / Background
- ✅ Language / Locale
- ✅ Personality
- ✅ Trust / Patience / Resistance
- ✅ Budget / Hidden Need
- ✅ Trigger / Objection
- ✅ Forbidden Knowledge
- ✅ Voice
- ✅ Persona Test Lab

## 補強

- [ ] Persona Version
- [ ] Status
- [ ] Owner
- [ ] Duplicate
- [ ] Import / Export
- [ ] Avatar Source / License Metadata
- [ ] Voice Consent / License Metadata
- [ ] Voice Fallback
- [ ] Persona Regression Test Set
- [ ] Character Consistency Score

---

# 12. Scenario Builder 複查

## 已完整

1. ✅ Basic Information
2. ✅ Knowledge Base
3. ✅ Persona
4. ✅ Scenario
5. ✅ Dynamic Behavior
6. ✅ Evaluation Rubric
7. ✅ Compliance / Safety
8. ✅ Preview & Test
9. ✅ Publish

## 補強

- [ ] Scenario Version
- [ ] Duplicate / Archive
- [ ] Owner / Reviewer
- [ ] Change Log
- [ ] Required Prerequisite
- [ ] Required Knowledge Version
- [ ] Required Rubric Version
- [ ] Required Compliance Policy Version
- [ ] Estimated Duration
- [ ] Supported Locale
- [ ] Voice Requirement

---

# 13. Dynamic Scenario Engine 複查

## 已完整

- ✅ Emotion
- ✅ Trust
- ✅ Interest
- ✅ Resistance
- ✅ Patience
- ✅ Budget
- ✅ Objection Queue
- ✅ Time Pressure
- ✅ Hidden Need
- ✅ Exit Intent
- ✅ Dynamic Difficulty

## 補強

- [ ] Deterministic seed for QA
- [ ] Randomness Range
- [ ] Event Injection Log
- [ ] Phase Transition Log
- [ ] Max State Delta per Turn
- [ ] Impossible State Guard
- [ ] State Reset on Restart
- [ ] Assessment Mode deterministic policy

測試模式應允許固定 `seed`，方便 regression test。

---

# 14. Multi-Agent 複查

## 已完整

- ✅ Conversation Orchestrator
- ✅ Scenario Director
- ✅ Customer Agent
- ✅ Knowledge Agent
- ✅ Coach Agent
- ✅ Compliance Agent
- ✅ Evaluator Agent

## P0 — Agent Config Registry

每個正式 Session 建議 pin：

```text
orchestrator_version
scenario_director_version
customer_agent_prompt_version
knowledge_agent_version
coach_agent_version
compliance_agent_version
evaluator_agent_version
tool_policy_version
model_route_version
```

需提供：

- [ ] Agent Prompt Registry
- [ ] Version
- [ ] Draft / Published
- [ ] Diff
- [ ] Rollback
- [ ] Change Reason
- [ ] Reviewer
- [ ] Effective Time

---

# 15. Tool Calling 複查

規格已有 Unauthorized Tool Call Prevention，建議正式建立 Tool Registry。

每個 Tool：

- [ ] tool_id
- [ ] name
- [ ] description
- [ ] input schema
- [ ] output schema
- [ ] allowed agents
- [ ] required role
- [ ] workspace scope
- [ ] read / write risk
- [ ] timeout
- [ ] retry
- [ ] audit
- [ ] enable / disable

```text
Agent
→ Permission Check
→ Schema Validation
→ Execute
→ Output Validation
→ Audit
```

禁止 LLM 任意呼叫未註冊 URL / API。

---

# 16. Intent Recovery 複查

## 已完整

- ✅ Incomplete
- ✅ Ambiguous
- ✅ Typo
- ✅ Irrelevant
- ✅ Out-of-scope
- ✅ Persona Escape
- ✅ Direct Answer Request
- ✅ Prompt Injection
- ✅ Unauthorized Knowledge

## 補強

- [ ] Intent Confidence
- [ ] Confidence Threshold
- [ ] Clarification Max Count
- [ ] Safe Termination Policy
- [ ] Repeated Abuse Policy
- [ ] Language Switching Detection

---

# 17. Voice 功能複查

## 已完整

- ✅ STT / TTS
- ✅ OpenAI / ElevenLabs
- ✅ VAD
- ✅ Barge-in
- ✅ Partial / Final Transcript
- ✅ Device Selector
- ✅ Captions
- ✅ Reconnecting
- ✅ Interruptibility

## 補強

### Device Check

- [ ] Mic Permission
- [ ] Mic Level
- [ ] Speaker Test
- [ ] Browser Compatibility
- [ ] Network Quality
- [ ] Provider Health

### Privacy / Consent

- [ ] Recording Consent
- [ ] Recording Indicator
- [ ] Retention Notice
- [ ] Delete Recording
- [ ] Download Permission
- [ ] Transcript-only Mode
- [ ] Workspace Policy to Disable Recording

### Fallback

```text
Realtime Voice unavailable
→ Streaming STT/TTS
→ Text Simulation
```

---

# 18. Live Simulation 複查

## 已完整

- ✅ Conversation / Transcript
- ✅ Right Persona
- ✅ Objective
- ✅ Persona State
- ✅ Voice
- ✅ Coach
- ✅ Compliance Alert
- ✅ Citation
- ✅ Timer
- ✅ Progress
- ✅ Training / Assessment Mode

## P0 — Recovery

- [ ] Turn Autosave
- [ ] Transcript Autosave
- [ ] Persona State Checkpoint
- [ ] Browser Refresh Recovery
- [ ] Tab Crash Recovery
- [ ] Network Reconnect
- [ ] Rejoin Active Session
- [ ] Duplicate Connection Protection
- [ ] Graceful Session Timeout
- [ ] Server-side Finalization if Client Disappears

```text
Connection Lost
→ Persist Current State
→ Retry WebSocket / WebRTC
→ Show Reconnecting
→ Restore Transcript
→ Restore Persona State
→ Continue
```

---

# 19. Training Mode vs Assessment Mode

## Training Mode

- ✅ Hint
- ✅ Coach Insight
- ✅ Suggested Strategy
- ✅ Knowledge Reference
- ✅ Pause

## Assessment Mode 應明確限制

- [ ] 禁止 Suggested Answer
- [ ] 禁止 Knowledge Peek
- [ ] 禁止 Realtime Coach
- [ ] 視政策禁用 AI Rephrase
- [ ] 視政策禁用 Pause
- [ ] 固定 Scenario / Rubric / Model Version
- [ ] 記錄 Disconnect
- [ ] 不允許 Adaptive Difficulty 自動降低

---

# 20. Session Snapshot / Reproducibility — P0

每個 TrainingSession 必須保存：

```text
scenario_version
persona_version
rubric_version
knowledge_snapshot_id
embedding_index_version
retrieval_config_version
compliance_policy_version
agent_config_bundle_version
model_route_version
voice_config_version
runtime_backend
locale
```

Evaluation 額外保存：

```text
evaluator_version
evaluation_prompt_version
evidence_turn_ids
human_override
generated_at
```

### 驗收

半年後重開 Report 仍能知道：

> 當時使用哪個 Persona、哪版企業知識、哪套評分規則、哪個 Compliance Policy、哪個 Agent / Model 設定。

---

# 21. Evaluation 複查

## 已完整

- ✅ 10 Dimensions
- ✅ Score
- ✅ Confidence
- ✅ Rubric
- ✅ Evidence
- ✅ Timestamp
- ✅ Improvement Suggestion

## P0 — Low-confidence Review Queue

```text
score_confidence < threshold
OR Critical Compliance Finding
OR AI-Human Variance > threshold
→ Review Queue
```

需有：

- [ ] Assign Reviewer
- [ ] Reviewer Due Date
- [ ] AI Score
- [ ] Human Score
- [ ] Override Reason
- [ ] Final Authoritative Score
- [ ] Review Status
- [ ] Review Audit

狀態：

```text
auto_scored
review_required
under_review
reviewed
overridden
final
```

---

# 22. Rubric Calibration 複查

## 已有

- ✅ Weight
- ✅ Threshold
- ✅ Custom Skill
- ✅ Evidence
- ✅ Forbidden Behavior
- ✅ AI vs Human

## 補強

- [ ] Rubric Version
- [ ] Effective Date
- [ ] Scenario Binding
- [ ] Golden Evaluation Set
- [ ] Inter-rater Agreement
- [ ] Calibration Dataset
- [ ] Language-specific Calibration
- [ ] Model Upgrade Regression

---

# 23. Compliance 複查

## 已完整

- ✅ False Promise
- ✅ Misleading Statement
- ✅ Unsupported Claim
- ✅ Privacy Issue
- ✅ Unauthorized Advice
- ✅ Sensitive Information
- ✅ Missing Disclosure

## P0 — Policy Version Pinning

每筆 Finding 保存：

```text
policy_id
policy_version
rule_id
severity
evidence
decision_model_version
```

Compliance Rule Lifecycle：

```text
Draft
→ Review
→ Approved
→ Effective
→ Expired
→ Replaced
```

避免新法規上線後重新解讀舊 Session。

---

# 24. Session Completion / Replay 複查

## 已完整

- ✅ Overall Score
- ✅ Goal Achievement
- ✅ Strength / Improvement
- ✅ Compliance
- ✅ Next Training
- ✅ Replay
- ✅ 0.5x / 1x / 1.5x
- ✅ Jump to Risk / Score Drop

## 補強

- [ ] Internal-only Share
- [ ] Expiring Share Permission
- [ ] Timeline Annotation
- [ ] Bookmark Key Moment
- [ ] Reviewer Comment
- [ ] Download Transcript Permission
- [ ] Download Audio Permission
- [ ] Redacted Export

---

# 25. Closed-loop Adaptive Learning 複查

## 已完整

- ✅ Skill Profile
- ✅ Knowledge Gap
- ✅ Scenario History
- ✅ Compliance History
- ✅ Practice Frequency
- ✅ Improvement Trend
- ✅ Next Scenario
- ✅ Material
- ✅ Question Set
- ✅ Suggested Difficulty

## 補強

- [ ] Recommendation Reason
- [ ] Recommendation Confidence
- [ ] User Dismiss
- [ ] Manager Override
- [ ] Prevent Endless Repetition
- [ ] Minimum Cooldown
- [ ] Remedial Material Completion
- [ ] Re-evaluation after Remediation

---

# 26. Assignment 複查

## 已有

- ✅ Users / Team
- ✅ Scenario
- ✅ Deadline
- ✅ Attempts
- ✅ Minimum Score
- ✅ Mandatory / Optional
- ✅ Prerequisite
- ✅ Assessment Mode

## P1

- [ ] Recurring Assignment
- [ ] Start Date
- [ ] Grace Period
- [ ] Exemption / Waiver
- [ ] Manager Extension
- [ ] Retake Cooldown
- [ ] Max Attempts
- [ ] Auto-remedial Assignment
- [ ] Bulk Assign
- [ ] CSV Import
- [ ] Assignment Template

---

# 27. Notification Center 複查

## 已有

- ✅ In-app
- ✅ Email
- ✅ Webhook
- ✅ Enterprise Messaging 可擴充

## 補強

- [ ] User Notification Preference
- [ ] Mandatory Notification
- [ ] Quiet Hours
- [ ] Daily / Weekly Digest
- [ ] Delivery Status
- [ ] Retry
- [ ] Bounce / Failure
- [ ] Read / Unread
- [ ] Mark All Read
- [ ] Retention

---

# 28. Content Approval Workflow 複查

目前：

```text
Draft → Review → Approved → Published → Archived
```

建議：

```text
Draft
→ Submitted
→ In Review
→ Changes Requested
→ Resubmitted
→ Approved
→ Scheduled
→ Published
→ Deprecated
→ Archived
```

功能：

- [ ] Reviewer Assignment
- [ ] Comment Thread
- [ ] Request Changes
- [ ] Diff
- [ ] Approval Reason
- [ ] Publish Date
- [ ] Effective Date
- [ ] Maker-checker
- [ ] Emergency Unpublish
- [ ] Rollback

---

# 29. Reports 複查

## 已有

- ✅ Individual
- ✅ Team
- ✅ Scenario
- ✅ Skill
- ✅ Compliance
- ✅ Knowledge Gap
- ✅ Completion
- ✅ Readiness
- ✅ PDF / CSV / XLSX

## P1

- [ ] Saved Filter
- [ ] Scheduled Report
- [ ] Email Delivery
- [ ] Report Snapshot
- [ ] Report Version
- [ ] Share ACL
- [ ] Expiring Share Link
- [ ] Redacted Export
- [ ] Team Digest

---

# 30. Team / Manager Analytics 複查

## 已完整

- ✅ Skill Matrix
- ✅ Weakness Heatmap
- ✅ Pass Rate
- ✅ Compliance Risk
- ✅ High Potential
- ✅ Low Readiness
- ✅ Knowledge Gap
- ✅ Improvement Trend

## 補強

- [ ] Minimum Sample Guard
- [ ] Team Comparison Permission
- [ ] Role Normalization
- [ ] Scenario Normalization
- [ ] Do Not Compare Incompatible Rubrics
- [ ] Sample Count
- [ ] Data Freshness Timestamp

---

# 31. Security 複查

## 已有

- ✅ Prompt Injection
- ✅ Jailbreak
- ✅ Unauthorized Tool
- ✅ PII / Masking
- ✅ Tenant Isolation
- ✅ Encryption
- ✅ Secret Management
- ✅ Signed Upload
- ✅ CSP / CSRF / XSS
- ✅ Rate Limit
- ✅ SSO

## 補強

- [ ] MFA
- [ ] IP Allowlist
- [ ] Session Revoke
- [ ] Dependency Vulnerability Scan
- [ ] Secret Rotation
- [ ] API Key Rotation
- [ ] Encryption Key Rotation
- [ ] Object Storage Private-by-default
- [ ] DLP Rule
- [ ] Download Restriction
- [ ] Data Residency
- [ ] Security Incident Workflow

---

# 32. Audit Log — P0

目前事件類型已足夠，需補治理：

- [ ] Append-only / Immutable Policy
- [ ] Retention Period
- [ ] Export
- [ ] Search / Filter
- [ ] Admin Access Audit
- [ ] Audit Export Audit
- [ ] UTC Timestamp
- [ ] Correlation ID
- [ ] Request ID
- [ ] Source Service
- [ ] Before / After Value for Critical Change
- [ ] Tamper Detection / WORM Strategy where required

Critical Change：

- Rubric
- Compliance Rule
- Model
- Prompt
- Role
- Knowledge Publish
- Report Override

---

# 33. Data Lifecycle / Privacy — P0

建議新增明確 Data Governance 模組。

## Data Class

```text
Public
Internal
Confidential
Restricted
PII
```

## Retention

- [ ] Transcript
- [ ] Voice
- [ ] Report
- [ ] Audit
- [ ] Uploaded Source
- [ ] WebGPU Local Cache
- [ ] Deleted User Data

## Operations

- [ ] Export Personal Data
- [ ] Delete Personal Data
- [ ] Anonymize
- [ ] Legal Hold
- [ ] Retention Exception
- [ ] Workspace Purge
- [ ] Data Region Selection

---

# 34. Integrations 複查

## 已有

- ✅ OpenAI
- ✅ ElevenLabs
- ✅ AMD AUP
- ✅ Qdrant / Chroma / FAISS
- ✅ CRM
- ✅ LMS
- ✅ HRIS
- ✅ SSO
- ✅ Webhook
- ✅ Object Storage

## 補強

每個 Integration 顯示：

- [ ] Health
- [ ] Last Request
- [ ] Error Rate
- [ ] Credential Expiry
- [ ] Scope
- [ ] Environment
- [ ] Test
- [ ] Rotate Credential
- [ ] Delivery / Sync Log
- [ ] Retry Failed Event

---

# 35. API / Webhook Security — P0

## API

- [ ] API Key / OAuth
- [ ] Scope
- [ ] Workspace Binding
- [ ] Rate Limit
- [ ] Expiration
- [ ] Rotation
- [ ] Revoke
- [ ] Last Used
- [ ] Audit

## Webhook

- [ ] HMAC Signature
- [ ] Timestamp
- [ ] Replay Protection
- [ ] Delivery ID
- [ ] Idempotency
- [ ] Retry
- [ ] Exponential Backoff
- [ ] Dead Delivery
- [ ] Delivery Log
- [ ] Test Event
- [ ] Secret Rotation

---

# 36. Model / Prompt / AI Runtime 複查

## 已有

- ✅ LLM Provider / Model
- ✅ Temperature / Tokens
- ✅ Routing / Fallback
- ✅ Embedding / Reranker
- ✅ STT / TTS
- ✅ Safety
- ✅ WebGPU / WASM / Server

## P0 — Model Registry

- [ ] Config ID
- [ ] Model Version
- [ ] Provider
- [ ] Production Approval
- [ ] Workspace Availability
- [ ] Data Policy
- [ ] Cost Metadata
- [ ] Context Limit
- [ ] Fallback
- [ ] Change Log

## P0 — Prompt Registry

- [ ] Prompt ID
- [ ] Agent
- [ ] Version
- [ ] Owner
- [ ] Reviewer
- [ ] Draft / Published
- [ ] Diff
- [ ] Rollback
- [ ] Evaluation Result
- [ ] Effective Date

---

# 37. WebGPU 複查

## 已完整

- ✅ Capability Detection
- ✅ Web Worker
- ✅ Model Cache
- ✅ Warmup
- ✅ Device Lost Handling
- ✅ WASM Fallback
- ✅ Server Fallback
- ✅ Local Embedding
- ✅ Intent
- ✅ Reranker
- ✅ Safety Pre-check
- ✅ Admin Policy

## 補強

- [ ] Capability Test Screen
- [ ] Browser / GPU Compatibility Result
- [ ] Estimated Model Memory
- [ ] Device Memory Guard
- [ ] Model Download Progress
- [ ] Cancel Download
- [ ] Clear Local Model
- [ ] Clear Local Data Cache
- [ ] Runtime Self-test
- [ ] Force Fallback for Troubleshooting

### 驗收

```text
Given navigator.gpu 不可用
When 學員開始訓練
Then 不顯示 blocking error
And 自動進入 WASM 或 Server 模式
```

```text
Given WebGPU 執行中 device lost
When runtime 收到錯誤
Then UI 不 crash
And 發出 runtime.fallback
And Session 可以繼續
```

---

# 38. Usage / Cost Guardrail

AI 系統正式部署建議加入：

- [ ] Monthly Token Budget
- [ ] Voice Minute Budget
- [ ] Embedding Budget
- [ ] Per-user Limit
- [ ] Per-session Max Duration
- [ ] Max Concurrent Sessions
- [ ] Warning Threshold
- [ ] Soft Limit
- [ ] Hard Limit
- [ ] Provider Breakdown
- [ ] Workspace Breakdown
- [ ] Cost Alert

---

# 39. Operational Health — P0

## System Health

- [ ] API
- [ ] WebSocket
- [ ] WebRTC / Voice
- [ ] OpenAI
- [ ] ElevenLabs
- [ ] Qdrant
- [ ] Redis
- [ ] Object Storage
- [ ] Worker Queue

## Job Health

- [ ] queued
- [ ] running
- [ ] retrying
- [ ] failed
- [ ] dead-letter
- [ ] duration

## AI Metrics

- [ ] LLM Latency
- [ ] STT Latency
- [ ] TTS Latency
- [ ] Retrieval Latency
- [ ] Evaluator Latency
- [ ] Fallback Rate
- [ ] Error Rate

---

# 40. Backup / Disaster Recovery

- [ ] PostgreSQL Backup
- [ ] Object Storage Versioning
- [ ] Vector DB Snapshot
- [ ] Restore Test
- [ ] Backup Encryption
- [ ] Backup Retention
- [ ] RPO
- [ ] RTO
- [ ] DR Runbook
- [ ] Region Outage Plan

---

# 41. B2C Mode 複查

## 已有

- ✅ Personal Workspace
- ✅ Templates
- ✅ Interview Practice
- ✅ Presentation Practice
- ✅ Negotiation Practice
- ✅ History
- ✅ Skill Profile
- ✅ Subscription / Credits

## 真正商業化前需補

- [ ] Checkout
- [ ] Upgrade / Downgrade
- [ ] Cancel Subscription
- [ ] Renewal
- [ ] Failed Payment
- [ ] Invoice / Receipt
- [ ] Refund Policy
- [ ] Credit Expiration
- [ ] Free Trial Abuse Prevention
- [ ] Delete Account
- [ ] Terms / Privacy Consent

> 建議企業 MVP 先將 B2C 保持為 Phase 2，避免支付與消費者權益流程干擾核心開發。

---

# 42. UI / UX 複查

## 已完整

- ✅ Soft Aurora
- ✅ Glassmorphism
- ✅ Floating Cards
- ✅ Icon Rail
- ✅ Transcript Style
- ✅ Light / Dark / System
- ✅ Responsive
- ✅ Accessibility
- ✅ i18n

## 補強

- [ ] Unsaved Changes Warning
- [ ] Destructive Action Confirmation
- [ ] Undo where possible
- [ ] Field Validation
- [ ] Global Error Boundary
- [ ] Offline Indicator
- [ ] Connection Degraded State
- [ ] Permission Denied State
- [ ] Quota Exceeded State
- [ ] Maintenance State
- [ ] Empty / No Result State

---

# 43. Accessibility / Localization 複查

## Accessibility

- [ ] Full Keyboard Operation
- [ ] Logical Tab Order
- [ ] Focus Trap
- [ ] Skip Navigation
- [ ] Screen Reader Labels
- [ ] ARIA Live for Transcript
- [ ] ARIA Live for Realtime State
- [ ] Captions
- [ ] Reduced Motion
- [ ] 200% Zoom
- [ ] Non-color-only Status
- [ ] Dark Mode Contrast

## Localization

- ✅ zh-TW
- ✅ English
- ✅ i18n key
- [ ] Timezone
- [ ] Date Format
- [ ] Number Format
- [ ] Currency
- [ ] Language-specific Voice
- [ ] Language-specific Rubric
- [ ] CJK Line Breaking

---

# 44. 端到端 MVP 驗收流程

```text
Admin Login
↓
Create / Select Workspace
↓
Upload Enterprise PDF
↓
Document Processing
↓
Review Chunks
↓
Embedding / Qdrant Index
↓
Retrieval Test
↓
Create Persona
↓
Persona Test Lab
↓
Create Scenario
↓
Bind Knowledge + Rubric + Compliance
↓
Publish Scenario
↓
Assign Trainee
↓
Trainee Device Check
↓
Start Voice / Text Session
↓
Dynamic Customer Objection
↓
Knowledge Citation
↓
Persona State Change
↓
Network Reconnect Test
↓
End Session
↓
Evaluation
↓
Compliance Findings
↓
Evidence Review
↓
Recommended Next Training
↓
Manager Dashboard
```

**任一主要流程都不應需要工程師直接改資料庫才能繼續。**

---

# 45. P0 Release Gate

## Identity

- [ ] Login / Invite / Reset
- [ ] RBAC
- [ ] Session Revocation
- [ ] SSO Policy
- [ ] MFA 或明確記錄為 deferred

## Knowledge

- [ ] Upload
- [ ] Parse
- [ ] Failure Retry
- [ ] Chunk
- [ ] Embedding
- [ ] Citation
- [ ] ACL

## Scenario

- [ ] Persona
- [ ] Scenario
- [ ] Rubric
- [ ] Compliance
- [ ] Version Pin

## Simulation

- [ ] Voice
- [ ] Text
- [ ] Reconnect
- [ ] Autosave
- [ ] Dynamic State
- [ ] Assessment Restriction

## Evaluation

- [ ] Score
- [ ] Evidence
- [ ] Confidence
- [ ] Review Queue
- [ ] Final Score

## Security

- [ ] Tenant Isolation
- [ ] PII
- [ ] Injection Defense
- [ ] Audit
- [ ] Encryption
- [ ] Data Retention

## Runtime

- [ ] WebGPU
- [ ] WASM Fallback
- [ ] Server Fallback
- [ ] Worker
- [ ] Runtime Error Recovery

---

# 46. P1 Release Gate

- [ ] Advanced Assignment
- [ ] Scheduled Reports
- [ ] Connector Sync
- [ ] Knowledge Expiration
- [ ] Full Content Approval
- [ ] Rubric Calibration Dashboard
- [ ] Notification Preferences
- [ ] Cost Dashboard
- [ ] Admin Ops Dashboard
- [ ] Backup / Restore Validation

---

# 47. P2 Roadmap

- [ ] B2C Full Commerce
- [ ] Template Marketplace
- [ ] 3D Avatar
- [ ] Advanced Lip Sync
- [ ] Gamification
- [ ] Cross-company Benchmark
- [ ] Advanced PWA
- [ ] Public API Ecosystem

---

# 48. 建議新增 Data Entity

原有 Entity Model 已完整，建議再新增：

```text
AuthSession
Invitation
MFADevice
KnowledgeSnapshot
RetrievalConfigVersion
PromptVersion
AgentConfigBundle
ModelRouteVersion
CompliancePolicy
CompliancePolicyVersion
ReviewTask
HumanScore
ConnectorSyncJob
WebhookDelivery
UsageRecord
QuotaPolicy
NotificationPreference
DataRetentionPolicy
ExportJob
DeletionJob
SystemHealthEvent
```

---

# 49. TrainingSession 建議最終資料模型

```json
{
  "session_id": "ses_...",
  "tenant_id": "org_...",
  "workspace_id": "ws_...",
  "user_id": "usr_...",
  "assignment_id": "asg_...",

  "mode": "assessment",
  "status": "completed",

  "scenario_version": "scv_12",
  "persona_version": "pev_7",
  "rubric_version": "rbv_4",
  "knowledge_snapshot_id": "kbs_20",
  "retrieval_config_version": "rcv_3",
  "compliance_policy_version": "cpv_8",
  "agent_config_bundle_version": "acb_11",
  "model_route_version": "mrv_5",
  "voice_config_version": "vcv_2",

  "runtime_backend": "webgpu",
  "voice_enabled": true,
  "locale": "zh-TW",

  "started_at": "...",
  "completed_at": "...",

  "final_score": 82,
  "score_status": "final",
  "compliance_status": "safe"
}
```

---

# 50. Evaluation 建議最終資料模型

```json
{
  "evaluation_id": "eva_...",
  "session_id": "ses_...",
  "evaluator_version": "ev_5",
  "rubric_version": "rbv_4",
  "overall_score": 82,
  "confidence": 0.88,
  "dimensions": [
    {
      "skill": "empathy",
      "score": 74,
      "confidence": 0.81,
      "evidence_turn_ids": ["turn_12"],
      "suggestion": "..."
    }
  ],
  "review_status": "final",
  "human_override": false,
  "generated_at": "..."
}
```

---

# 51. ComplianceFinding 建議最終資料模型

```json
{
  "finding_id": "cf_...",
  "session_id": "ses_...",
  "policy_id": "policy_...",
  "policy_version": "8",
  "rule_id": "false_promise_03",
  "type": "unsupported_claim",
  "severity": "high",
  "turn_id": "turn_18",
  "evidence": "...",
  "explanation": "...",
  "suggested_correction": "...",
  "review_status": "open",
  "reviewer_id": null
}
```

---

# 52. 功能測試最低案例集

## Knowledge

1. [ ] 正常 PDF
2. [ ] 加密 PDF
3. [ ] 掃描 PDF
4. [ ] 壞掉 DOCX
5. [ ] 重複文件
6. [ ] OCR fail + retry
7. [ ] Chunk edit + re-embed
8. [ ] Document rollback
9. [ ] ACL deny
10. [ ] Expired knowledge

## RAG

11. [ ] 正常命中
12. [ ] 無命中
13. [ ] 多個矛盾來源
14. [ ] 舊版來源
15. [ ] Cross-tenant access attempt
16. [ ] Citation click

## Persona

17. [ ] Normal persona
18. [ ] Prompt escape
19. [ ] Forbidden knowledge
20. [ ] Dynamic trust
21. [ ] Hidden need reveal
22. [ ] Exit condition

## Voice

23. [ ] Mic allow
24. [ ] Mic deny
25. [ ] Device switch
26. [ ] Network loss
27. [ ] Barge-in
28. [ ] STT fail
29. [ ] TTS fail
30. [ ] Text fallback

## Simulation

31. [ ] Training Hint
32. [ ] Assessment No Hint
33. [ ] Refresh Recovery
34. [ ] Duplicate Tab
35. [ ] Session Timeout
36. [ ] Restart

## Evaluation

37. [ ] Normal Scoring
38. [ ] Low Confidence
39. [ ] Critical Compliance
40. [ ] Human Override
41. [ ] Rubric Version
42. [ ] Evidence Missing Guard

## Security

43. [ ] Prompt Injection
44. [ ] Cross-tenant Access
45. [ ] Expired Session
46. [ ] Revoked User
47. [ ] Unauthorized Tool
48. [ ] API Rate Limit
49. [ ] Audit Event
50. [ ] Export Permission

## WebGPU

51. [ ] Supported
52. [ ] Unsupported
53. [ ] Device Lost
54. [ ] Memory Error
55. [ ] WASM Fallback
56. [ ] Server Fallback

---

# 53. 最終複查結論

## 核心產品功能：完整

目前 v3 已涵蓋：

```text
Knowledge
+
Knowledge Mining
+
Question Bank
+
Persona
+
Scenario
+
Dynamic Multi-Agent
+
Voice
+
Evaluation
+
Compliance
+
Closed-loop Learning
+
Team Management
+
Security
+
WebGPU
```

真正需要補的不是再堆更多 AI 功能，而是以下五件事：

### 1. 可重現性

```text
Scenario / Persona / Rubric / Knowledge / Prompt / Model / Compliance
全部 Version Pinning
```

### 2. 失敗恢復

```text
Document Retry
Session Autosave
Voice Reconnect
WebGPU Fallback
Job Retry
```

### 3. 企業治理

```text
MFA
Data Retention
Immutable Audit
API Security
Approval
Reviewer
```

### 4. 評分可信度

```text
Evidence
Confidence
Human Review
Calibration
Version
```

### 5. 正式營運

```text
Cost Guardrail
System Health
Usage
Backup
Restore
Alert
```

---

# 54. 功能 Freeze 建議

## MVP / P0

```text
企業登入與權限
Knowledge + RAG
Persona
Scenario
Multi-Agent
Voice
Live Simulation
Evaluation
Compliance
Report
Session Recovery
Version Snapshot
Security
WebGPU Fallback
```

## Beta / P1

```text
Knowledge Mining
Advanced Calibration
Adaptive Learning
Team Analytics
Connector Sync
Advanced Assignment
Approval Workflow
Scheduled Report
Operational Dashboard
```

## Commercial / P2

```text
B2C
Billing Automation
Marketplace
3D Avatar
Advanced Gamification
Cross-company Benchmark
```

---

# 55. 最後驗收一句話

> **只有當「文件能匯入、角色能建立、情境能發布、學員能順暢對練、網路中斷能恢復、AI 分數有證據、法遵有版本、所有重要設定可追溯、資料不跨租戶、WebGPU 壞掉仍能繼續使用」全部成立時，才算是完整可交付的企業級 MVP。**
