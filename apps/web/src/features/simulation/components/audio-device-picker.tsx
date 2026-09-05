'use client';

/**
 * Audio device picker — spec §24 (`Change Audio Device`) and §50 (mic selection
 * + permission). A blocking problem (no microphone permission) is the one case
 * §94 says deserves a modal, so this is a modal — and it explains the state
 * rather than just failing.
 */
import type { AudioDeviceOption, MicPermission } from '../lib/types';
import { insetSurface, toneText } from '../lib/tone';
import { CheckIcon, HeadphonesIcon, MicIcon, RestartIcon } from './icons';
import { cn, Modal } from './kit';

export interface AudioDevicePickerProps {
  open: boolean;
  onClose: () => void;
  devices: AudioDeviceOption[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  permission: MicPermission;
  micLive: boolean;
  onSelectInput: (deviceId: string) => void;
  onSelectOutput: (deviceId: string) => void;
  onRefresh: () => void;
  onRequestPermission: () => void;
}

const PERMISSION_COPY: Record<MicPermission, { tone: 'mint' | 'warning' | 'danger' | 'neutral'; text: string }> = {
  unknown: { tone: 'neutral', text: 'Microphone access has not been checked yet.' },
  prompt: { tone: 'warning', text: 'Your browser will ask for microphone access when the session starts.' },
  granted: { tone: 'mint', text: 'Microphone access granted.' },
  denied: {
    tone: 'danger',
    text: 'Microphone permission is blocked. Allow it in your browser’s site settings, then reload — you can keep training with the text composer in the meantime.',
  },
  unsupported: {
    tone: 'danger',
    text: 'This browser cannot capture audio. The text composer works normally.',
  },
};

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: AudioDeviceOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="sim-focusable flex w-full items-center gap-2.5 rounded-card-sm border px-3 py-2.5 text-left text-body-sm"
      style={insetSurface(selected ? 'blue' : 'neutral', selected ? 14 : 7)}
    >
      <span style={{ color: toneText(selected ? 'blue' : 'neutral') }}>
        {device.kind === 'audioinput' ? <MicIcon size={14} /> : <HeadphonesIcon size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-primary">{device.label}</span>
      {selected ? <CheckIcon size={14} style={{ color: toneText('blue') }} /> : null}
    </button>
  );
}

export function AudioDevicePicker({
  open,
  onClose,
  devices,
  inputDeviceId,
  outputDeviceId,
  permission,
  micLive,
  onSelectInput,
  onSelectOutput,
  onRefresh,
  onRequestPermission,
}: AudioDevicePickerProps) {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const copy = PERMISSION_COPY[permission];

  return (
    <Modal open={open} onClose={onClose} title="Audio device">
      <div className="grid gap-4">
        <div
          className="rounded-card-sm border p-3 text-body-sm"
          style={insetSurface(copy.tone, 9)}
        >
          <span style={{ color: toneText(copy.tone) }}>{copy.text}</span>
          {permission !== 'granted' && permission !== 'unsupported' ? (
            <button
              type="button"
              onClick={onRequestPermission}
              className="sim-focusable mt-2 block rounded-pill px-3 py-1.5 text-meta"
              style={insetSurface('blue', 14)}
            >
              <span style={{ color: toneText('blue') }}>Allow microphone</span>
            </button>
          ) : null}
        </div>

        <section>
          <div className="flex items-center justify-between">
            <h4 className="text-card-title text-text-primary">Microphone</h4>
            <button
              type="button"
              onClick={onRefresh}
              className="sim-focusable flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny text-text-secondary"
              style={insetSurface('neutral', 8)}
            >
              <RestartIcon size={12} />
              Refresh
            </button>
          </div>
          <div className="mt-2 grid gap-2">
            {inputs.length === 0 ? (
              <p className="text-body-sm text-text-tertiary">
                No microphones listed. Device names appear once permission is granted.
              </p>
            ) : (
              inputs.map((device) => (
                <DeviceRow
                  key={`in-${device.deviceId || device.label}`}
                  device={device}
                  selected={device.deviceId === inputDeviceId}
                  onSelect={() => onSelectInput(device.deviceId)}
                />
              ))
            )}
          </div>
          {micLive ? (
            <p className="mt-2 text-tiny text-text-tertiary">
              Switching microphone restarts the capture chain — you will not lose the session.
            </p>
          ) : null}
        </section>

        <section>
          <h4 className="text-card-title text-text-primary">Speaker</h4>
          <div className="mt-2 grid gap-2">
            {outputs.length === 0 ? (
              <p className="text-body-sm text-text-tertiary">
                This browser does not expose output devices — your system default is used.
              </p>
            ) : (
              outputs.map((device) => (
                <DeviceRow
                  key={`out-${device.deviceId || device.label}`}
                  device={device}
                  selected={device.deviceId === outputDeviceId}
                  onSelect={() => onSelectOutput(device.deviceId)}
                />
              ))
            )}
          </div>
        </section>

        <div className={cn('flex justify-end')}>
          <button
            type="button"
            onClick={onClose}
            className="sim-focusable rounded-input px-4 py-2 text-body"
            style={insetSurface('neutral', 10)}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
