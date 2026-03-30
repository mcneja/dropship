/** @typedef {import("./types.d.js").Point} Point */

/**
 * @typedef {{
 *   x:number,
 *   y:number,
 *   w:number,
 *   h:number
 * }} Rect
 */

/**
 * @typedef {{
 *   panelW:number,
 *   titleY:number,
 *   cardGap:number,
 *   leftCard:Rect,
 *   rightCard:Rect,
 * }} PerkChoiceLayout
 */

/**
 * @param {number} viewWidth
 * @param {number} viewHeight
 * @returns {PerkChoiceLayout}
 */
export function perkChoiceLayout(viewWidth, viewHeight){
  const w = Math.max(1, viewWidth);
  const h = Math.max(1, viewHeight);
  const panelW = Math.min(w * 0.94, 940);
  const panelX = (w - panelW) * 0.5;
  const cardGap = Math.max(18, panelW * 0.035);
  const cardY = h * 0.38;
  const cardW = Math.max(0, (panelW - cardGap) * 0.5);
  const cardH = Math.min(h * 0.28, 210);
  return {
    panelW,
    titleY: h * 0.30,
    cardGap,
    leftCard: { x: panelX, y: cardY, w: cardW, h: cardH },
    rightCard: { x: panelX + cardW + cardGap, y: cardY, w: cardW, h: cardH },
  };
}

/**
 * @param {Point} point
 * @param {number} viewWidth
 * @param {number} viewHeight
 * @returns {0|1|-1}
 */
export function perkChoiceIndexAtPoint(point, viewWidth, viewHeight){
  const layout = perkChoiceLayout(viewWidth, viewHeight);
  if (pointInRect(point, layout.leftCard)) return 0;
  if (pointInRect(point, layout.rightCard)) return 1;
  return -1;
}

/**
 * @param {Point} point
 * @param {Rect} rect
 * @returns {boolean}
 */
function pointInRect(point, rect){
  return point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}
