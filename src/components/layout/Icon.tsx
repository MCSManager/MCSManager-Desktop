import type { ReactNode } from "react";

export type IconName =
  | "play"
  | "stop"
  | "restart"
  | "settings"
  | "globe"
  | "external"
  | "copy"
  | "trash"
  | "logo"
  | "alert"
  | "terminal";

function shapeFor(name: IconName): ReactNode {
  switch (name) {
    case "play":
      return <path d="M5 3.2v9.6L12.5 8z" fill="currentColor" />;
    case "stop":
      return <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" />;
    case "restart":
      return (
        <>
          <polyline
            points="15.1 3 15.1 6.5 11.6 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.5 9.8A5.6 5.6 0 1 1 12.2 3.9L15.1 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1.7v2M8 12.3v2M14.3 8h-2M3.7 8h-2M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M12.5 12.5l-1.4-1.4M4.9 4.9L3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M2.2 8h11.6M8 2.2c1.8 2 1.8 9.6 0 11.6M8 2.2c-1.8 2-1.8 9.6 0 11.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case "external":
      return (
        <>
          <path
            d="M11.7 8.7v4a1.3 1.3 0 0 1-1.3 1.3H3.3A1.3 1.3 0 0 1 2 12.7V5.3A1.3 1.3 0 0 1 3.3 4H7.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="9.8 2.2 14.2 2.2 14.2 6.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="6.6"
            y1="9.4"
            x2="14.1"
            y2="2.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case "copy":
      return (
        <>
          <rect
            x="5.6"
            y="5.6"
            width="8"
            height="8"
            rx="1.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M3 10.4V3.9c0-.6.5-1.1 1.1-1.1H10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
    case "trash":
      return (
        <>
          <path
            d="M2.5 4.3h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M6.2 4.3V3.2c0-.5.4-.9.9-.9h1.8c.5 0 .9.4.9.9v1.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4.1 4.3l.6 8.3c.05.5.5.9 1 .9h4.6c.5 0 .95-.4 1-.9l.6-8.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "logo":
      return (
        <path
          d="M3.8 11.8V4.2l4.2 4.7 4.2-4.7v7.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "alert":
      return (
        <>
          <path
            d="M8 2.6 14.4 13.2H1.6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 6.3v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="11.2" r="0.85" fill="currentColor" />
        </>
      );
    case "terminal":
      return (
        <>
          <rect
            x="1.8"
            y="2.8"
            width="12.4"
            height="10.4"
            rx="1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <polyline
            points="4.6,6.1 6.8,8 4.6,9.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="8.3"
            y1="10"
            x2="11.3"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      );
  }
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {shapeFor(name)}
    </svg>
  );
}
