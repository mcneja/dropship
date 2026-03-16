/** @typedef {"ok"|"unsupported"|"failed"} ScreenshotCopyResult */
/** @typedef {import("./types.d.js").RenderState} RenderState */

/**
 * Draw the DROPSHIP start title using the same style as the main overlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dpr
 * @param {string} text
 * @param {number} alpha
 * @returns {void}
 */
export function drawStartTitle(ctx, w, h, dpr, text, alpha){
  if (!text || !(alpha > 0)) return;
  const fontFamily = "\"Science Gothic\", ui-sans-serif, system-ui, sans-serif";
  const fontPx = fitCanvasFontPx(
    ctx,
    text,
    700,
    Math.min(Math.round(w * 0.18), Math.round(140 * dpr)),
    Math.round(20 * dpr),
    w * 0.9,
    fontFamily,
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontPx}px ${fontFamily}`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgb(48, 174, 224)";
  ctx.fillText(text, w * 0.5, h * 0.25);
  ctx.globalAlpha = 1;
}

/**
 * @param {Object} opts
 * @param {HTMLCanvasElement|null|undefined} opts.canvas
 * @param {HTMLCanvasElement|null|undefined} [opts.overlay]
 * @param {boolean} [opts.clean]
 * @param {(()=>void)|null|undefined} [opts.drawCleanFrame]
 * @param {(()=>void)|null|undefined} [opts.restoreFrame]
 * @param {boolean} [opts.includeStartTitle]
 * @param {string} [opts.startTitleText]
 * @param {number} [opts.startTitleAlpha]
 * @returns {HTMLCanvasElement|null}
 */
export function buildScreenshotCanvas(opts){
  const source = opts.canvas;
  if (!source) return null;
  const dprFallback = (typeof window !== "undefined")
    ? Math.max(1, window.devicePixelRatio || 1)
    : 1;
  const w = source.width || Math.max(1, Math.floor(source.clientWidth * dprFallback));
  const h = source.height || Math.max(1, Math.floor(source.clientHeight * dprFallback));
  if (w <= 0 || h <= 0) return null;
  if (typeof document === "undefined") return null;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  const clean = !!opts.clean;
  let switchedFrame = false;
  try {
    // Always start from a solid background so captures are opaque.
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, w, h);

    if (clean && typeof opts.drawCleanFrame === "function"){
      opts.drawCleanFrame();
      switchedFrame = true;
    }
    ctx.drawImage(source, 0, 0, w, h);
    if (!clean && opts.overlay && opts.overlay.width > 0 && opts.overlay.height > 0){
      ctx.drawImage(opts.overlay, 0, 0, w, h);
    }
    if (clean && opts.includeStartTitle){
      const drawDpr = source.clientWidth > 0
        ? (source.width / Math.max(1, source.clientWidth))
        : dprFallback;
      drawStartTitle(
        ctx,
        w,
        h,
        drawDpr,
        opts.startTitleText || "DROPSHIP",
        Math.max(0, opts.startTitleAlpha || 0),
      );
    }
  } catch (_err){
    return null;
  } finally {
    if (switchedFrame && typeof opts.restoreFrame === "function"){
      try {
        opts.restoreFrame();
      } catch (_err){
        // Best-effort restore; caller owns rendering lifecycle.
      }
    }
  }
  return out;
}

/**
 * @param {HTMLCanvasElement|null|undefined} canvas
 * @returns {Promise<ScreenshotCopyResult>}
 */
export async function copyCanvasToClipboard(canvas){
  if (!canvas) return "failed";
  if (typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== "function" ||
      typeof ClipboardItem === "undefined"){
    return "unsupported";
  }
  try {
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b || null), "image/png");
    });
    if (!blob) return "failed";
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "ok";
  } catch (_err){
    return "failed";
  }
}

/**
 * Copy a gameplay screenshot to clipboard.
 * For clean captures, this temporarily renders a reduced-chrome frame and then restores the original frame.
 * @param {Object} opts
 * @param {HTMLCanvasElement|null|undefined} opts.canvas
 * @param {HTMLCanvasElement|null|undefined} [opts.overlay]
 * @param {RenderState} opts.renderState
 * @param {boolean} opts.clean
 * @param {(state:RenderState)=>void} opts.drawFrame
 * @param {(()=>void)|null|undefined} [opts.redrawOverlay]
 * @param {boolean} [opts.includeStartTitle]
 * @param {string} [opts.startTitleText]
 * @param {number} [opts.startTitleAlpha]
 * @returns {Promise<ScreenshotCopyResult>}
 */
export async function copyGameplayScreenshotToClipboard(opts){
  const clean = !!opts.clean;
  /** @type {RenderState|null} */
  const cleanState = clean ? {
    ...opts.renderState,
    debugCollisions: false,
    debugPlanetTriangles: false,
    debugCollisionContours: false,
    debugRingVertices: false,
    showGameplayIndicators: false,
    touchUi: null,
    touchStart: false,
    touchStartMode: null,
  } : null;

  const canvas = buildScreenshotCanvas({
    canvas: opts.canvas,
    overlay: opts.overlay,
    clean,
    drawCleanFrame: cleanState ? (() => opts.drawFrame(cleanState)) : null,
    restoreFrame: cleanState ? (() => {
      opts.drawFrame(opts.renderState);
      if (typeof opts.redrawOverlay === "function"){
        opts.redrawOverlay();
      }
    }) : null,
    includeStartTitle: clean && !!opts.includeStartTitle,
    startTitleText: opts.startTitleText || "DROPSHIP",
    startTitleAlpha: opts.startTitleAlpha,
  });
  if (!canvas) return "failed";
  return copyCanvasToClipboard(canvas);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} weight
 * @param {number} maxPx
 * @param {number} minPx
 * @param {number} maxWidth
 * @param {string} family
 * @returns {number}
 */
function fitCanvasFontPx(ctx, text, weight, maxPx, minPx, maxWidth, family){
  let px = Math.max(minPx, maxPx);
  while (px > minPx){
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return Math.max(minPx, px);
}
