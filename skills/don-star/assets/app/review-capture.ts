// Self-capture service for review-board frames. The BOARD can't rasterize a
// cross-document iframe, but the app inside one can rasterize itself — same
// document, full fidelity (fonts, gradients, images all resolve normally).
// When framed, listen for a capture request from the parent board and reply
// with a bitmap of the current viewport. html-to-image is imported lazily so
// the customer bundle never carries it; only a framed review session loads it.
//
// The reply is a **Blob**, not a data URL: the board keeps captures on disk
// (review/snapshot-store.ts), and a whole board of PNG data URLs is both ~10×
// the bytes and a base64 round-trip on every read. Structured clone moves the
// Blob across the frame boundary with no copy of our own.
//
// The caller picks the encoding. Previews ask for WebP (the default — a
// fraction of a PNG's size, visually clean at canvas scale); the download
// export asks for lossless PNG at a higher pixel ratio, because that file
// leaves the browser and lands in someone's deck.
//
// Protocol (window.postMessage, same-origin):
//   board → frame  { type: 'rv-capture',      id: string, pixelRatio?: number, format?: string }
//   frame → board  { type: 'rv-capture-done', id: string, blob: Blob | null }

/** Quality of the WebP encode. Ignored by PNG, which is lossless. Browsers
 *  without WebP encoding fall back to PNG on their own (toBlob returns
 *  image/png), which still works. */
const QUALITY = 0.82

export function installReviewCapture(): void {
  if (typeof window === 'undefined' || window.top === window) return
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; id?: string; pixelRatio?: number; format?: string } | null
    if (!d || d.type !== 'rv-capture' || typeof d.id !== 'string') return
    if (e.origin !== window.location.origin) return
    void (async () => {
      let blob: Blob | null = null
      // html-to-image resolves its internal images via decode() →
      // requestAnimationFrame — and Chrome never runs rAF in a throttled
      // (offscreen / scaled-down) iframe, so toPng hangs forever in exactly
      // the frames the board wants captured. Shim rAF to a timeout for the
      // duration of the capture.
      const realRaf = window.requestAnimationFrame
      window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        window.setTimeout(() => cb(performance.now()), 16)) as typeof window.requestAnimationFrame
      // Entrance animations (wm-reveal & co.) were capturing at their
      // from-state (opacity 0), blanking every staggered section, for TWO
      // stacked reasons: (1) a throttled offscreen iframe never advances
      // animation time, and (2) even when the live animation is done,
      // html-to-image CLONES the DOM and the clone's animation restarts at
      // t=0 inside the SVG rendering context — animations beat the inlined
      // computed styles in the cascade. So: suspend all animation for the
      // capture. Every house entrance animates hidden→natural, so natural
      // styles ARE the settled page.
      const freeze = document.createElement('style')
      freeze.textContent =
        '*, *::before, *::after { animation: none !important; transition: none !important; }'
      document.head.appendChild(freeze)
      try {
        const { toCanvas } = await import('html-to-image')
        const canvas = await toCanvas(document.documentElement, {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: d.pixelRatio ?? 1,
          // The viewport box only — frames show the top of the page, and a
          // full-page capture of a long flow would be mostly unseen pixels.
          style: { margin: '0' },
          filter: (node) => !(node instanceof Element && node.id === 'rv-capture-ignore'),
        })
        const format = d.format === 'image/png' ? 'image/png' : 'image/webp'
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, QUALITY))
      } catch {
        blob = null
      } finally {
        window.requestAnimationFrame = realRaf
        freeze.remove()
      }
      window.parent.postMessage({ type: 'rv-capture-done', id: d.id, blob }, window.location.origin)
    })()
  })
}
