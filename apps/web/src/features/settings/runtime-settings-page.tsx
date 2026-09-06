'use client';

import { Cpu, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile, Switch } from '@/components/ui';
import { RuntimeBadge, useComputeCapability } from '@/components/runtime';
import { useCan } from '@/lib/auth-context';
import {
  MEMORY_CLASS_LABEL, RUNTIME_BACKEND_LABEL, RUNTIME_STATE_LABEL, WORKER_STATUS_LABEL,
} from '@/lib/enum-labels';
import { SettingsShell } from './settings-shell';

/**
 * §93 Runtime Status UI (admin view) + §97 privacy controls + §61 cache policy.
 *
 * A learner only ever sees the outward label in the rail. This page is the one
 * place backend, model, load time, inference milliseconds, worker status and the
 * fallback reason are exposed — and it is gated on `runtime.view_telemetry`.
 */
export function RuntimeSettingsPage() {
  const canView = useCan('runtime.view_telemetry');
  const {
    capability,
    capabilityDetail,
    state,
    telemetry,
    telemetryDetail,
    backend,
    chain,
    label,
    policy,
    workerStatus,
    fallbackReason,
    consent,
    setConsent,
    refresh,
  } = useComputeCapability();

  if (!canView) {
    return (
      <SettingsShell
        title="AI 執行環境"
        description="這台裝置的本機推論加速。"
      >
        <GlassCard className="p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} strokeWidth={1.8} aria-hidden className="mt-0.5 text-accent-mint" />
            <div>
              <h2 className="text-card-title">{label}</h2>
              <p className="mt-1 max-w-xl text-body-sm text-text-secondary">
                部分支援的 AI 工作可以在這台裝置上本機執行，藉此降低延遲。最終結果一律以伺服器為準，
                因此你的分數與逐字稿都不會因此改變。詳細的執行環境診斷資訊僅開放給工作區管理者檢視。
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant={consent === 'granted' ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => setConsent(consent === 'granted' ? 'declined' : 'granted')}
                >
                  {consent === 'granted' ? '關閉本機加速' : '啟用本機加速'}
                </Button>
                <RuntimeBadge />
              </div>
            </div>
          </div>
        </GlassCard>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="AI 執行環境"
      description="WebGPU → WASM → 伺服器。WebGPU 只是加速層；就算沒有它，每一項功能也都必須能正常運作。"
      meta={
        <>
          <RuntimeBadge />
          <Pill tone="neutral" size="sm">狀態：{RUNTIME_STATE_LABEL[state] ?? state}</Pill>
          <Pill tone="neutral" size="sm">降級順序：{chain.map((b) => RUNTIME_BACKEND_LABEL[b] ?? b).join(' → ')}</Pill>
        </>
      }
      actions={
        <Button variant="secondary" size="sm" onClick={refresh}>
          <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
          重新偵測
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="後端" value={RUNTIME_BACKEND_LABEL[backend] ?? backend} hint="為這台裝置選定的後端" />
        <StatTile surface="card" label="Worker" value={WORKER_STATUS_LABEL[workerStatus] ?? workerStatus} hint="專用推論 Worker" />
        <StatTile surface="card" label="模型載入" value={telemetry.load_ms !== undefined ? `${telemetry.load_ms} ms` : '—'} hint="冷啟動" />
        <StatTile
          surface="card"
          label="最近一次推論"
          value={telemetry.last_inference_ms !== undefined ? `${telemetry.last_inference_ms} ms` : '—'}
          hint={
            telemetryDetail?.avg_inference_ms !== undefined
              ? `本次工作階段平均 ${Math.round(telemetryDetail.avg_inference_ms)} ms`
              : '最近一次本機工作'
          }
        />
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <Cpu size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
          <h2 className="text-card-title">偵測到的裝置能力</h2>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['WebGPU 介面卡', capability?.webgpu ? '可用' : '無法使用'],
              ['WASM SIMD', capability?.wasmSimd ? '可用' : '無法使用'],
              ['Web Worker', capability?.worker ? '可用' : '無法使用'],
              ['記憶體等級', capability ? (MEMORY_CLASS_LABEL[capability.memoryClass] ?? capability.memoryClass) : '—'],
              ['GPU 廠商', capability?.adapterInfo?.vendor ?? '未提供'],
              ['GPU 架構', capability?.adapterInfo?.architecture ?? '未提供'],
              ['選定的後端', capability ? (RUNTIME_BACKEND_LABEL[capability.selectedBackend] ?? capability.selectedBackend) : '—'],
              ['模型', telemetry.model_id ?? '未載入'],
              ['CPU 核心數', capabilityDetail ? String(capabilityDetail.cores) : '—'],
              [
                '裝置記憶體',
                capabilityDetail?.deviceMemoryGb !== undefined
                  ? `${capabilityDetail.deviceMemoryGb} GB`
                  : '未提供',
              ],
              [
                '跨來源隔離',
                capabilityDetail ? (capabilityDetail.crossOriginIsolated ? '是' : '否') : '—',
              ],
              ['WASM 執行緒', capabilityDetail ? String(capabilityDetail.wasmThreads) : '—'],
              [
                '軟體轉譯介面卡',
                capabilityDetail ? (capabilityDetail.softwareAdapter ? '是' : '否') : '—',
              ],
              ['本次工作階段降級次數', telemetryDetail ? String(telemetryDetail.fallback_count) : '—'],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex items-center justify-between gap-3 text-body-sm">
              <dt className="text-text-tertiary">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {fallbackReason ? (
          <p className="mt-4 rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm">
            <span className="meta-label mr-2 text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">降級原因</span>
            <span className="text-text-secondary">{fallbackReason}</span>
          </p>
        ) : null}

        {capabilityDetail?.webgpuUnavailableReason ? (
          <p className="mt-3 text-tiny text-text-tertiary">
            未選用 WebGPU：{capabilityDetail.webgpuUnavailableReason}
          </p>
        ) : null}

        {capabilityDetail?.detectedAt ? (
          <p className="mt-2 text-tiny text-text-tertiary">
            偵測時間 {capabilityDetail.detectedAt}
          </p>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">本機執行的工作</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          在裝置條件允許時，這些工作可能會在前端執行。伺服器的結果一律具有最終效力——
          本機算出的答案只是延遲最佳化，絕不是事實依據。
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ['向量嵌入', '為檢索預覽產生查詢向量'],
            ['意圖分類', '隨該回合一併送出的快速意圖提示'],
            ['重排序', '在本機重新排序檢索到的片段'],
            ['安全性預檢', '送出該回合前先在前端過濾'],
          ].map(([task, detail]) => (
            <li key={task} className="flex items-start justify-between gap-3 rounded-card-sm border border-border-soft bg-glass-card p-4">
              <div className="min-w-0">
                <p className="text-body-sm font-medium">{task}</p>
                <p className="mt-0.5 text-tiny text-text-tertiary">{detail}</p>
              </div>
              <Pill tone={backend === 'server' ? 'neutral' : 'success'} size="sm">
                {RUNTIME_BACKEND_LABEL[backend] ?? backend}
              </Pill>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">政策與隱私</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          管理者可以為整個工作區強制開啟或關閉本機加速。敏感資料預設不會快取在瀏覽器中，
          而且所有本機快取都會在登出時清除。
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="meta-label mb-2">WebGPU 政策</p>
            <Select
              value={policy.webgpu}
              onValueChange={() => undefined}
              ariaLabel="WebGPU 政策"
              options={[
                { value: 'auto', label: '自動——在支援的裝置上啟用' },
                { value: 'on', label: '開啟——強制使用' },
                { value: 'off', label: '關閉——僅使用伺服器' },
              ]}
            />
            <p className="mt-1.5 text-tiny text-text-tertiary">
              由本次部署的 <code>NEXT_PUBLIC_ENABLE_WEBGPU</code> 決定。
            </p>
          </div>

          <div className="space-y-3">
            <Switch checked={policy.allow_local_model_cache} onCheckedChange={() => undefined} label="在本機快取模型檔案" />
            <Switch checked={policy.allow_sensitive_data_cache} onCheckedChange={() => undefined} label="在本機快取敏感資料" />
            <Switch checked={policy.clear_on_logout} onCheckedChange={() => undefined} label="登出時清除所有本機快取" />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Pill tone={consent === 'granted' ? 'success' : consent === 'declined' ? 'neutral' : 'warning'} size="sm">
            這台裝置：{consent === 'unknown' ? '尚未詢問' : consent === 'granted' ? '已啟用' : '已拒絕'}
          </Pill>
          <Button variant="ghost" size="sm" onClick={() => setConsent(consent === 'granted' ? 'declined' : 'granted')}>
            {consent === 'granted' ? '在這台裝置關閉' : '在這台裝置開啟'}
          </Button>
        </div>
      </GlassCard>
    </SettingsShell>
  );
}
