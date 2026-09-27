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

export function FolderIcon({ open, className }: IconProps & { open?: boolean }) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={className} aria-hidden="true">
      <path
        d={
          open
            ? "M1.5 4V3.2c0-.5.4-.9.9-.9h3l1.2 1.3h4.6c.5 0 .9.4.9.9V5M1.4 5.2h11.3l-1.3 6H2.6z"
            : "M1.5 11.3V3.2c0-.5.4-.9.9-.9h3l1.2 1.3h4.6c.5 0 .9.4.9.9v6.8c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9Z"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScreenIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" className={className} aria-hidden="true">
      <rect x="1.8" y="2.3" width="10.4" height="9.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1.8 4.8h10.4M4.3 7h3.2M4.3 8.9h5.2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={className} aria-hidden="true">
      <path d="M6 2v8M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function SidebarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={className} aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.2 2v10" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function ImportIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={className} aria-hidden="true">
      <path
        d="M7 1.8v7M4.2 6.2 7 9l2.8-2.8M2 9.6v1.4c0 .6.5 1.1 1.1 1.1h7.8c.6 0 1.1-.5 1.1-1.1V9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
