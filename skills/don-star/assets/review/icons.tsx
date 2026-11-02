// Tiny inline icon set (feather-style strokes) so the harness has zero icon
// dependencies. Add here rather than importing an icon library.

import type { SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height">;

function icon(children: React.ReactNode) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const CaretLeft = icon(<polyline points="14.5 5.5 8 12 14.5 18.5" />);
export const CaretRight = icon(<polyline points="9.5 5.5 16 12 9.5 18.5" />);
export const CaretDown = icon(<polyline points="5.5 9.5 12 16 18.5 9.5" />);
export const Plus = icon(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
export const Minus = icon(<line x1="5" y1="12" x2="19" y2="12" />);
export const Cross = icon(<><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>);
export const Check = icon(<polyline points="4.5 12.5 9.5 17.5 19.5 7" />);
export const ArrowUp = icon(<><line x1="12" y1="19" x2="12" y2="6" /><polyline points="6 11.5 12 5.5 18 11.5" /></>);
export const Undo = icon(<><polyline points="8.5 3.5 3.5 8.5 8.5 13.5" /><path d="M3.5 8.5H14a6 6 0 0 1 0 12h-3" /></>);
export const Chat = icon(<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.8-.8L3 20l1.1-4.1a8 8 0 0 1-1.1-4.4A8.4 8.4 0 0 1 11.5 3.2 8.4 8.4 0 0 1 21 11.5z" />);
export const Eye = icon(<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeSlash = icon(<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><line x1="4" y1="20" x2="20" y2="4" /></>);
export const Fit = icon(<><polyline points="9 3.5 3.5 3.5 3.5 9" /><polyline points="15 3.5 20.5 3.5 20.5 9" /><polyline points="9 20.5 3.5 20.5 3.5 15" /><polyline points="15 20.5 20.5 20.5 20.5 15" /></>);
export const Grid = icon(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>);
export const List = icon(<><line x1="9" y1="5.5" x2="20.5" y2="5.5" /><line x1="9" y1="12" x2="20.5" y2="12" /><line x1="9" y1="18.5" x2="20.5" y2="18.5" /><line x1="3.75" y1="5.5" x2="3.85" y2="5.5" /><line x1="3.75" y1="12" x2="3.85" y2="12" /><line x1="3.75" y1="18.5" x2="3.85" y2="18.5" /></>);
export const Phone = icon(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><line x1="10.5" y1="18" x2="13.5" y2="18" /></>);
export const Desktop = icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><circle cx="6" cy="7.25" r="0.4" /><circle cx="8.5" cy="7.25" r="0.4" /></>);
export const Download = icon(<><line x1="12" y1="4" x2="12" y2="15" /><polyline points="6.5 9.5 12 15 17.5 9.5" /><line x1="4" y1="20" x2="20" y2="20" /></>);
export const Upload = icon(<><line x1="12" y1="15" x2="12" y2="4" /><polyline points="6.5 9.5 12 4 17.5 9.5" /><line x1="4" y1="20" x2="20" y2="20" /></>);
export const Link = icon(<><path d="M15 7h2.5a5 5 0 0 1 0 10H15" /><path d="M9 17H6.5a5 5 0 0 1 0-10H9" /><line x1="8" y1="12" x2="16" y2="12" /></>);
export const Dots = icon(<><circle cx="5" cy="12" r="0.9" /><circle cx="12" cy="12" r="0.9" /><circle cx="19" cy="12" r="0.9" /></>);
export const PanelLeft = icon(<><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><line x1="9.5" y1="4.5" x2="9.5" y2="19.5" /></>);
export const Cursor = icon(<path d="M5.5 3.5 19 10.2l-6.2 1.9-2.5 6.9L5.5 3.5z" />);
export const Filter = icon(<path d="M4 5.5h16l-6 7v5.5l-4-2v-3.5l-6-7z" />);
export const Sun = icon(<><circle cx="12" cy="12" r="4.25" /><line x1="12" y1="2.75" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21.25" /><line x1="2.75" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21.25" y2="12" /><line x1="5.45" y1="5.45" x2="7.05" y2="7.05" /><line x1="16.95" y1="16.95" x2="18.55" y2="18.55" /><line x1="5.45" y1="18.55" x2="7.05" y2="16.95" /><line x1="16.95" y1="7.05" x2="18.55" y2="5.45" /></>);
export const Moon = icon(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />);
export const Bell = icon(<><path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5z" /><path d="M10 19.5a2 2 0 0 0 4 0" /></>);
export const Trash = icon(<><path d="M5 7h14" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /><line x1="10" y1="10.5" x2="10.3" y2="16.5" /><line x1="14" y1="10.5" x2="13.7" y2="16.5" /></>);
export const Envelope = icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3.5 6.5 12 13 20.5 6.5" /></>);
export const Zap = icon(<path d="M13 2.5 3.5 14h8l-1 7.5L20.5 10h-8l0.5-7.5z" />);
export const Code = icon(<><polyline points="8.5 7 4 12 8.5 17" /><polyline points="15.5 7 20 12 15.5 17" /></>);
export const Refresh = icon(<><path d="M20 12a8 8 0 1 1-2.5-5.8" /><polyline points="20 3.5 20 7.5 16 7.5" /></>);
/** Leaves the board — used only for links that open the real app in a new tab. */
export const OpenExternal = icon(<><path d="M14 4.5h5.5V10" /><line x1="19.5" y1="4.5" x2="11.5" y2="12.5" /><path d="M18.5 14v4.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2H10" /></>);
export const Lock = icon(<><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.75a4 4 0 0 1 8 0v2.75" /></>);
export const People = icon(<><circle cx="9" cy="8" r="3.25" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.1a3.25 3.25 0 0 1 0 5.8" /><path d="M17.5 14.6a5.5 5.5 0 0 1 3 4.9" /></>);
export const Folder = icon(<path d="M3.5 6.5a2 2 0 0 1 2-2h3.2l2 2.5h7.8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />);
export const Info = icon(<><circle cx="12" cy="12" r="8.75" /><line x1="12" y1="11" x2="12" y2="16.25" /><line x1="12" y1="7.75" x2="12.01" y2="7.75" /></>);
