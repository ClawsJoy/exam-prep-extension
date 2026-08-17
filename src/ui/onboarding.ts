import { loadSettings, saveSettings } from "../engine/settings.js";
import { initTheme } from "../engine/theme-manager.js";

async function init() {
  // 标记已引导
  const settings = await loadSettings();
  if (!settings.onboarded) {
    await saveSettings({ onboarded: true });
  }
  const btn = document.getElementById("startBtn");
  btn?.addEventListener("click", async () => {
    // 已配置 Key → 打开设置页；未配置 → 引导到设置页填 Key
    chrome.runtime.openOptionsPage();
    window.close();
  });
}
initTheme().catch(() => {});
init();