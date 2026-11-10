import { createOffice, type OfficeHandle, type OfficeState } from "./engine";

let office: OfficeHandle | null = null;

type Msg =
  | { type: "init"; canvas: OffscreenCanvas; w: number; h: number }
  | { type: "resize"; w: number; h: number }
  | { type: "state"; state: OfficeState }
  | { type: "pointer"; x: number; y: number }
  | { type: "click"; x: number; y: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      office = createOffice(m.canvas, (w, h) => new OffscreenCanvas(w, h), {
        onHover: (id) => self.postMessage({ type: "hover", id }),
        onSelect: (id, at) => self.postMessage({ type: "select", id, at }),
      });
      office.resize(m.w, m.h);
      break;
    case "resize":
      office?.resize(m.w, m.h);
      break;
    case "state":
      office?.update(m.state);
      break;
    case "pointer":
      office?.pointer(m.x, m.y);
      break;
    case "click":
      office?.click(m.x, m.y);
      break;
  }
};
