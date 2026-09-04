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
    label: 'Models',
    href: '/settings/models',
    description: 'LLM, embedding, reranker, speech and safety providers.',
    icon: Sliders,
    permission: 'model.manage',
    adminOnly: true,
  },
  {
    id: 'runtime',
    label: 'AI Runtime',
    href: '/settings/runtime',
    description: 'WebGPU / WASM / server backend, worker status and fallback reason.',
    icon: Cpu,
    permission: 'runtime.view_telemetry',
    adminOnly: true,
  },
  {
    id: 'voice',
    label: 'Voice',
    href: '/settings/voice',
    description: 'Provider, voice, speed, stability, barge-in and captions.',
    icon: Volume2,
    permission: 'settings.view',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    href: '/settings/appearance',
    description: 'Light, dark or follow the system, plus motion preferences.',
    icon: Palette,
    permission: 'settings.view',
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/settings/profile',
    description: 'Your details, language, notifications and local data.',
    icon: UserCog,
    permission: 'settings.view',
  },
  {
    id: 'billing',
    label: 'Billing & usage',
    href: '/settings/billing',
    description: 'Seats, simulation and voice minutes, storage and invoices.',
    icon: BadgeDollarSign,
    permission: 'billing.manage',
    adminOnly: true,
  },
];

export const SETTINGS_ROOT: SettingsSection = {
  id: 'overview',
  label: 'Overview',
  href: '/settings',
  description: 'All workspace and personal settings.',
  icon: Settings,
  permission: 'settings.view',
};
