// @ts-check

import { GAME } from "./config.js";
import { PERF_FLAGS, getEffectiveDevicePixelRatio } from "./perf.js";
import { drawStartTitle } from "./screenshot.js";

/**
 * @param {any} loop
 * @returns {void}
 */
export function drawGameOverlay(loop){
  if (PERF_FLAGS.disableOverlayCanvas || !loop.overlay || !loop.overlayCtx){
    return;
  }

  const ctx = loop.overlayCtx;
  const dpr = getEffectiveDevicePixelRatio();
  const w = Math.floor(loop.overlay.clientWidth * dpr);
  const h = Math.floor(loop.overlay.clientHeight * dpr);
  if (loop.overlay.width !== w || loop.overlay.height !== h){
    loop.overlay.width = w;
    loop.overlay.height = h;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (loop.jumpdriveTransition.isActive()){
    loop.jumpdriveTransition.drawOverlay(ctx, w, h, dpr, loop._lastRenderState);
    ctx.globalAlpha = 1;
    return;
  }
  const showStartTitle = !loop.startTitleSeen && loop.startTitleAlpha > 0;
  if (!showStartTitle && !loop.popups.length && !loop.shipHitPopups.length && !loop.lastAimScreen && !loop.pendingPerkChoice){
    return;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(12, Math.round(16 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const screenT = loop._screenTransform(w / h);

  for (const p of loop.popups){
    const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
    const alpha = 0.9 * t;
    const screen = loop._worldToScreenNorm(p.x, p.y, screenT);
    const px = screen.x * w;
    const py = screen.y * h;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255, 236, 170, 1)";
    ctx.fillText(p.text, px, py);
  }
  for (const p of loop.shipHitPopups){
    const t = Math.max(0, Math.min(1, p.life / GAME.SHIP_HIT_POPUP_LIFE));
    const alpha = 0.9 * t;
    const screen = loop._worldToScreenNorm(p.x, p.y, screenT);
    const px = screen.x * w;
    const py = screen.y * h;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255, 80, 80, 1)";
    ctx.fillText("-1", px, py);
  }

  if (loop.lastAimScreen && loop.ship.state !== "crashed"){
    const px = loop.lastAimScreen.x * w;
    const py = loop.lastAimScreen.y * h;
    const r = Math.max(6, Math.round(10 * dpr));
    const cross = Math.max(4, Math.round(r * 0.6));
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = "rgba(120, 255, 220, 1)";
    ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.moveTo(px - cross, py);
    ctx.lineTo(px + cross, py);
    ctx.moveTo(px, py - cross);
    ctx.lineTo(px, py + cross);
    ctx.stroke();
  }

  if (loop.pendingPerkChoice){
    const panelW = Math.min(w * 0.94, 940 * dpr);
    const x = (w - panelW) * 0.5;
    const titleY = h * 0.30;
    const cardY = h * 0.38;
    const cardGap = Math.max(18 * dpr, panelW * 0.035);
    const cardW = (panelW - cardGap) * 0.5;
    const cardH = Math.min(h * 0.28, 210 * dpr);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 240, 190, 1)";
    const fontFamily = "\"Science Gothic\", ui-sans-serif, system-ui, sans-serif";
    const titlePx = fitCanvasFontPx(ctx, "Choose an Upgrade", 700, Math.round(24 * dpr), Math.round(14 * dpr), panelW * 0.84, fontFamily);
    ctx.font = `700 ${titlePx}px ${fontFamily}`;
    ctx.fillText("Choose an Upgrade", x + panelW * 0.5, titleY);

    const left = loop.pendingPerkChoice[0];
    const right = loop.pendingPerkChoice[1];
    const bodyPx = Math.max(Math.round(12 * dpr), Math.round(cardW * 0.06));
    const lineHeight = Math.max(Math.round(15 * dpr), Math.round(bodyPx * 1.26));
    const cardTitlePx = Math.max(Math.round(11 * dpr), Math.round(bodyPx * 0.92));
    /**
     * @param {number} cardX
     * @param {string} heading
     * @param {string} text
     * @param {string} accent
     * @returns {void}
     */
    const drawPerkCard = (cardX, heading, text, accent) => {
      const grad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
      grad.addColorStop(0, "rgba(14, 16, 28, 0.96)");
      grad.addColorStop(1, "rgba(8, 10, 18, 0.96)");
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = grad;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
      ctx.strokeRect(cardX, cardY, cardW, cardH);
      ctx.font = `700 ${cardTitlePx}px ${fontFamily}`;
      ctx.fillStyle = "rgba(255, 240, 190, 1)";
      ctx.fillText(heading, cardX + cardW * 0.5, cardY + cardH * 0.18);
      ctx.font = `600 ${bodyPx}px ${fontFamily}`;
      ctx.fillStyle = "rgba(220, 236, 255, 1)";
      drawCenteredWrappedText(ctx, text, cardX + cardW * 0.5, cardY + cardH * 0.56, cardW * 0.82, lineHeight, 3);
    };
    drawPerkCard(x, "LEFT", left ? left.text : "", "rgba(120, 210, 255, 0.95)");
    drawPerkCard(x + cardW + cardGap, "RIGHT", right ? right.text : "", "rgba(255, 214, 180, 0.95)");
  }

  if (showStartTitle){
    drawStartTitle(ctx, w, h, dpr, /** @type {string} */ (loop.startTitleText), /** @type {number} */ (loop.startTitleAlpha));
  }
  ctx.globalAlpha = 1;
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

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} cx
 * @param {number} topY
 * @param {number} maxWidth
 * @param {number} lineHeight
 * @param {number} maxLines
 * @returns {void}
 */
function drawCenteredWrappedText(ctx, text, cx, topY, maxWidth, lineHeight, maxLines){
  /** @type {string[]} */
  const lines = [];
  const paragraphs = String(text || "").split(/\r?\n/);
  for (const paragraph of paragraphs){
    const rawWords = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!rawWords.length){
      if (lines.length < maxLines){
        lines.push("");
      }
      continue;
    }
    /** @type {string[]} */
    const words = [];
    for (const token of rawWords){
      if (ctx.measureText(token).width <= maxWidth){
        words.push(token);
        continue;
      }
      let chunk = "";
      for (const ch of token){
        const next = chunk + ch;
        if (chunk && ctx.measureText(next).width > maxWidth){
          words.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      if (chunk) words.push(chunk);
    }

    let line = "";
    for (const word of words){
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth){
        lines.push(line);
        line = word;
        if (lines.length >= maxLines - 1) break;
      } else {
        line = next;
      }
    }
    if (line && lines.length < maxLines){
      lines.push(line);
    }
    if (lines.length >= maxLines){
      break;
    }
  }
  if (!lines.length) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i++){
    ctx.fillText(/** @type {string} */ (lines[i]), cx, topY + i * lineHeight);
  }
}
