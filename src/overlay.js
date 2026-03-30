// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as camera from "./camera.js";
import { GAME } from "./config.js";
import { dashboardPerkSummary } from "./dashboard.js";
import { perkChoiceLayout } from "./perk_choice_ui.js";
import { PERF_FLAGS, getEffectiveDevicePixelRatio } from "./perf.js";
import { drawStartTitle } from "./screenshot.js";

/**
 * @param {Game} game
 * @returns {void}
 */
export function drawGameOverlay(game){
  if (PERF_FLAGS.disableOverlayCanvas || !game.overlay || !game.overlayCtx){
    return;
  }

  const titleState = game.titleState;
  const ctx = game.overlayCtx;
  const dpr = getEffectiveDevicePixelRatio();
  const w = Math.floor(game.overlay.clientWidth * dpr);
  const h = Math.floor(game.overlay.clientHeight * dpr);
  if (game.overlay.width !== w || game.overlay.height !== h){
    game.overlay.width = w;
    game.overlay.height = h;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (game.jumpdriveTransition.isActive()){
    game.jumpdriveTransition.drawOverlay(ctx, w, h, dpr, game._lastRenderState);
    ctx.globalAlpha = 1;
    return;
  }
  const showStartTitle = !titleState.seen && titleState.alpha > 0;
  if (!showStartTitle && !game.popups.length && !game.shipHitPopups.length && !game.lastAimScreen && !game.pendingPerkChoice){
    return;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(12, Math.round(16 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const screenT = camera.screenTransform(game, w / h);

  for (const p of game.popups){
    const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
    const alpha = 0.9 * t;
    const screen = camera.worldToScreenNorm(game, p.x, p.y, screenT);
    const px = screen.x * w;
    const py = screen.y * h;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255, 236, 170, 1)";
    ctx.fillText(p.text, px, py);
  }
  for (const p of game.shipHitPopups){
    const t = Math.max(0, Math.min(1, p.life / GAME.SHIP_HIT_POPUP_LIFE));
    const alpha = 0.9 * t;
    const screen = camera.worldToScreenNorm(game, p.x, p.y, screenT);
    const px = screen.x * w;
    const py = screen.y * h;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255, 80, 80, 1)";
    ctx.fillText("-1", px, py);
  }

  if (game.lastAimScreen && game.ship.state !== "crashed"){
    const px = game.lastAimScreen.x * w;
    const py = game.lastAimScreen.y * h;
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

  if (game.pendingPerkChoice){
    const layout = perkChoiceLayout(w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 240, 190, 1)";
    const fontFamily = "\"Science Gothic\", ui-sans-serif, system-ui, sans-serif";
    const titlePx = fitCanvasFontPx(
      ctx,
      "Choose an Upgrade",
      700,
      Math.round(24 * dpr),
      Math.round(14 * dpr),
      layout.panelW * 0.84,
      fontFamily
    );
    ctx.font = `700 ${titlePx}px ${fontFamily}`;
    ctx.fillText("Choose an Upgrade", w * 0.5, layout.titleY);

    const left = game.pendingPerkChoice[0];
    const right = game.pendingPerkChoice[1];
    const bodyMaxPx = Math.max(Math.round(12 * dpr), Math.round(layout.leftCard.w * 0.06));
    const bodyMinPx = Math.max(Math.round(9 * dpr), Math.round(bodyMaxPx * 0.68));
    const cardTitlePx = Math.max(Math.round(11 * dpr), Math.round(bodyMaxPx * 0.92));
    /**
     * @param {{x:number,y:number,w:number,h:number}} card
     * @param {string} heading
     * @param {string} text
     * @param {string} accent
     * @returns {void}
     */
    const drawPerkCard = (card, heading, text, accent) => {
      const grad = ctx.createLinearGradient(0, card.y, 0, card.y + card.h);
      grad.addColorStop(0, "rgba(14, 16, 28, 0.96)");
      grad.addColorStop(1, "rgba(8, 10, 18, 0.96)");
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = grad;
      ctx.fillRect(card.x, card.y, card.w, card.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
      ctx.strokeRect(card.x, card.y, card.w, card.h);
      ctx.font = `700 ${cardTitlePx}px ${fontFamily}`;
      ctx.fillStyle = "rgba(255, 240, 190, 1)";
      ctx.fillText(heading, card.x + card.w * 0.5, card.y + card.h * 0.18);
      const bodyLayout = fitWrappedCanvasText(
        ctx,
        text,
        600,
        bodyMaxPx,
        bodyMinPx,
        card.w * 0.82,
        card.h * 0.44,
        4,
        fontFamily
      );
      ctx.font = `600 ${bodyLayout.fontPx}px ${fontFamily}`;
      ctx.fillStyle = "rgba(220, 236, 255, 1)";
      drawCenteredTextBlock(
        ctx,
        bodyLayout.lines,
        card.x + card.w * 0.5,
        card.y + card.h * 0.46,
        card.h * 0.44,
        bodyLayout.lineHeight
      );
    };
    drawPerkCard(layout.leftCard, "LEFT", left ? left.text : "", "rgba(120, 210, 255, 0.95)");
    drawPerkCard(layout.rightCard, "RIGHT", right ? right.text : "", "rgba(255, 214, 180, 0.95)");

    const techSummary = dashboardPerkSummary(game) || "None";
    const summaryTop = layout.leftCard.y + layout.leftCard.h + Math.max(18 * dpr, h * 0.03);
    const summaryLabelPx = Math.max(Math.round(10 * dpr), Math.round(bodyMaxPx * 0.78));
    ctx.font = `700 ${summaryLabelPx}px ${fontFamily}`;
    ctx.fillStyle = "rgba(165, 206, 228, 0.96)";
    ctx.fillText("Installed Tech", w * 0.5, summaryTop);
    const summaryTextTop = summaryTop + Math.max(16 * dpr, summaryLabelPx * 1.35);
    const summaryLayout = fitWrappedCanvasText(
      ctx,
      techSummary,
      550,
      Math.max(Math.round(11 * dpr), Math.round(bodyMaxPx * 0.8)),
      Math.max(Math.round(8 * dpr), Math.round(bodyMinPx * 0.95)),
      layout.panelW * 0.9,
      Math.max(16 * dpr, h - summaryTextTop - Math.max(20 * dpr, h * 0.05)),
      4,
      fontFamily
    );
    ctx.font = `550 ${summaryLayout.fontPx}px ${fontFamily}`;
    ctx.fillStyle = "rgba(220, 236, 255, 0.96)";
    drawCenteredTextBlock(
      ctx,
      summaryLayout.lines,
      w * 0.5,
      summaryTextTop + Math.min(summaryLayout.lines.length * summaryLayout.lineHeight, h * 0.16) * 0.5,
      Math.max(16 * dpr, h - summaryTextTop - Math.max(20 * dpr, h * 0.05)),
      summaryLayout.lineHeight
    );
  }

  if (showStartTitle){
    drawStartTitle(ctx, w, h, dpr, /** @type {string} */ (titleState.text), /** @type {number} */ (titleState.alpha));
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
 * @param {number} maxWidth
 * @param {number} maxLines
 * @returns {{lines:string[],truncated:boolean}}
 */
function wrapCanvasText(ctx, text, maxWidth, maxLines){
  /** @type {string[]} */
  const lines = [];
  let truncated = false;
  const paragraphs = String(text || "").split(/\r?\n/);
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1){
    const paragraph = /** @type {string} */ (paragraphs[paragraphIndex]);
    const rawWords = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!rawWords.length){
      if (lines.length < maxLines){
        lines.push("");
      } else if (paragraphIndex < paragraphs.length - 1){
        truncated = true;
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
        if (lines.length >= maxLines){
          truncated = true;
          break;
        }
      } else {
        line = next;
      }
    }
    if (truncated) break;
    if (line && lines.length < maxLines){
      lines.push(line);
    } else if (line){
      truncated = true;
    }
    if (lines.length >= maxLines && paragraphIndex < paragraphs.length - 1){
      truncated = true;
      break;
    }
  }
  if (truncated && lines.length){
    lines[lines.length - 1] = fitCanvasLineWithEllipsis(ctx, /** @type {string} */ (lines[lines.length - 1]), maxWidth);
  }
  return { lines, truncated };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} weight
 * @param {number} maxPx
 * @param {number} minPx
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {number} maxLines
 * @param {string} family
 * @returns {{fontPx:number,lineHeight:number,lines:string[]}}
 */
function fitWrappedCanvasText(ctx, text, weight, maxPx, minPx, maxWidth, maxHeight, maxLines, family){
  for (let fontPx = Math.max(minPx, maxPx); fontPx >= minPx; fontPx -= 1){
    ctx.font = `${weight} ${fontPx}px ${family}`;
    const lineHeight = Math.max(1, Math.round(fontPx * 1.24));
    const wrapped = wrapCanvasText(ctx, text, maxWidth, maxLines);
    if (wrapped.lines.length * lineHeight <= maxHeight){
      return { fontPx, lineHeight, lines: wrapped.lines };
    }
  }
  ctx.font = `${weight} ${minPx}px ${family}`;
  return {
    fontPx: minPx,
    lineHeight: Math.max(1, Math.round(minPx * 1.2)),
    lines: wrapCanvasText(ctx, text, maxWidth, maxLines).lines,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
function fitCanvasLineWithEllipsis(ctx, text, maxWidth){
  const ellipsis = "...";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let line = text;
  while (line.length > 0 && ctx.measureText(`${line}${ellipsis}`).width > maxWidth){
    line = line.slice(0, -1);
  }
  return line ? `${line}${ellipsis}` : ellipsis;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} lines
 * @param {number} cx
 * @param {number} centerY
 * @param {number} maxHeight
 * @param {number} lineHeight
 * @returns {void}
 */
function drawCenteredTextBlock(ctx, lines, cx, centerY, maxHeight, lineHeight){
  if (!lines.length) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const blockHeight = Math.min(maxHeight, lines.length * lineHeight);
  const firstLineY = centerY - blockHeight * 0.5 + lineHeight * 0.5;
  for (let i = 0; i < lines.length; i++){
    ctx.fillText(/** @type {string} */ (lines[i]), cx, firstLineY + i * lineHeight);
  }
}


