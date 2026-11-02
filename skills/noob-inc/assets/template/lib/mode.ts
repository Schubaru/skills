/** Which sides this deploy serves. both: the owner's dashboard plus a share link. admin: the dashboard, no sharing. view: a public office with no sign-in and no controls. */
export const MODE: "both" | "admin" | "view" =
  process.env.NEXT_PUBLIC_NOOB_MODE === "admin" || process.env.NEXT_PUBLIC_NOOB_MODE === "view" ? process.env.NEXT_PUBLIC_NOOB_MODE : "both";

/** The label beside the wordmark. */
export const OFFICE_NAME = process.env.NEXT_PUBLIC_OFFICE_NAME || "Agent floor";

/** In view mode the office is served at / through the share view under this fixed token. */
export const PUBLIC_TOKEN = "public";
