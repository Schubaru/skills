// The board config: pages → flows → screens. Hand-maintained.
//
// Every screen is LIVE — `{ kind: "url", src: "<the app's own route>" }` renders
// the real page in the frame, so the board can never go stale. A mid-flow
// screen (step 3 of a wizard) boots there by carrying a `seed`: the app's own
// storage, pre-written inside that frame (see src/review-seed.ts).
//
// Ids are the join key for comments: unique across the project and never
// recycled — pointing an existing id at a different screen silently moves
// every comment on it. If a step order changes, renumber ids AND migrate the
// anchors in the board file in the same commit.
//
// install.sh generates a first version of this file from the router (one
// flow per top-level route). Regroup it by USER JOURNEY — "Onboarding",
// "Checkout" — one flow per journey in walk-through order, never by viewport.

import type { Page, ReviewProject, Screen } from "./model";

const url = (id: string, title: string, src: string, extra: Partial<Screen> = {}): Screen => ({
  id,
  title,
  source: { kind: "url", src },
  ...extra,
});

const pages: Page[] = [
  {
    id: "main",
    title: "All screens",
    flows: [
      {
        id: "pages",
        title: "Pages",
        screens: [
          url("home", "Home", "/"),
        ],
      },
    ],
  },
];

export const project: ReviewProject = {
  name: "__DS_PROJECT_NAME__",
  // Pinned once. Every comment, status and cache entry keys off it.
  slug: "__DS_PROJECT_SLUG__",
  screen: { w: 960, h: 600 },
  pages,
};
