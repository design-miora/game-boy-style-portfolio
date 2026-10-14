// ===== Game Boy Style Portfolio — Web Components build =====
// Structure/technique adapted & extended from ManzDev's twitch-gameboy-css
// (github.com/ManzDev/twitch-gameboy-css): Shadow-DOM custom elements,
// layered gradients/box-shadows for plastic depth.
// Added: real interactivity, portfolio screen UI, micro-animations,
// haptic feedback, device-responsive scaling, and an embedded platformer.
//
// Comment tags used throughout this file:
//   HIGHLIGHT — a non-obvious design decision worth reading before editing nearby code
//   ALERT     — a correctness/security-sensitive spot; read before changing
//   TODO      — known, real follow-up work (not required for the site to run)

// Small helper: pulses the device's vibration motor, if the browser/device
// supports it. No-ops silently everywhere else (desktop browsers, iOS Safari).
function haptic(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ---------- Synthesized blips (no external audio files needed) ----------
// All console/game sound effects are tiny WebAudio oscillator "blips" —
// this keeps the whole project dependency-free (no .mp3/.wav assets to fetch).

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep(freq = 520, duration = 0.06, type = "square", gain = 0.05) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // Audio unsupported, blocked by autoplay policy, or context already
    // closed — none of that should ever break the UI, so fail silently.
  }
}

// Two-note "confirm" jingle, reused for boot-up and menu confirmations.
function chime() {
  beep(660, 0.09, "square", 0.06);
  setTimeout(() => beep(880, 0.16, "square", 0.06), 90);
}

// Every physical/virtual button dispatches the same custom event upward
// through the shadow tree (composed: true), so GameboyConsole can listen
// once at its own shadow root instead of wiring a listener per button.
function fireAction(el, action, dir) {
  el.dispatchEvent(new CustomEvent("gb-press", {
    detail: { action, dir },
    bubbles: true,
    composed: true,
  }));
}

// ---------- Decorative: top OFF/ON label strip ----------
// Purely cosmetic — the faded "◁ OFF·ON ▷" pill above the screen, matching
// the real hardware's silkscreen text. No state, no interactivity.

class GameboyTop extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { display: block; }
      .gbtop {
        display: flex;
        padding-bottom: 5px;
        margin-bottom: 5px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      }
      .corner { width: 25px; height: 20px; }
      .corner.left { margin-right: 5px; }
      .corner.right { margin-left: 5px; }
      .top { width: 100%; }
      .top span {
        font-family: Arial, sans-serif;
        font-size: 12px;
        box-shadow: 2px 2px 2px rgba(0, 0, 0, 0.5) inset;
        text-shadow: 2px 1px 2px rgba(0, 0, 0, 1);
        color: #eee;
        border-radius: 15px;
        margin: 0 6px;
        padding: 2px 5px;
        opacity: 0.25;
      }
      .corner.left, .top, .corner.right {
        border-radius: 0 0 2px 2px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.25);
      }
    </style>
    <div class="gbtop">
      <div class="corner left"></div>
      <div class="top"><span>◁ OFF·ON ▷</span></div>
      <div class="corner right"></div>
    </div>`;
  }
}
customElements.define("gameboy-top", GameboyTop);

// ---------- Decorative: speaker grille ----------
// Purely cosmetic — six angled bands in the bottom-right corner, styled
// via the --gb-vent-color skin variable. No state, no interactivity.

class GameboySpeaker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { display: block; }
      .container {
        display: flex;
        width: 120px;
        justify-content: space-around;
        position: absolute;
        right: 10px;
        bottom: 35px;
        transform: rotate(-30deg);
      }
      .band {
        width: 8px;
        height: 60px;
        border-radius: 8px;
        box-shadow: 3px 6px 1px rgba(0, 0, 0, 0.6) inset;
        background: var(--gb-vent-color, rgba(0, 0, 0, 0.35));
      }
    </style>
    <div class="container" id="container">
      ${"<div class=\"band\"></div>".repeat(6)}
    </div>`;
  }
}
customElements.define("gameboy-speaker", GameboySpeaker);

// ---------- Screen: the portfolio LCD itself ----------
// Renders every "app" on the console: boot animation, main menu, static
// text detail screens, and (via showGameView) the embedded platformer.
//
// ALERT: showMenu()/showDetail()/showBoot() below build markup with plain
// string interpolation into innerHTML. That's safe ONLY because every
// interpolated value here (MENU labels/bodies, PLAYER_NAME, PLAYER_ROLE,
// selectedIndex) is a developer-authored constant, never third-party or
// user input. If this ever needs to render anything from outside this
// file (a query param, a fetched bio, etc.), escape it first — do not
// interpolate untrusted strings into innerHTML.

const PLAYER_NAME = "MOULEESHWARAN";
const PLAYER_ROLE = "CONTENT OPS + WEB DEV";
const ROW_H = 22;

// ALERT: encodeURIComponent on the subject/body is required — a bare
// newline or "&" in either string would otherwise corrupt the mailto URL
// (and, if this pattern were ever copied into a server-side mail sender,
// unescaped header values are the classic email-header-injection bug).
const HIRE_EMAIL = "design.miora.info@gmail.com";
const HIRE_SUBJECT = "Let's talk — from your Game Boy portfolio";
const HIRE_BODY = "Hi Mouleeshwaran,\n\nI just played through your Game Boy portfolio and wanted to reach out about...\n\n";
const HIRE_MAILTO = `mailto:${HIRE_EMAIL}?subject=${encodeURIComponent(HIRE_SUBJECT)}&body=${encodeURIComponent(HIRE_BODY)}`;

const MENU = [
  {
    key: "about",
    label: "ABOUT ME",
    type: "text",
    body: "Hi, I'm Mouleeshwaran —\nContent Ops & Web Dev\nspecialist, 7+ yrs at\nApple, Accenture &\nAmazon. I blend AEM/\nCMS ops with AI-assisted\n(Claude, Gemini) vibe\ncoding to automate work.",
  },
  {
    key: "resume",
    label: "MY RESUME (BETA)",
    type: "game",
    body: "Loading resume data...",
  },
  {
    key: "follow",
    label: "FOLLOW ME",
    type: "text",
    // TODO: "github.com/yourprofile" is still a literal placeholder —
    // swap in the real GitHub handle before treating this as final copy.
    body: "LINKEDIN:\nlinkedin.com/in/\nmoule023\n\nGITHUB:\ngithub.com/\nyourprofile\n\n(more links soon)",
  },
  {
    key: "hire",
    label: "HIRE ME",
    type: "mail",
    mailto: HIRE_MAILTO,
    body: "Opening your mail app\nwith a message ready\nfor:\ndesign.miora.info@\ngmail.com",
  },
];

class GameboyScreen extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.selectedIndex = 0;
  }

  static get styles() {
    return /* css */`
      :host {
        --width: 210px;
        --height: 180px;
        display: block;
        width: var(--width);
        height: var(--height);
      }
      .container {
        background: var(--gb-screen-off, #9ca04c);
        width: 100%;
        height: 100%;
        box-shadow:
          5px 5px 10px #0008 inset,
          -2px -1px 10px #0005 inset,
          0 0 4px 3px #aaa4;
        position: relative;
        overflow: hidden;
        transition: background 0.4s ease, filter 0.4s ease;
      }
      .container.on {
        background: var(--gb-screen-on, #c7d089);
      }
      .container.flicker {
        animation: gbFlicker 0.45s steps(3, end);
      }
      @keyframes gbFlicker {
        0% { filter: brightness(2.4); }
        25% { filter: brightness(0.5); }
        50% { filter: brightness(1.8); }
        75% { filter: brightness(0.8); }
        100% { filter: brightness(1); }
      }
      .scanlines {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to bottom,
          rgba(30, 40, 10, 0.09) 0px,
          rgba(30, 40, 10, 0.09) 1px,
          transparent 1px,
          transparent 2px
        );
        mix-blend-mode: multiply;
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      .container.on .scanlines { opacity: 1; }
      .glare {
        position: absolute;
        inset: -10% -10%;
        background: linear-gradient(115deg, rgba(255,255,255,0.14) 0%, transparent 30%);
        pointer-events: none;
      }
      .content {
        position: absolute;
        inset: 0;
        padding: 10px 12px;
        font-family: "Press Start 2P", monospace;
        color: var(--gb-screen-ink, #33361f);
        font-size: 7px;
        line-height: 1.5;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.15s ease, transform 0.15s ease;
        display: flex;
        flex-direction: column;
      }
      .content.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .boot-view {
        margin: auto;
        text-align: center;
      }
      .boot-view.logo {
        font-size: 11px;
        font-weight: bold;
        animation: gbLogoIn 0.5s ease-out;
      }
      .boot-view.logo sup {
        font-size: 6px;
      }
      @keyframes gbLogoIn {
        0% { transform: translateY(-40px) scale(0.6); opacity: 0; }
        60% { transform: translateY(4px) scale(1.05); opacity: 1; }
        100% { transform: translateY(0) scale(1); }
      }
      .boot-view.credits {
        font-size: 6px;
        line-height: 2.1;
        opacity: 0;
        animation: gbFadeIn 0.4s ease forwards;
      }
      .boot-view.title {
        font-size: 9px;
        line-height: 2.2;
      }
      @keyframes gbFadeIn {
        to { opacity: 1; }
      }
      .blink {
        animation: gbBlink 1s steps(1, end) infinite;
      }
      @keyframes gbBlink {
        50% { opacity: 0; }
      }
      .player-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .hearts { letter-spacing: 2px; }
      .player-card {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
      }
      .avatar { position: relative; width: 14px; height: 14px; flex-shrink: 0; }
      .avatar::before {
        content: "";
        position: absolute;
        top: 0; left: 4px;
        width: 6px; height: 6px;
        background: var(--gb-screen-ink, #33361f);
      }
      .avatar::after {
        content: "";
        position: absolute;
        bottom: 0; left: 0;
        width: 14px; height: 7px;
        background: var(--gb-screen-ink, #33361f);
      }
      .player-name { font-size: 7.5px; }
      .player-role { font-size: 5.5px; margin-top: 3px; color: var(--gb-screen-ink-soft, #4c5030); }
      .menu-list {
        position: relative;
        flex: 1;
      }
      .cursor-bar {
        position: absolute;
        left: -12px;
        right: -12px;
        top: 0;
        height: ${ROW_H}px;
        background: var(--gb-screen-ink, #33361f);
        transition: transform 0.16s cubic-bezier(.3,.9,.4,1);
        z-index: 0;
      }
      .menu-row {
        position: relative;
        z-index: 1;
        height: ${ROW_H}px;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0 12px;
        color: var(--gb-screen-ink, #33361f);
        transition: color 0.12s ease;
      }
      .menu-row.active { color: var(--gb-screen-on, #c7d089); }
      .menu-row .arrow { width: 8px; opacity: 0; transform: translateX(-2px); transition: opacity 0.12s ease, transform 0.12s ease; }
      .menu-row.active .arrow { opacity: 1; transform: translateX(0); }
      .menu-row .label { flex: 1; }
      .menu-row .num { opacity: 0.7; }
      .screen-footer {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--gb-screen-ink-soft, #4c5030);
        font-size: 5.5px;
        display: flex;
        gap: 4px;
      }
      .detail-title {
        font-size: 8px;
        margin-bottom: 6px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--gb-screen-ink-soft, #4c5030);
      }
      .detail-body {
        white-space: pre-line;
        flex: 1;
        font-size: 6.5px;
        line-height: 1.9;
      }
      .content.game-mode {
        padding: 0;
      }
      .game-canvas {
        width: 100%;
        height: 100%;
        display: block;
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
    `;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>${GameboyScreen.styles}</style>
    <div class="container" id="container">
      <div class="glare"></div>
      <div class="scanlines"></div>
      <div class="content" id="content"></div>
    </div>`;
    this.containerEl = this.shadowRoot.getElementById("container");
    this.contentEl = this.shadowRoot.getElementById("content");
  }

  setPowered(on) {
    this.containerEl.classList.toggle("on", on);
    if (on) {
      this.containerEl.classList.add("flicker");
      setTimeout(() => this.containerEl.classList.remove("flicker"), 450);
    } else {
      this._swap(() => { this.contentEl.innerHTML = ""; });
    }
  }

  _swap(renderFn) {
    this.contentEl.classList.remove("visible");
    this.contentEl.classList.remove("game-mode");
    setTimeout(() => {
      renderFn();
      requestAnimationFrame(() => this.contentEl.classList.add("visible"));
    }, 130);
  }

  showGameView(onReady) {
    this.contentEl.classList.remove("visible");
    setTimeout(() => {
      this.contentEl.classList.add("game-mode");
      this.contentEl.innerHTML = `<canvas class="game-canvas" id="gameCanvas" width="160" height="144"></canvas>`;
      this.gameCanvas = this.contentEl.querySelector("#gameCanvas");
      requestAnimationFrame(() => this.contentEl.classList.add("visible"));
      if (onReady) onReady(this.gameCanvas);
    }, 130);
  }

  showBoot() {
    this._swap(() => {
      this.contentEl.innerHTML = `<div class="boot-view logo">MOULEESHWARAN<sup>®</sup></div>`;
    });
    chime();

    this._bootStage1 = setTimeout(() => {
      this._swap(() => {
        this.contentEl.innerHTML = `
          <div class="boot-view credits">
            PORTFOLIO SYSTEM<br>
            © 2026 MOULEESHWARAN<br>
            ALL RIGHTS RESERVED
          </div>`;
      });
    }, 1300);

    this._bootStage2 = setTimeout(() => {
      this._swap(() => {
        this.contentEl.innerHTML = `
          <div class="boot-view title">
            PORTFOLIO<br>
            <span class="blink">PRESS START</span>
          </div>`;
      });
    }, 2300);
  }

  cancelBoot() {
    clearTimeout(this._bootStage1);
    clearTimeout(this._bootStage2);
  }

  showMenu(selectedIndex) {
    this.selectedIndex = selectedIndex;
    this._swap(() => {
      const rows = MENU.map((item, i) => `
        <div class="menu-row ${i === selectedIndex ? "active" : ""}" data-i="${i}">
          <span class="arrow">▶</span>
          <span class="label">${item.label}</span>
          <span class="num">0${i + 1}</span>
        </div>`).join("");

      this.contentEl.innerHTML = `
        <div class="player-row">
          <span>PLAYER 01</span>
          <span class="hearts">&hearts; &hearts; &hearts;</span>
        </div>
        <div class="player-card">
          <div class="avatar"></div>
          <div>
            <div class="player-name">${PLAYER_NAME}</div>
            <div class="player-role">${PLAYER_ROLE}</div>
          </div>
        </div>
        <div class="menu-list">
          <div class="cursor-bar" style="transform: translateY(${selectedIndex * ROW_H}px)"></div>
          ${rows}
        </div>
        <div class="screen-footer"><span class="blink">■</span> A LITTLE CURIOUS? PRESS A.</div>`;

      this.cursorBar = this.contentEl.querySelector(".cursor-bar");
      this.menuRows = [...this.contentEl.querySelectorAll(".menu-row")];
    });
  }

  moveCursor(selectedIndex) {
    this.selectedIndex = selectedIndex;
    if (!this.cursorBar) return;
    this.cursorBar.style.transform = `translateY(${selectedIndex * ROW_H}px)`;
    this.menuRows.forEach((row, i) => row.classList.toggle("active", i === selectedIndex));
  }

  showDetail(index) {
    const item = MENU[index];
    this._swap(() => {
      this.contentEl.innerHTML = `
        <div class="detail-title">${item.label}</div>
        <div class="detail-body">${item.body}</div>
        <div class="screen-footer"><span class="blink">■</span> PRESS B TO GO BACK.</div>`;
    });
  }
}
customElements.define("gameboy-screen", GameboyScreen);

// ---------- SELECT / START pill buttons ----------
// Rotated capsule buttons. SELECT exits the embedded game back to the
// menu; START skips the boot animation straight to the menu.

class GameboyOptionButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.name = this.getAttribute("name");
    this.action = this.getAttribute("action") || this.name.toLowerCase();
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { --width: 50px; --height: 12px; display: block; }
      .wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        transform: rotate(-28deg);
      }
      .container {
        background: linear-gradient(to top, #EFF2F0, #AE9FA6);
        box-shadow: -4px 4px 3px -3px #0005 inset, 4px -4px 3px -3px #fffc inset;
        border-radius: 15px;
        padding: 1px 0;
        transition: transform 0.08s ease, box-shadow 0.08s ease;
        cursor: pointer;
      }
      .container.pressed {
        transform: translateY(2px) scale(0.96);
        box-shadow: -2px 2px 2px -2px #0007 inset;
      }
      .button {
        background: #9e9baf;
        background-image: linear-gradient(#C0BECA, #7F7584);
        border-radius: 10px;
        box-shadow:
          -2px -2px 5px #0004 inset, 2px 2px 5px #fff3 inset,
          2px 2px 6px #0007, -1px 2px 3px #000d;
        width: var(--width);
        height: var(--height);
        margin: 3px 6px;
      }
      .label {
        font-family: "Press Start 2P", monospace;
        font-size: 7px;
        letter-spacing: 0.5px;
        color: #302058;
        text-align: center;
        pointer-events: none;
      }
    </style>
    <div class="wrap" id="wrap">
      <div class="container" id="container">
        <div class="button"></div>
      </div>
      <div class="label">${this.name}</div>
    </div>`;

    this.containerEl = this.shadowRoot.getElementById("container");
    this.containerEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.containerEl.classList.add("pressed");
      haptic(6);
      fireAction(this, this.action);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
      this.containerEl.addEventListener(evt, () => this.containerEl.classList.remove("pressed"))
    );
  }

  flash() {
    this.containerEl.classList.add("pressed");
    setTimeout(() => this.containerEl.classList.remove("pressed"), 100);
  }
}
customElements.define("gameboy-option-button", GameboyOptionButton);

// ---------- Battery LED + dot-matrix label + screen ----------
// The "crystal" is the whole screen bezel assembly: the dot-matrix top
// label, the pulsing battery LED (flashes on skin change), and the
// <gameboy-screen> itself nested inside it.

class GameboyCrystal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { --width: 330px; --height: 240px; display: block; width: var(--width); height: var(--height); }
      .container {
        background-color: var(--gb-crystal-bg, #737488);
        width: 100%;
        height: 100%;
        border-radius: 10px 10px 35px 10px;
        border: 1px solid #666;
        border-width: 0 1px 0 1px;
        box-shadow:
          0 0 2px #514c65, 0 -1px 1px #161118, 0 -2px 1px #A0939F,
          0 -4px 1px #514c65, 0 0 2px 2px #9C99AC88 inset, 0 -1px 2px 1px #0006 inset;
      }
      .top {
        background: linear-gradient(
          transparent 10px, var(--gb-line1, #7d1a4a) 11px 12px, transparent 12px 16px,
          var(--gb-line2, #35224e) 16px 18px, transparent 18px
        );
        position: relative;
        height: 26px;
        margin: 0 15px;
      }
      .top span {
        padding: 0 8px;
        background: var(--gb-crystal-bg, #767189);
        position: absolute;
        right: 40px;
        top: 8px;
        font-family: Arial, sans-serif;
        font-size: 9.5px;
        color: #eee;
        text-shadow: 0 0 2px #eee9;
      }
      .bottom { display: flex; }
      .battery {
        padding: 0 10px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        transform: translateY(-20px);
      }
      .battery .led {
        width: 10px; height: 10px;
        background: #4a4748;
        border-radius: 50%;
        margin: 6px;
        transition: background 0.3s ease, box-shadow 0.3s ease;
      }
      .battery .led.on {
        background: var(--gb-led-on, #E11E0A);
        background-image: linear-gradient(0deg, transparent, #fff2);
        box-shadow: 0 0 2px 1.5px var(--gb-led-glow, #d87473);
        animation: ledPulse 2.4s ease-in-out infinite;
      }
      @keyframes ledPulse {
        0%, 100% { box-shadow: 0 0 2px 1.5px var(--gb-led-glow, #d87473); }
        50% { box-shadow: 0 0 4px 3px var(--gb-led-glow, #ff8f8b); }
      }
      .battery .led.flash {
        animation: ledFlash 0.9s ease-out;
      }
      @keyframes ledFlash {
        0% { box-shadow: 0 0 0 0 var(--gb-led-glow, #ff6b6b); }
        25% { box-shadow: 0 0 12px 7px var(--gb-led-glow, #ff6b6b); }
        100% { box-shadow: 0 0 0 0 var(--gb-led-glow, #ff6b6b); }
      }
      .battery .text {
        font-family: Arial, sans-serif;
        font-size: 8px;
        color: #eee;
      }
      gameboy-screen { transform: translate(2px, 2px); }
    </style>
    <div class="container" id="container">
      <div class="top"><span>DOT MATRIX WITH STEREO SOUND</span></div>
      <div class="bottom">
        <div class="battery">
          <div class="led" id="led"></div>
          <div class="text">BATTERY</div>
        </div>
        <gameboy-screen id="screen"></gameboy-screen>
      </div>
    </div>`;

    this.led = this.shadowRoot.getElementById("led");
    this.screen = this.shadowRoot.getElementById("screen");
  }

  setPowered(on) {
    this.led.classList.toggle("on", on);
    this.screen.setPowered(on);
  }

  flashBattery() {
    this.led.classList.remove("flash");
    void this.led.offsetWidth; // restart animation if triggered again quickly
    this.led.classList.add("flash");
    setTimeout(() => this.led.classList.remove("flash"), 900);
  }
}
customElements.define("gameboy-crystal", GameboyCrystal);

// ---------- D-pad ----------
// Layout uses CSS Grid (grid-template-areas), adapted from ManzDev's
// earlier gameboycss project — far more robust than manual absolute
// positioning: each direction is a real grid cell, centering is
// guaranteed by the grid itself rather than a flex/positioning quirk.
//
// HIGHLIGHT: each arm fires two kinds of events on press — a one-shot
// "dir" (used for menu cursor movement and in-game jump) plus a held
// "dirhold"/"dirrelease" pair (used for continuous left/right movement
// while playing the embedded game). See GameboyConsole.setGameHold().

class GameboyCross extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { --size: 120px; display: block; width: var(--size); height: var(--size); }
      .pad {
        width: 100%; height: 100%;
        background: #CFC8D1;
        background-image: radial-gradient(#0003 1%, transparent), linear-gradient(50deg, #E1DEEA 10%, #D9D2D5 90%);
        border-radius: 50%;
        box-sizing: border-box;
        padding: 15px;
        display: grid;
        grid-template-columns: 1fr 1.3fr 1fr;
        grid-template-rows: 1fr 1.3fr 1fr;
        grid-template-areas:          ".    up    ."
          "left center right"
          ".    down  .";
      }
      .arm {
        background: #1c1c1e;
        border: none;
        padding: 0;
        cursor: pointer;
        box-shadow: 0 0 0 2px #000, 0 3px 2px rgba(0, 0, 0, 0.55);
        transition: box-shadow 0.06s ease, transform 0.06s ease;
      }
      .arm.up { grid-area: up; border-radius: 4px 4px 0 0; }
      .arm.down { grid-area: down; border-radius: 0 0 4px 4px; }
      .arm.left { grid-area: left; border-radius: 4px 0 0 4px; }
      .arm.right { grid-area: right; border-radius: 0 4px 4px 0; }
      .arm.pressed {
        box-shadow: 0 0 0 2px #000, inset 0 2px 5px rgba(0, 0, 0, 0.7);
        transform: scale(0.94);
      }
      .center {
        grid-area: center;
        background: #1c1c1e;
        box-shadow: 0 0 0 2px #000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .center .gap {
        width: 68%;
        height: 68%;
        border-radius: 50%;
        background: conic-gradient(#DDE8F777 0 1%, transparent 10% 35%, #DDE8F7 50%, transparent 65% 90%, #DDE8F777 99%);
      }
    </style>
    <div class="pad" id="pad">
      <button class="arm up" data-dir="up"></button>
      <button class="arm left" data-dir="left"></button>
      <div class="center"><div class="gap"></div></div>
      <button class="arm right" data-dir="right"></button>
      <button class="arm down" data-dir="down"></button>
    </div>`;

    this.shadowRoot.querySelectorAll(".arm").forEach((arm) => {
      const dir = arm.dataset.dir;
      arm.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        arm.classList.add("pressed");
        haptic(6);
        fireAction(this, "dir", dir);
        fireAction(this, "dirhold", dir);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
        arm.addEventListener(evt, () => {
          arm.classList.remove("pressed");
          fireAction(this, "dirrelease", dir);
        })
      );
    });
  }
}
customElements.define("gameboy-cross", GameboyCross);

// ---------- A / B round buttons ----------
// A: confirm/jump. B: back-out-of-detail-screen, or hold-to-run in-game.
// Both press and release are dispatched (see "…up" actions) because the
// embedded game needs to know when B is released to stop running.

class GameboyButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.name = this.getAttribute("name");
    this.action = this.name.toLowerCase();
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { --size: 47px; display: block; }
      .wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
      }
      .container {
        width: var(--size); height: var(--size);
        border-radius: 50%;
        background: var(--gb-btn-bg, radial-gradient(26px 26px at 24px 27px, #6F0119 75%, #A20D37 90%, #EF94B2));
        box-shadow: 1px -4px 0 -3px #7c4b5b inset, -3px 7px 5px -2px #1e0009, 1px -1px 0 2px #53182b;
        transition: transform 0.08s ease, box-shadow 0.08s ease;
        cursor: pointer;
      }
      .container.pressed {
        transform: translateY(3px) scale(0.96);
        box-shadow: 1px -1px 0 -1px #7c4b5b inset, -1px 2px 3px -1px #1e0009, 1px -1px 0 1px #53182b;
      }
      .label {
        font-family: "Press Start 2P", monospace;
        font-size: 11px;
        color: #302058;
        text-align: center;
        pointer-events: none;
      }
    </style>
    <div class="wrap" id="wrap">
      <div class="container" id="container"></div>
      <div class="label">${this.name}</div>
    </div>`;

    this.containerEl = this.shadowRoot.getElementById("container");
    this.containerEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.containerEl.classList.add("pressed");
      haptic(10);
      fireAction(this, this.action);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
      this.containerEl.addEventListener(evt, () => {
        this.containerEl.classList.remove("pressed");
        fireAction(this, this.action + "up");
      })
    );
  }

  flash() {
    this.containerEl.classList.add("pressed");
    setTimeout(() => this.containerEl.classList.remove("pressed"), 120);
  }
}
customElements.define("gameboy-button", GameboyButton);

// ---------- Embedded platformer: "MY RESUME (BETA)" ----------
// A small side-scrolling platformer that turns the career timeline into
// four collectible data crystals (Amazon -> Bharathi -> Accenture -> Apple,
// oldest to current). Runs on its own <canvas> mounted inside the
// console's screen, driven entirely by the console's own D-pad/A/B/Select
// so it plays like a cartridge rather than a separate page. Uses the
// classic fixed 4-shade Game Boy green palette (not the console's own
// Classic/Vintage skin colors) so the cartridge always reads as authentic
// DMG green, and a bordered RPG-style textbox for crystal lore/dialogue.
//
// HIGHLIGHT: control scheme is intentionally simplified (D-pad move, A/Up
// jump, B hold-to-run, Select exit) rather than a full move-set (dash,
// attack, wall-jump, boss fight) — this keeps a one-way-platform collision
// model reliable at 160x144 with the console's own physical buttons.

function createPortfolioGame(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 160 — native Game Boy resolution
  const H = canvas.height;  // 144

  // Fixed DMG (original Game Boy) 4-shade green palette — deliberately
  // NOT tied to the console's Classic/Vintage --gb-screen-* variables,
  // so the cartridge itself always looks like real Game Boy hardware.
  const GB_LIGHTEST = "#9bbc0f";
  const GB_LIGHT = "#8bac0f";
  const GB_DARK = "#306230";
  const GB_DARKEST = "#0f380f";

  const GRAVITY = 700;
  const MOVE_SPEED = 68;
  const RUN_SPEED = 128;
  const JUMP_V = 290;
  const WORLD_W = 1400;
  const GROUND_Y = 120;

  // Four ground segments with gaps between them (fall in = respawn).
  const grounds = [
    { x: 0, w: 300 },
    { x: 340, w: 300 },
    { x: 680, w: 300 },
    { x: 1020, w: 380 },
  ].map((g) => ({ x: g.x, y: GROUND_Y, w: g.w, h: H - GROUND_Y }));

  // One floating platform per career stop, each holding that stop's crystal.
  const platforms = [
    { x: 120, y: 80, w: 50, h: 8 },
    { x: 420, y: 70, w: 50, h: 8 },
    { x: 760, y: 75, w: 50, h: 8 },
    { x: 1100, y: 65, w: 50, h: 8 },
  ];

  // HIGHLIGHT: grounds + platforms are treated as one-way "land on top
  // only" solids (see the landing check in update()) — there's no side
  // or ceiling collision. That's a deliberate simplification, not a bug:
  // it keeps movement predictable in such a small world.
  const solids = [...grounds, ...platforms];

  // Resume facts, told in chronological order as you move right through
  // the level. Keep these in sync with the resume text used elsewhere
  // (the ABOUT ME / FOLLOW ME menu copy) if either one changes.
  const crystals = [
    { x: 140, y: 64, got: false, title: "AMAZON · 2019–2021", lines: ["Digital Associate.", "CV annotation for ML +", "custom vanilla-JS QC", "scripts to speed up team."] },
    { x: 440, y: 54, got: false, title: "BHARATHI WEB · 2021–22", lines: ["Web Developer.", "Legacy HTML/CSS refactors,", "client builds & brand /", "social media graphics."] },
    { x: 780, y: 59, got: false, title: "ACCENTURE · 2022–2023", lines: ["Web Developer.", "AEM authoring, Figma-to-", "component, Azure DevOps", "bug-resolution tracking."] },
    { x: 1120, y: 49, got: false, title: "APPLE · 2023–PRESENT", lines: ["Content Ops Specialist.", "DRI for multilingual CMS /", "AEM launches + GenAI", "(Claude, Gemini) tooling."] },
  ];

  const ZONES = [
    { x: 0, name: "2019 · AMAZON" },
    { x: 340, name: "2021 · BHARATHI WEB" },
    { x: 680, name: "2022 · ACCENTURE" },
    { x: 1020, name: "2023 · APPLE" },
  ];

  const enemies = [
    { x: 400, y: 108, w: 12, h: 12, minX: 360, maxX: 600, dir: 1, dead: false },
    { x: 1080, y: 108, w: 12, h: 12, minX: 1060, maxX: 1340, dir: -1, dead: false },
  ];

  const flag = { x: 1370, y: 64, w: 8, h: 56 };
  const SPAWN = { x: 16, y: 96 };
  const player = { x: SPAWN.x, y: SPAWN.y, w: 8, h: 12, vx: 0, vy: 0, onGround: false, facing: 1 };
  const hold = { left: false, right: false, run: false };
  const camera = { x: 0 };

  let gameState = "PLAYING";
  let dialogue = null;
  let flagTouched = false;
  let introTimer = 2.4;
  let victoryTimer = 0;
  let animT = 0;
  let rafId = null;
  let lastTime = 0;
  let running = false;

  function setHold(key, isDown) {
    if (key in hold) hold[key] = isDown;
  }

  function jump() {
    if (dialogue) {
      dialogue = null;
      beep(300, 0.05, "square", 0.04);
      return;
    }
    if (gameState !== "PLAYING") return;
    if (player.onGround) {
      player.vy = -JUMP_V;
      player.onGround = false;
      beep(520, 0.07, "square", 0.05);
    }
  }

  function showDialogue(title, lines) {
    dialogue = { title, lines };
  }

  function respawn() {
    player.x = SPAWN.x;
    player.y = SPAWN.y;
    player.vx = 0;
    player.vy = 0;
    beep(160, 0.15, "sawtooth", 0.05);
  }

  function overlap(a, b, aw, ah, bw, bh) {
    return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
  }

  function playFanfareSimple() {
    beep(523, 0.1, "square", 0.06);
    setTimeout(() => beep(659, 0.1, "square", 0.06), 100);
    setTimeout(() => beep(784, 0.16, "square", 0.06), 200);
  }

  function update(dt) {
    animT += dt;
    if (introTimer > 0) introTimer -= dt;

    if (gameState === "VICTORY") {
      victoryTimer -= dt;
      if (victoryTimer <= 0 && opts.onExit) opts.onExit();
      return;
    }

    if (dialogue) return; // textbox pauses the action, classic RPG-style

    let moveDir = 0;
    if (hold.left) moveDir -= 1;
    if (hold.right) moveDir += 1;
    const speed = hold.run ? RUN_SPEED : MOVE_SPEED;
    player.vx = moveDir * speed;
    if (moveDir !== 0) player.facing = moveDir;
    player.x += player.vx * dt;
    player.x = Math.max(0, Math.min(WORLD_W - player.w, player.x));

    player.vy += GRAVITY * dt;
    if (player.vy > 500) player.vy = 500;
    player.y += player.vy * dt;

    player.onGround = false;
    for (const s of solids) {
      // HIGHLIGHT: "did the foot cross the platform top this frame?" check
      // — footPrev is reconstructed from the position *before* this
      // frame's gravity step, so a fast fall can't tunnel through a thin
      // platform without ever satisfying footPrev <= top.
      const footPrev = player.y + player.h - player.vy * dt;
      const foot = player.y + player.h;
      const horiz = player.x + player.w > s.x && player.x < s.x + s.w;
      if (horiz && player.vy >= 0 && footPrev <= s.y + 1 && foot >= s.y) {
        player.y = s.y - player.h;
        player.vy = 0;
        player.onGround = true;
      }
    }

    if (player.y > H + 20) respawn();

    for (const e of enemies) {
      if (e.dead) continue;
      e.x += e.dir * 26 * dt;
      if (e.x < e.minX) { e.x = e.minX; e.dir = 1; }
      if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1; }
      if (overlap(player, e, player.w, player.h, e.w, e.h)) {
        if (player.vy > 0 && player.y + player.h - e.y < 6) {
          e.dead = true;
          player.vy = -180;
          beep(700, 0.06, "square", 0.05);
        } else {
          respawn();
        }
      }
    }

    for (const c of crystals) {
      if (c.got) continue;
      if (overlap(player, c, player.w, player.h, 8, 8)) {
        c.got = true;
        chime();
        showDialogue(c.title, c.lines);
      }
    }

    const touchingFlag = gameState === "PLAYING" && overlap(player, flag, player.w, player.h, flag.w, flag.h);
    if (touchingFlag && !flagTouched) {
      flagTouched = true;
      const count = crystals.filter((c) => c.got).length;
      if (count === crystals.length) {
        gameState = "VICTORY";
        victoryTimer = 4.2;
        showDialogue("RESUME COMPLETE!", [
          "7+ years across Apple,",
          "Accenture, Amazon & more.",
          "Thanks for playing — press",
          "HIRE ME to say hello!",
        ]);
        playFanfareSimple();
      } else {
        showDialogue("LOCKED", [
          `Collected ${count}/4 data`,
          "crystals so far. Explore",
          "the career timeline first!",
        ]);
      }
    } else if (!touchingFlag) {
      flagTouched = false;
    }

    camera.x = Math.max(0, Math.min(WORLD_W - W, player.x - W * 0.4));
  }

  function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x - camera.x), Math.round(y), w, h);
  }

  function drawText(text, x, y, color, size = 6) {
    ctx.fillStyle = color;
    ctx.font = `${size}px "Press Start 2P", monospace`;
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
  }

  function drawHud(zoneName, count) {
    drawRect(camera.x, 0, W, 9, GB_DARKEST);
    drawText(zoneName, 3, 2, GB_LIGHTEST, 5);
    ctx.save();
    ctx.translate(W - 44, 4.5);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = GB_LIGHTEST;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    drawText(`x${count}/4`, W - 36, 2, GB_LIGHTEST, 5);
  }

  function drawTextbox(title, lines) {
    const boxY = H - 46;
    drawRect(camera.x, boxY, W, 46, GB_DARKEST);
    drawRect(camera.x + 2, boxY + 2, W - 4, 42, GB_LIGHTEST);
    drawRect(camera.x + 4, boxY - 4, title.length * 4 + 8, 10, GB_DARKEST);
    drawText(title, 8, boxY - 3, GB_LIGHTEST, 5);
    lines.forEach((line, i) => drawText(line, 8, boxY + 10 + i * 8, GB_DARKEST, 5));
    if (Math.floor(animT * 2) % 2 === 0) drawText("▼", W - 12, boxY + 36, GB_DARKEST, 6);
  }

  function render() {
    ctx.fillStyle = GB_LIGHTEST;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = GB_LIGHT;
    for (let i = 0; i < 6; i++) {
      const hx = ((i * 260 - camera.x * 0.4) % (W + 260) + (W + 260)) % (W + 260) - 260;
      ctx.fillRect(hx, 96, 90, 24);
    }

    for (const s of solids) {
      drawRect(s.x, s.y, s.w, s.h, GB_DARK);
      drawRect(s.x, s.y, s.w, 2, GB_LIGHT);
    }

    const count = crystals.filter((c) => c.got).length;
    const unlocked = count === crystals.length;
    drawRect(flag.x, flag.y, 2, flag.h, GB_DARKEST);
    drawRect(flag.x - 6, flag.y, 8, 6, unlocked ? (Math.floor(animT * 4) % 2 === 0 ? GB_LIGHTEST : GB_LIGHT) : GB_DARK);

    for (const c of crystals) {
      if (c.got) continue;
      const bob = Math.sin(animT * 3 + c.x) * 2;
      ctx.save();
      ctx.translate(c.x + 4 - camera.x, c.y + 4 + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = GB_DARKEST;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = GB_LIGHTEST;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    for (const e of enemies) {
      if (e.dead) continue;
      drawRect(e.x, e.y, e.w, e.h, GB_DARKEST);
      drawRect(e.x + (e.dir > 0 ? e.w - 4 : 2), e.y + 3, 2, 2, GB_LIGHTEST);
    }

    const px = player.x - camera.x;
    ctx.fillStyle = GB_DARKEST;
    ctx.fillRect(Math.round(px), Math.round(player.y), player.w, player.h);
    ctx.fillStyle = GB_LIGHTEST;
    ctx.fillRect(Math.round(px + (player.facing > 0 ? player.w - 2 : 0)), Math.round(player.y + 2), 2, 2);

    const zone = [...ZONES].reverse().find((z) => player.x >= z.x) || ZONES[0];
    drawHud(zone.name, count);

    if (introTimer > 0) {
      ctx.globalAlpha = Math.min(1, introTimer);
      drawRect(camera.x, H - 24, W, 24, GB_DARKEST);
      drawText("<>:MOVE  A/^:JUMP", 8, H - 20, GB_LIGHTEST, 5);
      drawText("B:RUN    SELECT:EXIT", 8, H - 10, GB_LIGHTEST, 5);
      ctx.globalAlpha = 1;
    }

    if (dialogue) drawTextbox(dialogue.title, dialogue.lines);
  }

  function loop(t) {
    if (!running) return; // stop() may have been called synchronously from inside update() (e.g. the victory auto-exit) — don't reschedule
    if (!lastTime) lastTime = t;
    const dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;
    update(dt);
    if (!running) return; // re-check: update() itself may have called stop()
    render();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return { setHold, jump, start, stop };
}

// ---------- Console: the whole device + state machine ----------
// Owns the entire interaction model as a single state machine:
//   off -> boot -> menu -> detail   (About Me / Follow Me / Hire Me)
//                       -> game     (My Resume (Beta), see startGame())
// Every physical control (power switch, D-pad, A/B, Select/Start, skin
// toggle) reports through here — this class decides what a given button
// press means for the current state, nothing below it does.

class GameboyConsole extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.powered = false;
    this.state = "off"; // off -> boot -> menu -> detail -> game
    this.selectedIndex = 0;
    this.game = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = /* html */`
    <style>
      :host { --width: 380px; --height: 625px; --gameboy-bgcolor: #d7d2d8; display: block; }
      /* HIGHLIGHT: this is the entire skin system. Every --gb-* variable
         set here cascades down through every nested custom element's
         shadow root (CSS custom properties are inherited properties, so
         shadow-DOM boundaries don't block them) — GameboyCrystal,
         GameboyScreen, GameboyButton, etc. all read these same variables
         via var(--gb-x, fallback). Adding a third skin means adding one
         more :host([skin="..."]) block here; nothing else needs to change. */
      :host([skin="vintage"]) {
        --gameboy-bgcolor: #F0EDE5;
        --gb-btn-bg: radial-gradient(26px 26px at 24px 27px, #5c2423 75%, #B54745 90%, #e2a6a5);
        --gb-crystal-bg: #1F3345;
        --gb-line1: #B54745;
        --gb-line2: #C78F57;
        --gb-screen-off: #5c8484;
        --gb-screen-on: #85ABAB;
        --gb-screen-ink: #1F3345;
        --gb-screen-ink-soft: #3f5a5a;
        --gb-led-on: #B54745;
        --gb-led-glow: #e2a6a5;
        --gb-vent-color: rgba(31, 51, 69, 0.5);
        --gb-brand-color: #1F3345;
      }
      .container {
        --gameboy-bottom-depth: linear-gradient(transparent 97.75%, #0004 98.5%, #0005 99%);
        width: var(--width); height: var(--height);
        background-color: var(--gameboy-bgcolor);
        background-image: linear-gradient(-31deg, #8b8b8b 0 75px, transparent 80px), var(--gameboy-bottom-depth);
        border-radius: 12px 12px 75px 12px;
        box-shadow: 0 0 10px #0007, 1px 0 10px 3px #0008 inset;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        position: relative;
        user-select: none;
        transition: background-color 0.4s ease;
      }
      .screen-container {
        height: 325px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        padding: 0 25px;
        border-top: 1px solid #fff8;
      }
      .brand { color: var(--gb-brand-color, #332C60); padding-top: 4px; text-shadow: 0 0 1px #30205855; transition: color 0.4s ease; }
      .brand .company { font-family: "Press Start 2P", monospace; font-size: 10px; letter-spacing: 0.5px; }
      .brand .product { font-family: Georgia, serif; font-size: 23px; font-weight: bold; font-style: italic; }
      .brand sub { display: inline-block; font-family: Georgia, serif; font-size: 15px; transform: translateY(2px); }

      /* ---- Skin toggle switch ----
         Adapted from a Uiverse.io toggle by JaydipPrajapati1910,
         scaled down and embedded directly into the shell next to
         the brand text, in the console's own plastic tones. */
      .skin-toggle {
        position: absolute;
        left: 255px;
        top: 319px;
        width: 64px;
        height: 16px;
        background-color: rgba(0, 0, 0, 0.22);
        border-radius: 9px;
        border: 1.5px solid rgba(58, 58, 58, 0.18);
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.5) inset;
        z-index: 3;
      }
      .skin-toggle-check {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .skin-toggle-label {
        cursor: pointer;
        display: block;
        width: 60px;
        height: 12px;
        margin: 0 auto;
        position: relative;
        text-indent: -9999px;
      }
      .skin-toggle-label::before {
        content: "";
        display: block;
        position: absolute;
        left: -10px;
        top: 3.5px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, #ff8a8a, #b5302f 100%);
        border: 1px solid #742323;
        box-shadow: 0 1px 1px rgba(255, 67, 48, 0.6), 0 0 2px rgba(255, 159, 109, 0.5) inset;
        transition: all 0.2s;
        z-index: 4;
      }
      .skin-toggle-label::after {
        content: "";
        display: block;
        position: absolute;
        right: -10px;
        top: 3.5px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, rgba(140, 140, 140, 0.7), rgba(70, 70, 70, 0.7) 100%);
        border: 1px solid #111;
        box-shadow: 0 1px 1px rgba(20, 20, 20, 0.5);
        transition: all 0.2s;
        z-index: 4;
      }
      .skin-toggle-label span {
        display: block;
        position: absolute;
        top: 1px;
        left: 1px;
        width: 26px;
        height: 10px;
        border-radius: 8px;
        background: linear-gradient(#4f4f4f, #2b2b2b);
        border: 1px solid #1a1a1a;
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.5), 0 1px 1px rgba(255, 255, 255, 0.1) inset, 0 -1px 0 rgba(0, 0, 0, 0.2) inset;
        transition: left 0.2s linear;
      }
      .skin-toggle-check:checked + .skin-toggle-label span {
        left: 33px;
      }
      .skin-toggle-check:checked + .skin-toggle-label::before {
        background: radial-gradient(circle at 40% 35%, rgba(140, 140, 140, 0.7), rgba(70, 70, 70, 0.7) 100%);
        border: 1px solid #111;
        box-shadow: 0 1px 1px rgba(20, 20, 20, 0.5);
      }
      .skin-toggle-check:checked + .skin-toggle-label::after {
        background: radial-gradient(circle at 40% 35%, #b9ffb9, #4caf50 100%);
        border: 1px solid #1c5b1f;
        box-shadow: 0 1px 3px #4caf50, 0 0 3px #4caf50 inset;
      }
      .controls-container { height: 275px; display: flex; flex-direction: column; align-items: center; }
      .controls { display: flex; justify-content: space-between; align-items: center; width: 100%; height: 140px; padding: 0 22px; box-sizing: border-box; }
      .controls gameboy-cross { width: 130px; height: 130px; }
      .controls .buttons {
        width: 140px; height: 68px;
        background: linear-gradient(10deg, #EFF2F099, #AE9FA699);
        box-shadow: 0 0 4px 2px #ccc, 0 20px 4px -2px #6661 inset;
        border-radius: 40px;
        transform: translateY(30px) rotate(-25deg);
        display: flex; justify-content: space-between;
        padding: 10px; box-sizing: border-box;
      }
      gameboy-speaker { width: 130px; height: 90px; position: absolute; bottom: 0; right: 0; }
      .option-buttons { width: 130px; height: 55px; display: flex; transform: translateY(30px); }
      .bottom { position: absolute; bottom: 0; }
      .bottom .phones {
        display: inline-block;
        font-family: Arial, sans-serif;
        font-size: 10px; color: #eee;
        border-radius: 15px; padding: 2px 4px;
        text-shadow: 1px 1px 1px #0003;
        box-shadow: 1px 2px 2px #0005 inset, 0px -2px 2px #fffd inset;
        opacity: 0.8;
        transform: translate(-2px, 0);
      }
      .slot { margin: auto; width: 5px; height: 10px; background-image: radial-gradient(transparent, #0003); position: relative; }
      .slot::before, .slot::after { content: ""; display: block; width: 5px; height: 10px; background-image: radial-gradient(transparent, #0003); position: absolute; top: 0; }
      .slot::before { transform: translateX(-8px); }
      .slot::after { transform: translateX(8px); }
      .power-switch {
        width: 28px; height: 6px;
        border-radius: 999px 999px 0 0;
        position: absolute;
        background-color: var(--gameboy-bgcolor);
        background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.35), rgba(0, 0, 0, 0.07));
        box-shadow:
          inset 0 -1.5px 2px rgba(0, 0, 0, 0.15),
          inset 0 1px 1px rgba(255, 255, 255, 0.5),
          0 -1px 1px rgba(0, 0, 0, 0.08);
        top: -6px;
        left: 51px;
        border: none;
        padding: 0;
        cursor: pointer;
        transition: left 0.2s ease;
        z-index: 2;
      }
      .power-switch.on { left: 74px; }
    </style>
    <div class="container">
      <button class="power-switch" id="powerSwitch" aria-label="Power switch"></button>
      <gameboy-top id="top"></gameboy-top>
      <div class="skin-toggle">
        <input class="skin-toggle-check" id="skinToggleCheck" type="checkbox">
        <label class="skin-toggle-label" for="skinToggleCheck">Skin<span></span></label>
      </div>
      <div class="screen-container">
        <gameboy-crystal id="crystal"></gameboy-crystal>
        <div class="brand">
          <span class="company">PORTFOLIO</span><br>
          <span class="product">GAME BOY</span><sub>™</sub>
        </div>
      </div>
      <div class="controls-container">
        <div class="controls">
          <gameboy-cross id="cross"></gameboy-cross>
          <div class="buttons">
            <gameboy-button name="B" id="btnB"></gameboy-button>
            <gameboy-button name="A" id="btnA"></gameboy-button>
          </div>
        </div>
        <gameboy-speaker id="speaker"></gameboy-speaker>
        <div class="option-buttons">
          <gameboy-option-button name="SELECT" action="select" id="btnSelect"></gameboy-option-button>
          <gameboy-option-button name="START" action="start" id="btnStart"></gameboy-option-button>
        </div>
        <div class="bottom">
          <div class="phones"><span>🎧</span> PHONES</div>
          <div class="slot"></div>
        </div>
      </div>
    </div>`;

    this.crystal = this.shadowRoot.getElementById("crystal");
    this.powerSwitch = this.shadowRoot.getElementById("powerSwitch");
    this.buttons = {
      a: this.shadowRoot.getElementById("btnA"),
      b: this.shadowRoot.getElementById("btnB"),
      start: this.shadowRoot.getElementById("btnStart"),
      select: this.shadowRoot.getElementById("btnSelect"),
    };

    this.powerSwitch.addEventListener("click", () => {
      haptic(10);
      this.togglePower();
    });
    this.shadowRoot.addEventListener("gb-press", (e) => this.handlePress(e.detail));

    this.skinToggleCheck = this.shadowRoot.getElementById("skinToggleCheck");
    this.skinToggleCheck.addEventListener("change", () => {
      haptic(8);
      beep(500, 0.05, "triangle", 0.04);
      this.setSkin(this.skinToggleCheck.checked ? "vintage" : "classic");
    });

    this._bindKeyboard();
  }

  handlePress({ action, dir }) {
    if (action === "dir") return this.pressDirection(dir);
    if (action === "dirhold") return this.setGameHold(dir, true);
    if (action === "dirrelease") return this.setGameHold(dir, false);
    if (action === "a") return this.pressA();
    if (action === "aup") return; // jump is edge-triggered, nothing to release
    if (action === "b") return this.pressB();
    if (action === "bup") return this.releaseB();
    if (action === "start") return this.pressStart();
    if (action === "select") return this.pressSelect();
  }

  setGameHold(dir, isDown) {
    if (this.state !== "game" || !this.game) return;
    if (dir === "left" || dir === "right") this.game.setHold(dir, isDown);
  }

  setSkin(skin) {
    this.setAttribute("skin", skin);
    document.body.dataset.skin = skin;
    this.crystal.flashBattery();
  }

  togglePower() {
    this.powered = !this.powered;
    this.powerSwitch.classList.toggle("on", this.powered);
    this.crystal.setPowered(this.powered);
    haptic(this.powered ? 15 : 8);

    if (this.powered) {
      this.state = "boot";
      this.crystal.screen.showBoot();
      this._bootTimer = setTimeout(() => {
        if (this.powered) {
          this.state = "menu";
          this.selectedIndex = 0;
          this.crystal.screen.showMenu(0);
        }
      }, 3200);
    } else {
      clearTimeout(this._bootTimer);
      this.crystal.screen.cancelBoot();
      if (this.game) { this.game.stop(); this.game = null; }
      this.state = "off";
      beep(280, 0.12, "square", 0.05);
    }
  }

  pressDirection(dir) {
    if (!this.powered) return;
    if (this.state === "menu") {
      if (dir === "up") this.selectedIndex = (this.selectedIndex - 1 + MENU.length) % MENU.length;
      if (dir === "down") this.selectedIndex = (this.selectedIndex + 1) % MENU.length;
      this.crystal.screen.moveCursor(this.selectedIndex);
      beep(300, 0.03, "square", 0.02);
      return;
    }
    if (this.state === "game" && dir === "up" && this.game) {
      this.game.jump();
    }
  }

  pressA() {
    if (!this.powered) return;
    if (this.state === "boot") {
      clearTimeout(this._bootTimer);
      this.crystal.screen.cancelBoot();
      this.state = "menu";
      this.crystal.screen.showMenu(this.selectedIndex);
      return;
    }
    if (this.state === "menu") {
      const item = MENU[this.selectedIndex];
      if (item.type === "game") {
        beep(660, 0.07, "square", 0.05);
        this.startGame();
        return;
      }
      this.state = "detail";
      this.crystal.screen.showDetail(this.selectedIndex);
      beep(660, 0.07, "square", 0.05);
      if (item.type === "mail") {
        // ALERT: item.mailto is a fixed, pre-encoded constant (HIRE_MAILTO
        // above) — never build this URL from live/user-editable input
        // without encodeURIComponent, or the mailto: link breaks/misfires.
        setTimeout(() => { window.location.href = item.mailto; }, 600);
      }
      return;
    }
    if (this.state === "game" && this.game) {
      this.game.jump();
    }
  }

  pressB() {
    if (!this.powered) return;
    if (this.state === "detail") {
      this.state = "menu";
      this.crystal.screen.showMenu(this.selectedIndex);
      beep(220, 0.07, "square", 0.05);
      return;
    }
    if (this.state === "game" && this.game) {
      this.game.setHold("run", true);
    }
  }

  releaseB() {
    if (this.state === "game" && this.game) this.game.setHold("run", false);
  }

  pressSelect() {
    if (!this.powered) return;
    if (this.state === "game") this.exitGame();
  }

  startGame() {
    this.state = "game";
    this.crystal.screen.showGameView((canvas) => {
      this.game = createPortfolioGame(canvas, { onExit: () => this.exitGame() });
      this.game.start();
    });
  }

  exitGame() {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    this.state = "menu";
    this.crystal.screen.showMenu(this.selectedIndex);
    beep(220, 0.07, "square", 0.05);
  }

  pressStart() {
    if (!this.powered) return;
    if (this.state === "boot") {
      clearTimeout(this._bootTimer);
      this.crystal.screen.cancelBoot();
      this.state = "menu";
      this.crystal.screen.showMenu(this.selectedIndex);
    }
  }

  _bindKeyboard() {
    const KEY_MAP = {
      ArrowUp: () => {
        if (this.state === "game") { this.game?.jump(); return; }
        this.pressDirection("up");
      },
      ArrowDown: () => this.pressDirection("down"),
      Enter: () => { if (this.state === "game") { this.game?.jump(); return; } this.buttons.a.flash(); this.pressA(); },
      z: () => { if (this.state === "game") { this.game?.jump(); return; } this.buttons.a.flash(); this.pressA(); },
      Backspace: () => { if (this.state === "game") return; this.buttons.b.flash(); this.pressB(); },
      x: () => { if (this.state === "game") return; this.buttons.b.flash(); this.pressB(); },
      " ": () => { this.buttons.start.flash(); this.pressStart(); },
      p: () => this.togglePower(),
      Escape: () => { if (this.state === "game") this.exitGame(); },
    };
    window.addEventListener("keydown", (e) => {
      const handler = KEY_MAP[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    });

    const HOLD_KEYS = {
      ArrowLeft: "left", a: "left",
      ArrowRight: "right", d: "right",
      Shift: "run",
    };
    window.addEventListener("keydown", (e) => {
      const dir = HOLD_KEYS[e.key];
      if (dir && this.state === "game" && this.game) {
        e.preventDefault();
        this.game.setHold(dir, true);
      }
    });
    window.addEventListener("keyup", (e) => {
      const dir = HOLD_KEYS[e.key];
      if (dir && this.game) this.game.setHold(dir, false);
    });
  }
}
customElements.define("gameboy-console", GameboyConsole);

// ---------- Responsive scaling: fit the fixed-size console to any viewport ----------
// The console is built at one fixed logical size (BASE_W x BASE_H) and
// scaled as a whole via CSS transform — every child component's px sizes
// stay untouched, so nothing inside the shell needs its own breakpoints.

const BASE_W = 380;
const BASE_H = 625;
const gbWrap = document.getElementById("gbWrap");
const gbScale = document.getElementById("gbScale");

function fitScale() {
  const maxW = Math.min(window.innerWidth * 0.92, 420);
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / BASE_W, maxH / BASE_H, 1.15);
  gbScale.style.transform = `scale(${scale})`;
  gbWrap.style.width = `${BASE_W * scale}px`;
  gbWrap.style.height = `${BASE_H * scale}px`;
}

window.addEventListener("resize", fitScale);
window.addEventListener("orientationchange", fitScale);
fitScale();
