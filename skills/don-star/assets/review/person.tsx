// A board user, the same everywhere they appear: sharing, the admin screens,
// the @ menu, comments and events wear the look they chose in Edit profile
// (presence-ui.tsx), not a plain initial. Presence reads the live channel;
// this reads the people directory (people-directory.ts) for everywhere else.

import type { CSSProperties } from "react";
import { initialOf } from "./model";
import { lookOf, useDirectory } from "./people-directory";
import { colorCss, inkOn } from "./presence-model";

/** The avatar circle for a board user. `className` keeps each surface's own
 *  shape; `size` (px) sets the circle, an emoji drawn larger than a letter.
 *  The look paints over the surface's background. Unknown people (no email,
 *  never signed in) render exactly as that surface always has. */
export function PersonAvatar({
  name,
  email,
  className,
  size,
}: {
  name: string;
  email?: string | null;
  className: string;
  size?: number;
}) {
  const look = lookOf(useDirectory(), email, name);
  const style: CSSProperties = {};
  if (size) Object.assign(style, { width: size, height: size, fontSize: size * (look.emoji ? 0.56 : 0.42) });
  if (look.color != null) Object.assign(style, { background: colorCss(look.color), color: inkOn(look.color) });
  return (
    <span className={look.emoji ? `${className} is-emoji` : className} style={style} aria-hidden>
      {look.emoji ?? initialOf(look.name)}
    </span>
  );
}
