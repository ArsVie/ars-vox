/**
 * Inline SVG icon set — stroke-based, currentColor, no dependencies.
 * Keep icons small (16px default) so they sit inside buttons/labels.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

/** Microphone icon (tap-to-talk). */
export function MicIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

/** Send (paper plane) icon. */
export function SendIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

/** Stop square icon. */
export function StopIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Chat bubble icon. */
export function ChatIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Document/file icon. */
export function DocumentIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

/** Shield/alert icon for confirmations. */
export function ShieldIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Warning triangle icon. */
export function WarningIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m10.3 3.9-8.2 14a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** X (dismiss) icon. */
export function XIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Sparkle icon for the brand/empty states. */
export function SparkleIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="m5.6 5.6 2.1 2.1" />
      <path d="m16.3 16.3 2.1 2.1" />
      <path d="m18.4 5.6-2.1 2.1" />
      <path d="m7.7 16.3-2.1 2.1" />
    </svg>
  );
}

/** Maximize (expand panel) icon. */
export function MaximizeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

/** Restore (exit fullscreen) icon. */
export function RestoreIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 3v6H3" />
      <path d="M15 3v6h6" />
      <path d="M9 21v-6H3" />
      <path d="M15 21v-6h6" />
    </svg>
  );
}

/** Audio waveform bars (recording/listening feedback). */
export function WaveformIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 12v3" />
      <path d="M8 8v8" />
      <path d="M12 4v16" />
      <path d="M16 8v8" />
      <path d="M20 12v3" />
    </svg>
  );
}

/** Globe (browser panel). */
export function GlobeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" />
    </svg>
  );
}

/** Open book (book reader panel). */
export function BookIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v14c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-14c-4.5 0-6.5.5-8 2z" />
      <path d="M12 6.5v14" />
    </svg>
  );
}

/** Check inside a clipboard (tasks panel). */
export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9 3.5V6h6V3.5" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}

/** Pen (notes panel). */
export function PenIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

/** Bell (reminders panel). */
export function BellIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** Gear (settings panel). */
export function GearIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function PlayIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ReloadIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function YoutubeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
