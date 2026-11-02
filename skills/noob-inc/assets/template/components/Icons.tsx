import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ viewBox: "0 0 24 24", strokeWidth: 2.25, ...p })}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
  </svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
  </svg>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.8 8.4l3.2 3.2 7.2-7.4" />
  </svg>
);
export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 8l11-5.5-3 11-2.6-4.2L2.5 8z" />
    <path d="M7.9 9.3l5.6-6.8" />
  </svg>
);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
  </svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
);
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </svg>
);
export const IconGitHub = (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
    <path d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.7.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2z" />
  </svg>
);
export const IconTerminal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 4.5l3.5 3.5L3 11.5M8 12h5" />
  </svg>
);
export const IconKey = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="10.5" r="2.8" />
    <path d="M7.5 8.5l6-6M11 4l2 2M9.5 5.5l1.5 1.5" />
  </svg>
);
export const IconBubble = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);
export const IconTool = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9.5 2.5a3 3 0 0 0-3.6 3.9L2.5 9.8l1.7 1.7 3.4-3.4a3 3 0 0 0 3.9-3.6l-1.8 1.8-1.5-.4-.4-1.5 1.7-1.9z" />
  </svg>
);
export const IconPrompt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 3.5h10M3 8h7M3 12.5h5" />
  </svg>
);
export const IconSpawn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="4" r="1.6" />
    <path d="M5.5 4.8L10.6 11M5.5 4h5" />
  </svg>
);
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 14V2.5h8.5l-2 3 2 3H3.5" />
  </svg>
);
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 10V2M5 4.8L8 1.8l3 3" />
    <path d="M5.5 7H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1.5" />
  </svg>
);
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </svg>
);
