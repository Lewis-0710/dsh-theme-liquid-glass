/**
 * Browser half of dsh-theme-liquid-glass (single self-contained file).
 *
 * Architecture follows the battle-tested pattern of the shipped
 * dsh-ui-appearance / dsh-dream-skin plugins:
 *
 * - Settings persist in localStorage, NOT the settings RPC: the harness
 *   settings gateway only exposes its hard-coded product namespaces to
 *   browser clients, so a third-party namespace stays `loading` forever on
 *   the client even when the host half registered it. (ui-appearance comment:
 *   "the harness settings gateway only exposes its hard-coded product
 *   namespaces to browser clients, so a third-party namespace cannot be
 *   written through the settings RPC".)
 * - One stylesheet + one fixed background layer element + body CSS variables;
 *   every write retracts on dispose, so disabling the plugin restores the
 *   stock UI exactly.
 * - Frost/blur is `filter: blur()` applied to the BACKGROUND LAYER, never
 *   `backdrop-filter` on #root: a non-none backdrop-filter turns #root into
 *   the containing block of every fixed-position descendant (menus, tooltips,
 *   toasts), re-anchoring them to #root instead of the viewport.
 * - Layer sits at z-index 0, #root is lifted to z-index 1, so the wallpaper
 *   shows through the translucent `--dsw-alias-*` surface tokens.
 * - Tokens are plain rgba() pairs ({light, dark}) — no color-mix, which would
 *   make a custom property referencing itself go guaranteed-invalid.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { ChangeEvent, CSSProperties } from 'react';
import type { LiquidGlassSettings, WallpaperKind } from '../shared';

// Inlined constants (the client bundle stays a single module — the shell
// module loader only resolves graph rows and shell modules, never relative
// paths, so nothing outside this file may be required at runtime).
const STORAGE_KEY = 'dsh-liquid-glass.settings';
const WALLPAPER_ROUTE = '/liquid-glass/wallpaper';
const UPLOAD_ROUTE = '/liquid-glass/upload';
const PROXY_ROUTE = '/liquid-glass/proxy';
const PLUGIN_ID = 'dsh-theme-liquid-glass';
const OVERRIDE_SOURCE = PLUGIN_ID;
const BG_LAYER_ID = 'dsh-liquid-glass-bg';
const SCRIM_ID = 'dsh-liquid-glass-scrim';
const STYLE_ID = 'dsh-liquid-glass-style';

const FILTER_ID = 'dsh-lg-filters';
const EDGE_FILTER_ID = 'dsh-lg-edge-refraction';
/** Inline SVG filter for edge refraction, applied via `backdrop-filter: url(#...)`.
 *  feDisplacementMap with no explicit in/in2 → consumes the backdrop's own alpha
 *  edge as the displacement map, creating a smooth liquid refraction at the
 *  element border. filterUnits=objectBoundingBox ties the filter region to the
 *  element. */
const FILTER_SVG = `<svg id="${FILTER_ID}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:fixed;pointer-events:none;visibility:hidden;top:0;left:0;overflow:hidden">
  <filter id="${EDGE_FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%" filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
    <feDisplacementMap scale="80"/>
  </filter>
</svg>`;

const DEFAULTS: LiquidGlassSettings = {
  enabled: true,
  wallpaper: { kind: 'local', value: 'demo.html', proxy: false, muted: true },
  demo: { speed: 1, blobs: 6, colorCycle: 4, blur: 65, opacity: 0.85, wash: true },
  glass: { frosted: true, blur: 24, bgBlur: 5, refraction: 0.4, tint: '#ffffff', tintOpacity: 0.35, toolTextColor: '', codeBlockOpacity: 0.7, glassBrightness: 1, brightness: 1, edgeRefractionScale: 80 },
};

const WALLPAPER_KINDS: readonly WallpaperKind[] = ['none', 'url', 'html', 'image', 'video', 'local'];

/** Kinds whose value is a LOCAL file (click-to-pick opens the system file dialog). */
const LOCAL_FILE_KINDS: readonly WallpaperKind[] = ['local', 'html', 'image', 'video'];

/** <input type="file"> accept filter per local-file kind. */
const LOCAL_ACCEPT: Record<string, string> = {
  html: '.html,.htm',
  image: 'image/*',
  video: 'video/*',
  local: '.html,.htm,image/*,video/*',
};

/**
 * Upload a picked file to the host wallpaper dir and return the stored name.
 * The host names the file `lg-<timestamp>-<sanitized-original>` and serves it
 * back through /liquid-glass/wallpaper/<name>.
 */
async function uploadLocalFile(file: File): Promise<string> {
  const body = await file.arrayBuffer();
  const res = await fetch(`${UPLOAD_ROUTE}?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  let data: { name?: unknown };
  try {
    data = JSON.parse(text) as { name?: unknown };
  } catch {
    throw new Error('无效的上传响应');
  }
  if (typeof data.name !== 'string' || data.name === '') throw new Error('上传响应缺少文件名');
  return data.name;
}

const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Validate + clamp one parsed settings document (hand-edited or stale
 * localStorage can never produce invalid CSS this way). */
function sanitizeSettings(raw: unknown): LiquidGlassSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULTS };
  const s = raw as Record<string, unknown>;
  const w = (typeof s.wallpaper === 'object' && s.wallpaper !== null ? s.wallpaper : {}) as Record<string, unknown>;
  const d = (typeof s.demo === 'object' && s.demo !== null ? s.demo : {}) as Record<string, unknown>;
  const g = (typeof s.glass === 'object' && s.glass !== null ? s.glass : {}) as Record<string, unknown>;
  const kind: WallpaperKind = WALLPAPER_KINDS.includes(w.kind as WallpaperKind)
    ? (w.kind as WallpaperKind)
    : DEFAULTS.wallpaper.kind;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled,
    wallpaper: {
      kind,
      value: typeof w.value === 'string' ? w.value : DEFAULTS.wallpaper.value,
      proxy: typeof w.proxy === 'boolean' ? w.proxy : DEFAULTS.wallpaper.proxy,
      muted: typeof w.muted === 'boolean' ? w.muted : DEFAULTS.wallpaper.muted,
    },
    demo: {
      speed: clampNum(d.speed, 0.1, 4, DEFAULTS.demo.speed),
      blobs: Math.round(clampNum(d.blobs, 1, 6, DEFAULTS.demo.blobs)),
      colorCycle: Math.round(clampNum(d.colorCycle, 0, 10, DEFAULTS.demo.colorCycle)),
      blur: Math.round(clampNum(d.blur, 10, 140, DEFAULTS.demo.blur)),
      opacity: clampNum(d.opacity, 0.2, 1, DEFAULTS.demo.opacity),
      wash: typeof d.wash === 'boolean' ? d.wash : DEFAULTS.demo.wash,
    },
    glass: {
      frosted: typeof g.frosted === 'boolean' ? g.frosted : DEFAULTS.glass.frosted,
      blur: clampNum(g.blur, 0, 60, DEFAULTS.glass.blur),
      bgBlur: clampNum(g.bgBlur, 0, 60, DEFAULTS.glass.bgBlur),
      refraction: clampNum(g.refraction, 0, 1, DEFAULTS.glass.refraction),
      tint: typeof g.tint === 'string' && /^#[0-9a-f]{6}$/i.test(g.tint) ? g.tint.toLowerCase() : DEFAULTS.glass.tint,
      tintOpacity: clampNum(g.tintOpacity, 0, 1, DEFAULTS.glass.tintOpacity),
      toolTextColor: typeof g.toolTextColor === 'string' && (/^#[0-9a-f]{6}$/i.test(g.toolTextColor) || g.toolTextColor === '') ? g.toolTextColor.toLowerCase() : DEFAULTS.glass.toolTextColor,
      codeBlockOpacity: clampNum(g.codeBlockOpacity, 0.2, 1, DEFAULTS.glass.codeBlockOpacity),
      glassBrightness: clampNum(g.glassBrightness, 0.2, 1.6, DEFAULTS.glass.glassBrightness),
      brightness: clampNum(g.brightness, 0.2, 1.6, DEFAULTS.glass.brightness),
      edgeRefractionScale: clampNum(g.edgeRefractionScale, 0, 200, DEFAULTS.glass.edgeRefractionScale),
    },
  };
}

function readStoredSettings(): LiquidGlassSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Hex → rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255, 255, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Dark-palette glass color: the tint scaled toward black (Apple's dark glass
 * material is a translucent near-black with the same hue family). */
function darkGlass(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#26262b';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 0xff) * 0.2);
  const g = Math.round(((n >> 8) & 0xff) * 0.2);
  const b = Math.round((n & 0xff) * 0.2);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Scale a hex color's lightness: factor > 1 mixes toward white, < 1 toward
 * black (the glass material brightness — the card surface gets lighter /
 * darker without touching the hue). factor 1 is the identity. */
function scaleTint(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  if (factor >= 1) {
    const t = Math.min(1, (factor - 1) / 0.6); // 1.0 -> 0, 1.6 -> full white
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  } else {
    const t = Math.min(1, (1 - factor) / 0.8); // 1.0 -> 0, 0.2 -> full black
    r = Math.round(r * (1 - t));
    g = Math.round(g * (1 - t));
    b = Math.round(b * (1 - t));
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Build the glass token override layer. Plain rgba() strings only; values are
 * `{ light, dark }` pairs so the theme service can pick per color scheme.
 */
function buildTokens(s: LiquidGlassSettings): ThemeTokenOverrides {
  const g = s.glass;
  const a = clamp01(g.tintOpacity);
  // The glass material brightness scales the tint lightness; every glass
  // surface (card, bubbles, dock, menus) follows the same tint.
  const tint = scaleTint(g.tint, clampNum(g.glassBrightness, 0.2, 1.6, 1));
  const glass = (alpha: number) => ({
    light: hexToRgba(tint, clamp01(alpha)),
    dark: hexToRgba(darkGlass(tint), clamp01(alpha)),
  });
  const hoverGlass = (alpha: number) => ({
    light: hexToRgba(tint, clamp01(alpha)),
    dark: `rgba(255, 255, 255, ${clamp01(alpha * 0.75)})`,
  });
  const edges = (strength: number, darkStrength = strength) => ({
    light: `rgba(0, 0, 0, ${clamp01(g.refraction * strength)})`,
    dark: `rgba(255, 255, 255, ${clamp01(g.refraction * darkStrength)})`,
  });
  const wallpaperActive = s.wallpaper.kind !== 'none' && s.wallpaper.value.trim() !== '';
  const t: ThemeTokenOverrides = {};
  const set = (name: string, v: { light: string; dark: string }) => {
    t[name] = v;
  };
  // Base canvas: transparent when a wallpaper shows through, else translucent glass.
  set('--dsw-alias-bg-base', wallpaperActive ? { light: 'transparent', dark: 'transparent' } : glass(a * 0.3));
  set('--dsw-alias-bg-layer-1', glass(a * 0.55));
  set('--dsw-alias-bg-layer-2', glass(a * 0.66));
  set('--dsw-alias-bg-layer-3', glass(a * 0.78));
  set('--dsw-alias-bg-module-platform', glass(a * 0.5));
  set('--dsw-alias-bg-multi-select', glass(a * 0.6));
  set('--dsw-alias-bg-overlay', glass(a * 0.92));
  set('--dsw-specific-menu', glass(0.92));
  set('--dsw-specific-sidebar-fill', glass(a * 0.5));
  // User message bubbles: frosted tint (the frosted backdrop + lens rim come
  // from the stylesheet pseudo-element rules).
  set('--dsw-specific-bubble', glass(0.5));
  set('--dsw-specific-bubble-highlight', glass(0.38));
  // The composer card and queue dock stay translucent so the sharp wallpaper
  // shows around the input box; the box itself carries the frosted
  // backdrop-filter (see SHEET) over its own glass-tint gradient.
  set('--dsw-specific-input-major', glass(0.35));
  set('--dsw-specific-login-input', glass(0.6));
  set('--dsw-specific-tip', glass(0.45));
  set('--dsw-specific-selector', glass(a * 0.5));
  set('--dsw-alias-markdown-code-block', glass(clampNum(g.codeBlockOpacity, 0.2, 1, DEFAULTS.glass.codeBlockOpacity)));
  set('--dsw-alias-markdown-code-block-banner', glass(clampNum(g.codeBlockOpacity - 0.1, 0.2, 1, DEFAULTS.glass.codeBlockOpacity)));
  set('--dsw-alias-markdown-inline-code', glass(clampNum(g.codeBlockOpacity - 0.1, 0.2, 1, DEFAULTS.glass.codeBlockOpacity)));
  set('--dsw-alias-markdown-citation', glass(a * 0.32));
  set('--dsw-alias-button-elevated-fill', glass(a * 0.55));
  set('--dsw-alias-button-floating-fill', glass(a * 0.55));
  set('--dsw-alias-button-floating-hover', hoverGlass(a * 0.66));
  set('--dsw-alias-button-tool-bar-fill', glass(a * 0.62));
  set('--dsw-alias-button-tool-bar-hover', hoverGlass(a * 0.72));
  set('--dsw-alias-button-tool-bar-fill-invisible', glass(a * 0.4));
  set('--dsw-alias-interactive-bg-hover', hoverGlass(0.18));
  set('--dsw-alias-interactive-bg-active', hoverGlass(0.24));
  set('--dsw-alias-interactive-bg-hover-accent', hoverGlass(0.28));
  set('--dsw-alias-bg-skeleton', edges(0.1));
  // Soft glass rim: low-alpha edges so the composer/dock boundary reads as a
  // subtle luminous rim (the frost strip's feathered top supplies the glow),
  // never a stark white line.
  set('--dsw-alias-border-l1', edges(0.4));
  set('--dsw-alias-border-l2', edges(0.35));
  set('--dsw-alias-border-l2-darkmode-thin', edges(0.45));
  set('--dsw-alias-border-l3', edges(0.45));
  set('--dsw-alias-border-l4', edges(0.55));
  set('--dsw-alias-toast-bg', glass(a * 0.82));
  set('--dsw-alias-tooltip-bg', glass(a * 0.85));
  return t;
}

/**
 * Static sheet. The wallpaper layer sits above the body background but below
 * #root (lifted with a minimal stacking context), so surfaces painted with
 * translucent tokens show the wallpaper through. `inset: -48px` gives the
 * blur filter room so edges never show transparent bleed.
 *
 * Frosted glass: the composer CARD, user bubbles, and queue dock carry their
 * own `backdrop-filter: blur(...)` (card/bubble via a ::before pseudo so the
 * containing-block side effect never re-anchors their absolute descendants) —
 * exactly the mechanism the harness settings modal uses
 * (`backdrop-filter: var(--dsw-mask-blur)`). The wallpaper blur is a separate,
 * independently adjustable `--dsh-lg-bg-blur` on the background layer itself.
 * Lens-like edges come from inset highlights: a bright top rim that catches
 * light, a soft inner ring, and bottom depth shading.
 */
const SHEET = `
#${BG_LAYER_ID} {
  position: fixed;
  inset: -48px;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  contain: strict;
  filter: blur(var(--dsh-lg-bg-blur, 0px)) brightness(var(--dsh-lg-brightness, 1)) saturate(calc(1 + var(--dsh-lg-refraction, 0)));
}
#${BG_LAYER_ID} > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 0;
  display: block;
  pointer-events: none;
}
#${BG_LAYER_ID} > iframe { background: transparent; }
#${SCRIM_ID} {
  z-index: 2;
  background: linear-gradient(rgba(8, 10, 18, var(--dsh-lg-scrim, 0)) 0%, rgba(8, 10, 18, var(--dsh-lg-scrim, 0)) 100%);
}
body:not([data-ds-dark-theme]) #${SCRIM_ID} {
  background: linear-gradient(rgba(255, 255, 255, var(--dsh-lg-scrim, 0)) 0%, rgba(255, 255, 255, var(--dsh-lg-scrim, 0)) 100%);
}
#root {
  position: relative;
  z-index: 1;
}
/* Whole composer card (input area, model selector, send button, meter) is ONE
   piece of frosted glass: the input box has no separate surface of its own, so
   it blends into the card. backdrop-filter lives on the card's ::before
   pseudo-element, NOT the card itself: the containing-block side effect of
   backdrop-filter only applies to the pseudo's own descendants (none), so the
   absolutely-positioned popups inside the card (context meter panel, model
   menu) keep their anchors. The refractive edge is a WIDE luminous zone:
   a thick top rim that catches light, inner glows spreading into the surface,
   and a soft halo spilling outside the card. */
[data-composer-card] {
  isolation: isolate;
}
body.dsh-lg-on [data-composer-card]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: 0;
  pointer-events: none;
  -webkit-backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 10%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22),
    inset 0 0 18px rgba(255, 255, 255, 0.10),
    inset 0 0 36px rgba(255, 255, 255, 0.05),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.20),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.20),
    0 0 24px rgba(255, 255, 255, 0.12);
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card]::before {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 14%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 0 18px rgba(255, 255, 255, 0.08),
    inset 0 0 40px rgba(255, 255, 255, 0.04),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.12),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.12),
    0 0 28px rgba(255, 255, 255, 0.10);
}
/* Edge refraction lives on the SAME backdrop-filter chain as the frosted blur
   (no separate ::after ring with a binary mask). feDisplacementMap is driven by
   the backdrop's alpha edges — strongest at the element border where the
   backdrop transitions, weakest at the center — so refraction naturally
   concentrates at the edge without a hard mask boundary. */
/* Harness settings modal: the SAME frosted glass + lens edge as the composer
   card. [aria-labelledby] pins this to the settings dialog only — the generic
   Modal primitive and the image lightbox use aria-label, not aria-labelledby.
   backdrop-filter rides the ::before pseudo (isolation + z-index:-1), never
   the dialog itself, so its descendants keep their anchors. */
body.dsh-lg-on [role="dialog"][aria-labelledby] {
  isolation: isolate;
}
body.dsh-lg-on [role="dialog"][aria-labelledby]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: -1;
  -webkit-backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22),
    inset 0 0 18px rgba(255, 255, 255, 0.10),
    inset 0 0 36px rgba(255, 255, 255, 0.05),
    0 0 24px rgba(255, 255, 255, 0.12);
}
body[data-ds-dark-theme].dsh-lg-on [role="dialog"][aria-labelledby]::before {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 0 18px rgba(255, 255, 255, 0.08),
    inset 0 0 40px rgba(255, 255, 255, 0.04),
    0 0 28px rgba(255, 255, 255, 0.10);
}
/* User message bubbles: ultra-smooth liquid glass card styling without
   per-bubble backdrop-filter convolution, eliminating frame-drops and GPU
   thrashing across long chat histories while preserving crystalline glass refraction. */
[data-time-hover-root] [class*="_bubble"] {
  position: relative;
  isolation: isolate;
  contain: layout style;
}
body.dsh-lg-on [data-time-hover-root] [class*="_bubble"]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: -1;
  pointer-events: none;
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 24%, rgba(255, 255, 255, 0.18));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.50),
    inset 0 0 0 1px rgba(255, 255, 255, 0.20),
    inset 0 0 14px rgba(255, 255, 255, 0.08),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.12),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.12),
    0 2px 10px rgba(0, 0, 0, 0.06);
}
body[data-ds-dark-theme].dsh-lg-on [data-time-hover-root] [class*="_bubble"]::before {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2b2b2f) 42%, rgba(0, 0, 0, 0.24));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 0 14px rgba(255, 255, 255, 0.05),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.08),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.08),
    0 2px 12px rgba(0, 0, 0, 0.25);
}
/* Conversation page header (对话 / 轨迹 / session log bar).
   NOTE: the header is deliberately left COMPLETELY unstyled as a surface.
   It used to carry a "gradient frosted glass" treatment — a full-bleed
   ::before pseudo-element with a masked backdrop blur — and the bar was
   re-anchored with position:absolute so the message list scrolled underneath
   it. That overlay read as a horizontal translucent band/shadow across the top
   of the page on the active conversation view (and only there, since the
   header is absent in the empty/hero view), desaturating the wallpaper above
   the bar. The stock layout already puts the header in its own flex:none row,
   so nothing ever passes beneath it: the overlay bought nothing and only
   painted the band. Both the overlay and the absolute positioning are
   therefore removed, and the header keeps its stock flow layout and its
   native bottom hairline. */
/* View tabs: floating glass capsules with a highlight edge (the old underline
   indicator is replaced by the capsule surface). backdrop-filter rides the
   ::before pseudo, never the button itself. */
body.dsh-lg-on header:has([role="tablist"]) [role="tab"] {
  position: relative;
  isolation: isolate;
  border-radius: 999px;
  padding: 7px 18px;
  margin-bottom: 10px;
  color: var(--dsw-alias-label-secondary);
}
body.dsh-lg-on header:has([role="tablist"]) [role="tab"]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: -1;
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  backdrop-filter: blur(12px) saturate(150%);
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 8%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.40),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    inset 0 0 10px rgba(255, 255, 255, 0.08),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.14),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.14),
    0 2px 10px rgba(0, 0, 0, 0.12);
}
body.dsh-lg-on header:has([role="tablist"]) [role="tab"][aria-selected="true"] {
  color: var(--dsw-alias-state-business-primary);
}
body.dsh-lg-on header:has([role="tablist"]) [role="tab"][aria-selected="true"]::before {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 14%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.30),
    inset 0 0 14px rgba(255, 255, 255, 0.14),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.20),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.20),
    0 2px 12px rgba(0, 0, 0, 0.16);
}
body[data-ds-dark-theme].dsh-lg-on header:has([role="tablist"]) [role="tab"]::before {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 12%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 0 10px rgba(255, 255, 255, 0.05),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.08),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.08),
    0 2px 10px rgba(0, 0, 0, 0.30);
}
body[data-ds-dark-theme].dsh-lg-on header:has([role="tablist"]) [role="tab"][aria-selected="true"]::before {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 16%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.16),
    inset 0 0 14px rgba(255, 255, 255, 0.08),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.12),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.12),
    0 2px 12px rgba(0, 0, 0, 0.35);
}
body.dsh-lg-on header:has([role="tablist"]) [role="tab"]::after {
  display: none;
}
/* General focus & focus-visible reset: eliminate macOS / Chromium default
   high-contrast focus ring (double black halo / outline) across all glass UI. */
body.dsh-lg-on button:focus,
body.dsh-lg-on button:focus-visible,
body.dsh-lg-on a:focus,
body.dsh-lg-on a:focus-visible,
body.dsh-lg-on [role="button"]:focus,
body.dsh-lg-on [role="button"]:focus-visible,
body.dsh-lg-on [role="tab"]:focus,
body.dsh-lg-on [role="tab"]:focus-visible,
body.dsh-lg-on [role="menuitem"]:focus,
body.dsh-lg-on [role="menuitem"]:focus-visible {
  outline: none !important;
}
/* General hover effect for interactive elements: subtle highlight edge & shadow.
   Performance optimized: NO transform (prevents compositing layer churning)
   and NO filter:brightness (prevents offscreen software rasterization). */
body.dsh-lg-on button:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body.dsh-lg-on a:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body.dsh-lg-on [role="button"]:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body.dsh-lg-on [role="tab"]:not(:disabled):hover:not([role="dialog"] *),
body.dsh-lg-on [role="menuitem"]:not(:disabled):hover:not([role="dialog"] *),
body.dsh-lg-on [role="link"]:not(:disabled):hover:not([role="dialog"] *) {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 2px 8px rgba(0, 0, 0, 0.10);
}
body[data-ds-dark-theme].dsh-lg-on button:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body[data-ds-dark-theme].dsh-lg-on a:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body[data-ds-dark-theme].dsh-lg-on [role="button"]:not(:disabled):hover:not([role="dialog"] *):not([class*="_tree"] *):not([class*="_sidebar"] *):not([class*="_foot"] *):not([class*="_settingsArea"] *),
body[data-ds-dark-theme].dsh-lg-on [role="tab"]:not(:disabled):hover:not([role="dialog"] *),
body[data-ds-dark-theme].dsh-lg-on [role="menuitem"]:not(:disabled):hover:not([role="dialog"] *),
body[data-ds-dark-theme].dsh-lg-on [role="link"]:not(:disabled):hover:not([role="dialog"] *) {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.16);
}
/* Switch toggle buttons & thumbs: ensure crisp high contrast between thumb and track in both ON and OFF states */
body.dsh-lg-on button[role="switch"],
body.dsh-lg-on [class*="_switch"][role="switch"],
body.dsh-lg-on [class*="switchRoot"] {
  box-sizing: border-box !important;
  position: relative !important;
  cursor: pointer !important;
  transition: background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease !important;
}

/* OFF (Unchecked) track: dark translucent base with crisp luminous ring */
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]),
body.dsh-lg-on [class*="_switch"][role="switch"]:not([data-state="checked"]):not([aria-checked="true"]),
body.dsh-lg-on [class*="switchRoot"]:not([data-state="checked"]):not([aria-checked="true"]) {
  background: rgba(0, 0, 0, 0.35) !important;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.28) !important;
}
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]):hover:not(:disabled),
body.dsh-lg-on [class*="_switch"][role="switch"]:not([data-state="checked"]):not([aria-checked="true"]):hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.45) !important;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.45) !important;
}

/* OFF (Unchecked) thumb: luminous distinct whitish thumb (never dark or invisible) */
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]) [class*="thumb" i],
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]) > span,
body.dsh-lg-on [class*="_switch"]:not([data-state="checked"]):not([aria-checked="true"]) [class*="thumb" i] {
  background: rgba(255, 255, 255, 0.65) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.50), 0 0 0 1px rgba(255, 255, 255, 0.35) !important;
  opacity: 1 !important;
}
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]):hover:not(:disabled) [class*="thumb" i],
body.dsh-lg-on button[role="switch"]:not([data-state="checked"]):not([aria-checked="true"]):hover:not(:disabled) > span,
body.dsh-lg-on [class*="_switch"]:not([data-state="checked"]):not([aria-checked="true"]):hover:not(:disabled) [class*="thumb" i] {
  background: rgba(255, 255, 255, 0.90) !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.60), 0 0 0 1px rgba(255, 255, 255, 0.50) !important;
}

/* ON (Checked) track: high-contrast dark track with crisp border */
body.dsh-lg-on button[role="switch"]:is([data-state="checked"], [aria-checked="true"]),
body.dsh-lg-on [class*="_switch"][role="switch"]:is([data-state="checked"], [aria-checked="true"]),
body.dsh-lg-on [class*="switchRoot"]:is([data-state="checked"], [aria-checked="true"]) {
  background: #000000 !important;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.40) !important;
}
body.dsh-lg-on button[role="switch"]:is([data-state="checked"], [aria-checked="true"]):hover:not(:disabled),
body.dsh-lg-on [class*="_switch"][role="switch"]:is([data-state="checked"], [aria-checked="true"]):hover:not(:disabled) {
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.70) !important;
}

/* ON (Checked) thumb: solid pure white thumb */
body.dsh-lg-on button[role="switch"]:is([data-state="checked"], [aria-checked="true"]) [class*="thumb" i],
body.dsh-lg-on button[role="switch"]:is([data-state="checked"], [aria-checked="true"]) > span,
body.dsh-lg-on [class*="_switch"]:is([data-state="checked"], [aria-checked="true"]) [class*="thumb" i] {
  background: #ffffff !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.60), 0 0 0 1px rgba(255, 255, 255, 0.40) !important;
  opacity: 1 !important;
}

/* Tool call titles (Read, Think, Edit, Bash, etc.): text-shadow for
   readability on glass backgrounds, plus optional custom color. */
body.dsh-lg-on [data-variant] [data-disclosure-row] [class*="title"] {
  color: var(--dsh-lg-tool-text-color, var(--dsw-alias-label-primary));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
/* Tool call summary text: same readability fix as the title. */
body.dsh-lg-on [data-variant] [data-disclosure-row] [class*="summary"] {
  color: var(--dsh-lg-tool-text-color, var(--dsw-alias-label-secondary));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
/* Composer card bottom action buttons: 指令 (+), 添加附件 (📎), 通知开关 (🔔), Git分支
   默认状态：完全透明无背景、无边框、图标与文字纯白高亮 (#ffffff) 且自带抗背景微阴影，确保在任意壁纸下清晰可见。
   悬停状态：100% 还原模型选择入口按钮（ModelSelect）效果：无实线边框 (border: none)，依靠极细的 box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.10) 微光边缘 + var(--dsw-alias-interactive-bg-hover) 浅底色 + 24px 圆角胶囊。 */

/* 1. 默认状态：透明底、无边框、无阴影、统一 28px 高度、纯白高亮 */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *),
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"],
body.dsh-lg-on [data-composer-card] button[aria-label="指令"],
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i],
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"],
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i],
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"],
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i],
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="chip_"],
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="dock_"] button {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  color: #ffffff !important;
  opacity: 1 !important;
  visibility: visible !important;
  border-radius: 24px !important;
  height: 28px !important;
  box-sizing: border-box !important;
  outline: none !important;
  cursor: pointer !important;
  transition: background-color var(--ds-transition-duration-fast, 0.15s) ease,
              box-shadow var(--ds-transition-duration-fast, 0.15s) ease,
              color var(--ds-transition-duration-fast, 0.15s) ease !important;
}

/* 单图标按钮尺寸与居中：28x28 正圆/胶囊，居中对齐 */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *):not([class*="chip_"]):not([class*="dock_"] *),
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"],
body.dsh-lg-on [data-composer-card] button[aria-label="指令"],
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i],
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"],
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i],
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"],
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i] {
  width: 28px !important;
  min-width: 28px !important;
  max-width: 28px !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex: none !important;
}

/* Git分支外层 dock 与内层 chip 布局与纯白字体 */
body.dsh-lg-on [data-composer-card] [class*="dock_"] {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  overflow: visible !important;
  height: 28px !important;
  display: inline-flex !important;
  align-items: center !important;
  color: #ffffff !important;
}
body.dsh-lg-on [data-composer-card] [class*="chip_"],
body.dsh-lg-on [data-composer-card] [class*="dock_"] button {
  padding: 0 8px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  height: 28px !important;
  border-radius: 24px !important;
  color: #ffffff !important;
}
body.dsh-lg-on [data-composer-card] [class*="dock_"] [class*="branch_"],
body.dsh-lg-on [data-composer-card] [class*="chip_"] [class*="branch_"],
body.dsh-lg-on [data-composer-card] [class*="branch_"] {
  color: #ffffff !important;
  opacity: 1 !important;
  visibility: visible !important;
  font-size: 13px !important;
  line-height: 20px !important;
  font-weight: 500 !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45) !important;
}

/* 彻底禁用任何多余伪元素层 */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *)::before,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *)::after,
body.dsh-lg-on [data-composer-card] [class*="dock_"]::before,
body.dsh-lg-on [data-composer-card] [class*="dock_"]::after {
  display: none !important;
  content: none !important;
}

/* 纯白图标 (通用规则：覆盖 tools 区域内所有这4个按钮的 SVG) */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *) svg,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label="指令"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i] svg,
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i] svg,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"] svg,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i] svg,
body.dsh-lg-on [data-composer-card] [class*="chip_"] svg,
body.dsh-lg-on [data-composer-card] [class*="dock_"] svg {
  color: #ffffff !important;
  opacity: 1 !important;
  visibility: visible !important;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45)) !important;
}

/* 实心图标纯白填充 (指令 +, 附件 📎, 分支 图标) */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label="指令"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i] svg,
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"] svg,
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i] svg,
body.dsh-lg-on [data-composer-card] [class*="chip_"] svg,
body.dsh-lg-on [data-composer-card] [class*="dock_"] svg {
  fill: #ffffff !important;
  stroke: none !important;
}
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"] svg path,
body.dsh-lg-on [data-composer-card] button[aria-label="指令"] svg path,
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i] svg path,
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"] svg path,
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i] svg path,
body.dsh-lg-on [data-composer-card] [class*="chip_"] svg path,
body.dsh-lg-on [data-composer-card] [class*="dock_"] svg path {
  fill: #ffffff !important;
  stroke: none !important;
  opacity: 1 !important;
}

/* 描边图标纯白描边 (通知开关铃铛 🔔 图标) */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"] svg,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i] svg {
  fill: none !important;
  stroke: #ffffff !important;
}
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"] svg path,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i] svg path {
  fill: none !important;
  stroke: #ffffff !important;
  opacity: 1 !important;
}

/* 2. 悬停状态：100% 完全对齐模型选择入口 (ModelSelect) 的效果
   无 border (坚决不写 border: 1px solid)，依靠 box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.10) 的 1px 微光边框 + 浮起阴影 + 浅底色 */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *):hover,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"]:hover,
body.dsh-lg-on [data-composer-card] button[aria-label="指令"]:hover,
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i]:hover,
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"]:hover,
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i]:hover,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"]:hover,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i]:hover,
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="chip_"]:hover,
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="dock_"] button:hover {
  border: none !important;
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12)) !important;
  background-color: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12)) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.10), 0 4px 12px rgba(0, 0, 0, 0.18) !important;
  color: #ffffff !important;
  border-radius: 24px !important;
}

/* 3. 点击激活状态 */
body.dsh-lg-on [data-composer-card] [class*="_tools"] button:not([class*="_modes"] button):not([class*="_modes"] *):active,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[class*="add"]:active,
body.dsh-lg-on [data-composer-card] button[aria-label="指令"]:active,
body.dsh-lg-on [data-composer-card] button[aria-label*="Command" i]:active,
body.dsh-lg-on [data-composer-card] button[aria-label="添加附件"]:active,
body.dsh-lg-on [data-composer-card] button[aria-label*="attachment" i]:active,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="通知"]:active,
body.dsh-lg-on [data-composer-card] [class*="_tools"] button[title*="Notification" i]:active,
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="chip_"]:active,
body.dsh-lg-on [data-composer-card] [class*="_tools"] [class*="dock_"] button:active {
  border: none !important;
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.20)) !important;
  background-color: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.20)) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14) !important;
}



/* Send/stop button: a transparent lens instead of the solid brand fill. */
body.dsh-lg-on [data-composer-card] button[class*="_primary"] {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 20%, transparent),
    color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 6%, transparent));
  color: var(--dsw-alias-brand-primary);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.40),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    inset 0 -2px 6px rgba(0, 0, 0, 0.20),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.14),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.14);
}
body.dsh-lg-on [data-composer-card] button[class*="_primary"]:hover:not(:disabled) {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 30%, transparent),
    color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 12%, transparent));
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] button[class*="_primary"] {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 34%, transparent),
    color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 14%, transparent));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 -2px 8px rgba(0, 0, 0, 0.35),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.08),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.08);
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] button[class*="_primary"]:hover:not(:disabled) {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 48%, transparent),
    color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 22%, transparent));
}
/* Queue dock: same frosted glass + a wider lens rim. */
body.dsh-lg-on [data-queue-dock] > div {
  -webkit-backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(150%);
  backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(150%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 0 12px rgba(255, 255, 255, 0.06);
}
/* Sidebar header action buttons (new session, collapse, etc.): the same frosted glass
   + edge refraction as the view tabs, applied via ::before so the button's
   icon stays above the glass layer. */
body.dsh-lg-on [class*="_treeHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i]),
body.dsh-lg-on [class*="_sidebarHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i]) {
  position: relative;
  isolation: isolate;
}
body.dsh-lg-on [class*="_treeHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i])::before,
body.dsh-lg-on [class*="_sidebarHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i])::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: -1;
  pointer-events: none;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 8%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 0 8px rgba(255, 255, 255, 0.06),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.10),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.10);
}
body[data-ds-dark-theme].dsh-lg-on [class*="_treeHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i])::before,
body[data-ds-dark-theme].dsh-lg-on [class*="_sidebarHeader"] button:not([role="dialog"] *):not([aria-label*="访问模式" i]):not([aria-label*="Access mode" i])::before {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #333333) 12%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 0 8px rgba(255, 255, 255, 0.04),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.06),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.06);
}
/* Tree inline action buttons (workspaces, sessions, tasks +, ..., expand icons):
   Keep clean and borderless without glass pseudo-elements. Strictly scoped to tree body. */
body.dsh-lg-on [class*="_treeBody"] button,
body.dsh-lg-on [class*="_treeItem"] button,
body.dsh-lg-on [class*="_treeNode"] button,
body.dsh-lg-on [class*="_treeRow"] button,
body.dsh-lg-on [class*="_treeBody"] [class*="_actions"] button,
body.dsh-lg-on [class*="_treeBody"] [class*="_action"] button,
body.dsh-lg-on [class*="_treeRoot"] [class*="_actions"] button,
body.dsh-lg-on [class*="_treeRoot"] [class*="_action"] button {
  position: static !important;
  isolation: auto !important;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transform: none !important;
  filter: none !important;
}
body.dsh-lg-on [class*="_treeBody"] button:hover,
body.dsh-lg-on [class*="_treeItem"] button:hover,
body.dsh-lg-on [class*="_treeNode"] button:hover,
body.dsh-lg-on [class*="_treeRow"] button:hover,
body.dsh-lg-on [class*="_treeBody"] [class*="_actions"] button:hover,
body.dsh-lg-on [class*="_treeBody"] [class*="_action"] button:hover,
body.dsh-lg-on [class*="_treeRoot"] [class*="_actions"] button:hover,
body.dsh-lg-on [class*="_treeRoot"] [class*="_action"] button:hover {
  transform: none !important;
  box-shadow: none !important;
  filter: none !important;
}
body.dsh-lg-on [class*="_treeBody"] button::before,
body.dsh-lg-on [class*="_treeBody"] button::after,
body.dsh-lg-on [class*="_treeItem"] button::before,
body.dsh-lg-on [class*="_treeItem"] button::after,
body.dsh-lg-on [class*="_treeNode"] button::before,
body.dsh-lg-on [class*="_treeNode"] button::after,
body.dsh-lg-on [class*="_treeRow"] button::before,
body.dsh-lg-on [class*="_treeRow"] button::after,
body.dsh-lg-on [class*="_treeBody"] [class*="_actions"] button::before,
body.dsh-lg-on [class*="_treeBody"] [class*="_actions"] button::after,
body.dsh-lg-on [class*="_treeBody"] [class*="_action"] button::before,
body.dsh-lg-on [class*="_treeBody"] [class*="_action"] button::after,
body.dsh-lg-on [class*="_treeRoot"] [class*="_actions"] button::before,
body.dsh-lg-on [class*="_treeRoot"] [class*="_actions"] button::after,
body.dsh-lg-on [class*="_treeRoot"] [class*="_action"] button::before,
body.dsh-lg-on [class*="_treeRoot"] [class*="_action"] button::after {
  content: none !important;
  display: none !important;
}
/* Sidebar footer & main settings trigger button (settings gear, collapse, panel rows):
   Completely remove system outline, box-shadows, and glass pseudo-elements outside dialogs to avoid dark halos or borders. */
body.dsh-lg-on :not([role="dialog"]) [class*="_footArea"] button,
body.dsh-lg-on :not([role="dialog"]) [class*="_settingsArea"] button,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] button,
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"],
body.dsh-lg-on :not([role="dialog"]) [class*="_panelRow"] {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
  transform: none !important;
  filter: none !important;
}
body.dsh-lg-on :not([role="dialog"]) [class*="_footArea"] button:focus,
body.dsh-lg-on :not([role="dialog"]) [class*="_footArea"] button:focus-visible,
body.dsh-lg-on :not([role="dialog"]) [class*="_settingsArea"] button:focus,
body.dsh-lg-on :not([role="dialog"]) [class*="_settingsArea"] button:focus-visible,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] button:focus,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] button:focus-visible,
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"]:focus,
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"]:focus-visible,
body.dsh-lg-on :not([role="dialog"]) [class*="_panelRow"]:focus,
body.dsh-lg-on :not([role="dialog"]) [class*="_panelRow"]:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
body.dsh-lg-on :not([role="dialog"]) [class*="_footArea"] button:hover,
body.dsh-lg-on :not([role="dialog"]) [class*="_settingsArea"] button:hover,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] button:hover,
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"]:hover {
  background: var(--dsw-alias-interactive-bg-hover) !important;
  box-shadow: none !important;
  transform: none !important;
  filter: none !important;
}
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"][aria-expanded="true"],
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] button[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover) !important;
  box-shadow: none !important;
  outline: none !important;
}
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"]::before,
body.dsh-lg-on :not([role="dialog"]) [class*="_trigger"]::after,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] > button::before,
body.dsh-lg-on :not([role="dialog"]) [class*="_triggerRow"] > button::after {
  content: none !important;
  display: none !important;
}
/* Sidebar tree items & Workbench TabBar (sessions, tasks, workspaces, workbench tabs) selected/active row: 75% transparency background */
body.dsh-lg-on [class*="_treeBody"] [class*="_sessionRow"][class*="_selected"],
body.dsh-lg-on [class*="_treeBody"] [class*="_sessionRow"][aria-selected="true"],
body.dsh-lg-on [class*="_treeBody"] [class*="_projectRow"][class*="_selected"],
body.dsh-lg-on [class*="_treeBody"] [class*="_projectRow"][aria-selected="true"],
body.dsh-lg-on [class*="_treeBody"] [class*="_searchResultRow"][class*="_selected"],
body.dsh-lg-on [class*="_treeBody"] [class*="_searchResultRow"][aria-selected="true"],
body.dsh-lg-on [class*="_treeBody"] [role="treeitem"][aria-selected="true"],
body.dsh-lg-on [class*="_treeBody"] [role="treeitem"][class*="_selected"],
body.dsh-lg-on [class*="_treeBody"] [data-selected="true"],
body.dsh-lg-on [class*="_treeBody"] [data-active="true"],
body.dsh-lg-on [class*="_treeRoot"] [role="treeitem"][aria-selected="true"],
body.dsh-lg-on [class*="_treeRoot"] [class*="_selected"],
body.dsh-lg-on [data-dsh-panel-host] [class*="_tabActive"],
body.dsh-lg-on [class*="_workbench"] [class*="_tabActive"],
body.dsh-lg-on [class*="_pane"] [class*="_tabActive"],
body.dsh-lg-on [class*="_bottomPanel"] [class*="_tabActive"] {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 20%, transparent) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
}
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_sessionRow"][class*="_selected"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_sessionRow"][aria-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_projectRow"][class*="_selected"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_projectRow"][aria-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_searchResultRow"][class*="_selected"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [class*="_searchResultRow"][aria-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [role="treeitem"][aria-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [role="treeitem"][class*="_selected"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [data-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeBody"] [data-active="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeRoot"] [role="treeitem"][aria-selected="true"],
body[data-ds-dark-theme].dsh-lg-on [class*="_treeRoot"] [class*="_selected"],
body[data-ds-dark-theme].dsh-lg-on [data-dsh-panel-host] [class*="_tabActive"],
body[data-ds-dark-theme].dsh-lg-on [class*="_workbench"] [class*="_tabActive"],
body[data-ds-dark-theme].dsh-lg-on [class*="_pane"] [class*="_tabActive"],
body[data-ds-dark-theme].dsh-lg-on [class*="_bottomPanel"] [class*="_tabActive"] {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #ffffff) 14%, rgba(255, 255, 255, 0.08)) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
}

/* ==========================================================================
   Tab Navigation & Segmented Controls (下划线导航 Tab 与分段胶囊选择器分离规范)
   1. 下划线导航 Tab（如设置页「插件配置 / 插件列表」、卡片内「状态/上下文/明细/签到」）：
      必须保持纯透明背景，绝对不加卡片外框、圆角或阴影，完整保留原汁原味的下划线指示条。
   2. 分段胶囊选择器（如「国内版 / 国际版」变体切换器、RadioGroup、ToggleGroup）：
      激活项呈现高对比度毛玻璃药丸卡片背景与圆角细边框，绝不下划线；未激活项透明。
   ========================================================================== */

/* 1. 下划线导航 Tab 基础与未选中状态：纯透明、无卡片外框、无圆角、无阴影
   严格限定于水平导航 Tab（如设置二级导航、卡片水平 Tab），排除垂直侧栏与模型选择器供应商列表 */
body.dsh-lg-on [class*="_tabs"] [class*="_tab"],
body.dsh-lg-on :not(header) > [role="tablist"]:not([aria-orientation="vertical"]):not([role="menu"] *):not([class*="model" i] *):not([class*="provider" i] *):not([class*="segmented" i]):not([class*="toggle" i]):not([class*="wbp-tabs"]):not([role="radiogroup"]) [role="tab"]:not([style*="border-radius"]):not([style*="borderRadius"]) {
  background: transparent !important;
  background-color: transparent !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.65)) !important;
  transition: color 0.15s ease !important;
}

/* 1.1 下划线导航 Tab 悬停状态：平滑提亮文字，保持纯透明背景无外框 */
body.dsh-lg-on [class*="_tabs"] [class*="_tab"]:hover,
body.dsh-lg-on :not(header) > [role="tablist"]:not([aria-orientation="vertical"]):not([role="menu"] *):not([class*="model" i] *):not([class*="provider" i] *):not([class*="segmented" i]):not([class*="toggle" i]):not([class*="wbp-tabs"]):not([role="radiogroup"]) [role="tab"]:not([style*="border-radius"]):not([style*="borderRadius"]):hover {
  background: transparent !important;
  background-color: transparent !important;
  box-shadow: none !important;
  transform: none !important;
  color: var(--dsw-alias-label-primary, #ffffff) !important;
}

/* 1.2 下划线导航 Tab 激活/选中状态：纯文字纯白高亮，背景透明，绝对无背景卡片框 */
body.dsh-lg-on [class*="_tabs"] [class*="_tab"]:is([data-active="true"], [aria-selected="true"], [data-state="active"]),
body.dsh-lg-on :not(header) > [role="tablist"]:not([aria-orientation="vertical"]):not([role="menu"] *):not([class*="model" i] *):not([class*="provider" i] *):not([class*="segmented" i]):not([class*="toggle" i]):not([class*="wbp-tabs"]):not([role="radiogroup"]) [role="tab"]:not([style*="border-radius"]):not([style*="borderRadius"]):is([data-active="true"], [aria-selected="true"], [data-state="active"]) {
  background: transparent !important;
  background-color: transparent !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-primary, #ffffff) !important;
  font-weight: 600 !important;
}

/* 1.3 确保原生 DSH 设置二级导航（如「插件配置 / 插件列表」）底部的 ::after 白色指示线明亮清晰 */
body.dsh-lg-on [class*="_tabs"] [class*="_tab"]:is([data-active="true"], [aria-selected="true"])::after {
  background: var(--dsw-alias-label-primary, #ffffff) !important;
  opacity: 1 !important;
}

/* 1.4 卡片内下划线 Tab（如 WorkBuddy「状态/上下文窗口/额度明细/签到日志」）保持底部指示线高亮 */
body.dsh-lg-on :not(header) > [role="tablist"]:not([aria-orientation="vertical"]):not([role="menu"] *):not([class*="model" i] *):not([class*="provider" i] *):not([class*="segmented" i]):not([class*="toggle" i]):not([class*="wbp-tabs"]):not([role="radiogroup"]) [role="tab"]:not([class*="_tab"]):not([style*="border-radius"]):not([style*="borderRadius"]):is([data-active="true"], [aria-selected="true"], [data-state="active"]) {
  border-bottom: 2px solid var(--dsw-alias-brand-primary, #ffffff) !important;
}

/* ==========================================================================
   2. 分段胶囊选择器（Segmented Control / Pill Switcher，如「国内版 / 国际版」变体切换）
   ========================================================================== */

/* 2.1 分段胶囊容器（底槽）：微暗半透明圆角凹槽，保证在液态玻璃下边界清晰 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i],
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i],
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i],
body.dsh-lg-on [role="tablist"][aria-label*="版本" i],
body.dsh-lg-on [role="tablist"][aria-label*="选择" i],
body.dsh-lg-on [class*="wbp-tabs"],
body.dsh-lg-on [class*="segmented" i]:not(button),
body.dsh-lg-on [role="radiogroup"] {
  background: rgba(0, 0, 0, 0.28) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  padding: 3px !important;
}

/* 2.2 分段胶囊子项交互过渡动画 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"],
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"],
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"],
body.dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"],
body.dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"],
body.dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"],
body.dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"],
body.dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"],
body.dsh-lg-on [class*="wbp-tabs"] [role="tab"],
body.dsh-lg-on [class*="wbp-tab"],
body.dsh-lg-on [class*="segmented" i] button,
body.dsh-lg-on [class*="Segmented"] button,
body.dsh-lg-on [class*="segmented" i] [role="tab"],
body.dsh-lg-on [class*="Segmented"] [role="tab"],
body.dsh-lg-on [class*="toggleGroup" i] button,
body.dsh-lg-on [class*="toggle" i] button,
body.dsh-lg-on [class*="pill" i] [role="tab"],
body.dsh-lg-on [class*="capsule" i] [role="tab"],
body.dsh-lg-on [role="radiogroup"] [role="radio"],
body.dsh-lg-on [role="radiogroup"] button {
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease !important;
}

/* 2.3 分段胶囊未激活项：透明底、透明边框、圆角药丸 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]),
body.dsh-lg-on [class*="wbp-tabs"] [role="tab"]:not([class*="Active"]):not([aria-selected="true"]):not([data-state="active"]),
body.dsh-lg-on [class*="wbp-tab"]:not([class*="Active"]):not([aria-selected="true"]):not([data-state="active"]),
body.dsh-lg-on [class*="segmented" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]),
body.dsh-lg-on [class*="Segmented"] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]),
body.dsh-lg-on [class*="toggleGroup" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]),
body.dsh-lg-on [class*="toggle" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]),
body.dsh-lg-on [class*="pill" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]),
body.dsh-lg-on [class*="capsule" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]),
body.dsh-lg-on [role="radiogroup"] [role="radio"]:not([aria-checked="true"]):not([data-state="checked"]):not([data-checked="true"]),
body.dsh-lg-on [role="radiogroup"] button:not([aria-checked="true"]):not([data-state="checked"]):not([data-checked="true"]) {
  background: transparent !important;
  border: 1px solid transparent !important;
  border-radius: 6px !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.65)) !important;
}

/* 2.4 分段胶囊未激活项悬停态 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"]:not([aria-selected="true"]):not([data-state="active"]):not([data-active="true"]):hover,
body.dsh-lg-on [class*="wbp-tabs"] [role="tab"]:not([class*="Active"]):not([aria-selected="true"]):not([data-state="active"]):hover,
body.dsh-lg-on [class*="wbp-tab"]:not([class*="Active"]):not([aria-selected="true"]):not([data-state="active"]):hover,
body.dsh-lg-on [class*="segmented" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]):hover,
body.dsh-lg-on [class*="Segmented"] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]):hover,
body.dsh-lg-on [class*="toggleGroup" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]):hover,
body.dsh-lg-on [class*="toggle" i] button:not([aria-selected="true"]):not([data-state="active"]):not([class*="Active"]):hover,
body.dsh-lg-on [class*="pill" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):hover,
body.dsh-lg-on [class*="capsule" i] [role="tab"]:not([aria-selected="true"]):not([data-state="active"]):hover,
body.dsh-lg-on [role="radiogroup"] [role="radio"]:not([aria-checked="true"]):not([data-state="checked"]):not([data-checked="true"]):hover,
body.dsh-lg-on [role="radiogroup"] button:not([aria-checked="true"]):not([data-state="checked"]):not([data-checked="true"]):hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.10)) !important;
  color: var(--dsw-alias-label-primary, #ffffff) !important;
}

/* 2.5 分段胶囊激活/选中项（Active Pill）：高对比度药丸卡片背景、圆角、立体浮起边框阴影、绝对不下划线 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body.dsh-lg-on [class*="wbp-tabs"] [role="tab"]:is([class*="Active"], [aria-selected="true"], [data-state="active"]),
body.dsh-lg-on [class*="wbp-tab"]:is([class*="Active"], [aria-selected="true"], [data-state="active"]),
body.dsh-lg-on [class*="segmented" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="Segmented"] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="segmented" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="Segmented"] [role="tab"]:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="toggleGroup" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="toggle" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body.dsh-lg-on [class*="pill" i] [role="tab"]:is([aria-selected="true"], [data-state="active"]),
body.dsh-lg-on [class*="capsule" i] [role="tab"]:is([aria-selected="true"], [data-state="active"]),
body.dsh-lg-on [role="radiogroup"] [role="radio"]:is([aria-checked="true"], [data-state="checked"], [data-checked="true"]),
body.dsh-lg-on [role="radiogroup"] button:is([aria-checked="true"], [data-state="checked"], [data-checked="true"]) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 24%, rgba(255, 255, 255, 0.20)) !important;
  border: 1px solid rgba(255, 255, 255, 0.32) !important;
  border-radius: 6px !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.22) !important;
  color: #ffffff !important;
  font-weight: 600 !important;
}

/* 2.6 暗色主题下的激活分段胶囊高光 */
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"]:is([aria-selected="true"], [data-state="active"], [data-active="true"]),
body[data-ds-dark-theme].dsh-lg-on [class*="wbp-tabs"] [role="tab"]:is([class*="Active"], [aria-selected="true"], [data-state="active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="wbp-tab"]:is([class*="Active"], [aria-selected="true"], [data-state="active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="segmented" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="Segmented"] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="segmented" i] [role="tab"]:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="Segmented"] [role="tab"]:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="toggleGroup" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="toggle" i] button:is([aria-selected="true"], [data-state="active"], [class*="Active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="pill" i] [role="tab"]:is([aria-selected="true"], [data-state="active"]),
body[data-ds-dark-theme].dsh-lg-on [class*="capsule" i] [role="tab"]:is([aria-selected="true"], [data-state="active"]),
body[data-ds-dark-theme].dsh-lg-on [role="radiogroup"] [role="radio"]:is([aria-checked="true"], [data-state="checked"], [data-checked="true"]),
body[data-ds-dark-theme].dsh-lg-on [role="radiogroup"] button:is([aria-checked="true"], [data-state="checked"], [data-checked="true"]) {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #ffffff) 22%, rgba(255, 255, 255, 0.18)) !important;
  border: 1px solid rgba(255, 255, 255, 0.30) !important;
  border-radius: 6px !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.50), inset 0 0 0 1px rgba(255, 255, 255, 0.20) !important;
  color: #ffffff !important;
  font-weight: 600 !important;
}

/* 2.7 分段胶囊绝不下划线：彻底隐藏伪元素底线，避免与下划线导航混淆 */
body.dsh-lg-on [role="tablist"][aria-label*="Version" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"][aria-label*="Selection" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"][aria-label*="Variant" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"][aria-label*="WorkBuddy" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"][aria-label*="版本" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"][aria-label*="选择" i] [role="tab"]::after,
body.dsh-lg-on [role="tablist"] [role="tab"][style*="border-radius"]::after,
body.dsh-lg-on [role="tablist"] [role="tab"][style*="borderRadius"]::after,
body.dsh-lg-on [class*="wbp-tabs"] [role="tab"]::after,
body.dsh-lg-on [class*="wbp-tab"]::after,
body.dsh-lg-on [class*="segmented" i] button::after,
body.dsh-lg-on [class*="Segmented"] button::after,
body.dsh-lg-on [class*="toggleGroup" i] button::after,
body.dsh-lg-on [role="radiogroup"] button::after {
  display: none !important;
}

/* ==========================================================================
   3. 模型选择器供应商分类列表（Provider Navigation List，如模型面板左侧栏）
   保持原生的高对比度圆角差异色半透明背景高亮，绝不下划线，完整展示左栏分类
   ========================================================================== */
body.dsh-lg-on [data-composer-card] [role="menu"] [role="tablist"] [role="tab"],
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] [role="tab"],
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] button {
  background: transparent !important;
  border-radius: 8px !important;
  border: none !important;
  border-bottom: none !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.70)) !important;
  transition: background 0.15s ease, color 0.15s ease !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] [role="tablist"] [role="tab"]:hover,
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] [role="tab"]:hover,
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] button:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #ffffff !important;
  border: none !important;
  border-bottom: none !important;
  box-shadow: none !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] [role="tablist"] [role="tab"]:is([aria-selected="true"], [data-active="true"], [data-selected="true"], [class*="active" i], [class*="selected" i]),
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] [role="tab"]:is([aria-selected="true"], [data-active="true"], [data-selected="true"], [class*="active" i], [class*="selected" i]),
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] button:is([aria-selected="true"], [data-active="true"], [data-selected="true"], [class*="active" i], [class*="selected" i]) {
  background: rgba(255, 255, 255, 0.16) !important;
  border-radius: 8px !important;
  border: none !important;
  border-bottom: none !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
  color: #ffffff !important;
  font-weight: 600 !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] [role="tablist"] [role="tab"]::after,
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="provider" i] [role="tab"]::after {
  display: none !important;
  content: none !important;
}

/* Water-drop icon for Liquid Glass settings section: pure CSS mask without DOM tearing */
[role="dialog"] [data-dsh-liquid-glass-settings-nav]:not([data-dsh-icon-theme-managed]) > svg:first-child {
  display: none !important;
}
[role="dialog"] [data-dsh-liquid-glass-settings-nav]:not([data-dsh-icon-theme-managed])::before {
  content: "" !important;
  display: inline-block !important;
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'/%3E%3C/svg%3E") center / contain no-repeat;
}
/* Settings dialog left-hand navigation items: strictly borderless, transparent, and clean without cards */
body.dsh-lg-on [role="dialog"] > div > div:first-child button,
body.dsh-lg-on [role="dialog"] [role="navigation"] button,
body.dsh-lg-on [role="dialog"] [class*="nav"] button,
body.dsh-lg-on [role="dialog"] [class*="side"] button,
body.dsh-lg-on [role="dialog"] [class*="menu"] button,
body.dsh-lg-on [role="dialog"] [class*="list"] button,
body.dsh-lg-on [role="dialog"] aside button,
body.dsh-lg-on [role="dialog"] [data-dsh-liquid-glass-settings-nav] {
  border: none !important;
  box-shadow: none !important;
  background: transparent !important;
  color: var(--dsw-alias-label-secondary) !important;
  transform: none !important;
  border-radius: 8px !important;
}
body.dsh-lg-on [role="dialog"] > div > div:first-child button:hover,
body.dsh-lg-on [role="dialog"] [role="navigation"] button:hover,
body.dsh-lg-on [role="dialog"] [class*="nav"] button:hover,
body.dsh-lg-on [role="dialog"] [class*="side"] button:hover,
body.dsh-lg-on [role="dialog"] [class*="menu"] button:hover,
body.dsh-lg-on [role="dialog"] [class*="list"] button:hover,
body.dsh-lg-on [role="dialog"] aside button:hover,
body.dsh-lg-on [role="dialog"] [data-dsh-liquid-glass-settings-nav]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.10)) !important;
  color: var(--dsw-alias-label-primary, #ffffff) !important;
  box-shadow: none !important;
  border: none !important;
  transform: none !important;
}
body.dsh-lg-on [role="dialog"] > div > div:first-child button[aria-selected="true"],
body.dsh-lg-on [role="dialog"] > div > div:first-child button[data-selected="true"],
body.dsh-lg-on [role="dialog"] [class*="nav"] button[aria-selected="true"],
body.dsh-lg-on [role="dialog"] [class*="sidebar"] button[aria-selected="true"],
body.dsh-lg-on [role="dialog"] aside button[aria-selected="true"],
body.dsh-lg-on [role="dialog"] [class*="nav"] button[data-selected="true"],
body.dsh-lg-on [role="dialog"] [class*="sidebar"] button[data-selected="true"],
body.dsh-lg-on [role="dialog"] [data-dsh-liquid-glass-settings-nav][aria-selected="true"],
body.dsh-lg-on [role="dialog"] [data-dsh-liquid-glass-settings-nav][data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.14)) !important;
  color: var(--dsw-alias-brand-primary, #3b82f6) !important;
  box-shadow: none !important;
  border: none !important;
  font-weight: 600 !important;
}
/* Settings dialog right-hand content area action buttons (file pickers, restore defaults, test buttons, etc.):
   Scoped strictly to form, section, group, and content wrappers. */
body.dsh-lg-on [role="dialog"] :is(form, section, [class*="content"], [class*="panel"], [class*="group"], [class*="body"], [class*="field"]) button:not([role="switch"]):not([role="tab"]):not([data-dsh-liquid-glass-settings-nav]):not([aria-label*="关闭" i]):not([aria-label*="close" i]) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 14%, rgba(0, 0, 0, 0.05)) !important;
  color: var(--dsw-alias-label-primary, #ffffff) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
  border-radius: 8px !important;
  font-weight: 500 !important;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, filter 0.15s ease !important;
  cursor: pointer !important;
}
body[data-ds-dark-theme].dsh-lg-on [role="dialog"] :is(form, section, [class*="content"], [class*="panel"], [class*="group"], [class*="body"], [class*="field"]) button:not([role="switch"]):not([role="tab"]):not([data-dsh-liquid-glass-settings-nav]):not([aria-label*="关闭" i]):not([aria-label*="close" i]) {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #ffffff) 18%, rgba(255, 255, 255, 0.08)) !important;
  border-color: rgba(255, 255, 255, 0.16) !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.10) !important;
  color: #ffffff !important;
}
body.dsh-lg-on [role="dialog"] :is(form, section, [class*="content"], [class*="panel"], [class*="group"], [class*="body"], [class*="field"]) button:not([role="switch"]):not([role="tab"]):not([data-dsh-liquid-glass-settings-nav]):not([aria-label*="关闭" i]):not([aria-label*="close" i]):hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 26%, rgba(255, 255, 255, 0.16)) !important;
  border-color: rgba(255, 255, 255, 0.32) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.24) !important;
  color: #ffffff !important;
  filter: brightness(1.12) !important;
  transform: translateY(-1px) !important;
}
body[data-ds-dark-theme].dsh-lg-on [role="dialog"] :is(form, section, [class*="content"], [class*="panel"], [class*="group"], [class*="body"], [class*="field"]) button:not([role="switch"]):not([role="tab"]):not([data-dsh-liquid-glass-settings-nav]):not([aria-label*="关闭" i]):not([aria-label*="close" i]):hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #ffffff) 28%, rgba(255, 255, 255, 0.20)) !important;
  border-color: rgba(255, 255, 255, 0.30) !important;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.20) !important;
  color: #ffffff !important;
  filter: brightness(1.15) !important;
  transform: translateY(-1px) !important;
}
body.dsh-lg-on [role="dialog"] :is(form, section, [class*="content"], [class*="panel"], [class*="group"], [class*="body"], [class*="field"]) button:not([role="switch"]):not([role="tab"]):not([data-dsh-liquid-glass-settings-nav]):not([aria-label*="关闭" i]):not([aria-label*="close" i]):active:not(:disabled) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 16%, rgba(0, 0, 0, 0.15)) !important;
  border-color: rgba(255, 255, 255, 0.20) !important;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.30) !important;
  transform: translateY(0) !important;
}
/* Sandbox mode trigger button: explicitly strip any glass effect so its
   dropdown menu (position:fixed) is not affected by backdrop-filter creating
   a new containing block. */
body.dsh-lg-on button[aria-label*="访问模式" i],
body.dsh-lg-on button[aria-label*="Access mode" i] {
  position: static !important;
  isolation: auto !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
body.dsh-lg-on button[aria-label*="访问模式" i]::before,
body.dsh-lg-on button[aria-label*="Access mode" i]::before {
  display: none !important;
}
/* Sidebar logo / branding: exclude from the liquid glass effect — the square
   shape looks odd when refracted. The logo is a wordmark SVG aria-hidden inside
   a button. Reset glass on the SVG itself and suppress the ::before glass layer
   on buttons containing the wordmark. */
body.dsh-lg-on [class*="_root"]:has([class*="_treeBody"]) svg[aria-hidden="true"] {
  filter: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
body.dsh-lg-on [class*="_root"]:has([class*="_treeBody"]) button:has(svg[aria-hidden="true"])::before {
  display: none !important;
}
/* Model selector popup: FULL-SCREEN.
   Gated on :has(.scrollable) so this FULL-SCREEN treatment only applies to the
   model/effort selector menu (which renders a .scrollable pane). The access-mode
   dropdown in the composer modes row is also [role="menu"] but has no
   .scrollable; leaving it a normal small dropdown instead of a fullscreen
   overlay. */
body.dsh-lg-on [data-composer-card] [role="menu"]:has(.scrollable) {
  position: fixed !important;
  inset: 0 !important;
  z-index: 1000 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"]:has(.scrollable)::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, 0.30);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"]:has(.scrollable)::before {
  background: rgba(0, 0, 0, 0.55);
}
/* The inner scrollable groups container: centered frosted-glass panel.
   Width expanded to min(94vw, 760px) to comfortably house two-column provider + model layout
   without horizontal truncation or horizontal scrollbars. */
body.dsh-lg-on [data-composer-card] [role="menu"] .scrollable {
  max-width: min(94vw, 760px) !important;
  min-width: min(90vw, 680px) !important;
  max-height: min(84vh, 720px) !important;
  width: min(94vw, 740px) !important;
  margin: 0 auto !important;
  border-radius: 16px !important;
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  backdrop-filter: blur(28px) saturate(160%);
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 78%, transparent) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 24px 60px rgba(0, 0, 0, 0.35);
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"] .scrollable {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2a2a2a) 84%, transparent) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    0 24px 60px rgba(0, 0, 0, 0.55);
}

/* Model selector search bar / input header: spans full 100% width across the panel */
body.dsh-lg-on [data-composer-card] [role="menu"] input,
body.dsh-lg-on [data-composer-card] [role="menu"] :has(> input),
body.dsh-lg-on [data-composer-card] [role="menu"] [class*="search" i] {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 100% !important;
  box-sizing: border-box !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] input {
  height: 38px !important;
  padding: 0 12px !important;
  border-radius: 8px !important;
  background: rgba(0, 0, 0, 0.25) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  color: #ffffff !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] input:focus {
  border-color: rgba(255, 255, 255, 0.40) !important;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.12) !important;
  outline: none !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] > :first-child:has(input),
body.dsh-lg-on [data-composer-card] [role="menu"] > :first-child[class*="search" i] {
  width: 100% !important;
  max-width: 100% !important;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  overflow: visible !important;
}

/* The legacy root pane (Model / Effort cells): only applies when it does NOT contain search / input */
body.dsh-lg-on [data-composer-card] [role="menu"] > :first-child:not(.scrollable):not(:has(input)):not([class*="search" i]) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 82%, transparent) !important;
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  backdrop-filter: blur(28px) saturate(160%);
  border-radius: 16px !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 24px 60px rgba(0, 0, 0, 0.35);
  width: 280px !important;
  overflow: hidden !important;
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"] > :first-child:not(.scrollable):not(:has(input)):not([class*="search" i]) {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2a2a2a) 86%, transparent) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    0 24px 60px rgba(0, 0, 0, 0.55);
}
/* Root pane cells (Model / Effort buttons): glass-styled menu rows. */
body.dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitem"] {
  background: transparent !important;
  border-radius: 8px !important;
  margin: 2px 6px !important;
  padding: 10px 12px !important;
  color: var(--dsw-alias-label-primary) !important;
  transition: background 0.15s !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitem"]:hover {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 20%, transparent) !important;
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitem"]:hover {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2a2a2a) 30%, transparent) !important;
}
/* Provider group headings inside the full-screen picker. The actual DOM uses
   a plain div with class _7KE1Ra_groupTitle (no role="presentation"), so we
   target the first child div inside each [role="group"] section. */
body.dsh-lg-on [data-composer-card] [role="menu"] [role="group"] > div:first-child {
  padding: 14px 18px 6px !important;
  font-weight: 600 !important;
  letter-spacing: 0.02em !important;
  color: var(--dsw-alias-brand-primary) !important;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  font-size: 13px !important;
}
/* Model option items (role="menuitemradio"): full-width single-column rows with space-between layout */
body.dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitemradio"] {
  border-radius: 8px !important;
  margin: 1px 0 !important;
  padding: 8px 12px !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  transition: background 0.15s !important;
  background: transparent !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitemradio"]:hover {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 18%, transparent) !important;
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitemradio"]:hover {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2a2a2a) 26%, transparent) !important;
}
/* Selected model option: accent highlight. */
body.dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitemradio"][aria-checked="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent) !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent) !important;
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"] button[role="menuitemradio"][aria-checked="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent) !important;
}
/* Provider groups in model list: single-column vertical list with 100% width */
body.dsh-lg-on [data-composer-card] [role="menu"] .scrollable [role="group"] {
  display: flex !important;
  flex-direction: column !important;
  gap: 2px !important;
  padding: 0 6px 6px !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"] .scrollable [role="group"] > div:first-child {
  padding: 12px 10px 4px !important;
}
/* Click-to-dismiss: cursor pointer on the backdrop, default cursor on the panel. */
body.dsh-lg-on [data-composer-card] [role="menu"] {
  cursor: pointer;
}
body.dsh-lg-on [data-composer-card] [role="menu"] .scrollable {
  cursor: default;
}
/* Access-mode dropdown glass (see EDGE note below). */
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 74%, transparent) !important;
  -webkit-backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  backdrop-filter: blur(var(--dsh-lg-blur, 24px)) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    inset 0 0 18px rgba(255, 255, 255, 0.08),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.14),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.14),
    0 8px 32px rgba(0, 0, 0, 0.30);
}
body[data-ds-dark-theme].dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) {
  background: color-mix(in srgb, var(--dsh-lg-tint-dark, #2a2a2a) 78%, transparent) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.10),
    inset 0 0 18px rgba(255, 255, 255, 0.06),
    inset 2px 2px 6px 2px rgba(255, 255, 255, 0.08),
    inset -2px -2px 4px -1px rgba(255, 255, 255, 0.08),
    0 8px 32px rgba(0, 0, 0, 0.50);
}
/* Access-mode dropdown: harness inner layers (viewport / itemWrap / item) carry
   their own opaque surface + backdrop-filter. Strip all of them so only the
   frosted :menu glass shows (no box-in-box). [class*="_item"] also covers the
   menu buttons, and a hover highlight keeps the rows usable on the glass. */
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) [role="presentation"],
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) [class*="_viewport"],
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) [class*="_itemWrap"],
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) [class*="_item"],
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) button[role="menuitem"] {
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  box-shadow: none !important;
}
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) button[role="menuitem"]:hover,
body.dsh-lg-on [data-composer-card] [role="menu"]:not(:has(.scrollable)) button[role="menuitemradio"]:hover {
  background: color-mix(in srgb, var(--dsh-lg-tint, #ffffff) 20%, transparent) !important;
}

`;

/** Body CSS variables the sheet consumes (retracted on dispose). */
const BODY_VARS = ['--dsh-lg-blur', '--dsh-lg-bg-blur', '--dsh-lg-brightness', '--dsh-lg-refraction', '--dsh-lg-scrim', '--dsh-lg-tint', '--dsh-lg-tint-dark', '--dsh-lg-tool-text-color'] as const;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'ogg', 'ogv'];

const isHttp = (value: string) => /^https?:\/\//i.test(value);
const localUrl = (value: string) => `${WALLPAPER_ROUTE}/${value.replace(/^\/+/, '')}`;
const proxied = (value: string, useProxy: boolean) =>
  useProxy && isHttp(value) ? `${PROXY_ROUTE}?u=${encodeURIComponent(value)}` : value;

/** Serialize the demo.html tunables into the iframe query string; demo.html
 * reads these back and drives its animations from them. */
const demoQuery = (d: LiquidGlassSettings['demo']): string => {
  const p = new URLSearchParams();
  p.set('sp', String(d.speed));
  p.set('bl', String(d.blobs));
  p.set('cc', String(d.colorCycle));
  p.set('bf', String(d.blur));
  p.set('op', String(d.opacity));
  p.set('w', d.wash ? '1' : '0');
  return p.toString();
};

/** Readability veil over the wallpaper; follows the base palette. */
function scrimValue(s: LiquidGlassSettings): string {
  if (!s.enabled || s.wallpaper.kind === 'none' || s.wallpaper.value.trim() === '') return '0';
  return document.body.hasAttribute('data-ds-dark-theme') ? '0.26' : '0.1';
}

/**
 * DOM applier: owns one stylesheet and one fixed background layer element.
 * The composer input box and queue dock carry their own backdrop-filter
 * (see SHEET) so the wallpaper stays sharp and the frosting is visible at the
 * box bounds. Forwards the token overrides into ctx.theme and exposes live
 * CSS variables the stylesheet consumes. Everything retracts on dispose.
 */
class LiquidGlassApplier {
  private readonly style: HTMLStyleElement;
  private readonly layer: HTMLDivElement;
  private filterEl: SVGSVGElement | null = null;
  private mediaKey = '';
  private removeOverrides: (() => void) | undefined;

  constructor(private readonly theme: ClientServices['theme']) {
    this.style = document.createElement('style');
    this.style.id = STYLE_ID;
    this.style.textContent = SHEET;
    document.head.appendChild(this.style);
    this.layer = document.createElement('div');
    this.layer.id = BG_LAYER_ID;
    document.body.prepend(this.layer);
    this.injectFilter();
  }

  private injectFilter(): void {
    if (document.getElementById(FILTER_ID)) return;
    const temp = document.createElement('div');
    temp.innerHTML = FILTER_SVG;
    const svg = temp.firstElementChild;
    if (!svg) return;
    document.body.appendChild(svg);
    this.filterEl = svg as SVGSVGElement;
  }

  apply(settings: LiquidGlassSettings): void {
    this.removeOverrides?.();
    this.removeOverrides = undefined;
    // The `dsh-lg-on` class gates every stylesheet effect rule (frost, lens
    // edges, send-button lens, dialog glass): with the switch OFF nothing
    // visual remains, even though the stylesheet itself stays mounted.
    document.body.classList.toggle('dsh-lg-on', settings.enabled);
    const tokens = buildTokens(settings);
    if (settings.enabled && Object.keys(tokens).length > 0) {
      this.removeOverrides = this.theme.overrideTokens(OVERRIDE_SOURCE, tokens);
    }

    const g = settings.glass;
    const body = document.body;
    body.style.setProperty('--dsh-lg-blur', `${g.frosted ? clampNum(g.blur, 0, 60, DEFAULTS.glass.blur) : 0}px`);
    body.style.setProperty('--dsh-lg-bg-blur', `${clampNum(g.bgBlur, 0, 60, DEFAULTS.glass.bgBlur)}px`);
    body.style.setProperty('--dsh-lg-brightness', String(clampNum(g.brightness, 0.2, 1.6, DEFAULTS.glass.brightness)));
    body.style.setProperty('--dsh-lg-refraction', String(clampNum(g.refraction, 0, 1, DEFAULTS.glass.refraction)));
    body.style.setProperty('--dsh-lg-scrim', scrimValue(settings));
    const tint = scaleTint(g.tint, clampNum(g.glassBrightness, 0.2, 1.6, DEFAULTS.glass.glassBrightness));
    body.style.setProperty('--dsh-lg-tint', tint);
    body.style.setProperty('--dsh-lg-tint-dark', darkGlass(tint));
    body.style.setProperty('--dsh-lg-tool-text-color', g.toolTextColor || '');
    // Update the SVG filter's displacement scale from the live setting.
    if (this.filterEl) {
      const disp = this.filterEl.querySelector('feDisplacementMap');
      if (disp) disp.setAttribute('scale', String(clampNum(g.edgeRefractionScale, 0, 200, DEFAULTS.glass.edgeRefractionScale)));
    }

    this.syncMedia(settings);
  }

  /** Palette flips only refresh the veil; tokens re-stack via the theme service. */
  refreshScrim(): void {
    document.body.style.setProperty('--dsh-lg-scrim', scrimValue(readStoredSettings()));
  }

  /** Build one wallpaper media element (img / video / iframe) for a kind+value. */
  private buildMedia(
    kind: WallpaperKind,
    value: string,
    proxy: boolean,
    muted: boolean,
    demo: LiquidGlassSettings['demo'],
  ): HTMLElement {
    const isLocalImage = kind === 'local' && IMAGE_EXTS.includes(value.split('.').pop()?.toLowerCase() ?? '');
    const isLocalVideo = kind === 'local' && VIDEO_EXTS.includes(value.split('.').pop()?.toLowerCase() ?? '');
    if (kind === 'image' || isLocalImage) {
      const img = document.createElement('img');
      img.src = isHttp(value) ? proxied(value, proxy) : localUrl(value);
      img.alt = '';
      return img;
    }
    if (kind === 'video' || isLocalVideo) {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = muted;
      video.loop = true;
      video.playsInline = true;
      video.src = isHttp(value) ? proxied(value, proxy) : localUrl(value);
      return video;
    }
    const iframe = document.createElement('iframe');
    // `allow-same-origin` is intentionally omitted for `kind: 'url'` (web
    // links): a third-party page must not access the harness origin (cookies,
    // localStorage, API). Local files (demo.html, uploaded HTML/images/video)
    // need same-origin to load through the wallpaper route, so those fall
    // through to the general sandbox below.
    if (kind === 'url') {
      iframe.setAttribute('sandbox', 'allow-scripts');
    } else {
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    }
    if (kind === 'html' && value.includes('<')) {
      iframe.srcdoc = value;
    } else {
      let src = isHttp(value) ? proxied(value, proxy) : localUrl(value);
      // The built-in demo.html reads its tunables from the query string.
      if (value.trim() === 'demo.html') src += `?${demoQuery(demo)}`;
      iframe.src = src;
    }
    return iframe;
  }

  private syncMedia(settings: LiquidGlassSettings): void {
    const w = settings.wallpaper;
    const active = settings.enabled && w.kind !== 'none' && w.value.trim() !== '';
    if (!active) {
      this.mediaKey = '';
      this.layer.replaceChildren();
      return;
    }
    const value = w.value.trim();
    const media = this.buildMedia(w.kind, value, w.proxy, w.muted, settings.demo);
    const src = (media as { src?: string }).src ?? '';
    const key = `${media.tagName}:${src}:${(media as { srcdoc?: string }).srcdoc ?? ''}`;
    // Rebuild children only when the wallpaper actually changed, so slider
    // tweaks never reload an iframe/video.
    if (key === this.mediaKey && this.layer.children.length > 0) {
      // A mute toggle updates the existing video in place (no reload).
      const existing = this.layer.children[0];
      const next = media as { muted?: boolean };
      if (existing.tagName === 'VIDEO' && typeof next.muted === 'boolean' && (existing as HTMLVideoElement).muted !== next.muted) {
        (existing as HTMLVideoElement).muted = next.muted;
      }
      return;
    }
    this.mediaKey = key;
    this.layer.replaceChildren();
    this.layer.appendChild(media);
    const scrim = document.createElement('div');
    scrim.id = SCRIM_ID;
    this.layer.appendChild(scrim);
  }

  dispose(): void {
    this.removeOverrides?.();
    this.removeOverrides = undefined;
    this.mediaKey = '';
    this.style.remove();
    this.layer.remove();
    this.filterEl?.remove();
    this.filterEl = null;
    document.body.classList.remove('dsh-lg-on');
    const body = document.body;
    for (const name of BODY_VARS) body.style.removeProperty(name);
    // Drop the error banner if one was created during this fiber's lifetime —
    // the div is only ever appended by showBanner() on failure, so removing it
    // here guarantees a disabled/unloaded plugin leaves zero DOM behind.
    document.getElementById('dsh-liquid-glass-error')?.remove();
  }
}

// ── settings panel store ─────────────────────────────────────────────────────

interface PanelState {
  settings: LiquidGlassSettings;
  revision: number;
}

type PanelActions = {
  sync: (d: PanelState, settings: LiquidGlassSettings, revision: number) => void;
};

type PanelBakedActions = {
  sync: (settings: LiquidGlassSettings, revision: number) => void;
};

type PanelStoreHandle = import('@deepseek-ai/dsh-client-store').EngineStoreHandle<PanelState, PanelActions>;

function createPanelStore(): PanelStoreHandle {
  return defineStore<PanelState, PanelActions>({
    init: (): PanelState => ({ settings: { ...DEFAULTS }, revision: -1 }),
    actions: {
      sync(d, settings, revision) {
        if (revision <= d.revision) return;
        d.settings = { ...settings };
        d.revision = revision;
      },
    },
  });
}

// ── settings panel component ────────────────────────────────────────────────

const KIND_LABELS: Record<WallpaperKind, string> = {
  none: '关闭',
  url: '网页链接',
  html: '本地 HTML / 网页',
  image: '图片',
  video: '视频',
  local: '本地文件',
};

interface PanelProps {
  useStore: <S>(sel: (s: PanelState) => S) => S;
  update: (
    path: 'enabled' | 'wallpaper' | 'glass' | 'demo',
    value: boolean | LiquidGlassSettings['wallpaper'] | LiquidGlassSettings['glass'] | LiquidGlassSettings['demo'],
  ) => void;
  reset: () => void;
}

function LiquidGlassPanel({ useStore, update, reset }: PanelProps) {
  const s = useStore((st) => st.settings);
  const g = s.glass;
  const d = s.demo;
  const w = s.wallpaper;

  const section: CSSProperties = {
    padding: '16px 0',
    borderBottom: '1px solid var(--dsw-alias-border-l2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 13,
    color: 'var(--dsw-alias-label-secondary)',
  };
  const input: CSSProperties = {
    background: 'var(--dsw-specific-input-major)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 13,
    minWidth: 0,
  };
  const group: CSSProperties = {
    padding: '14px 16px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-1)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };
  const groupTitle: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' };
  const fieldLabel: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' };

  const patch = (
    path: 'glass' | 'wallpaper' | 'demo',
    partial: Partial<LiquidGlassSettings['glass'] | LiquidGlassSettings['wallpaper'] | LiquidGlassSettings['demo']>,
  ) => update(path, { ...s[path], ...partial });

  /** Upload a picked file to the host wallpaper dir and use it as the value. */
  const pickLocalFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const name = await uploadLocalFile(file);
      patch('wallpaper', { value: name });
    } catch (error) {
      showBanner(`壁纸文件上传失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const isLocalKind = (LOCAL_FILE_KINDS as readonly string[]).includes(w.kind);
  const isVideoKind = w.kind === 'video' || (w.kind === 'local' && VIDEO_EXTS.includes(w.value.split('.').pop()?.toLowerCase() ?? ''));

  return (
    <div style={{ width: '100%', maxWidth: 560, padding: '4px 0 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={section}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>液态玻璃</div>
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
          动态壁纸 + 磨砂玻璃质感。设置保存在浏览器本地。
        </div>
        <label style={row}>
          <span>启用液态玻璃</span>
          <input type="checkbox" checked={s.enabled} onChange={() => update('enabled', !s.enabled)} />
        </label>
      </div>

      {/* ── 页面背景 ─────────────────────────────────────────────────────── */}
      <div style={group}>
        <div style={groupTitle}>页面背景</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>壁纸类型</span>
          <select
            style={input}
            value={w.kind}
            onChange={(e) => patch('wallpaper', { kind: e.target.value as WallpaperKind })}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {/* demo.html is a fixed built-in option, always selectable. */}
          <button
            type="button"
            style={{ ...input, cursor: 'pointer', alignSelf: 'flex-start' }}
            onClick={() => patch('wallpaper', { kind: 'local', value: 'demo.html' })}
          >
            使用内置演示壁纸 demo.html
          </button>
          {w.kind !== 'none' && (
            <>
              {isLocalKind ? (
                // Local-file kinds: the whole box is a label for a hidden file
                // input, so clicking it opens the system file picker; the
                // upload writes the file into the host wallpaper dir.
                <label
                  style={{
                    ...input,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title="点击选择本地文件"
                >
                  <input
                    type="file"
                    accept={LOCAL_ACCEPT[w.kind] ?? ''}
                    style={{ display: 'none' }}
                    onChange={(e) => { void pickLocalFile(e); }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '6px 10px' }}>
                    {w.value.trim() !== '' ? w.value : '点击选择本地文件…'}
                  </span>
                  <span style={{ flex: 'none', fontSize: 12, color: 'var(--dsw-alias-brand-primary)', paddingRight: 10 }}>
                    选择文件
                  </span>
                </label>
              ) : (
                <input
                  style={input}
                  placeholder="网页链接"
                  value={w.value}
                  onChange={(e) => patch('wallpaper', { value: e.target.value })}
                />
              )}
              {w.kind === 'url' && (
                <label style={row}>
                  <span>网页链接走代理（绕过 X-Frame-Options）</span>
                  <input type="checkbox" checked={w.proxy} onChange={(e) => patch('wallpaper', { proxy: e.target.checked })} />
                </label>
              )}
              {isVideoKind && (
                <label style={row}>
                  <span>静音播放（取消后视频带声音，可能被浏览器阻止自动播放）</span>
                  <input type="checkbox" checked={w.muted} onChange={(e) => patch('wallpaper', { muted: e.target.checked })} />
                </label>
              )}
            </>
          )}
          <label style={row}>
            <span>背景模糊（{g.bgBlur}px）</span>
            <input type="range" min={0} max={60} step={1} value={g.bgBlur} onChange={(e) => patch('glass', { bgBlur: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>背景亮度（{g.brightness.toFixed(2)}）</span>
            <input type="range" min={0.2} max={1.6} step={0.05} value={g.brightness} onChange={(e) => patch('glass', { brightness: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      {/* ── demo.html 壁纸设置（仅当壁纸是 demo.html 时生效） ───────────── */}
      {w.value.trim() === 'demo.html' && w.kind !== 'none' && (
        <div style={group}>
          <div style={groupTitle}>demo.html 演示壁纸设置</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={row}>
              <span>动画速度（×{d.speed.toFixed(1)}）</span>
              <input type="range" min={0.1} max={4} step={0.1} value={d.speed} onChange={(e) => patch('demo', { speed: Number(e.target.value) })} />
            </label>
            <label style={row}>
              <span>色块数量（{d.blobs} 个）</span>
              <input type="range" min={1} max={6} step={1} value={d.blobs} onChange={(e) => patch('demo', { blobs: Number(e.target.value) })} />
            </label>
            <label style={row}>
              <span>颜色变化（{d.colorCycle}/10，0=静态）</span>
              <input type="range" min={0} max={10} step={1} value={d.colorCycle} onChange={(e) => patch('demo', { colorCycle: Number(e.target.value) })} />
            </label>
            <label style={row}>
              <span>色块模糊（{d.blur}px）</span>
              <input type="range" min={10} max={140} step={5} value={d.blur} onChange={(e) => patch('demo', { blur: Number(e.target.value) })} />
            </label>
            <label style={row}>
              <span>色块不透明度（{d.opacity.toFixed(2)}）</span>
              <input type="range" min={0.2} max={1} step={0.05} value={d.opacity} onChange={(e) => patch('demo', { opacity: Number(e.target.value) })} />
            </label>
            <label style={row}>
              <span>背景渐变流动</span>
              <input type="checkbox" checked={d.wash} onChange={(e) => patch('demo', { wash: e.target.checked })} />
            </label>
          </div>
        </div>
      )}

      {/* ── 输入卡片 · 磨砂玻璃 ─────────────────────────────────────────── */}
      <div style={group}>
        <div style={groupTitle}>输入卡片 · 磨砂玻璃</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={row}>
            <span>磨砂效果</span>
            <input type="checkbox" checked={g.frosted} onChange={(e) => patch('glass', { frosted: e.target.checked })} />
          </label>
          <label style={row}>
            <span>磨砂强度（{g.blur}px）</span>
            <input type="range" min={0} max={60} step={1} value={g.blur} onChange={(e) => patch('glass', { blur: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>边缘折射（{g.refraction.toFixed(2)}）</span>
            <input type="range" min={0} max={1} step={0.05} value={g.refraction} onChange={(e) => patch('glass', { refraction: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>玻璃颜色</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(g.tint) ? g.tint : '#ffffff'} onChange={(e) => patch('glass', { tint: e.target.value })} />
              <input style={{ ...input, width: 90 }} value={g.tint} onChange={(e) => patch('glass', { tint: e.target.value })} />
            </span>
          </label>
          <label style={row}>
            <span>玻璃不透明度（{g.tintOpacity.toFixed(2)}）</span>
            <input type="range" min={0} max={1} step={0.05} value={g.tintOpacity} onChange={(e) => patch('glass', { tintOpacity: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>玻璃亮度（{g.glassBrightness.toFixed(2)}）</span>
            <input type="range" min={0.2} max={1.6} step={0.05} value={g.glassBrightness} onChange={(e) => patch('glass', { glassBrightness: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>边缘折射（{g.edgeRefractionScale}）</span>
            <input type="range" min={0} max={200} step={5} value={g.edgeRefractionScale} onChange={(e) => patch('glass', { edgeRefractionScale: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      {/* ── 代码与文字 ───────────────────────────────────────────────────── */}
      <div style={group}>
        <div style={groupTitle}>代码与文字</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={row}>
            <span>代码块背景（{g.codeBlockOpacity.toFixed(2)}）</span>
            <input type="range" min={0.2} max={1} step={0.05} value={g.codeBlockOpacity} onChange={(e) => patch('glass', { codeBlockOpacity: Number(e.target.value) })} />
          </label>
          <label style={row}>
            <span>操作文字颜色</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(g.toolTextColor) ? g.toolTextColor : '#ffffff'} onChange={(e) => patch('glass', { toolTextColor: e.target.value })} />
              <input style={{ ...input, width: 90 }} value={g.toolTextColor || '(默认)'} onChange={(e) => patch('glass', { toolTextColor: e.target.value })} />
            </span>
          </label>
        </div>
      </div>

      <button
        type="button"
        style={{ ...input, alignSelf: 'flex-start', cursor: 'pointer' }}
        onClick={reset}
      >
        恢复默认
      </button>
    </div>
  );
}

// ── plugin body ─────────────────────────────────────────────────────────────

interface ClientServices {
  theme: {
    overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void;
  };
  on?(event: string, listener: (...args: unknown[]) => void): () => void;
  effect(disposer: () => unknown, label?: string): void;
  slots?: {
    inject(key: string, fn: () => unknown): unknown;
    register(options: Record<string, unknown>, component: unknown): () => void;
  };
}

/**
 * Cordis service dependencies (SERVICE names, not package ids — the client
 * loader builds the fiber inject map from this exported array). Mirrors the
 * shipped dsh-ui-appearance / dsh-dream-skin plugins: slots + locale + theme.
 */
export const inject = ['slots', 'locale', 'theme'];

/** Show a visible in-page banner so apply outcome is observable without devtools. */
function showBanner(message: string, color = '#b91c1c'): void {
  try {
    let el = document.getElementById('dsh-liquid-glass-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dsh-liquid-glass-error';
      el.style.cssText =
        `position:fixed;top:8px;right:8px;z-index:99999;max-width:70vw;background:${color};color:#fff;` +
        'font:12px/1.5 system-ui,sans-serif;padding:8px 12px;border-radius:8px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = `[liquid-glass] ${message}`;
  } catch {
    /* banner must never throw */
  }
}

/** Run a step and swallow+report failures so the theme can never fail the web boot. */
function safe(step: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    console.error(`[liquid-glass] ${step} failed:`, error);
    showBanner(`${step} failed: ${message}`);
  }
}

/**
 * Client plugin body. Everything runs behind a top-level guard: a theme
 * plugin must never take the whole web boot down with it (the shell's
 * fail-loud sweep rejects the app when ANY entry fails to activate).
 * @param ctx - client cordis context (slots + locale + theme provided).
 */
export function apply(ctx: ClientContext): void {
  try {
    applyCore(ctx);
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    console.error('[liquid-glass] apply failed:', error);
    showBanner(`apply failed: ${message}`);
  }
}

function applyCore(ctx: ClientContext): void {
  const client = ctx as unknown as ClientServices;

  let current = readStoredSettings();
  let revision = 0;
  let applier: LiquidGlassApplier | undefined;
  const store = createPanelStore();
  let boundActions: PanelBakedActions | undefined;

  const publish = (): void => {
    revision += 1;
    boundActions?.sync(current, revision);
    applier?.apply(current);
  };

  // DOM applier: created with the fiber, retracts everything on dispose.
  client.effect(() => {
    applier = new LiquidGlassApplier(client.theme);
    applier.apply(current);
    return () => {
      applier?.dispose();
      applier = undefined;
    };
  }, 'liquid-glass: DOM applier');

  // Palette flips only refresh the readability veil (token layers re-stack
  // through the theme service itself).
  const offThemeChange = client.on?.('theme/change', () => safe('theme-change scrim', () => applier?.refreshScrim()));
  client.effect(() => offThemeChange, 'liquid-glass: theme-change scrim');

  const scheduleTask = (fn: () => void): void => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(fn);
    } else {
      queueMicrotask(fn);
    }
  };

  // Model menu behaviour: clicking the composer model selector opens a two-pane
  // menu (a "root" pane all-in-one list, then a model list). Users asked to skip
  // the intermediate root pane and jump straight to the model list, render it in
  // two columns (see SHEET), and dismiss it by clicking empty space.
  // Implementation: a MutationObserver watches for the full-screen model menu
  // to appear; while the root pane (first child, not .scrollable) is visible we
  // programmatically click its "模型/Model" menuitem to advance to the model
  // list. A capture-phase click listener dismisses the menu when the backdrop
  // (the menu container itself) is clicked. Everything is gated on the theme
  // being enabled and retracted on dispose.
  client.effect(() => {
    let observer: MutationObserver | undefined;
    let scheduled = false;
    const navigate = (): void => {
      if (!document.body.classList.contains('dsh-lg-on')) return;
      const menu = document.querySelector<HTMLElement>('[data-composer-card] [role="menu"]');
      if (!menu) return;
      // ONLY drive the FULL-SCREEN model/effort selector: it renders .scrollable
      // and was styled position:fixed. Other [role="menu"] popovers inside the
      // composer card — e.g. the access-mode dropdown (no .scrollable, default
      // positioning) — must keep their own normal interaction and not be
      // auto-navigated or auto-clicked here.
      if (getComputedStyle(menu).position !== 'fixed') return;
      // Already looking at the model list? Do nothing.
      const scrollable = menu.querySelector('.scrollable');
      if (scrollable && getComputedStyle(scrollable).display !== 'none') return;
      // Root pane visible (first child that isn't .scrollable), and actually
      // being shown → find and click the "Model" cell. Guard against duplicate
      // dispatches with a transient flag so React state settles.
      const rootPane = Array.from(menu.children).find(
        (n) => !(n instanceof HTMLElement) || !n.classList.contains('scrollable'),
      ) as HTMLElement | undefined;
      if (!rootPane) return;
      const style = getComputedStyle(rootPane);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (rootPane.dataset.lgSkipHandled === '1') return;
      rootPane.dataset.lgSkipHandled = '1';
      const cells = Array.from(rootPane.querySelectorAll<HTMLElement>('button[role="menuitem"]'));
      const modelCell = cells.find((b) => /模型|model/i.test(b.textContent ?? '')) ?? cells[0];
      if (!modelCell) {
        // Nothing clickable yet — clear the flag so a later pass can retry.
        delete rootPane.dataset.lgSkipHandled;
        return;
      }
      // Defer so the menu has settled into the DOM before we click it.
      scheduleTask(() => {
        try {
          modelCell.click();
        } catch {
          /* the cell may have been removed already */
        } finally {
          delete rootPane.dataset.lgSkipHandled;
        }
      });
    };

    // Catch the menu being added/removed with animation frame debouncing.
    observer = new MutationObserver((mutations) => {
      if (!document.body.classList.contains('dsh-lg-on')) return;
      let mightHaveMenu = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i];
            if (node.nodeType === 1) {
              const el = node as Element;
              if (el.getAttribute('role') === 'menu' || el.querySelector?.('[role="menu"]')) {
                mightHaveMenu = true;
                break;
              }
            }
          }
          if (mightHaveMenu) break;
        }
      }
      if (!mightHaveMenu) return;
      if (scheduled) return;
      scheduled = true;
      scheduleTask(() => {
        scheduled = false;
        navigate();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Click empty area → dismiss. The full-screen menu is display:flex centering
    // its panels; a click whose target is the menu container itself (the backdrop
    // area outside the panels) closes it with an Escape key event.
    const dismiss = (e: MouseEvent): void => {
      if (!document.body.classList.contains('dsh-lg-on')) return;
      const menu = document.querySelector<HTMLElement>('[data-composer-card] [role="menu"]');
      if (!menu || !menu.isConnected) return;
      // Only the full-screen model selector dismisses on backdrop click; a
      // normal small dropdown (access mode) must not be force-closed.
      if (getComputedStyle(menu).position !== 'fixed') return;
      const target = e.target as Node;
      if (target !== menu) return;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    };
    document.addEventListener('click', dismiss, true);

    return () => {
      observer?.disconnect();
      document.removeEventListener('click', dismiss, true);
    };
  }, 'liquid-glass: model menu behaviour');

  // Water-drop settings icon. The settings shell picks a nav glyph per section
  // id via a HARD-CODED map (see `navIcon` in dsh-client-ui-settings-general):
  // ids it doesn't know — including ours, `liquid-glass` — all fall back to the
  // settings GEAR (IconSettingsOutline16). Instead of modifying innerHTML directly
  // (which causes an infinite re-render loop with dsh-icon-theme), we tag our section's
  // button with `data-dsh-liquid-glass-settings-nav` and let pure CSS mask render
  // the water-drop icon.
  client.effect(() => {
    let scheduled = false;
    const markNav = (): void => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      if (dialog.querySelector('[data-dsh-liquid-glass-settings-nav]')) return; // already marked

      const OUR_LABELS = new Set(['液态玻璃', 'Liquid Glass', 'liquid-glass']);
      const cell = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => {
          const text = b.textContent?.trim();
          return text ? OUR_LABELS.has(text) : false;
        },
      );
      if (!cell) return;
      cell.setAttribute('data-dsh-liquid-glass-settings-nav', '');
    };

    markNav();
    const observer = new MutationObserver((mutations) => {
      let mightHaveDialog = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i];
            if (node.nodeType === 1) {
              const el = node as Element;
              if (el.getAttribute('role') === 'dialog' || el.querySelector?.('[role="dialog"]')) {
                mightHaveDialog = true;
                break;
              }
            }
          }
          if (mightHaveDialog) break;
        }
      }
      if (!mightHaveDialog) return;
      if (scheduled) return;
      scheduled = true;
      scheduleTask(() => {
        scheduled = false;
        markNav();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, 'liquid-glass: settings water icon');

  // Cross-tab sync: another tab persisted a settings change.
  client.effect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      current = readStoredSettings();
      publish();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, 'liquid-glass: storage sync');

  const commit = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Quota exceeded: keep the in-memory state so this session still works.
    }
    publish();
  };

  const update = (
    path: 'enabled' | 'wallpaper' | 'glass' | 'demo',
    value: boolean | LiquidGlassSettings['wallpaper'] | LiquidGlassSettings['glass'] | LiquidGlassSettings['demo'],
  ): void => {
    const patch = { ...current } as unknown as Record<string, unknown>;
    patch[path] = value;
    current = sanitizeSettings(patch);
    commit();
  };

  const reset = (): void => {
    current = { ...DEFAULTS };
    commit();
  };

  const injected = (actions: PanelBakedActions): { update: typeof update; reset: () => void } => {
    boundActions = actions;
    publish();
    return { update, reset };
  };

  // Settings page: registered as a top-level `settings.section`, so it gets
  // its own nav row beside 通用设置 / 模型 / 插件 (guarded: the section slot
  // may not exist in every surface).
  if (client.slots) {
    safe('settings panel registration', () => {
      client.slots!.inject('settings.section', () =>
        client.slots!.register(
          {
            name: 'settings.section',
            id: 'liquid-glass',
            order: 100,
            label: '液态玻璃',
            store,
            inject: injected,
          },
          LiquidGlassPanel,
        ),
      );
    });
  }
}