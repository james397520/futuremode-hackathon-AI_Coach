/**
 * Tier 1 — ONNX Runtime Web on the **WebGPU execution provider**.
 *
 * Spec §51, §57, §58, §62.
 *
 * This is the acceleration tier and nothing more. Every failure mode §62 names is
 * turned into a typed `BackendFailure` carrying a fallback reason, so the
 * controller can step down to WASM and then to the server without the calling
 * feature ever seeing an exception:
 *
 *   | failure                      | reason                  | fatal |
 *   |------------------------------|-------------------------|-------|
 *   | `navigator.gpu` absent       | `webgpu_unavailable`    | yes   |
 *   | `requestDevice()` rejected   | `adapter_request_failed`| yes   |
 *   | `device.lost` fires          | `device_lost`           | yes   |
 *   | allocation / buffer limits   | `memory_exceeded`       | yes   |
 *   | kernel not implemented       | `unsupported_operator`  | yes   |
 *   | run exceeds the budget       | `timeout`               | no    |
 *
 * "Fatal" means the tier is abandoned for this session rather than retried in a
 * loop — see the cooldown in `fallback.ts`.
 *
 * Runs inside the inference worker only (§58). WebGPU is available in worker scope,
 * so nothing here touches `window`.
 */
import { errorText, hasNavigator } from '../capability';
import type { LocalTask } from '@ai-coach/shared';

import { OrtBackend, type OrtBackendOptions } from './ort-backend';
import { BackendFailure } from './types';
import type { OrtNamespace } from './ort-session';
import type { LocalBackendKind } from '../worker/protocol';

export interface WebgpuBackendOptions extends OrtBackendOptions {
  powerPreference?: GPUPowerPreference;
  /** Reject the tier when only a software adapter exists (SwiftShader etc.). */
  rejectSoftwareAdapter?: boolean;
}

export class WebgpuBackend extends OrtBackend {
  readonly kind: LocalBackendKind = 'webgpu';

  private device: GPUDevice | null = null;
  private deviceLost = false;
  private deviceLostMessage = '';
  private readonly webgpuOptions: WebgpuBackendOptions;

  constructor(options: WebgpuBackendOptions = {}) {
    super(options);
    this.webgpuOptions = options;
  }

  /**
   * `preferredOutputLocation` is deliberately left at ORT's default (CPU). Keeping
   * outputs on the GPU is faster, but every consumer here immediately reads the
   * values into plain arrays to post them back to the main thread, so a GPU-side
   * output would only add a manual download step.
   */
  protected executionProviders(): ReadonlyArray<
    string | { name: string; [key: string]: unknown }
  > {
    return [
      {
        name: 'webgpu',
        ...(this.webgpuOptions.powerPreference
          ? { powerPreference: this.webgpuOptions.powerPreference }
          : {}),
      },
      // ORT's own in-session fallback. Our controller-level fallback is the real
      // safety net, but letting ORT cover a single unsupported kernel avoids
      // throwing away the whole tier for one operator.
      'wasm',
    ];
  }

  protected sessionThreads(): number {
    // The GPU does the work; extra CPU threads only compete with the UI.
    return 1;
  }

  /**
   * Acquire a device *before* creating the first session, and subscribe to
   * `device.lost`. ORT would acquire one implicitly, but then we would have no
   * handle on which to observe loss — and device loss is the §62 failure that most
   * needs to be observed rather than inferred from a later error message.
   */
  protected override async prepare(ort: OrtNamespace): Promise<void> {
    if (this.device && !this.deviceLost) return;

    if (!hasNavigator()) {
      throw new BackendFailure({
        reason: 'webgpu_unavailable',
        backend: 'webgpu',
        fatal: true,
        message: 'No navigator in this scope, so WebGPU cannot be used.',
      });
    }
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') {
      throw new BackendFailure({
        reason: 'webgpu_unavailable',
        backend: 'webgpu',
        fatal: true,
        message: 'navigator.gpu is not exposed in this browser.',
      });
    }

    let adapter: GPUAdapter | null = null;
    try {
      adapter = await gpu.requestAdapter({
        powerPreference: this.webgpuOptions.powerPreference ?? 'high-performance',
      });
    } catch (error) {
      throw new BackendFailure({
        reason: 'adapter_request_failed',
        backend: 'webgpu',
        fatal: true,
        message: `Could not request a GPU adapter: ${errorText(error)}`,
        cause: error,
      });
    }
    if (!adapter) {
      throw new BackendFailure({
        reason: 'adapter_request_failed',
        backend: 'webgpu',
        fatal: true,
        message: 'No GPU adapter is available on this device.',
      });
    }

    if (
      this.webgpuOptions.rejectSoftwareAdapter !== false &&
      (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter === true
    ) {
      throw new BackendFailure({
        reason: 'webgpu_unavailable',
        backend: 'webgpu',
        fatal: true,
        message: 'Only a software GPU adapter is available; the CPU tier is faster.',
      });
    }

    let device: GPUDevice;
    try {
      // Ask for the largest buffer the adapter allows, clamped to 512 MiB — the
      // quantised models we ship are far smaller, and requesting the adapter's
      // theoretical maximum makes some drivers refuse outright.
      const limits = adapter.limits;
      const requested: Record<string, number> = {};
      const maxBuffer = typeof limits?.maxBufferSize === 'number' ? limits.maxBufferSize : 0;
      if (maxBuffer > 0) {
        requested['maxBufferSize'] = Math.min(maxBuffer, 512 * 1024 * 1024);
      }
      const maxBinding =
        typeof limits?.maxStorageBufferBindingSize === 'number'
          ? limits.maxStorageBufferBindingSize
          : 0;
      if (maxBinding > 0) {
        requested['maxStorageBufferBindingSize'] = Math.min(
          maxBinding,
          512 * 1024 * 1024,
        );
      }
      device = await adapter.requestDevice(
        Object.keys(requested).length > 0
          ? { requiredLimits: requested as unknown as Record<string, GPUSize64> }
          : {},
      );
    } catch (error) {
      throw new BackendFailure({
        reason: 'adapter_request_failed',
        backend: 'webgpu',
        fatal: true,
        message: `Could not create a GPU device: ${errorText(error)}`,
        cause: error,
      });
    }

    this.device = device;
    this.deviceLost = false;
    this.deviceLostMessage = '';

    // §62 "device lost". Once this resolves the tier is unusable; mark it so the
    // very next call fails fast with the right reason instead of hanging.
    try {
      void device.lost.then((info) => {
        this.deviceLost = true;
        this.deviceLostMessage = info?.message || 'The GPU device was lost.';
        // Drop every session; their GPU buffers are already gone.
        void this.release().catch(() => undefined);
      });
    } catch {
      /* `device.lost` is not implemented everywhere; the error path still works */
    }

    // Hand our device to ORT so it does not create a second one.
    try {
      if (ort.env.webgpu) {
        (ort.env.webgpu as { device?: unknown }).device = device;
        if (this.webgpuOptions.powerPreference) {
          (ort.env.webgpu as { powerPreference?: string }).powerPreference =
            this.webgpuOptions.powerPreference;
        }
      }
    } catch {
      // Older ORT builds do not accept an external device; it will make its own.
    }

    // Uncaptured validation / OOM errors surface here rather than as a rejected
    // promise, so translate them into the tier's health state.
    try {
      device.addEventListener?.('uncapturederror', (event: Event) => {
        const detail = (event as GPUUncapturedErrorEvent).error;
        const message = detail && 'message' in detail ? String(detail.message) : 'GPU error';
        if (/out of memory|allocation/i.test(message)) {
          this.deviceLost = true;
          this.deviceLostMessage = message;
        }
      });
    } catch {
      /* optional */
    }
  }

  /** Fail fast when the device is gone, with the reason §62 expects. */
  protected override assertHealthy(task?: LocalTask): void {
    if (this.deviceLost) {
      throw new BackendFailure({
        reason: 'device_lost',
        backend: 'webgpu',
        fatal: true,
        ...(task ? { task } : {}),
        message: this.deviceLostMessage || 'The GPU device was lost.',
      });
    }
  }

  get healthy(): boolean {
    return !this.deviceLost;
  }

  /** Also destroy the device, so the GPU is genuinely handed back (§60). */
  override async release(task?: LocalTask): Promise<void> {
    await super.release(task);
    if (task) return; // partial release keeps the device for the other tasks
    const device = this.device;
    this.device = null;
    if (!device) return;
    try {
      device.destroy?.();
    } catch {
      // Destroying an already-lost device throws; the resources are freed anyway.
    }
  }
}
