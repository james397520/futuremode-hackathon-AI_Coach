/**
 * 情境示範劇本。
 *
 * 兩個示範情境完整照本演出，供一鍵播放。示範的能力是真的（模糊意圖→反問釐清、
 * 知識庫引用、即時合規攔截），這裡把「行為」固定成可重播的順序。播放頁會在虛擬
 * 人出現後自動逐句演出，並在每句 AI 回覆前顯示生成中的狀態。
 */
import type { Citation, ComplianceFinding, Difficulty } from '@ai-coach/shared';

export type DemoBeat =
  | {
      speaker: 'persona';
      name: string;
      text: string;
      citations?: Citation[];
      clarifyOptions?: string[];
    }
  | { speaker: 'coach'; title: string; text: string }
  | { speaker: 'compliance'; finding: ComplianceFinding }
  | { speaker: 'trainee'; text: string };

export interface DemoScript {
  slug: string;
  scenarioTitle: string;
  personaName: string;
  personaGender: 'male' | 'female';
  personaAge: number;
  /** 建立語音合成用 session 的真實情境 id（僅供 TTS，內容仍照本檔演出）。 */
  ttsScenarioId: string;
  difficulty: Difficulty;
  personaOccupation: string;
  industry: string;
  trainingType: string;
  timeLimitSeconds: number;
  maxTurns: number;
  learningObjectives: string[];
  requiredTalkingPoints: string[];
  keyObjections: string[];
  restrictedTopics: string[];
  successCondition: string;
  personaTraits: { trust: number; interest: number; resistance: number; patience: number };
  opening: DemoBeat;
  beats: DemoBeat[];
  capabilities: string[];
}

const cite = (
  section: string,
  documentName: string,
  snippet: string,
  similarity: number,
  rerank: number,
): Citation => ({
  chunk_id: `chk_${section}`,
  document_id: `doc_${documentName}`,
  document_name: documentName,
  document_version: 3,
  section,
  similarity,
  rerank_score: rerank,
  snippet,
});

const finding = (
  partial: Pick<
    ComplianceFinding,
    'type' | 'severity' | 'evidence' | 'policy_rule' | 'explanation' | 'suggested_correction'
  > & { timestamp_ms: number },
): ComplianceFinding => ({
  id: `cf_${partial.timestamp_ms}`,
  session_id: 'demo',
  transcript_turn_id: 'demo',
  reviewer_status: 'open',
  ...partial,
});

/* ---------------------------------------------------------------------- */
/* 情境一 — 模糊意圖 → 反問釐清 ＋ 知識庫引用 ＋ 即時合規（林佳穎）          */
/* ---------------------------------------------------------------------- */

export const DEMO_CLARIFY: DemoScript = {
  slug: 'clarify',
  scenarioTitle: '模糊提問的釐清對談——第一次買保險的林佳穎',
  personaName: '林佳穎',
  personaGender: 'female',
  personaAge: 29,
  ttsScenarioId: '9061e279791b5ba08f9b02f4a36d5075',
  difficulty: 'easy',
  personaOccupation: '行銷專員',
  industry: '保險 / 個人壽險',
  trainingType: 'needs_discovery',
  timeLimitSeconds: 600,
  maxTurns: 30,
  learningObjectives: [
    '面對指涉不明的提問，先反問釐清（在問價格？保障？期限？），不要猜著回答',
    '把選項攤開讓客戶選，而不是替客戶決定',
    '用客戶聽得懂的生活語言解釋專有名詞',
    '在任何商品說明前完成基本需求探索（收入、負擔、最擔心的情況）',
  ],
  requiredTalkingPoints: [
    '至少一次以反問釐清客戶的模糊提問',
    '確認每月可負擔金額',
    '確認客戶最擔心的情況',
    '明確說明本次對話不構成投資或稅務建議',
  ],
  keyObjections: ['我朋友說直接買儲蓄險就好？', '這個…划算嗎？', '那這樣夠嗎？', '我再想想好了'],
  restrictedTopics: ['保證投資報酬率', '稅務規劃建議', '同業商品的具體費率比較'],
  successCondition: '學員至少一次以反問釐清模糊提問 + 客戶說出每月可負擔金額 + 信任度 ≥ 65 + 無重大合規風險',
  personaTraits: { trust: 55, interest: 50, resistance: 40, patience: 60 },
  capabilities: ['模糊意圖 → 反問釐清', 'Enterprise RAG 引用', '即時合規攔截'],
  opening: {
    speaker: 'persona',
    name: '林佳穎',
    text: '我朋友說我應該買一個…那個，你覺得划算嗎？',
  },
  beats: [
    { speaker: 'trainee', text: '這個划算嗎？' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '你說的划算，是想問每個月要繳多少、還是之後領得回來多少？我自己也不太確定該問哪個。',
      clarifyOptions: ['定期壽險的保費', '定期壽險的保障範圍', '定期壽險的理賠條件'],
    },
    { speaker: 'trainee', text: '我先確認一下，你比較在意每月保費負擔，還是保障範圍？' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '嗯…應該是保費吧，我怕每個月繳不起。那定期跟終身差在哪？',
    },
    {
      speaker: 'trainee',
      text: '簡單說：定期在約定年期內有保障、保費較低；終身保障一輩子、保費較高。我用核准資料跟你說明。',
    },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '喔——所以一樣的保額，定期比較便宜、但期滿就沒了對嗎？那我這年紀適合哪種？',
      citations: [
        cite(
          '定期壽險與終身壽險',
          '商品 SOP v3',
          '定期壽險在約定年期內提供身故／全殘保障，期滿無給付、無解約金，因此同樣保額的保費明顯低於終身壽險。',
          0.89,
          0.94,
        ),
      ],
    },
    { speaker: 'trainee', text: '這個一定會理賠，你放心。' },
    {
      speaker: 'compliance',
      finding: finding({
        timestamp_ms: 42_000,
        type: 'false_promise',
        severity: 'critical',
        evidence: '這個一定會理賠，你放心。',
        policy_rule: '合規紅線與禁止話術 — 不得以「一定會理賠」描述任何條款',
        explanation:
          '以「一定會理賠」對條款作出保證，屬於知識庫〈合規紅線與禁止話術〉明文禁止的話術；理賠與否取決於保單條款與核保結果。',
        suggested_correction: '實際給付以保單條款與核保結果為準，我幫你把理賠條件逐項說明。',
      }),
    },
    { speaker: 'trainee', text: '抱歉我修正一下：實際給付以保單條款與核保結果為準，我把理賠條件逐項跟你說。' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '這樣講我比較安心。那如果我決定要保，接下來要準備什麼？',
    },
  ],
};

/* ---------------------------------------------------------------------- */
/* 情境二 — 合規檢查：禁止話術辨識 ＋ 風險揭露 ＋ 即時攔截（周敏惠）          */
/* ---------------------------------------------------------------------- */

export const DEMO_COMPLIANCE: DemoScript = {
  slug: 'compliance',
  scenarioTitle: '投資型保單的合規對談——精打細算的周敏惠',
  personaName: '周敏惠',
  personaGender: 'female',
  personaAge: 42,
  // 語音合成借用既有情境（本地單一女聲），對話內容仍照本檔演出。
  ttsScenarioId: '6e871cc2b0fe59a0b4c9103c7da844c4',
  difficulty: 'hard',
  personaOccupation: '小型企業主',
  industry: '保險 / 投資型保單',
  trainingType: 'compliance_check',
  timeLimitSeconds: 600,
  maxTurns: 30,
  learningObjectives: [
    '辨識並避開「保證獲利」「保本」「穩賺不賠」等禁止話術',
    '說明投資型商品時完整揭露市場風險與本金可能損失',
    '不提供稅務規劃建議，導向會計師或稅務專業',
    '出現違規話術時當下自我修正，不硬凹',
  ],
  requiredTalkingPoints: [
    '明確揭露投資型商品不保證獲利、本金可能損失',
    '不承諾保本、不承諾固定報酬',
    '不提供稅務規劃或節稅承諾',
    '引用核准的商品與合規說明',
  ],
  keyObjections: ['朋友說這個保證獲利，是真的嗎？', '買保險可以節稅吧？', '至少本金不會少吧？', '你們公司會不會倒？'],
  restrictedTopics: ['保證投資報酬率', '保本承諾', '稅務規劃建議', '同業商品的具體費率比較', '醫療診斷'],
  successCondition:
    '全程不出現保證獲利／保本／節稅承諾 + 每次違規話術當下修正 + 完整揭露市場風險 + 無重大合規風險',
  personaTraits: { trust: 45, interest: 65, resistance: 45, patience: 55 },
  capabilities: ['即時合規攔截', '禁止話術辨識', '風險揭露', 'Enterprise RAG 引用'],
  opening: {
    speaker: 'persona',
    name: '周敏惠',
    text: '朋友介紹我買你們的投資型保單，說是保證獲利，是真的嗎？',
  },
  beats: [
    { speaker: 'trainee', text: '對，這個保證獲利，穩賺不賠，你放心買。' },
    {
      speaker: 'compliance',
      finding: finding({
        timestamp_ms: 20_000,
        type: 'false_promise',
        severity: 'critical',
        evidence: '這個保證獲利，穩賺不賠。',
        policy_rule: '合規紅線與禁止話術 — 不得保證投資報酬或給付',
        explanation:
          '「保證獲利」「穩賺不賠」是知識庫〈合規紅線與禁止話術〉明文禁止的話術；投資型保單的報酬隨市場波動、本金可能損失，不得作任何獲利保證。',
        suggested_correction: '投資型保單的報酬會隨市場波動、本金可能損失，我把風險與過往績效的性質跟你說明清楚。',
      }),
    },
    { speaker: 'trainee', text: '抱歉我更正：投資型保單的報酬會隨市場波動，不保證獲利，本金也可能損失。' },
    {
      speaker: 'persona',
      name: '周敏惠',
      text: '喔…所以不是穩賺的喔？那我得先搞清楚風險。這種商品的風險到底怎麼看？',
      citations: [
        cite(
          '合規紅線與禁止話術',
          '商品 SOP v3',
          '禁止：保證投資報酬率或保證給付；以「一定會理賠」描述任何條款；提供稅務規劃或投資建議；為促成成交而誇大商品內容。',
          0.9,
          0.95,
        ),
      ],
    },
    { speaker: 'trainee', text: '報酬連結投資標的，帳戶價值會隨市場漲跌，最壞情況本金會虧損，這些條款裡都有寫。' },
    {
      speaker: 'persona',
      name: '周敏惠',
      text: '好，那我懂了。對了，朋友說買保險可以節稅，這個能幫我節稅嗎？',
    },
    { speaker: 'trainee', text: '可以啊，買這個一定能幫你節稅。' },
    {
      speaker: 'compliance',
      finding: finding({
        timestamp_ms: 60_000,
        type: 'unauthorized_advice',
        severity: 'high',
        evidence: '買這個一定能幫你節稅。',
        policy_rule: '合規紅線與禁止話術 — 不得提供稅務規劃建議',
        explanation:
          '提供稅務規劃或節稅承諾屬於知識庫〈合規紅線與禁止話術〉的受限行為；稅務效果因人而異，應導向會計師或稅務專業。',
        suggested_correction: '稅務規劃請以會計師或稅務專業意見為準，我這邊只說明商品本身的內容與費用。',
      }),
    },
    { speaker: 'trainee', text: '抱歉，稅務我不能給建議，請以會計師或稅務專業意見為準，我只說明商品內容。' },
    {
      speaker: 'persona',
      name: '周敏惠',
      text: '這樣才對嘛。那至少本金不會少吧？我放進去的錢有保本嗎？',
    },
    { speaker: 'trainee', text: '這個保證保本，你完全不用擔心。' },
    {
      speaker: 'compliance',
      finding: finding({
        timestamp_ms: 96_000,
        type: 'false_promise',
        severity: 'critical',
        evidence: '這個保證保本，你完全不用擔心。',
        policy_rule: '合規紅線與禁止話術 — 不得承諾保本',
        explanation:
          '「保證保本」是禁止話術：投資型保單不保證本金，帳戶價值可能低於已繳保費；承諾保本會誤導客戶對風險的認知。',
        suggested_correction: '這類商品不保證本金，帳戶價值可能低於已繳保費，我把保本型與投資型的差別跟你比較。',
      }),
    },
    {
      speaker: 'trainee',
      text: '這裡我要更正：投資型不保證本金，帳戶價值可能低於已繳保費。如果你要保本，我幫你看保本型的商品。',
    },
    {
      speaker: 'persona',
      name: '周敏惠',
      text: '你這樣講清楚多了，我反而更信得過。那你把保本型跟投資型的差別整理給我看看。',
    },
  ],
};

export const DEMO_SCRIPTS: Record<string, DemoScript> = {
  [DEMO_CLARIFY.slug]: DEMO_CLARIFY,
  [DEMO_COMPLIANCE.slug]: DEMO_COMPLIANCE,
};
