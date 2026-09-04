import type { Persona } from '@ai-coach/shared-types';
import { NOW_ISO, SCOPE, daysAgo } from './constants';

/**
 * §59 core demo persona — 陳先生.
 * 38, engineer, married, two children. Rational / price-sensitive /
 * family-oriented / skeptical. Main objection:
 *   「我已經有保險了，為什麼還要多買？」
 * Hidden need: family financial protection after a major incident.
 */
export const PERSONA_MR_CHEN: Persona = {
  id: 'per_chen',
  ...SCOPE,
  name: '陳先生 (Mr. Chen)',
  version: 4,
  status: 'published',
  age: 38,
  occupation: 'Senior hardware engineer',
  industry: 'Semiconductor',
  background:
    '已婚，兩名小孩（6 歲與 3 歲）。家庭年收入穩定但房貸壓力大，公司團保之外只有一張早年買的儲蓄型保單。習慣先查資料再做決定，對業務話術敏感。',
  language: 'zh-TW',
  locale: 'zh-TW',
  traits: {
    trust: 38,
    patience: 62,
    price_sensitivity: 84,
    risk_aversion: 71,
    product_knowledge: 46,
    resistance: 68,
    openness: 44,
  },
  hidden: {
    primary_goal: '確認自己現有的保障是否真的足夠，而不是被多賣一張保單',
    hidden_need: '擔心家庭在重大事故後的財務保障 — 房貸與兩個孩子的教育費',
    main_concern: '每月保費會壓縮家庭現金流',
    budget: 4500,
    trigger_points: [
      '提到孩子的教育金時會軟化',
      '被追問收入細節時會提高警戒',
      '聽到「保證」「一定」等字眼會直接質疑',
    ],
    objections: [
      '我已經有保險了，為什麼還要多買？',
      '公司團保不是已經有保障了嗎？',
      '這個保費比我想像的高很多。',
      '你們業務是不是抽成很高？',
    ],
    forbidden_knowledge: [
      '不知道自己團保的實際理賠上限',
      '不知道重大疾病與癌症險的定義差異',
    ],
    opening_attitude: '禮貌但明顯保留，語速快，直接問重點',
    exit_condition: '被連續兩次忽略情緒訊號，或聽到不實承諾',
    success_condition: '學員完成需求探索並用他自己的家庭情境說明保障缺口',
  },
  voice: {
    provider: 'elevenlabs',
    voice_id: 'zh-tw-male-mid',
    language: 'zh-TW',
    speed: 1.02,
    stability: 0.62,
    emotion_style: 'measured, slightly guarded',
  },
  avatar_url: undefined,
  created_at: daysAgo(96),
  updated_at: daysAgo(3),
};

export const MOCK_PERSONAS: Persona[] = [
  PERSONA_MR_CHEN,
  {
    id: 'per_lady_wu',
    ...SCOPE,
    name: '吳太太 (Mrs. Wu)',
    version: 2,
    status: 'published',
    age: 54,
    occupation: 'Retail shop owner',
    industry: 'Retail',
    background: '自營商，現金流敏感，剛送走一位因病離世的親戚，情緒起伏較大。',
    language: 'zh-TW',
    locale: 'zh-TW',
    traits: {
      trust: 55,
      patience: 40,
      price_sensitivity: 66,
      risk_aversion: 82,
      product_knowledge: 28,
      resistance: 44,
      openness: 70,
    },
    voice: {
      provider: 'elevenlabs',
      voice_id: 'zh-tw-female-mature',
      language: 'zh-TW',
      speed: 0.98,
      stability: 0.5,
      emotion_style: 'warm, anxious',
    },
    created_at: daysAgo(72),
    updated_at: daysAgo(12),
  },
  {
    id: 'per_daniel',
    ...SCOPE,
    name: 'Daniel Ko',
    version: 1,
    status: 'review_required',
    age: 29,
    occupation: 'Startup founder',
    industry: 'SaaS',
    background: 'High income, irregular cash flow, extremely time-poor. Wants everything in three bullet points.',
    language: 'en',
    locale: 'en-SG',
    traits: {
      trust: 48,
      patience: 22,
      price_sensitivity: 34,
      risk_aversion: 30,
      product_knowledge: 61,
      resistance: 72,
      openness: 58,
    },
    voice: {
      provider: 'openai',
      voice_id: 'en-male-brisk',
      language: 'en',
      speed: 1.12,
      stability: 0.7,
      emotion_style: 'clipped, impatient',
    },
    created_at: daysAgo(20),
    updated_at: daysAgo(1),
  },
  {
    id: 'per_bank_walkin',
    ...SCOPE,
    name: '林小姐 (Bank walk-in)',
    version: 3,
    status: 'published',
    age: 33,
    occupation: 'Public sector clerk',
    industry: 'Government',
    background: '到分行辦定存被轉介，對「銀行推銷保險」有戒心，重視白紙黑字。',
    language: 'zh-TW',
    locale: 'zh-TW',
    traits: {
      trust: 30,
      patience: 74,
      price_sensitivity: 58,
      risk_aversion: 66,
      product_knowledge: 22,
      resistance: 76,
      openness: 36,
    },
    voice: {
      provider: 'elevenlabs',
      voice_id: 'zh-tw-female-young',
      language: 'zh-TW',
      speed: 1,
      stability: 0.66,
      emotion_style: 'polite, reserved',
    },
    created_at: daysAgo(140),
    updated_at: daysAgo(30),
  },
  {
    id: 'per_draft_hr',
    ...SCOPE,
    name: 'HR benefits committee (draft)',
    version: 1,
    status: 'draft',
    age: undefined,
    occupation: 'Group benefits decision panel',
    industry: 'Manufacturing',
    background: 'Three-person committee persona for group insurance renewal negotiations.',
    language: 'zh-TW',
    locale: 'zh-TW',
    traits: {
      trust: 50,
      patience: 55,
      price_sensitivity: 90,
      risk_aversion: 48,
      product_knowledge: 74,
      resistance: 60,
      openness: 42,
    },
    voice: { provider: 'none', language: 'zh-TW', speed: 1 },
    created_at: daysAgo(5),
    updated_at: NOW_ISO,
  },
];

/** §36 Persona Behaviour Rules — trigger table shown in the builder. */
export interface PersonaTriggerRule {
  id: string;
  when: string;
  effect: string;
  delta: Array<{ variable: 'trust' | 'interest' | 'resistance' | 'patience'; amount: number }>;
}

export const PERSONA_TRIGGER_RULES: PersonaTriggerRule[] = [
  {
    id: 'rule_oversell',
    when: 'Trainee oversells or promises a guaranteed return',
    effect: 'Resistance + 20, trust drops sharply',
    delta: [
      { variable: 'resistance', amount: 20 },
      { variable: 'trust', amount: -12 },
    ],
  },
  {
    id: 'rule_family',
    when: 'Trainee recognises the family / mortgage pressure',
    effect: 'Trust + 15, hidden need becomes reachable',
    delta: [
      { variable: 'trust', amount: 15 },
      { variable: 'interest', amount: 10 },
    ],
  },
  {
    id: 'rule_group_cover',
    when: 'Trainee explains the gap between group cover and personal cover with numbers',
    effect: 'Interest + 18, resistance − 10',
    delta: [
      { variable: 'interest', amount: 18 },
      { variable: 'resistance', amount: -10 },
    ],
  },
  {
    id: 'rule_ignore_emotion',
    when: 'Trainee skips an emotional signal twice in a row',
    effect: 'Patience − 25, persona moves toward exit condition',
    delta: [
      { variable: 'patience', amount: -25 },
      { variable: 'trust', amount: -8 },
    ],
  },
];

export function personaById(id: string): Persona | undefined {
  return MOCK_PERSONAS.find((persona) => persona.id === id);
}
