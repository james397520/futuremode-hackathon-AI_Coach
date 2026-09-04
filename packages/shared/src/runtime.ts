/**
 * 客戶端推論能力 — spec §59 / §62 / §44 Client Runtime.
 * WebGPU 只是 acceleration layer，核心功能不得因不支援而停擺（§51）。
 */
export type ComputeBackend = 'webgpu' | 'wasm' | 'server';

export interface ComputeCapability {
  webgpu: boolean;
  wasmSimd: boolean;
  worker: boolean;
  memoryClass: 'low' | 'medium' | 'high';
  selectedBackend: ComputeBackend;
  adapterInfo?: { vendor?: string; architecture?: string };
}

/** 可在本地跑的任務（§52–§55）；server 永遠是 authoritative（§55 註記） */
export type LocalTask = 'embedding' | 'intent_classification' | 'reranking' | 'safety_precheck';

export interface LocalModelManifest {
  task: LocalTask;
  model_id: string;
  /** 模型檔（ONNX / transformers.js 相容） */
  files: Array<{ url: string; bytes: number; sha256?: string }>;
  quantization?: string;
  dimension?: number;
}

export interface RuntimeTelemetry {
  backend: ComputeBackend;
  model_id?: string;
  load_ms?: number;
  last_inference_ms?: number;
  worker_alive: boolean;
  fallback_reason?: string;
}

/** 企業安全模式（§61） */
export interface RuntimePolicy {
  webgpu: 'auto' | 'on' | 'off';
  allow_local_model_cache: boolean;
  allow_sensitive_data_cache: boolean;
  clear_on_logout: boolean;
}
