// ── 主题管理：light / dark / system（跟随系统） ──────────────
export type ThemePref = "light" | "dark" | "system";

const KEY = "theme_pref";

/** 读取主题偏好（新用户默认 system，跟随系统） */
export async function loadThemePref(): Promise<ThemePref> {
  const r = await chrome.storage.local.get(KEY);
  const v = r[KEY] as ThemePref | undefined;
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** 保存主题偏好并应用 */
export async function saveThemePref(pref: ThemePref): Promise<void> {
  await chrome.storage.local.set({ [KEY]: pref });
  applyTheme(pref);
}

/** 应用主题：写入 html[data-theme] */
export function applyTheme(pref: ThemePref): void {
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = pref === "system" ? (sysDark ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = resolved;
}

/** 初始化：读取偏好应用 + 跟随系统时监听系统变化 */
export async function initTheme(): Promise<() => void> {
  const pref = await loadThemePref();
  applyTheme(pref);

  // 仅在 system 偏好下监听系统变化（避免多余监听）
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = async () => {
    const cur = await loadThemePref();
    if (cur === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
