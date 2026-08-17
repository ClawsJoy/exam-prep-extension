// background service worker：集中管理 AI 请求（绕 CORS）+ 首次安装引导
// 合规说明：最小权限（storage/contextMenus）；AI 请求统一经此转发，
// 输入/输出做基础敏感词过滤，使用日志仅存本地元数据（不含内容）。
import { loadSettings } from "./engine/settings.js";
import { checkContent, logUsage } from "./engine/safety.js";

// 首次安装：打开引导页
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const settings = await loadSettings();
    if (!settings.onboarded) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("ui/onboarding.html") });
    }
  }
});

// 右键菜单：划词加入错题本
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-error-book",
    title: "📕 加入考研错题本",
    contexts: ["selection"],
  });
});

// 右键点击：通知 content script 收集选中文本（页面标题由 content script 自行读取，
// 无需 tabs 权限）
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-error-book" && info.selectionText && tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, {
      type: "COLLECT_SELECTION",
      text: info.selectionText,
    });
  }
});

// 消息路由
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AI_CHAT") {
    handleAIChat(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // 异步响应
  }
  if (msg?.type === "COLLECT_SAVE") {
    handleCollectSave(msg.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  return false;
});

// 划词内容存入知识库（本地）
async function handleCollectSave(payload: { text: string; pageTitle: string; url: string; collectedAt: number }) {
  const KEY = "knowledge_points";
  const r = await chrome.storage.local.get(KEY);
  const list = (r[KEY] as unknown[]) ?? [];
  list.push({
    subject: "网页收藏",
    chapter: (payload.pageTitle || "未命名网页").slice(0, 50),
    content: payload.text,
    source: "web",
    url: payload.url,
    createdAt: payload.collectedAt ?? Date.now(),
  });
  await chrome.storage.local.set({ [KEY]: list });
}


// ── 流式 AI 调用：Port 长连接逐块转发 SSE ─────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ai_stream") return;
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "AI_CHAT_STREAM") return;
    const payload = msg.payload;
    try {
      await handleAIChatStream(port, payload);
    } catch (e) {
      try { port.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) }); } catch { /* ignore */ }
    }
  });
  // 用户取消
  port.onMessage.addListener((msg) => {
    if (msg?.type === "AI_STREAM_ABORT") {
      try { port.disconnect(); } catch { /* ignore */ }
    }
  });
});

async function handleAIChatStream(
  port: chrome.runtime.Port,
  payload: {
    apiKey: string;
    baseUrl: string;
    model: string;
    messages: { role: string; content: string }[];
    temperature: number;
    maxTokens: number;
  },
) {
  // 输入安全过滤
  const inputText = payload.messages.map((m) => m.content).join("\n");
  const inputCheck = checkContent(inputText);
  if (inputCheck.blocked) {
    await logUsage({ ts: Date.now(), type: "ai_chat", blocked: true, category: inputCheck.categories.join(","), charLen: inputText.length, provider: payload.model });
    throw new Error("输入内容包含不当关键词，已拦截（类别：" + inputCheck.categories.join("、") + "）");
  }

  const base = payload.baseUrl.replace(/\/$/, "");
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + payload.apiKey.trim(),
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.5,
      max_tokens: payload.maxTokens ?? 2048,
      stream: true,
    }),
  });
  if (!resp.ok || !resp.body) {
    let msg = "HTTP " + resp.status;
    try {
      const j = await resp.json();
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let accumulated = "";

  // 输出安全过滤：对累积文本检查（逐块，命中即中断）
  const outCheck = checkContent; // alias

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 按 \n\n 分割 SSE 事件
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const dataLines = ev.split("\n").filter((l) => l.startsWith("data:"));
      for (const dl of dataLines) {
        const data = dl.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            // 输出安全（对已累积文本做基础过滤）
            const c = outCheck(accumulated);
            if (c.blocked) {
              await logUsage({ ts: Date.now(), type: "ai_chat", blocked: true, category: c.categories.join(","), charLen: accumulated.length, provider: payload.model });
              try { port.postMessage({ type: "error", message: "AI 输出包含不当内容，已中断" }); } catch { /* ignore */ }
              return;
            }
            try { port.postMessage({ type: "delta", text: delta }); } catch { /* ignore */ }
          }
        } catch { /* 忽略不完整 JSON 行 */ }
      }
    }
  }

  await logUsage({ ts: Date.now(), type: "ai_chat", blocked: false, charLen: accumulated.length, provider: payload.model });
  try { port.postMessage({ type: "done" }); } catch { /* ignore */ }
}

async function handleAIChat(payload: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  maxTokens: number;
}) {
  // ── 内容安全：输入过滤 ──
  const inputText = payload.messages.map((m) => m.content).join("\n");
  const inputCheck = checkContent(inputText);
  if (inputCheck.blocked) {
    await logUsage({
      ts: Date.now(),
      type: "ai_chat",
      blocked: true,
      category: inputCheck.categories.join(","),
      charLen: inputText.length,
      provider: payload.model,
    });
    throw new Error("输入内容包含不当关键词，已拦截（类别：" + inputCheck.categories.join("、") + "）");
  }

  const base = payload.baseUrl.replace(/\/$/, "");
  const resp = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + payload.apiKey.trim(),
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.7,
      max_tokens: payload.maxTokens ?? 4096,
    }),
  });
  if (!resp.ok) {
    let msg = "HTTP " + resp.status;
    try {
      const j = await resp.json();
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 返回内容为空");

  // ── 内容安全：输出过滤 ──
  const outputCheck = checkContent(content);
  if (outputCheck.blocked) {
    await logUsage({
      ts: Date.now(),
      type: "ai_chat",
      blocked: true,
      category: outputCheck.categories.join(","),
      charLen: content.length,
      provider: payload.model,
    });
    throw new Error("AI 返回内容包含不当内容，已拦截");
  }

  // ── 使用日志（仅元数据）──
  await logUsage({
    ts: Date.now(),
    type: "ai_chat",
    blocked: false,
    charLen: inputText.length + content.length,
    provider: payload.model,
  });

  return { ok: true, content } as const;
}