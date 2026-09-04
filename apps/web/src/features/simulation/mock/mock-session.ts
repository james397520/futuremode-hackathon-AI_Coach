/**
 * Demo fixtures — spec §59 核心 Demo 情境 (insurance sales AI coach).
 *
 * Used whenever `NEXT_PUBLIC_API_BASE_URL` is unset so the most important page of
 * the product is fully demoable with no backend running.
 */
import type { Citation, Evaluation, SessionMode, SkillScore } from '@ai-coach/shared';

import type { SessionBootstrap } from '../lib/types';

export const MOCK_TENANT_ID = 'tenant-demo';
export const MOCK_WORKSPACE_ID = 'ws-demo';

export function createMockBootstrap(sessionId: string, mode: SessionMode = 'training'): SessionBootstrap {
  return {
    sessionId,
    mode,
    runtime: 'webgpu',
    voiceEnabled: true,
    scoreLiveEnabled: mode === 'training',
    startedAtMs: Date.now(),
    turnCount: 0,
    scenario: {
      id: 'scn-family-protection',
      name: '家庭保障需求探索',
      version: 4,
      category: 'Insurance',
      industry: 'Insurance',
      trainingType: 'Consultative Sales',
      difficulty: 'hard',
      openingContext:
        '陳先生是既有客戶轉介，已持有一張基本壽險。他同意見面 15 分鐘，但明確表示「我已經有保險了」。',
      learningObjectives: [
        '完成家庭保障需求探索',
        '正確說明商品的保障範圍與限制',
        '在不承諾固定報酬的前提下處理價格異議',
      ],
      requiredTalkingPoints: [
        '家庭年支出與房貸缺口',
        '既有保單的保障範圍',
        '重大事故後的收入替代',
        '保費與預算的取捨',
      ],
      keyObjections: [
        '我已經有保險了，為什麼還要多買？',
        '每個月又要多一筆支出。',
        '這個報酬率有保證嗎？',
      ],
      restrictedTopics: ['保證報酬率', '其他公司商品比較', '稅務規避建議'],
      successCondition: '完成需求探索 + 正確說明保障 + 無 Critical 合規風險 + Trust ≥ 70',
      timeLimitSeconds: 900,
      maxTurns: 24,
      minimumScore: 80,
    },
    persona: {
      id: 'persona-chen',
      name: '陳先生',
      version: 3,
      age: 38,
      occupation: '軟體工程師',
      background: '已婚，兩名小孩（6 歲 / 3 歲），家中主要收入來源，有房貸。',
      subtitle: '既有客戶 · 家庭保障',
      traitSummary: ['Rational', 'Price-sensitive', 'Family-oriented', 'Skeptical'],
      language: 'zh-TW',
    },
  };
}

/** §12.5 — every knowledge claim traces back to document / version / page / section. */
export const MOCK_CITATIONS: Citation[] = [
  {
    chunk_id: 'chunk-8842',
    document_id: 'doc-product-manual',
    document_name: '家庭保障系列商品手冊',
    document_version: 7,
    page: 12,
    section: '2.3 收入替代給付',
    similarity: 0.883,
    rerank_score: 0.941,
    snippet:
      '收入替代給付於被保險人發生條款所列重大事故且符合等待期規定時，按月給付約定金額，最長 120 個月。給付金額不隨投資績效變動。',
  },
  {
    chunk_id: 'chunk-8850',
    document_id: 'doc-compliance-guide',
    document_name: '業務員合規行為指引',
    document_version: 3,
    page: 4,
    section: '1.2 禁止之招攬行為',
    similarity: 0.812,
    rerank_score: 0.897,
    snippet:
      '不得以「保證獲利」、「保證報酬率」或任何足使要保人誤信收益確定之文字或言詞進行招攬。',
  },
];

export const MOCK_COVERAGE_CITATION: Citation[] = [
  {
    chunk_id: 'chunk-9012',
    document_id: 'doc-product-manual',
    document_name: '家庭保障系列商品手冊',
    document_version: 7,
    page: 18,
    section: '3.1 既有保單加保規則',
    similarity: 0.856,
    rerank_score: 0.912,
    snippet:
      '既有壽險保額低於年收入 5 倍者，得依家庭責任缺口辦理加保；加保時應重新告知等待期與除外責任。',
  },
];

const MOCK_SKILLS: SkillScore[] = [
  {
    skill: 'needs_discovery',
    score: 88,
    confidence: 0.86,
    rubric_note: '主動探索家庭支出與房貸缺口，並確認既有保單範圍。',
    evidence: [
      {
        timestamp_ms: 96_000,
        transcript_turn_ids: ['turn-t2'],
        quote: '如果收入中斷，家裡的固定支出大概還撐得住幾個月？',
        better_approach: '可以再確認配偶是否有收入來源，缺口會更精準。',
      },
    ],
    improvement_suggestion: '把「缺口」量化成月數，客戶更容易自己得出結論。',
  },
  {
    skill: 'empathy',
    score: 84,
    confidence: 0.81,
    rubric_note: '在客戶提到兩個小孩後，先回應擔憂再談商品。',
    evidence: [
      {
        timestamp_ms: 214_000,
        transcript_turn_ids: ['turn-t4'],
        quote: '您最擔心的其實不是保費，而是萬一自己不在了，孩子的教育會不會被迫改變。',
      },
    ],
  },
  {
    skill: 'compliance',
    score: 96,
    confidence: 0.94,
    rubric_note: '全程依商品條款說明保障與費用，未做保證收益承諾。',
    evidence: [
      {
        timestamp_ms: 168_000,
        transcript_turn_ids: ['turn-t3'],
        quote: '我會先依商品條款和您現有保障試算，不會把收益當成保證來估。',
        better_approach: '持續引用商品條款，並清楚區分保障內容與非保證項目。',
      },
    ],
    improvement_suggestion: '談收益時持續使用「非保證、可能變動」的句型。',
  },
  {
    skill: 'objection_handling',
    score: 86,
    confidence: 0.83,
    rubric_note: '將「我已經有保險了」轉為保障缺口的對話。',
    evidence: [
      {
        timestamp_ms: 132_000,
        transcript_turn_ids: ['turn-t3'],
        quote: '您現有的保額大約是年收入的兩倍，我們一起看看差距在哪裡。',
      },
    ],
  },
  {
    skill: 'trust_building',
    score: 82,
    confidence: 0.79,
    rubric_note: '主動更正自己的用語，客戶信任度回升。',
    evidence: [
      {
        timestamp_ms: 186_000,
        transcript_turn_ids: ['turn-t4'],
        quote: '剛剛我講「保證」是不精確的，我更正一下。',
      },
    ],
  },
  {
    skill: 'goal_achievement',
    score: 84,
    confidence: 0.88,
    rubric_note: '取得下一步同意（試算保費）並揭露隱性需求。',
    evidence: [
      {
        timestamp_ms: 268_000,
        transcript_turn_ids: ['turn-t5'],
        quote: '那你幫我算一下，一個月大概多少？',
      },
    ],
  },
];

export function createMockEvaluation(sessionId: string): Evaluation {
  return {
    id: 'eval-demo-1',
    session_id: sessionId,
    rubric_id: 'rubric-consultative-v2',
    overall_score: 82,
    goal_achieved: true,
    passed: true,
    skills: MOCK_SKILLS,
    key_strength: '把價格異議重新框定成家庭保障缺口，並用客戶自己的話收斂結論。',
    main_improvement: '談到收益時避免任何「保證」字眼，改用「非保證、可能變動」並引用商品手冊。',
    compliance_status: 'medium',
    created_at: new Date().toISOString(),
  };
}

export const MOCK_NEXT_TRAINING = {
  scenarioId: 'scn-compliance-language',
  name: '合規話術：收益說明不越線',
  reason: '本次出現一次 False Promise 用語，建議先補強收益說明的合規句型。',
};
