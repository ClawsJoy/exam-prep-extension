import { AppSettings } from "./types.js";


// ── 流式错误类型（供 UI 区分处理） ────────────────────────
export class StreamTimeoutError extends Error {
  constructor(msg = "解析超时（15 秒无响应）") { super(msg); this.name = "StreamTimeoutError"; }
}
export class NetworkError extends Error {
  constructor(msg = "网络连接失败") { super(msg); this.name = "NetworkError"; }
}
export class AbortError extends Error {
  constructor(msg = "已停止生成") { super(msg); this.name = "AbortError"; }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 调用 DeepSeek（OpenAI 兼容接口）。
 * 通过 chrome.runtime.sendMessage 交给 background 转发，
 * 避免页面 CORS 限制并集中管理 API Key。
 * 输入先在页面层做敏感词过滤（防御纵深），background 会再次校验。
 */
export async function callAI(
  settings: AppSettings,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.7,
): Promise<string> {
  const combined = systemPrompt + "\n" + userPrompt;
  const { checkContent } = await import("./safety.js");
  const check = checkContent(combined);
  if (check.blocked) {
    throw new Error("输入内容包含不当关键词，已拦截（类别：" + check.categories.join("、") + "）");
  }
  const resp = await chrome.runtime.sendMessage({
    type: "AI_CHAT",
    payload: {
      apiKey: settings.apiKey,
      baseUrl: settings.apiBaseUrl,
      model: settings.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      maxTokens: 4096,
    },
  });
  if (resp?.ok) return resp.content as string;
  throw new Error(resp?.error ?? "AI 调用失败");
}


/**
 * 流式调用 DeepSeek（错题分析专用）。
 * 通过 chrome.runtime.connect 建立 Port 长连接，background 逐块转发 SSE 增量。
 * - onDelta(text): 每个增量片段回调
 * - signal: AbortSignal，支持用户停止
 * 返回累积的完整文本。
 */
export function callAIStream(
  settings: AppSettings,
  systemPrompt: string,
  userPrompt: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const combined = systemPrompt + "\n" + userPrompt;
    let accumulated = "";
    let finished = false;
    let externalAborted = false;

    // 同步注册外部 abort（避免异步 import 期间丢失中止事件 — 连续点击快速中止场景）
    if (signal) {
      signal.addEventListener("abort", () => {
        externalAborted = true;
        reject(new AbortError());
      }, { once: true });
    }

    // 输入安全过滤（页面层防御）
    import("./safety.js").then(({ checkContent }) => {
      if (externalAborted) return; // 已被外部中止，无需启动
      const check = checkContent(combined);
      if (check.blocked) {
        reject(new Error("输入内容包含不当关键词，已拦截（类别：" + check.categories.join("、") + "）"));
        return;
      }
      startPort();
    }).catch(() => {
      if (!externalAborted) startPort();
    });

    function startPort() {
      const port = chrome.runtime.connect({ name: "ai_stream" });
      let settled = false;
      let timeoutId: number | null = null;

      // 15 秒无新 delta → 超时中止（activity-based：每次 delta 重置）
      const resetTimeout = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            try { port.postMessage({ type: "AI_STREAM_ABORT" }); } catch { /* ignore */ }
            try { port.disconnect(); } catch { /* ignore */ }
            reject(new StreamTimeoutError());
          }
        }, 15000);
      };

      const cleanup = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        try { port.disconnect(); } catch { /* ignore */ }
      };

      port.onMessage.addListener((msg) => {
        if (msg?.type === "delta") {
          accumulated += msg.text ?? "";
          resetTimeout(); // 收到数据重置超时
          try { onDelta(accumulated); } catch { /* UI 回调异常不影响链路 */ }
        } else if (msg?.type === "done") {
          if (!settled) { settled = true; cleanup(); resolve(accumulated); }
        } else if (msg?.type === "error") {
          if (!settled) { settled = true; cleanup(); reject(new Error(msg.message ?? "AI 流式调用失败")); }
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled && !finished) {
          settled = true;
          const err = chrome.runtime.lastError;
          reject(new NetworkError(err?.message ? "连接已断开：" + err.message : "网络连接失败"));
        }
      });

      // 发送请求 + 启动首 token 超时
      port.postMessage({
        type: "AI_CHAT_STREAM",
        payload: {
          apiKey: settings.apiKey,
          baseUrl: settings.apiBaseUrl,
          model: settings.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2, // 低温度降低 JSON 格式漂移概率
          maxTokens: 2048,
        },
      });
      resetTimeout();

      // 外部中止已由同步监听处理；此处仅在端口已建立时通知服务端取消
      if (signal && signal.aborted) {
        settled = true;
        try { port.postMessage({ type: "AI_STREAM_ABORT" }); } catch { /* ignore */ }
        cleanup();
        return;
      }
    }
  });
}
/** 从 AI 返回文本中稳健提取 JSON */
/**
 * 清理 AI 输出中的常见前缀/装饰，返回纯 JSON 候选文本。
 * 支持：序号前缀(1. / 1) / - / markdown 代码块(```json) / 首尾杂散文字。
 */
/**
 * 容错修复 JSON 语法缺陷（针对 AI 输出的常见不严格格式）。
 * 目前修复：字段边界缺少逗号（如 ...第2步"]"避坑":"..." → ...第2步"],"避坑":"..."）
 */
export function repairJsonSyntax(content: string): string {
  let t = content;
  // 1) ] 后直接跟 "字段" 键 → 补逗号
  t = t.replace(/\](?=\s*")/g, "],");
  // 2) } 后直接跟 "字段" 键 → 补逗号
  t = t.replace(/\}(?=\s*")/g, "},");
  // 3) 值("..."/数字) 后直接跟 "字段" 键（"值""键" → "值","键"）
  t = t.replace(/("(?:[^"\\]|\\.)*")(?=\s*")/g, "$1,");
  t = t.replace(/(\d+)(?=\s*")/g, "$1,");
  // 4) 尾随逗号（"字段": "值",} 或 ["项",] → 去掉 }/] 前的多余逗号）
  t = t.replace(/,+\s*(?=[}\]])/g, "");
  return t;
}

export function stripJsonPrefix(content: string): string {
  let t = content.trim();
  // 去掉 ```json ... ``` 代码块包裹（保留内部内容）
  const fence = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    t = fence[1].trim();
  }
  // 去掉行首序号/列表前缀（1. 2) - * 等），直到剩余文本以 { 或 [ 开头
  for (let i = 0; i < 10; i++) {
    const m = t.match(/^\s*(?:\d+[.)、]?\s*|[-*•]\s*)/);
    if (m) {
      t = t.slice(m[0].length).trim();
    } else {
      break;
    }
  }
  // 去掉前导说明文字（首个 { 或 [ 之前的非 JSON 文本）
  const brace = t.search(/[{\[]/);
  if (brace > 0) {
    t = t.slice(brace).trim();
  }
  return t;
}

export function parseJsonResponse<T>(content: string): T {
  // 1. 直接解析（可能无任何前缀）
  try {
    return JSON.parse(content.trim()) as T;
  } catch { /* fallthrough */ }
  // 2. 清洗前缀后再解析（code block / 序号 / 前导文字）
  const cleaned = stripJsonPrefix(content);
  try {
    return JSON.parse(cleaned) as T;
  } catch { /* fallthrough */ }
  // 3. 花括号/方括号截取（找第一个 JSON 边界到最后一个匹配闭合）
  const start = cleaned.search(/[{\[]/);
  if (start >= 0) {
    const open = cleaned[start];
    const close = open === "{" ? "}" : "]";
    const end = cleaned.lastIndexOf(close);
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch { /* fallthrough */ }
    }
  }
  // 4. 容错修复缺逗号等缺陷后再解析
  try {
    const repaired = repairJsonSyntax(cleaned);
    if (repaired !== cleaned) {
      console.debug("[parseJsonResponse] 已容错修复 JSON 语法缺陷");
      return JSON.parse(repaired) as T;
    }
  } catch { /* fallthrough */ }
  throw new Error("无法解析 AI 返回的 JSON");
}

/** 按章节生成题目 */
export async function generateQuestions(
  settings: AppSettings,
  subject: string,
  chapter: string,
  count = 5,
  difficulty = 0.5,
) {
  const system = "你是一位资深考研命题老师。只输出 JSON 数组，不要输出任何其他文字。";
  const user = "请为「" + subject + "」第「" + chapter + "」生成 " + count + " 道单选题。\n"
    + "难度系数 " + difficulty + "（0-1，越大越难）。\n"
    + "每道题格式：{\"topic\": \"知识点\", \"content\": \"题干\", \"options\": [\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"], \"answer\": \"A\", \"explanation\": \"解析\"}\n"
    + "只输出 JSON 数组。";
  const raw = await callAI(settings, system, user);
  return parseJsonResponse<Array<Record<string, unknown>>>(raw);
}

/** AI 讲解/解析 */
export async function explainQuestion(settings: AppSettings, questionContent: string, userAnswer: string, correctAnswer: string) {
  const system = "你是一位耐心的考研辅导老师，用简洁的中文讲解题目。";
  const user = "题目：" + questionContent + "\n你的答案：" + userAnswer + "\n正确答案：" + correctAnswer + "\n请给出详细的解题思路和知识点解析。";
  return callAI(settings, system, user);
}

/** 生成模拟试卷 */
export async function generateExamPaper(
  settings: AppSettings,
  subject: string,
  chapters: string[],
  questionCount = 20,
) {
  const system = "你是一位考研命题组专家。只输出 JSON 数组。";
  const user = "请为「" + subject + "」生成一份模拟试卷，共 " + questionCount + " 道单选题，覆盖章节：" + chapters.join("、") + "。\n"
    + "每题格式：{\"chapter\": \"章节名\", \"topic\": \"知识点\", \"content\": \"题干\", \"options\": [\"A. ...\",\"B. ...\",\"C. ...\",\"D. ...\"], \"answer\": \"A\", \"explanation\": \"解析\"}\n"
    + "只输出 JSON 数组。";
  const raw = await callAI(settings, system, user);
  return parseJsonResponse<Array<Record<string, unknown>>>(raw);
}