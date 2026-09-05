/**
 * Inline icon set. Local on purpose: this feature must not assume an icon
 * package is a dependency of `apps/web` (that manifest belongs to another
 * owner). Every glyph is `currentColor` + 1.6px stroke so it inherits tone.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </Svg>
);

export const MicOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 9v2a3 3 0 0 0 4.5 2.6" />
    <path d="M15 10.5V7a3 3 0 0 0-5.4-1.8" />
    <path d="M5.5 11a6.5 6.5 0 0 0 9.9 5.6" />
    <path d="M18.5 11c0 .7-.1 1.4-.3 2" />
    <path d="M12 17.5V21" />
    <path d="M4 3l16 18" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a1 1 0 0 0 .8-.4l.9-1.2a1 1 0 0 1 .8-.4h5.6a1 1 0 0 1 .8.4l.9 1.2a1 1 0 0 0 .8.4h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </Svg>
);

export const CameraOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6" />
    <path d="M9.9 6l.7-1a1 1 0 0 1 .8-.4h2.8a1 1 0 0 1 .8.4l.9 1.2a1 1 0 0 0 .8.4h1.2A2.5 2.5 0 0 1 21 8.5v7" />
    <path d="M3 11.5v5A2.5 2.5 0 0 0 5.5 19h11" />
    <path d="M14.8 14.9a3.2 3.2 0 0 1-4.4-4.4" />
    <path d="M4 3l16 18" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12 20 4.5 15 20l-4-6-6.5-2Z" />
    <path d="M11 14l9-9.5" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5v14M14.5 5v14" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5 19 12 8 18.5V5.5Z" />
  </Svg>
);

export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
  </Svg>
);

export const RestartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4.5V10h5.5" />
  </Svg>
);

export const LightbulbIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 17.5h5" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.8V15h7v-1.2A6 6 0 0 0 12 3Z" />
  </Svg>
);

export const SparkleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l1.6 4.4L18 9.5l-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6L12 3.5Z" />
    <path d="M18 15.5l.8 2.1 2.2.8-2.2.8-.8 2.1-.8-2.1-2.2-.8 2.2-.8.8-2.1Z" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5h6.5A2.5 2.5 0 0 1 14 7v12a2 2 0 0 0-2-2H5V4.5Z" />
    <path d="M19 4.5h-4.5A2.5 2.5 0 0 0 12 7v12a2 2 0 0 1 2-2h5V4.5Z" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4" />
    <path d="M12 16.8h.01" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 19 6v6c0 4-3 7-7 8.5C8 19 5 16 5 12V6l7-2.5Z" />
    <path d="M9.2 12.2l2 2 3.6-3.9" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 6.5 15 12l-5.5 5.5" />
  </Svg>
);

export const CaptionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
    <path d="M10 10.5a2.5 2.5 0 1 0 0 3" />
    <path d="M16.5 10.5a2.5 2.5 0 1 0 0 3" />
  </Svg>
);

export const SpeakerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3v-5Z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    <path d="M18 7.5a6.5 6.5 0 0 1 0 9" />
  </Svg>
);

export const SpeakerOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3v-5Z" />
    <path d="M16 10l4 4M20 10l-4 4" />
  </Svg>
);

export const HeadphonesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
    <rect x="3" y="13.5" width="3.5" height="6" rx="1.6" />
    <rect x="17.5" y="13.5" width="3.5" height="6" rx="1.6" />
  </Svg>
);

export const TranscriptIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="3" />
    <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
  </Svg>
);

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5V21" />
    <path d="M6 4.5h9.5l-1.5 3.5 1.5 3.5H6" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 12.5 10 17l8.5-10" />
  </Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M6.5 13.5 12 19l5.5-5.5" />
  </Svg>
);

export const PhoneOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4.5c3.5 8 8 12.5 15.5 15.5" />
    <path d="M9 5.5 7 3.5 4 5c.2 1.6.7 3.1 1.4 4.5L8 8" />
    <path d="M18.5 15l-2.5 1.5 1.4 2.6c1.4-.5 2.6-1.2 3.6-2.1l-2.5-2Z" />
    <path d="M4 20 20 4" />
  </Svg>
);

export const TargetIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 4.5V2M12 22v-2.5M4.5 12H2M22 12h-2.5" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.3l3 1.7" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10" />
    <path d="M7.5 10 12 14.5 16.5 10" />
    <path d="M5 18.5h14" />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="17.5" cy="6" r="2.5" />
    <circle cx="6.5" cy="12" r="2.5" />
    <circle cx="17.5" cy="18" r="2.5" />
    <path d="M8.8 10.8 15.2 7.2M8.8 13.2l6.4 3.6" />
  </Svg>
);

export const ReportIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="3" />
    <path d="M8.5 15.5v-3M12 15.5v-6M15.5 15.5v-4" />
  </Svg>
);

export const CompareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16" />
    <path d="M8 8.5 4 13h8L8 8.5Z" />
    <path d="M16 8.5 12 13h8l-4-4.5Z" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
  </Svg>
);

export const RadioIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8" />
    <path d="M5.2 5.2a9.5 9.5 0 0 0 0 13.6M18.8 5.2a9.5 9.5 0 0 1 0 13.6" />
  </Svg>
);

export const WaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h1.5M8 8v8M12 5.5v13M16 9v6M20 11.5h-1.5" />
  </Svg>
);
