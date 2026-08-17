// content script：划词收集 + 网页知识点抓取
// 合规说明：仅在用户主动右键选择时收集文本；页面标题由本脚本自行读取（无需 tabs 权限）。

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "COLLECT_SELECTION") {
    collectToErrorBook(msg.text ?? "", document.title ?? "");
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

function collectToErrorBook(text: string, pageTitle: string) {
  // 通过 background 存入错题本（本地存储）
  chrome.runtime.sendMessage({
    type: "COLLECT_SAVE",
    payload: { text, pageTitle, url: location.href, collectedAt: Date.now() },
  });
  // 轻提示
  const tip = document.createElement("div");
  tip.textContent = "📕 已加入错题本（可在知识库查看）";
  tip.style.cssText = [
    "position:fixed", "bottom:24px", "right:24px", "z-index:999999",
    "background:#1f6feb", "color:#fff", "padding:10px 16px",
    "border-radius:8px", "font:14px/1.5 sans-serif", "box-shadow:0 4px 12px rgba(0,0,0,.2)",
  ].join(";");
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2500);
}

// 供 popup 调用的页面上下文信息
if (typeof window !== "undefined") {
  (window as unknown as { __examPrepPageInfo: () => { title: string; url: string; selected: string } }).__examPrepPageInfo = () => ({
    title: document.title,
    url: location.href,
    selected: window.getSelection()?.toString() ?? "",
  });
}
