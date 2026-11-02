// Public surface of the review harness. Host apps import from here; the
// standalone host's main.tsx does too.

export { ReviewApp } from "./app";
export { parseSnapshot, EMPTY_SNAPSHOT, isAgent } from "./model";
export { DEV_SNAPSHOT_ENDPOINT } from "./io";
export type {
  AgentMeta,
  CommentAnchor,
  CommentThread,
  Flow,
  Page,
  ReviewProject,
  ReviewSnapshot,
  ReviewStatus,
  Screen,
  ScreenSeed,
  ScreenSource,
} from "./model";
