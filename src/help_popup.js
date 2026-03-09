// @ts-check

/**
 * @typedef {{onToggle?:(open:boolean)=>void}} HelpPopupOptions
 */

const HELP_STYLE_ID = "help-popup-style";

const HELP_CONTENT = `
  <section class="help-section">
    <h3>Mission Brief</h3>
    <div class="help-grid">
      <div class="help-k">Your Job</div><div class="help-v">Fly a dropship down to hostile planets, locate survivors, and return them safely to the mothership in orbit.</div>
      <div class="help-k">Mothership</div><div class="help-v">The mothership is your mobile base in orbit. It stores rescued crew and is where runs are reset, missions completed, and dropships upgraded.</div>
      <div class="help-k">Dropship</div><div class="help-v">The dropship is your active craft for terrain flight, combat, extraction, and docking back at the mothership.</div>
      <div class="help-k">Rescue Flow</div><div class="help-v">Find stranded crew on the surface, pick them up by landing next to them, survive enemies and terrain, then drop them off at the mothership.</div>
      <div class="help-k">Survivor Types</div><div class="help-v"><span class="help-chip">Miners</span> are the primary rescue objective. <span class="help-chip">Pilots</span> let you launch replacement dropships after a crash. <span class="help-chip">Engineers</span> unlock dropship upgrades while docked.</div>
      <div class="help-k">Upgrades</div><div class="help-v">Engineers can improve ship systems (for example hull, bombs, thrust, firepower, and utility gear). Choose upgrades when prompted at the mothership.</div>
    </div>
  </section>
  <section class="help-section">
    <h3>Flight Controls</h3>
    <div class="help-grid">
      <div class="help-k">Move / Strafe</div><div class="help-v"><span class="help-chip">A / D</span> or <span class="help-chip">Left / Right</span></div>
      <div class="help-k">Main Thrust</div><div class="help-v"><span class="help-chip">W</span> <span class="help-chip">Up</span> <span class="help-chip">Space</span></div>
      <div class="help-k">Reverse Thrust</div><div class="help-v"><span class="help-chip">S</span> or <span class="help-chip">Down</span></div>
      <div class="help-k">Fire Laser</div><div class="help-v"><span class="help-chip">LMB</span></div>
      <div class="help-k">Drop Bomb</div><div class="help-v"><span class="help-chip">RMB</span></div>
      <div class="help-k">Restart / Upgrade / Level up</div><div class="help-v"><span class="help-chip">R</span></div>
      <div class="help-k">Open / Close Help</div><div class="help-v"><span class="help-chip">/</span> <span class="help-chip">?</span> (close also with <span class="help-chip">Esc</span>)</div>
      <div class="help-k">Music</div><div class="help-v"><span class="help-chip">B</span> mute toggle, <span class="help-chip">J</span> combat tracks toggle, <span class="help-chip">-</span>/<span class="help-chip">=</span> volume</div>
      <div class="help-k">Other audio</div><div class="help-v">Use system volume</div>
    </div>
  </section>
  <section class="help-section">
    <h3>Touch & Gamepad</h3>
    <div class="help-grid">
      <div class="help-k">Touch Movement</div><div class="help-v">Left circular pad (lower-left): drag for strafe + thrust/down.</div>
      <div class="help-k">Touch Aim / Fire</div><div class="help-v">Right diamond (lower-right): drag to aim, hold to fire.</div>
      <div class="help-k">Touch Bomb</div><div class="help-v">Right square (upper-right): drag + release to throw bomb.</div>
      <div class="help-k">Touch Help</div><div class="help-v">Small circled <span class="help-chip">?</span> button in upper-left.</div>
      <div class="help-k">Gamepad Move</div><div class="help-v">Left stick (analog thrust vector).</div>
      <div class="help-k">Gamepad Aim</div><div class="help-v">Right stick.</div>
      <div class="help-k">Gamepad Inputs</div><div class="help-v"><span class="help-chip">A</span> thrust, <span class="help-chip">B</span> down, <span class="help-chip">RB</span> laser, <span class="help-chip">RT</span> bomb, <span class="help-chip">Start</span> restart.</div>
    </div>
  </section>
  <section class="help-section">
    <h3>HUD & Indicators</h3>
    <div class="help-legend">
      <div class="help-legend-item"><span class="help-glyph help-glyph-thrust"></span><div><b>Thruster plumes</b><span>Active directional thrust output from the dropship.</span></div></div>
      <div class="help-legend-item"><span class="help-glyph help-glyph-velocity"></span><div><b>Velocity / braking line</b><span>Projected stopping distance from your current speed and local gravity.</span></div></div>
      <div class="help-legend-item"><span class="help-glyph help-glyph-mother"></span><div><b>Mothership indicator</b><span>Blue edge arrow points toward off-screen mothership.</span></div></div>
      <div class="help-legend-item"><span class="help-glyph help-glyph-orbit"></span><div><b>Apogee / Perigee markers</b><span>Orbit line with cross ticks for farthest and closest altitude points.</span></div></div>
      <div class="help-legend-item"><span class="help-glyph help-glyph-miner"></span><div><b>Closest miner indicator</b><span>When rescuee detector is unlocked, edge arrow points to nearest stranded miner.</span></div></div>
      <div class="help-legend-item"><span class="help-glyph help-glyph-hud"></span><div><b>Status labels</b><span>Top-left: hull/bombs. Bottom-left: objective + prompts. Bottom-right: planet/level. Bottom-center: heat meter when active.</span></div></div>
    </div>
  </section>
  <section class="help-section">
    <h3>Audio Credits</h3>
    <div class="help-v">
      Luke.RUSTLTD, brandon75689, cynicmusic, pauliuw, Michel Baradari, Ogrebane, ycake, Blender Foundation, Matthew Pablo, Q009, qubodup, yd.
      Full attribution: <a href="https://github.com/mcneja/dropship/blob/main/gameaudio/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">ATTRIBUTION.md on GitHub</a>.
    </div>
  </section>
`;

function ensureHelpStyles(){
  if (document.getElementById(HELP_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HELP_STYLE_ID;
  style.textContent = `
    #help-popup {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 60;
      pointer-events: auto;
    }
    #help-popup.help-open { display: flex; }
    #help-popup .help-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(3, 5, 10, 0.68);
      backdrop-filter: blur(2px);
    }
    #help-popup .help-panel {
      position: relative;
      width: min(940px, calc(100vw - max(16px, env(safe-area-inset-left)) - max(16px, env(safe-area-inset-right))));
      max-height: min(88vh, calc(100vh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom))));
      border: 2px solid rgba(255, 215, 110, 0.95);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(14,16,27,0.98), rgba(9,10,18,0.96));
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255,255,255,0.05);
      color: #e8f0ff;
      font: 500 15px/1.35 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #help-popup .help-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 16px 10px;
      border-bottom: 1px solid rgba(255, 215, 110, 0.35);
      background: linear-gradient(90deg, rgba(255, 215, 110, 0.12), rgba(120, 210, 255, 0.1));
    }
    #help-popup .help-title {
      margin: 0;
      color: rgba(255, 240, 190, 1);
      font: 700 clamp(16px, 2.4vw, 26px)/1.1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #help-popup .help-close-hint {
      color: rgba(200, 235, 255, 0.95);
      font-size: clamp(11px, 1.8vw, 14px);
      white-space: nowrap;
    }
    #help-popup .help-close-btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.25);
      color: #fff;
      background: rgba(255,255,255,0.06);
      border-radius: 8px;
      font: 700 14px/1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      width: 32px;
      height: 32px;
      cursor: pointer;
      flex: 0 0 auto;
    }
    #help-popup .help-scroll {
      overflow-y: auto;
      padding: 10px 16px 16px;
      display: block;
      scrollbar-width: thin;
      overscroll-behavior: contain;
    }
    #help-popup .help-section + .help-section { margin-top: 16px; }
    #help-popup .help-section h3 {
      margin: 0 0 8px;
      font: 650 clamp(14px, 2vw, 19px)/1.2 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.02em;
      color: rgba(255, 240, 190, 0.98);
    }
    #help-popup .help-grid {
      display: grid;
      grid-template-columns: minmax(140px, 0.34fr) 1fr;
      gap: 8px 12px;
      align-items: start;
    }
    #help-popup .help-k {
      color: rgba(200, 235, 255, 0.96);
      font-weight: 650;
    }
    #help-popup .help-v { color: rgba(232, 240, 255, 0.95); }
    #help-popup .help-v a {
      color: rgba(136, 210, 255, 1);
      text-decoration-color: rgba(136, 210, 255, 0.8);
    }
    #help-popup .help-v a:hover {
      color: rgba(176, 226, 255, 1);
    }
    #help-popup .help-chip {
      display: inline-block;
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 6px;
      padding: 0 6px;
      margin: 0 2px;
      background: rgba(255,255,255,0.07);
      color: #fff;
      font-size: 0.92em;
      line-height: 1.35;
    }
    #help-popup .help-legend { display: grid; gap: 9px; }
    #help-popup .help-legend-item {
      display: grid;
      grid-template-columns: 22px 1fr;
      gap: 10px;
      align-items: start;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
    }
    #help-popup .help-legend-item b {
      display: block;
      color: rgba(200, 235, 255, 1);
      font-weight: 700;
    }
    #help-popup .help-legend-item span { color: rgba(232, 240, 255, 0.92); }
    #help-popup .help-glyph {
      width: 20px;
      height: 16px;
      position: relative;
      margin-top: 1px;
      box-sizing: border-box;
    }
    #help-popup .help-glyph::before,
    #help-popup .help-glyph::after {
      content: "";
      position: absolute;
      box-sizing: border-box;
    }
    #help-popup .help-glyph-thrust {
      color: rgba(255, 140, 38, 0.98);
    }
    #help-popup .help-glyph-thrust::before,
    #help-popup .help-glyph-thrust::after {
      top: 2px;
      width: 2px;
      height: 12px;
      background: rgba(255, 145, 45, 1);
      transform-origin: center top;
    }
    #help-popup .help-glyph-thrust::before {
      left: 6px;
      transform: rotate(42deg);
    }
    #help-popup .help-glyph-thrust::after {
      left: 13px;
      transform: rotate(-42deg);
    }
    #help-popup .help-glyph-velocity::before {
      left: 1px;
      right: 1px;
      top: 7px;
      height: 2px;
      background: rgba(106, 198, 255, 1);
    }
    #help-popup .help-glyph-mother::before,
    #help-popup .help-glyph-mother::after,
    #help-popup .help-glyph-miner::before,
    #help-popup .help-glyph-miner::after {
      width: 2px;
      height: 9px;
      top: 3px;
      transform-origin: center center;
    }
    #help-popup .help-glyph-mother::before,
    #help-popup .help-glyph-mother::after {
      background: rgba(95, 194, 255, 1);
    }
    #help-popup .help-glyph-miner::before,
    #help-popup .help-glyph-miner::after {
      background: rgba(255, 206, 156, 1);
    }
    #help-popup .help-glyph-mother::before,
    #help-popup .help-glyph-miner::before {
      left: 9px;
      transform: rotate(48deg);
    }
    #help-popup .help-glyph-mother::after,
    #help-popup .help-glyph-miner::after {
      left: 13px;
      transform: rotate(-48deg);
    }
    #help-popup .help-glyph-orbit::before {
      left: 9px;
      top: 2px;
      width: 2px;
      height: 12px;
      background: rgba(106, 198, 255, 1);
    }
    #help-popup .help-glyph-orbit::after {
      left: 5px;
      top: 2px;
      width: 9px;
      height: 2px;
      background: rgba(106, 198, 255, 1);
      box-shadow: 0 10px 0 rgba(106, 198, 255, 1);
    }
    #help-popup .help-glyph-hud::before {
      inset: 2px;
      border: 1.5px solid rgba(232, 240, 255, 0.92);
      border-radius: 2px;
    }
    #help-touch-toggle {
      position: fixed;
      left: calc(max(8px, env(safe-area-inset-left)));
      top: calc(max(8px, env(safe-area-inset-top)));
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(255, 215, 110, 0.95);
      background: rgba(12, 14, 24, 0.88);
      color: rgba(255, 240, 190, 1);
      display: none;
      place-items: center;
      z-index: 45;
      font: 700 21px/1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      box-shadow: 0 3px 12px rgba(0,0,0,0.35);
      padding: 0;
      pointer-events: auto;
      touch-action: manipulation;
    }
    #help-touch-toggle.help-touch-visible { display: grid; }
    @media (max-width: 780px) {
      #help-popup .help-panel {
        width: calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)));
        max-height: calc(100vh - max(12px, env(safe-area-inset-top)) - max(12px, env(safe-area-inset-bottom)));
      }
      #help-popup .help-header { padding: 10px 12px 8px; }
      #help-popup .help-scroll { padding: 8px 12px 12px; }
      #help-popup .help-grid { grid-template-columns: 1fr; gap: 3px 8px; }
      #help-popup .help-k { margin-top: 2px; }
      #help-popup .help-close-hint { display: none; }
    }
  `;
  document.head.appendChild(style);
}

export class HelpPopup {
  /**
   * @param {HelpPopupOptions} [options]
   */
  constructor(options = {}){
    ensureHelpStyles();

    this.onToggle = (typeof options.onToggle === "function") ? options.onToggle : null;
    this.open = false;

    this.root = document.createElement("div");
    this.root.id = "help-popup";
    this.root.innerHTML = `
      <div class="help-backdrop"></div>
      <section class="help-panel" role="dialog" aria-modal="true" aria-label="Dropship Help">
        <header class="help-header">
          <h2 class="help-title">Operations Manual</h2>
          <div class="help-close-hint">Close: / ? Esc</div>
          <button type="button" class="help-close-btn" aria-label="Close help">x</button>
        </header>
        <div class="help-scroll">
          ${HELP_CONTENT}
        </div>
      </section>
    `;

    this.touchButton = document.createElement("button");
    this.touchButton.id = "help-touch-toggle";
    this.touchButton.type = "button";
    this.touchButton.setAttribute("aria-label", "Open help");
    this.touchButton.textContent = "?";

    const closeBtn = /** @type {HTMLButtonElement|null} */ (this.root.querySelector(".help-close-btn"));
    const backdrop = /** @type {HTMLElement|null} */ (this.root.querySelector(".help-backdrop"));
    closeBtn?.addEventListener("click", () => this.close());
    backdrop?.addEventListener("click", () => this.close());
    this.touchButton.addEventListener("click", (e) => {
      e.preventDefault();
      this.toggle();
    });
    this.touchButton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });

    this._onKeyDownBound = (e) => this._onKeyDown(e);
    window.addEventListener("keydown", this._onKeyDownBound, true);
    document.body.appendChild(this.root);
    document.body.appendChild(this.touchButton);
  }

  /**
   * @returns {boolean}
   */
  isOpen(){
    return this.open;
  }

  /**
   * @param {boolean} touchMode
   * @returns {void}
   */
  setTouchMode(touchMode){
    const show = !!touchMode;
    this.touchButton.classList.toggle("help-touch-visible", show);
    document.body.classList.toggle("help-touch-visible", show);
  }

  /**
   * @returns {void}
   */
  show(){
    if (this.open) return;
    this.open = true;
    this.root.classList.add("help-open");
    document.body.classList.add("help-popup-open");
    const scroller = /** @type {HTMLElement|null} */ (this.root.querySelector(".help-scroll"));
    if (scroller) scroller.scrollTop = 0;
    if (this.onToggle) this.onToggle(true);
  }

  /**
   * @returns {void}
   */
  close(){
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove("help-open");
    document.body.classList.remove("help-popup-open");
    if (this.onToggle) this.onToggle(false);
  }

  /**
   * @returns {void}
   */
  toggle(){
    if (this.open) this.close();
    else this.show();
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {void}
   */
  _onKeyDown(e){
    const slashKey = e.key === "/" || e.key === "?" || e.code === "Slash";
    if (e.repeat) return;
    if (!this.open){
      if (!slashKey) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.show();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key === "Escape" || slashKey){
      this.close();
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
