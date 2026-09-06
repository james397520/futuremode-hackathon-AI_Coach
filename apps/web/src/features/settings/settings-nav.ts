import {
  BadgeDollarSign,
  Cpu,
  Palette,
  Settings,
  Sliders,
  UserCog,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@/lib/rbac';

export interface SettingsSection {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
  /** §93 — engineering detail is admin-only. */
  adminOnly?: boolean;
}

/** §44 model settings, §93 runtime, §22.4 voice, §58-37/38/39 theme / user / billing. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'models',
    label: '模型',
    href: '/settings/models',
    description: 'LLM、向量嵌入、重排序、語音與安全性的服務供應商。',
    icon: Sliders,
    permission: 'model.manage',
    adminOnly: true,
  },
  {
    id: 'runtime',
    label: 'AI 執行環境',
    href: '/settings/runtime',
    description: 'WebGPU / WASM / 伺服器後端、Worker 狀態與降級原因。',
    icon: Cpu,
    permission: 'runtime.view_telemetry',
    adminOnly: true,
  },
  {
    id: 'voice',
    label: '語音',
    href: '/settings/voice',
    description: '服務供應商、音色、語速、穩定度、插話與字幕。',
    icon: Volume2,
    permission: 'settings.view',
  },
  {
    id: 'appearance',
    label: '外觀',
    href: '/settings/appearance',
    description: '淺色、深色或跟隨系統，以及動態效果偏好。',
    icon: Palette,
    permission: 'settings.view',
  },
  {
    id: 'profile',
    label: '個人資料',
    href: '/settings/profile',
    description: '你的個人資訊、語言、通知與本機資料。',
    icon: UserCog,
    permission: 'settings.view',
  },
  {
    id: 'billing',
    label: '帳單與用量',
    href: '/settings/billing',
    description: '席次、模擬與語音分鐘數、儲存空間與發票。',
    icon: BadgeDollarSign,
    permission: 'billing.manage',
    adminOnly: true,
  },
];

export const SETTINGS_ROOT: SettingsSection = {
  id: 'overview',
  label: '總覽',
  href: '/settings',
  description: '所有工作區與個人設定。',
  icon: Settings,
  permission: 'settings.view',
};
