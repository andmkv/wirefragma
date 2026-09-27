/** Tiny monochrome icons so the Layers panel matches the editor's greyscale style. */

interface IconProps {
  className?: string;
}

export function EyeIcon({ off, className }: IconProps & { off?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <path
        d="M1 6s1.9-3.1 5-3.1S11 6 11 6 9.1 9.1 6 9.1 1 6 1 6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity={off ? 0.35 : 1} />
      {off ? <path d="M2 10.2 10 1.8" fill="none" stroke="currentColor" strokeWidth="1.1" /> : null}
    </svg>
  );
}

export function LockIcon({ locked, className }: IconProps & { locked: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <rect x="2.7" y="5.4" width="6.6" height="4.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      {locked ? (
        <path d="M4.3 5.4V4.1a1.7 1.7 0 0 1 3.4 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
      ) : (
        <path d="M4.3 5.4V4.1a1.7 1.7 0 0 1 3.4 0" fill="none" stroke="currentColor" strokeWidth="1.1" />
      )}
    </svg>
  );
}

export function CaretIcon({ open, className }: IconProps & { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" className={className} aria-hidden="true">
      <path
        d={open ? "M2.5 4.2 6 7.8l3.5-3.6" : "M4.2 2.5 7.8 6l-3.6 3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <path
        d="M2.5 3.4h7M4.6 3.4V2.6a.8.8 0 0 1 .8-.8h1.2a.8.8 0 0 1 .8.8v.8M3.6 3.4l.5 6a.8.8 0 0 0 .8.7h2.2a.8.8 0 0 0 .8-.7l.5-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DuplicateIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <rect x="1.6" y="1.6" width="6.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M4.4 10.4h4.6a1.4 1.4 0 0 0 1.4-1.4V4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <circle cx="2.4" cy="6" r="1.05" fill="currentColor" />
      <circle cx="6" cy="6" r="1.05" fill="currentColor" />
      <circle cx="9.6" cy="6" r="1.05" fill="currentColor" />
    </svg>
  );
}
