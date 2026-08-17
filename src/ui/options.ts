import { loadSettings, saveSettings, testApiKey, resetSettings, linkedEnglishType, mathAllowedFor } from "../engine/settings.js";
import { MathType, EnglishType } from "../engine/types.js";
import { initTheme, loadThemePref, saveThemePref, ThemePref } from "../engine/theme-manager.js";
import { getMajorChapters } from "../engine/knowledge.js";

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

function showSaved() {
  const el = $("saved");
  if (!el) return;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function setStatus(text: string, cls: "ok" | "err" | "wait" = "wait") {
  const el = $("keyStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "status " + cls;
}

async function init() {
  const s = await loadSettings();
  (document.getElementById("apiKey") as HTMLInputElement).value = s.apiKey;
  (document.getElementById("apiBaseUrl") as HTMLInputElement).value = s.apiBaseUrl;
  (document.getElementById("model") as HTMLSelectElement).value = s.model;
  (document.getElementById("targetUniversity") as HTMLInputElement).value = s.targetUniversity;
  (document.getElementById("majorSubject") as HTMLInputElement).value = s.majorSubject;
  (document.getElementById("mathType") as HTMLSelectElement).value = s.mathType;
  (document.getElementById("englishType") as HTMLSelectElement).value = s.englishType;
  (document.getElementById("politics") as HTMLInputElement).checked = s.politics;
  // 主题偏好
  const themePref = await loadThemePref();
  (document.getElementById("themePref") as HTMLSelectElement).value = themePref;

  const linkTip = $("mathEnglishLink");
  if (linkTip) linkTip.textContent = "当前联动：数学 " + s.mathType + " ↔ 英语 " + linkedEnglishType(s.mathType);
  // 未连接 API Key → 显示科目 AI 提示
  const keyWarn = $("aiKeyWarning");
  if (keyWarn && !s.apiKey.trim()) keyWarn.style.display = "block";
  (document.getElementById("dailyGoal") as HTMLInputElement).value = String(s.dailyGoal);

  // 显示/隐藏 Key
  const keyInput = document.getElementById("apiKey") as HTMLInputElement;
  $("toggleKey")?.addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  });


  // ── 数学/英语联动（考研规定：自动切换 + 提示） ──
  const mathSel = document.getElementById("mathType") as HTMLSelectElement;
  const engSel = document.getElementById("englishType") as HTMLSelectElement;
  mathSel.addEventListener("change", () => {
    const mt = mathSel.value as MathType;
    const lt = linkedEnglishType(mt);
    engSel.value = lt;
    if (linkTip) linkTip.textContent = "当前联动：数学 " + mt + " ↔ 英语 " + lt + "（已自动切换）";
    showSaved();
  });
  engSel.addEventListener("change", () => {
    const et = engSel.value as EnglishType;
    const allowed = mathAllowedFor(et);
    if (!allowed.includes(mathSel.value as MathType)) {
      mathSel.value = "数学二"; // 英语二 → 数学自动回退数学二
      if (linkTip) linkTip.textContent = "当前联动：数学 数学二 ↔ 英语 " + et + "（英语" + et + "仅支持数学二/三，已自动调整）";
    } else {
      if (linkTip) linkTip.textContent = "当前联动：数学 " + mathSel.value + " ↔ 英语 " + et;
    }
    showSaved();
  });

  // 保存 Key
  $("saveKey")?.addEventListener("click", async () => {
    await saveSettings({
      apiKey: keyInput.value.trim(),
      apiBaseUrl: (document.getElementById("apiBaseUrl") as HTMLInputElement).value.trim() || "https://api.deepseek.com",
      model: (document.getElementById("model") as HTMLSelectElement).value,
    });
    showSaved();
    setStatus("密钥已保存", "ok");
  });

  // 进入学习页（与保存/测试按钮平级，独立事件）
  $("openApp")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/app.html") });
  });

  // 测试连接
  $("testKey")?.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    const base = (document.getElementById("apiBaseUrl") as HTMLInputElement).value.trim() || "https://api.deepseek.com";
    const model = (document.getElementById("model") as HTMLSelectElement).value;
    if (!key) { setStatus("请先粘贴 API Key", "err"); return; }
    setStatus("测试连接中……", "wait");
    const r = await testApiKey(key, base, model);
    if (r.ok) {
      setStatus("✓ " + r.message, "ok");
      await saveSettings({ apiKey: key, apiBaseUrl: base, model });
    } else {
      setStatus("✗ " + r.message, "err");
    }
  });

  // 保存备考目标（保存后触发专业课 AI 初始化）
  $("saveGoal")?.addEventListener("click", async () => {
    const university = (document.getElementById("targetUniversity") as HTMLInputElement).value.trim();
    const major = (document.getElementById("majorSubject") as HTMLInputElement).value.trim();
    await saveSettings({
      targetUniversity: university,
      majorSubject: major,
      mathType: (document.getElementById("mathType") as HTMLSelectElement).value as MathType,
      englishType: (document.getElementById("englishType") as HTMLSelectElement).value as EnglishType,
      politics: (document.getElementById("politics") as HTMLInputElement).checked,
      dailyGoal: Number((document.getElementById("dailyGoal") as HTMLInputElement).value) || 20,
    });
    showSaved();

    // 专业课章节 AI 初始化（按学校+专业）
    const initMsg = $("majorInitMsg");
    const saveBtn = $("saveGoal") as HTMLButtonElement;
    if (!initMsg || !saveBtn) return;
    const cur = await loadSettings();
    if (!cur.apiKey || !cur.apiKey.trim()) {
      initMsg.textContent = "⚠️ 需连接 API Key 才能初始化专业课章节";
      initMsg.style.color = "var(--warning)";
      return;
    }
    saveBtn.disabled = true;
    initMsg.textContent = "🔄 AI 初始化中…（生成专业课代码与章节大纲）";
    initMsg.style.color = "var(--text-muted)";
    try {
      const res = await getMajorChapters(cur, university || "未填学校", major || "未填专业");
      if (res.chapters.length > 0) {
        initMsg.textContent = "✅ 专业课章节已生成" + (res.code ? "（代码 " + res.code + "）" : "") + "：" + res.chapters.length + " 章";
        initMsg.style.color = "var(--success)";
      } else {
        initMsg.textContent = "⚠️ 专业课章节生成失败，将在学习页重试";
        initMsg.style.color = "var(--warning)";
      }
    } catch (e) {
      initMsg.textContent = "⚠️ 初始化失败：" + (e instanceof Error ? e.message : String(e));
      initMsg.style.color = "var(--danger)";
    } finally {
      saveBtn.disabled = false;
    }
  });

  // 保存主题
  $("saveTheme")?.addEventListener("click", async () => {
    await saveThemePref(($("themePref") as HTMLSelectElement).value as ThemePref);
    showSaved();
  });

  // 导出数据
  $("exportData")?.addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exam-prep-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // 清空数据（保留设置）
  $("clearData")?.addEventListener("click", async () => {
    if (!confirm("确定清空所有学习数据（错题本、练习记录、报告）？此操作不可恢复。")) return;
    const keys = (await chrome.storage.local.get(null)) as Record<string, unknown>;
    const keep = ["app_settings"];
    const toRemove = Object.keys(keys).filter((k) => !keep.includes(k));
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
    showSaved();
  });

  // ── 隐私与合规 ──
  // 查看隐私政策
  $("viewPrivacy")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/privacy.html") });
  });

  // 查看更新日志
  $("viewWhatsNew")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/whats-new.html") });
  });

  // 查看使用日志（仅元数据）
  const logArea = $("logArea");
  $("viewLog")?.addEventListener("click", async () => {
    if (!logArea) return;
    const { getUsageLog } = await import("../engine/safety.js");
    const log = await getUsageLog();
    if (log.length === 0) {
      logArea.textContent = "暂无使用日志。";
    } else {
      logArea.innerHTML = log
        .slice()
        .reverse()
        .slice(0, 50)
        .map((e) => {
          const d = new Date(e.ts);
          const time = d.toLocaleString("zh-CN");
          const cat = e.category ? " · 拦截类别:" + e.category : "";
          return "[ " + time + " ] " + (e.type === "ai_chat" ? "AI调用" : "划词收藏") + (e.blocked ? " · ⚠️已拦截" + cat : "") + " · 长度:" + e.charLen + (e.provider ? " · " + e.provider : "") + "\n";
        })
        .join("");
    }
    logArea.style.display = "block";
  });

  // 清空日志
  $("clearLog")?.addEventListener("click", async () => {
    const { clearUsageLog } = await import("../engine/safety.js");
    await clearUsageLog();
    if (logArea) {
      logArea.textContent = "日志已清空。";
      logArea.style.display = "block";
    }
    showSaved();
  });
}
initTheme().catch(() => {});
init();