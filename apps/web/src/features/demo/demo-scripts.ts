/**
 * 寫死的展示劇本（螢幕錄影用）。
 *
 * 這是**展示模式**：兩個對話流程完全照劇本走，不呼叫後端、不呼叫模型，所以
 * 每次錄影逐字一致、不會因為服務沒接好而中斷。內容取自 docs/DEMO_SCRIPT.md
 * 設計的兩場戲，示範的能力是真的（模糊意圖→反問釐清、知識庫引用、即時合規），
 * 這裡把「行為」固定成可重播的腳本，方便對著鏡頭走一遍。
 *
 * 一個 beat 是一則要顯示的訊息。trainee beat 由使用者按下送出後出現（畫面會
 * 顯示這裡寫死的 text，不管使用者打了什麼，避免錄影時打錯字）；其餘 beat 在
 * 前一個 trainee beat 之後自動依序播出，中間有打字延遲。
 */
import type { Citation, ComplianceFinding, Difficulty } from '@ai-coach/shared';

export type DemoBeat =
  | {
      speaker: 'persona';
      /** 顯示名稱，例如「林佳穎」。 */
      name: string;
      text: string;
      /** 客戶發言底下的引用晶片（Enterprise RAG）。 */
      citations?: Citation[];
      /** 反問釐清時的可點選項（§8.1）。 */
      clarifyOptions?: string[];
    }
  | {
      speaker: 'coach';
      title: string;
      text: string;
    }
  | {
      speaker: 'compliance';
      finding: ComplianceFinding;
    }
  | {
      speaker: 'trainee';
      /** 送出後顯示的固定台詞（提詞機也顯示同一句）。 */
      text: string;
    };

export interface DemoScript {
  slug: string;
  scenarioTitle: string;
  personaName: string;
  /** 3D 虛擬人身形。 */
  personaGender: 'male' | 'female';
  personaAge: number;
  /** 建立 TTS 用 session 的真實情境 id（僅供語音合成，對話仍照劇本）。 */
  ttsScenarioId: string;
  difficulty: Difficulty;
  personaOccupation: string;
  learningObjectives: string[];
  restrictedTopics: string[];
  /** 客戶第一句（伺服器直接播的固定開場）。 */
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
/* Demo 1 — 模糊意圖 → 反問釐清 ＋ 知識庫引用 ＋ 即時合規（林佳穎）          */
/* ---------------------------------------------------------------------- */

export const DEMO_CLARIFY: DemoScript = {
  slug: 'clarify',
  scenarioTitle: '模糊提問的釐清對談——第一次買保險的林佳穎',
  personaName: '林佳穎',
  personaGender: 'female',
  personaAge: 29,
  ttsScenarioId: '9061e279791b5ba08f9b02f4a36d5075',
  difficulty: 'easy',
  personaOccupation: '29 歲・第一次買保險',
  learningObjectives: ['辨識模糊提問並主動反問釐清', '用知識庫佐證定期與終身壽險差異', '避免對理賠作出保證'],
  restrictedTopics: [],
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
      text: '你說的划算，是指每個月要繳的保費、還是之後能領回來的金額？我怕自己問錯方向。',
      clarifyOptions: ['定期壽險的保費', '定期壽險的保障範圍', '定期壽險的理賠條件'],
    },
    { speaker: 'trainee', text: '我是問保費。定期跟終身差在哪？' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '喔——所以同樣的保額，定期比較便宜、但期滿就沒有了對嗎？那我這個年紀適合哪一種？',
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
    { speaker: 'trainee', text: '抱歉我修正一下：實際給付以保單條款與核保結果為準。' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '這樣講我比較放心。那如果我要保，下一步要準備什麼？',
    },
    { speaker: 'trainee', text: '那這樣呢？' },
    {
      speaker: 'persona',
      name: '林佳穎',
      text: '你說的「這樣」是指投保流程、還是要我先決定保額？我不太確定你在問哪一個。',
      clarifyOptions: ['投保流程', '需要準備的文件', '保額怎麼抓'],
    },
  ],
};

/* ---------------------------------------------------------------------- */
/* Demo 2 — 超綱話題 → 溫和收斂 ＋ 團保知識 ＋ 缺口試算（王國棟）           */
/* ---------------------------------------------------------------------- */

export const DEMO_REDIRECT: DemoScript = {
  slug: 'redirect',
  scenarioTitle: '超綱話題的溫和收斂——健談的王伯伯',
  personaName: '王國棟',
  personaGender: 'male',
  personaAge: 67,
  ttsScenarioId: 'a3d5670bbc0858b3a4a0f6a1a9749bfe',
  difficulty: 'medium',
  personaOccupation: '67 歲・退休國中老師',
  learningObjectives: ['把離題溫和收斂回保單盤點', '用團保知識點出保障缺口', '避免保證費率或給付'],
  restrictedTopics: ['颱風', '選舉', '政治', '股市預測'],
  capabilities: ['超綱話題 → 溫和收斂', '團保知識引用', '缺口試算', '即時合規攔截'],
  opening: {
    speaker: 'persona',
    name: '王國棟',
    text: '今天颱風好像要來了？你們年輕人有去投票嗎？',
  },
  beats: [
    { speaker: 'trainee', text: '王伯伯，您覺得今天天氣如何？' },
    {
      speaker: 'persona',
      name: '王國棟',
      text: '天氣喔…我一個退休老人哪管得了那麼多。倒是你來，是要幫我看保單的吧？我們講這個。',
    },
    { speaker: 'trainee', text: '明天股票會不會漲？' },
    {
      speaker: 'coach',
      title: '偵測到離題',
      text: '客戶把話題帶到股市預測，屬於這個情境的受限主題。用一句話溫和收回，不要跟著預測，直接回到保單盤點。',
    },
    {
      speaker: 'persona',
      name: '王國棟',
      text: '股票我可不敢亂講，會賠錢的。你還是幫我看看我這些保單夠不夠實在。',
    },
    { speaker: 'trainee', text: '我幫您盤點一下現有保單。您公司有團保嗎？' },
    {
      speaker: 'persona',
      name: '王國棟',
      text: '有啊，退休前公司有保，可是我退休了…那個還算數嗎？',
      citations: [
        cite(
          '團體保險與個人保單的差異',
          '商品 SOP v3',
          '團體保險由企業投保，保費低、核保寬鬆，是很好的基礎保障，但保障隨僱傭關係存續：離職、退休或公司變更保單條件時即失效或降低。',
          0.91,
          0.96,
        ),
      ],
    },
    {
      speaker: 'trainee',
      text: '用您的數字算一次缺口：房貸 780 萬、兩個孩子教育金 400 萬、家庭年支出 90 萬要撐 10 年，扣掉現有 300 萬跟可動用的 150 萬。',
    },
    {
      speaker: 'persona',
      name: '王國棟',
      text: '你這樣一算我才知道差這麼多…所以我現在等於少了一千多萬的保障？',
      citations: [
        cite(
          '保障缺口的計算方式',
          '商品 SOP v3',
          '責任基礎法：需求保額 ≈ 未清償負債 ＋ 子女教育費用現值 ＋ 家庭生活費用（年支出 × 需支撐年數）－ 現有保障 － 可動用資產。',
          0.88,
          0.93,
        ),
      ],
    },
    { speaker: 'trainee', text: '這個保證不會再漲。' },
    {
      speaker: 'compliance',
      finding: finding({
        timestamp_ms: 96_000,
        type: 'false_promise',
        severity: 'high',
        evidence: '這個保證不會再漲。',
        policy_rule: '合規紅線與禁止話術 — 不得保證費率或給付',
        explanation:
          '保證費率不再調漲屬於對未來條件的承諾，是知識庫〈合規紅線與禁止話術〉列的禁止事項；續保費率依實際損率與精算調整。',
        suggested_correction: '費率會依理賠狀況逐年檢視，我把影響費率的因素跟您說明清楚。',
      }),
    },
    { speaker: 'trainee', text: '抱歉，費率會依每年的理賠狀況檢視，我幫您說明影響因素。' },
    {
      speaker: 'persona',
      name: '王國棟',
      text: '這樣講才實在。那你把那個缺口的部分，用我付得起的方式幫我補一補。',
    },
  ],
};

export const DEMO_SCRIPTS: Record<string, DemoScript> = {
  [DEMO_CLARIFY.slug]: DEMO_CLARIFY,
  [DEMO_REDIRECT.slug]: DEMO_REDIRECT,
};
