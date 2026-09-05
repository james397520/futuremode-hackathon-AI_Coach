/**
 * A self-contained WordPiece tokenizer.
 *
 * The embedder / classifier / cross-encoder families we ship (§52–§54) are all
 * BERT-derived, so one WordPiece implementation covers every local task. Bundling
 * our own keeps `transformers.js` out of the dependency graph — it is a large
 * package and §96 forbids anything ML-shaped in the initial bundle.
 *
 * It runs in both window and worker scopes and touches no browser API beyond
 * `TextDecoder`, which is guarded.
 */

export interface TokenizerOptions {
  lowercase?: boolean;
  stripAccents?: boolean;
  maxLength?: number;
  clsToken?: string;
  sepToken?: string;
  unkToken?: string;
  padToken?: string;
  continuingSubwordPrefix?: string;
}

export interface EncodedInput {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
}

export interface EncodedBatch {
  inputIds: number[][];
  attentionMask: number[][];
  tokenTypeIds: number[][];
  /** Padded sequence length shared by every row. */
  sequenceLength: number;
}

const DEFAULTS = {
  lowercase: true,
  stripAccents: true,
  maxLength: 512,
  clsToken: '[CLS]',
  sepToken: '[SEP]',
  unkToken: '[UNK]',
  padToken: '[PAD]',
  continuingSubwordPrefix: '##',
} as const;

/** Unicode categories WordPiece's BasicTokenizer treats as standalone punctuation. */
const PUNCTUATION_RE =
  /[!-\/:-@\[-`{-~¡-¿‐-‧‰-⁞、-〿！-･]/u;

/** CJK ranges are split per-character before WordPiece, as in the reference impl. */
function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f) ||
    // Hiragana / Katakana / Hangul are also better treated per-character here.
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

export class WordPieceTokenizer {
  readonly vocabSize: number;

  private readonly vocab: Map<string, number>;
  private readonly opts: Required<TokenizerOptions>;
  private readonly clsId: number;
  private readonly sepId: number;
  private readonly unkId: number;
  private readonly padId: number;

  constructor(vocab: Map<string, number>, options: TokenizerOptions = {}) {
    if (vocab.size === 0) {
      throw new Error('WordPieceTokenizer: empty vocabulary');
    }
    this.vocab = vocab;
    this.vocabSize = vocab.size;
    this.opts = {
      lowercase: options.lowercase ?? DEFAULTS.lowercase,
      stripAccents: options.stripAccents ?? DEFAULTS.stripAccents,
      maxLength: options.maxLength ?? DEFAULTS.maxLength,
      clsToken: options.clsToken ?? DEFAULTS.clsToken,
      sepToken: options.sepToken ?? DEFAULTS.sepToken,
      unkToken: options.unkToken ?? DEFAULTS.unkToken,
      padToken: options.padToken ?? DEFAULTS.padToken,
      continuingSubwordPrefix:
        options.continuingSubwordPrefix ?? DEFAULTS.continuingSubwordPrefix,
    };
    // Special tokens sometimes differ between checkpoints; fall back to <s>/</s>
    // style names, and finally to 0 so we degrade instead of throwing.
    this.clsId = this.lookupSpecial([this.opts.clsToken, '<s>', '[CLS]'], 0);
    this.sepId = this.lookupSpecial([this.opts.sepToken, '</s>', '[SEP]'], 0);
    this.unkId = this.lookupSpecial([this.opts.unkToken, '<unk>', '[UNK]'], 0);
    this.padId = this.lookupSpecial([this.opts.padToken, '<pad>', '[PAD]'], 0);
  }

  private lookupSpecial(candidates: readonly string[], fallback: number): number {
    for (const candidate of candidates) {
      const id = this.vocab.get(candidate);
      if (typeof id === 'number') return id;
    }
    return fallback;
  }

  /** `vocab.txt`: one token per line, id = line index. */
  static fromVocabText(text: string, options: TokenizerOptions = {}): WordPieceTokenizer {
    const vocab = new Map<string, number>();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      if (raw === undefined) continue;
      const token = raw.replace(/\r$/, '');
      if (token.length === 0) continue;
      if (!vocab.has(token)) vocab.set(token, i);
    }
    return new WordPieceTokenizer(vocab, options);
  }

  /**
   * HuggingFace `tokenizer.json`. Parsed defensively: we only read `model.vocab`,
   * `model.unk_token`, `model.continuing_subword_prefix` and the normaliser flags,
   * and every one of them is optional.
   */
  static fromTokenizerJson(source: string | unknown, options: TokenizerOptions = {}): WordPieceTokenizer {
    let parsed: unknown = source;
    if (typeof source === 'string') {
      try {
        parsed = JSON.parse(source) as unknown;
      } catch (error) {
        throw new Error(
          `WordPieceTokenizer: tokenizer.json is not valid JSON (${describe(error)})`,
        );
      }
    }
    const root = asRecord(parsed);
    const model = asRecord(root['model']);
    const rawVocab = model['vocab'];
    const vocab = new Map<string, number>();
    if (Array.isArray(rawVocab)) {
      // Unigram-style: [[piece, score], ...] — id is the array index.
      for (let i = 0; i < rawVocab.length; i += 1) {
        const entry = rawVocab[i];
        const piece = Array.isArray(entry) ? entry[0] : entry;
        if (typeof piece === 'string' && !vocab.has(piece)) vocab.set(piece, i);
      }
    } else if (rawVocab && typeof rawVocab === 'object') {
      for (const [token, id] of Object.entries(rawVocab as Record<string, unknown>)) {
        if (typeof id === 'number' && Number.isFinite(id)) vocab.set(token, id);
      }
    }
    if (vocab.size === 0) {
      throw new Error('WordPieceTokenizer: tokenizer.json contained no usable vocabulary');
    }

    const normalizer = asRecord(root['normalizer']);
    const inferred: TokenizerOptions = {
      lowercase:
        typeof normalizer['lowercase'] === 'boolean'
          ? (normalizer['lowercase'] as boolean)
          : undefined,
      stripAccents:
        typeof normalizer['strip_accents'] === 'boolean'
          ? (normalizer['strip_accents'] as boolean)
          : undefined,
      unkToken: typeof model['unk_token'] === 'string' ? (model['unk_token'] as string) : undefined,
      continuingSubwordPrefix:
        typeof model['continuing_subword_prefix'] === 'string'
          ? (model['continuing_subword_prefix'] as string)
          : undefined,
    };
    // Explicit caller options win over anything inferred from the file.
    return new WordPieceTokenizer(vocab, {
      ...stripUndefined(inferred),
      ...stripUndefined(options),
    });
  }

  /** Pick the right parser from the file name. */
  static fromFile(
    fileName: string,
    bytes: ArrayBuffer,
    options: TokenizerOptions = {},
  ): WordPieceTokenizer {
    const text = decodeUtf8(bytes);
    return /\.json$/i.test(fileName)
      ? WordPieceTokenizer.fromTokenizerJson(text, options)
      : WordPieceTokenizer.fromVocabText(text, options);
  }

  encode(text: string, maxLength?: number): EncodedInput {
    const limit = this.clampLength(maxLength);
    // Reserve room for [CLS] ... [SEP].
    const pieces = this.wordpiece(this.basicTokenize(text)).slice(0, Math.max(0, limit - 2));
    const inputIds = [this.clsId, ...pieces, this.sepId];
    return {
      inputIds,
      attentionMask: inputIds.map(() => 1),
      tokenTypeIds: inputIds.map(() => 0),
    };
  }

  /** Cross-encoder pair encoding: [CLS] a [SEP] b [SEP]. */
  encodePair(a: string, b: string, maxLength?: number): EncodedInput {
    const limit = this.clampLength(maxLength);
    const budget = Math.max(0, limit - 3);
    let first = this.wordpiece(this.basicTokenize(a));
    let second = this.wordpiece(this.basicTokenize(b));
    // Longest-first truncation, as in the reference `truncate_sequences`.
    while (first.length + second.length > budget) {
      if (first.length >= second.length && first.length > 0) first = first.slice(0, -1);
      else if (second.length > 0) second = second.slice(0, -1);
      else break;
    }
    const inputIds = [this.clsId, ...first, this.sepId, ...second, this.sepId];
    const typeIds = [
      ...new Array<number>(first.length + 2).fill(0),
      ...new Array<number>(second.length + 1).fill(1),
    ];
    return {
      inputIds,
      attentionMask: inputIds.map(() => 1),
      tokenTypeIds: typeIds.length === inputIds.length ? typeIds : inputIds.map(() => 0),
    };
  }

  /** Right-pad a set of encodings to a common length. */
  padBatch(rows: readonly EncodedInput[]): EncodedBatch {
    let sequenceLength = 0;
    for (const row of rows) sequenceLength = Math.max(sequenceLength, row.inputIds.length);
    if (sequenceLength === 0) sequenceLength = 1;
    const inputIds: number[][] = [];
    const attentionMask: number[][] = [];
    const tokenTypeIds: number[][] = [];
    for (const row of rows) {
      const pad = sequenceLength - row.inputIds.length;
      inputIds.push([...row.inputIds, ...new Array<number>(pad).fill(this.padId)]);
      attentionMask.push([...row.attentionMask, ...new Array<number>(pad).fill(0)]);
      tokenTypeIds.push([...row.tokenTypeIds, ...new Array<number>(pad).fill(0)]);
    }
    return { inputIds, attentionMask, tokenTypeIds, sequenceLength };
  }

  encodeBatch(texts: readonly string[], maxLength?: number): EncodedBatch {
    return this.padBatch(texts.map((t) => this.encode(t, maxLength)));
  }

  encodePairBatch(
    query: string,
    docs: readonly string[],
    maxLength?: number,
  ): EncodedBatch {
    return this.padBatch(docs.map((d) => this.encodePair(query, d, maxLength)));
  }

  private clampLength(maxLength?: number): number {
    const requested = maxLength ?? this.opts.maxLength;
    if (!Number.isFinite(requested)) return this.opts.maxLength;
    return Math.max(4, Math.min(Math.floor(requested), this.opts.maxLength));
  }

  /** Normalise → split on whitespace/punctuation → isolate CJK characters. */
  private basicTokenize(input: string): string[] {
    let text = typeof input === 'string' ? input : String(input ?? '');
    // Drop control characters and normalise all whitespace to a single space.
    text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, '');
    try {
      text = text.normalize('NFD');
    } catch {
      /* Intl data may be trimmed in some embedded browsers — proceed unnormalised. */
    }
    if (this.opts.stripAccents) {
      text = text.replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe20-\ufe2f]/g, '');
    }
    try {
      text = text.normalize('NFC');
    } catch {
      /* ignore */
    }
    if (this.opts.lowercase) text = text.toLowerCase();

    const out: string[] = [];
    let buffer = '';
    const flush = (): void => {
      if (buffer.length > 0) {
        out.push(buffer);
        buffer = '';
      }
    };
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (/\s/u.test(char)) {
        flush();
      } else if (PUNCTUATION_RE.test(char)) {
        flush();
        out.push(char);
      } else if (isCjk(code)) {
        flush();
        out.push(char);
      } else {
        buffer += char;
      }
    }
    flush();
    return out;
  }

  /** Greedy longest-match-first WordPiece. */
  private wordpiece(words: readonly string[]): number[] {
    const ids: number[] = [];
    const prefix = this.opts.continuingSubwordPrefix;
    for (const word of words) {
      if (word.length === 0) continue;
      if (word.length > 100) {
        // Reference impl treats absurdly long "words" as unknown rather than
        // burning O(n^2) on them.
        ids.push(this.unkId);
        continue;
      }
      const chars = Array.from(word);
      let start = 0;
      const wordIds: number[] = [];
      let failed = false;
      while (start < chars.length) {
        let end = chars.length;
        let matched: number | undefined;
        while (start < end) {
          const piece = (start > 0 ? prefix : '') + chars.slice(start, end).join('');
          const id = this.vocab.get(piece);
          if (typeof id === 'number') {
            matched = id;
            break;
          }
          end -= 1;
        }
        if (matched === undefined) {
          failed = true;
          break;
        }
        wordIds.push(matched);
        start = end;
      }
      if (failed) ids.push(this.unkId);
      else ids.push(...wordIds);
    }
    return ids;
  }
}

/* ------------------------------------------------------------------ *
 * small local helpers
 * ------------------------------------------------------------------ */

function decodeUtf8(bytes: ArrayBuffer): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
  // Extremely defensive fallback for environments without TextDecoder.
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 1) out += String.fromCharCode(view[i] ?? 0);
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (out as Record<string, unknown>)[key] = entry;
  }
  return out;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
