import { loadSettings, hasApiKey } from "../engine/settings.js";
import { MemoryEngine } from "../engine/memory.js";
import { initTheme } from "../engine/theme-manager.js";

// 未实现完整练习页前，用新标签页承载主要功能
const PAGES: Record<string, string> = {
  practice: "practice", exam: "exam", errorbook: "errorbook",
  report: "report", library: "library", settings: "settings",
};

async function init() {
  const s = await loadSettings();
  const hasKey = hasApiKey(s);

  // 未配置 Key 提示
  const warn = document.getElementById("noKeyWarn");
  if (!hasKey && warn) warn.style.display = "block";

  // 学习概览
  const statsEl = document.getElementById("stats");
  if (hasKey && statsEl) {
    const mem = new MemoryEngine();
    const st = await mem.getStats();
    statsEl.style.display = "block";
    statsEl.innerHTML = "📊 累计答题 <b>" + st.totalAnswered + "</b> 题 · 正确率 <b>" + Math.round(st.accuracy * 100) + "%</b> · 待复习 <b>" + st.activeErrors + "</b> 题";
  }

  // 各入口点击：未配置 Key 的 AI 功能 → 提示并跳设置
  document.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("click", async () => {
      const action = (el as HTMLElement).dataset.action;
      if (!action) return;
      const aiActions = ["practice", "exam"];
      if (aiActions.includes(action) && !hasKey) {
        alert("请先在设置页配置 DeepSeek API Key");
        chrome.runtime.openOptionsPage();
        return;
      }
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("ui/app.html?page=" + PAGES[action]) });
      void tab;
    });
  });

  document.getElementById("goOptions")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("onboard")?.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("ui/onboarding.html") }));
  document.getElementById("dashboard")?.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("ui/app.html?page=dashboard") }));
}
initTheme().catch(() => {});
init();