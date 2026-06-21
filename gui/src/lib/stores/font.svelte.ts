const ZOOM_KEY = "agentry:zoom";
const FAMILY_KEY = "agentry:font-family";

// Built-in presets. These reference fonts the OS is likely to have, with
// generic fallbacks so an unavailable face degrades gracefully (fail-open).
// Users can also pick any font installed on their system (see SettingsView),
// in which case the stored value is the raw family name.
export type FontPreset = "system" | "inter" | "geist" | "mono";

export const FONT_STACKS: Record<FontPreset, string> = {
  system: "system-ui, -apple-system, sans-serif",
  inter: '"Inter", "Inter var", system-ui, sans-serif',
  geist: '"Geist", "Geist Sans", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace',
};

const PRESETS: FontPreset[] = ["system", "inter", "geist", "mono"];

function isPreset(v: string): v is FontPreset {
  return (PRESETS as string[]).includes(v);
}

// Resolve a stored value (preset key or raw system font name) into a CSS
// font-family stack. Raw names are quoted and given a generic fallback so an
// unavailable face degrades to the system default rather than serif.
function resolveStack(value: string): string {
  if (isPreset(value)) return FONT_STACKS[value];
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}", system-ui, sans-serif`;
}

// Continuous zoom controls overall UI scale via CSS `zoom` on <html>.
// Bounds keep the layout usable; step matches a comfortable keyboard increment.
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT;
  // Round to 2 decimals to avoid float drift (e.g. 1.0000000002).
  const rounded = Math.round(z * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

function createZoom() {
  const saved =
    typeof localStorage !== "undefined" ? localStorage.getItem(ZOOM_KEY) : null;
  const initial = clampZoom(saved !== null ? parseFloat(saved) : ZOOM_DEFAULT);
  let cur = $state<number>(initial);

  // Apply on boot so the persisted choice takes effect before user interaction.
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--app-zoom", String(initial));
  }

  function apply(z: number) {
    cur = z;
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--app-zoom", String(z));
    }
    if (typeof localStorage !== "undefined")
      localStorage.setItem(ZOOM_KEY, String(z));
  }

  return {
    get value() {
      return cur;
    },
    /** Current zoom as a percentage integer for display (e.g. 110). */
    get percent() {
      return Math.round(cur * 100);
    },
    get canZoomIn() {
      return cur < ZOOM_MAX;
    },
    get canZoomOut() {
      return cur > ZOOM_MIN;
    },
    get isDefault() {
      return cur === ZOOM_DEFAULT;
    },
    set(z: number) {
      apply(clampZoom(z));
    },
    zoomIn() {
      apply(clampZoom(cur + ZOOM_STEP));
    },
    zoomOut() {
      apply(clampZoom(cur - ZOOM_STEP));
    },
    reset() {
      apply(ZOOM_DEFAULT);
    },
  };
}

function createFontFamily() {
  const saved =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(FAMILY_KEY)
      : null;
  const initial: string = saved && saved.trim() ? saved : "system";
  let cur = $state<string>(initial);

  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(
      "--app-font-family",
      resolveStack(initial),
    );
  }

  return {
    /** Stored value: a preset key (`system`/`inter`/`geist`/`mono`) or a raw system font name. */
    get value() {
      return cur;
    },
    /** True when the current value is a raw system-font pick, not a built-in preset. */
    get isCustom() {
      return !isPreset(cur);
    },
    /** Set to a preset key or any system font family name. */
    set(f: string) {
      const next = f && f.trim() ? f : "system";
      cur = next;
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty(
          "--app-font-family",
          resolveStack(next),
        );
      }
      if (typeof localStorage !== "undefined")
        localStorage.setItem(FAMILY_KEY, next);
    },
  };
}

export const zoom = createZoom();
export const fontFamily = createFontFamily();
