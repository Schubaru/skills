// Deterministic board geometry: each page lays out its flows as horizontal
// lanes of screens from a fixed origin. Screens can differ in size (portrait
// mobile next to desktop), so positions come from prefix sums, and a lane is
// as tall as its tallest screen.

import { screenSize, type Flow, type Page, type ReviewProject, type Screen } from "./model";

export const SCREEN_GAP = 76;
export const FLOW_HEADER_H = 104;
export const HEADER_TO_LANE = 52;
export const FLOW_GAP_Y = 130;
/* The page label band is gone (2026-07-30); its width survives as the
   min-width for flow lanes and the section bands. */
export const PAGE_HEADER_W = 600;
export const ORIGIN_X = 120;
export const ORIGIN_Y = 96;
const PAGE_GAP_BOTTOM = 150;
export const SECTION_HEADER_H = 88;
export const SECTION_TO_FLOW = 48;

export const MIN_SCALE = 0.14;
export const MAX_SCALE = 1.6;

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Transform = { x: number; y: number; scale: number };

export type ScreenLayout = {
  screen: Screen;
  index: number;
  /** Local x within the flow lane. */
  x: number;
  w: number;
  h: number;
};

export type FlowLayout = {
  flow: Flow;
  page: Page;
  flowIndex: number;
  /** Default position; a dragged flow overrides it. */
  def: Point;
  width: number;
  laneH: number;
  screens: ScreenLayout[];
};

/** A section band at its default position: heads the run of consecutive
 *  flows that declare it (see Flow.section). Pure presentation — dragging a
 *  flow moves the lane, never its band. */
export type SectionLayout = {
  title: string;
  y: number;
  flowCount: number;
  screenCount: number;
};

export type PageLayout = {
  page: Page;
  flows: FlowLayout[];
  sections: SectionLayout[];
  bounds: Size;
};

export function buildPageLayout(project: ReviewProject, page: Page): PageLayout {
  const flows: FlowLayout[] = [];
  const sections: SectionLayout[] = [];
  let y = ORIGIN_Y;
  let maxX = ORIGIN_X + PAGE_HEADER_W;

  let prevSection: string | undefined;
  page.flows.forEach((flow, flowIndex) => {
    if (flow.section && flow.section !== prevSection) {
      sections.push({ title: flow.section, y, flowCount: 0, screenCount: 0 });
      y += SECTION_HEADER_H + SECTION_TO_FLOW;
    }
    prevSection = flow.section;
    if (flow.section) {
      const sec = sections[sections.length - 1]!;
      sec.flowCount += 1;
      sec.screenCount += flow.screens.length;
    }
    const screens: ScreenLayout[] = [];
    let x = 0;
    let laneH = 0;
    flow.screens.forEach((screen, index) => {
      const { w, h } = screenSize(project, screen);
      screens.push({ screen, index, x, w, h });
      x += w + SCREEN_GAP;
      laneH = Math.max(laneH, h);
    });
    const width = Math.max(PAGE_HEADER_W, x - SCREEN_GAP);
    flows.push({ flow, page, flowIndex, def: { x: ORIGIN_X, y }, width, laneH, screens });
    maxX = Math.max(maxX, ORIGIN_X + width);
    y += FLOW_HEADER_H + HEADER_TO_LANE + laneH + FLOW_GAP_Y;
  });

  return { page, flows, sections, bounds: { w: maxX + ORIGIN_X, h: y + PAGE_GAP_BOTTOM } };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fitTransform(bounds: Size, size: Size, pad = 80): Transform {
  const scale = clamp(
    Math.min((size.w - pad * 2) / bounds.w, (size.h - pad * 2) / bounds.h),
    MIN_SCALE,
    MAX_SCALE,
  );
  return {
    scale,
    x: (size.w - bounds.w * scale) / 2,
    y: (size.h - bounds.h * scale) / 2,
  };
}
