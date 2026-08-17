import { AppSettings, KnowledgePoint } from "./types.js";
import { callAI, parseJsonResponse } from "./deepseek.js";

const KEY_KNOWLEDGE = "knowledge_points";

/** 知识引擎：AI 生成章节知识点 + 本地缓存 + 网页抓取入库 */
export class KnowledgeEngine {
  private async load(): Promise<KnowledgePoint[]> {
    const r = await chrome.storage.local.get(KEY_KNOWLEDGE);
    return (r[KEY_KNOWLEDGE] as KnowledgePoint[]) ?? [];
  }

  private async save(list: KnowledgePoint[]): Promise<void> {
    await chrome.storage.local.set({ [KEY_KNOWLEDGE]: list });
  }

  /** AI 生成某章节的核心知识点 */
  async generateKnowledge(settings: AppSettings, subject: string, chapter: string): Promise<KnowledgePoint> {
    const system = "你是一位考研专业课老师，擅长提炼章节核心考点。";
    const user = "请为「" + subject + "」章节「" + chapter + "」提炼 300 字以内的核心知识点与考点，直接输出正文。";
    const content = await callAI(settings, system, user);
    const point: KnowledgePoint = {
      subject,
      chapter,
      content,
      source: "ai",
      createdAt: Date.now(),
    };
    const list = await this.load();
    list.push(point);
    await this.save(list);
    return point;
  }

  /** 网页正文一键入库（content script 采集后调用） */
  async addFromWeb(pageTitle: string, selectedText: string): Promise<KnowledgePoint> {
    const point: KnowledgePoint = {
      subject: "网页收藏",
      chapter: pageTitle.slice(0, 50),
      content: selectedText,
      source: "web",
      createdAt: Date.now(),
    };
    const list = await this.load();
    list.push(point);
    await this.save(list);
    return point;
  }

  async list(): Promise<KnowledgePoint[]> {
    const list = await this.load();
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  async search(keyword: string): Promise<KnowledgePoint[]> {
    const list = await this.load();
    const kw = keyword.toLowerCase();
    return list.filter(
      (p) =>
        p.content.toLowerCase().includes(kw) ||
        p.chapter.toLowerCase().includes(kw) ||
        p.subject.toLowerCase().includes(kw),
    );
  }

  async remove(id: number): Promise<void> {
    const list = await this.load();
    await this.save(list.filter((p) => p.createdAt !== id));
  }
}

// ── 科目章节框架（AI 初始化 + 本地缓存） ──────────────────────
const KEY_CHAPTERS = "subject_chapters_cache";

/** 获取科目章节列表：优先缓存，无缓存且有 Key 时由 AI 生成并缓存 */
export async function getSubjectChapters(
  settings: AppSettings,
  subjectName: string,
): Promise<{ chapters: string[]; fromCache: boolean }> {
  const r = await chrome.storage.local.get(KEY_CHAPTERS);
  const cache = (r[KEY_CHAPTERS] as Record<string, string[]>) ?? {};

  // 缓存命中
  if (cache[subjectName]?.length) {
    return { chapters: cache[subjectName], fromCache: true };
  }

  // 无 Key → 无法初始化
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return { chapters: [], fromCache: false };
  }

  // AI 生成框架
  try {
    const system = "你是一位考研大纲专家，精通各科目章节体系。只输出 JSON 数组（章节名列表），不要输出其他文字。";
    const user = "请列出「" + subjectName + "」考研复习的章节框架（8-12 个章节名，按学习顺序），格式：[\"第1章 章节名\", \"第2章 章节名\", ...]。只输出 JSON 数组。";
    const content = await callAI(settings, system, user);
    const chapters = parseChapterList(content);
    if (chapters.length === 0) throw new Error("AI 返回章节为空");
    cache[subjectName] = chapters;
    await chrome.storage.local.set({ [KEY_CHAPTERS]: cache });
    return { chapters, fromCache: false };
  } catch (e) {
    console.warn("章节框架生成失败:", e);
    // 兜底：使用通用章节框架
    const fallback = FALLBACK_CHAPTERS[subjectName] ?? FALLBACK_CHAPTERS["default"];
    cache[subjectName] = fallback;
    await chrome.storage.local.set({ [KEY_CHAPTERS]: cache });
    return { chapters: fallback, fromCache: false };
  }
}

/** 兜底章节框架（AI 失败时使用） */
const FALLBACK_CHAPTERS: Record<string, string[]> = {
  "考研数学（数学一）": ["第1章 极限与连续", "第2章 一元函数微分学", "第3章 一元函数积分学", "第4章 多元函数微积分", "第5章 无穷级数", "第6章 常微分方程", "第7章 线性代数", "第8章 概率论与数理统计"],
  "考研数学（数学二）": ["第1章 极限与连续", "第2章 一元函数微分学", "第3章 一元函数积分学", "第4章 多元函数微积分", "第5章 常微分方程", "第6章 线性代数"],
  "考研数学（数学三）": ["第1章 极限与连续", "第2章 一元函数微分学", "第3章 一元函数积分学", "第4章 多元函数微积分", "第5章 无穷级数", "第6章 常微分方程", "第7章 线性代数", "第8章 概率论与数理统计"],
  "考研英语（英语一）": ["第1章 词汇与长难句", "第2章 完形填空", "第3章 阅读理解A节", "第4章 阅读理解B节", "第5章 翻译", "第6章 写作小作文", "第7章 写作大作文"],
  "考研英语（英语二）": ["第1章 词汇与长难句", "第2章 完形填空", "第3章 阅读理解A节", "第4章 阅读理解B节", "第5章 翻译", "第6章 写作应用文", "第7章 写作短文"],
  "考研政治": ["第1章 马克思主义基本原理", "第2章 毛泽东思想和中国特色社会主义", "第3章 中国近现代史纲要", "第4章 思想道德与法治", "第5章 形势与政策"],
  "default": ["第1章 基础知识", "第2章 核心概念", "第3章 重点难点", "第4章 综合应用", "第5章 拓展提升"],
};

/** 从 AI 返回内容解析章节列表（容错） */
function parseChapterList(content: string): string[] {
  const trimmed = content.trim();
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { /* fallthrough */ }
  const fence = trimmed.match(/\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60/);
  if (fence) {
    try {
      const arr = JSON.parse(fence[1]);
      if (Array.isArray(arr)) return arr.map(String);
    } catch { /* fallthrough */ }
  }
  // 按行拆分
  return trimmed.split(/\n+/).map((x) => x.replace(/^[-*\d.、\s]+/, "").trim()).filter((x) => x.length > 0);
}

// ── 专业课 AI 初始化（按学校+专业生成大纲） ──────────────────────
/** 专业课章节缓存 key：含学校与专业，改任一即触发重新初始化 */
export function majorChaptersKey(university: string, major: string): string {
  return "考研专业课·" + (university || "未填学校") + "·" + (major || "未填专业");
}

/**
 * 按学校+专业 AI 初始化专业课大纲。
 * 返回 { chapters, code } — code 为 AI 识别的专业课代码（如 408），无则空。
 * 兼容 AI 返回 {code, chapters} 对象 或 纯数组 两种格式。
 * 缓存到 subject_chapters_cache[key]。
 */
export async function getMajorChapters(
  settings: AppSettings,
  university: string,
  major: string,
): Promise<{ chapters: string[]; code: string; fromCache: boolean }> {
  const key = majorChaptersKey(university, major);
  const r = await chrome.storage.local.get(KEY_CHAPTERS);
  const cache = (r[KEY_CHAPTERS] as Record<string, string[]>) ?? {};

  // 缓存命中
  if (cache[key]?.length) {
    return { chapters: cache[key], code: "", fromCache: true };
  }

  // 无 Key → 无法初始化
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return { chapters: [], code: "", fromCache: false };
  }

  try {
    const system = "你是一位考研专业课大纲专家，熟悉全国各高校专业课科目代码与考试大纲。只输出 JSON，不要输出任何其他文字。";
    const user = "考生报考学校：" + university + "；报考专业：" + major + "。\n"
      + "请完成两件事：\n"
      + "1) 判断该学校该专业的考研专业课代码（如 408 计算机学科专业基础综合、845 等）；\n"
      + "2) 列出该专业课的考试大纲章节（8-12 个，按学习顺序）。\n"
      + '输出格式：{"code":"专业课代码","chapters":["第1章 章节名","第2章 章节名",...]}。只输出 JSON。';
    const content = await callAI(settings, system, user);
    const parsed = parseMajorChapters(content);
    if (parsed.chapters.length === 0) throw new Error("AI 返回章节为空");
    cache[key] = parsed.chapters;
    await chrome.storage.local.set({ [KEY_CHAPTERS]: cache });
    return { ...parsed, fromCache: false };
  } catch (e) {
    console.warn("专业课章节生成失败:", e);
    return { chapters: [], code: "", fromCache: false };
  }
}

/** 解析专业课 AI 输出：兼容 {code, chapters} 对象 与 纯数组 */
function parseMajorChapters(content: string): { chapters: string[]; code: string } {
  let obj: unknown = null;
  try { obj = parseJsonResponse(content); } catch { /* fallthrough */ }
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    // 对象格式 {code, chapters}
    if (Array.isArray(o.chapters)) {
      return { chapters: o.chapters.map(String), code: String(o.code ?? "") };
    }
    // 纯数组（parseJsonResponse 可能直接返回数组）
    if (Array.isArray(obj)) {
      return { chapters: (obj as unknown[]).map(String), code: "" };
    }
  }
  // 数组解析
  try {
    const arr = parseChapterList(content);
    if (arr.length) return { chapters: arr, code: "" };
  } catch { /* fallthrough */ }
  return { chapters: [], code: "" };
}