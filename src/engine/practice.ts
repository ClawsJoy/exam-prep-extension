import { AppSettings, Question } from "./types.js";
import { getSubjectChapters } from "./knowledge.js";
import { callAI, callAIStream, parseJsonResponse, stripJsonPrefix, StreamTimeoutError, NetworkError, AbortError } from "./deepseek.js";
import { hashKey, getCachedAnalysis, setCachedAnalysis } from "./analysis-cache.js";
import { AnalysisSections, GradeResult } from "./types.js";
import { searchReferences } from "./kb-files.js";
import { MemoryEngine } from "./memory.js";

/** 练习引擎：AI 按章节出题 + 判分 + 记录 */
export class PracticeEngine {
  private memory: MemoryEngine;

  constructor(userId = "default") {
    this.memory = new MemoryEngine(userId);
  }

  /**
   * 按章节生成题目。
   * - subject: 科目显示名（如 "考研数学（数学一）"）
   * - chapter: 指定章节；不指定时从章节框架随机选
   * - chaptersOverride: 章节列表（专业课传 majorChapters；数学/英语/政治传 AI 框架）
   */
  async generateQuestions(
    settings: AppSettings,
    subject: string,
    chapter?: string,
    count = 5,
    chaptersOverride?: string[],
  ): Promise<Question[]> {
    let chapters: string[];
    if (chapter) {
      // 章节名校验：若用户在非框架章节下拉选中的旧章节（如默认热力学章节），
      // 且当前有框架（chaptersOverride），则忽略该章节，回退框架随机
      if (chaptersOverride && chaptersOverride.length > 0 && !chaptersOverride.includes(chapter)) {
        chapters = chaptersOverride;
      } else {
        chapters = [chapter];
      }
    } else if (chaptersOverride && chaptersOverride.length > 0) {
      chapters = chaptersOverride;
    } else if (subject.includes("专业课") || subject.includes("工程热力学")) {
      chapters = settings.majorChapters;
    } else {
      // 数学/英语/政治：尝试取 AI 框架
      const fc = await getSubjectChapters(settings, subject);
      chapters = fc.chapters;
    }
    const target = chapters[Math.floor(Math.random() * chapters.length)] ?? "全部章节";
    const system = "你是一位资深考研命题老师。只输出 JSON 数组，不要输出任何其他文字。";
    let refBlock = "";
    try {
      const refs = await searchReferences(subject, target, 3);
      if (refs.length > 0) {
        refBlock = "\n请优先基于以下用户本地资料出题（引用其中的知识点与表述）：\n" + refs.join("\n---\n");
      }
    } catch { /* 知识库检索失败不影响出题 */ }
    const user = "请为「" + subject + "」章节「" + target + "」生成 " + count + " 道单选题。\n"
      + "难度系数 " + settings.difficulty + "（0-1，越大越难）。\n"
      + refBlock
      + '\n每道题格式：{"topic": "知识点", "content": "题干", "options": ["A. ...","B. ...","C. ...","D. ..."], "answer": "A", "explanation": "解析"}\n'
      + "只输出 JSON 数组。";
    const raw = await callAI(settings, system, user);
    const list = parseJsonResponse<Array<Record<string, unknown>>>(raw);
    // AI 可能多出题 → 截断到 count
    const trimmed = list.slice(0, count);
    const now = Date.now();
    return trimmed.map((q, i) => ({
      id: "ai_" + now + "_" + i,
      subject,
      chapter: target,
      topic: String(q.topic ?? ""),
      content: String(q.content ?? ""),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      answer: String(q.answer ?? ""),
      explanation: String(q.explanation ?? ""),
      source: "ai" as const,
      createdAt: now,
    }));
  }

  /**
   * 判分并记录（错题自动入错题本）。
   * 答错时生成五段分层分析：
   *  1. 先查缓存 → 命中直接返回（免流式）
   *  2. 未命中 → callAIStream 流式生成 → 解析分层 JSON → 写缓存
   * onStreaming(accumulated): 流式过程中的增量回调（UI 打字机）
   * signal: 用户停止
   */
  async gradeAnswer(
    settings: AppSettings,
    q: Question,
    userAnswer: string,
    onStreaming?: (accumulated: string) => void,
    signal?: AbortSignal,
  ): Promise<GradeResult> {
    const isCorrect = q.answer.trim().toUpperCase() === userAnswer.trim().toUpperCase();

    // 答对：不调 AI，返回原题解析
    if (isCorrect) {
      await this.memory.recordAnswer({
        questionId: q.id,
        subject: q.subject,
        topic: q.topic,
        isCorrect,
        userAnswer,
        correctAnswer: q.answer,
        questionContent: q.content,
      });
      return { isCorrect: true, sections: null, fromCache: false, explanation: q.explanation };
    }

    // 答错：分层分析（缓存优先）
    const cacheKey = hashKey(q.id, userAnswer, q.content);
    const cached = await getCachedAnalysis(cacheKey);
    if (cached) {
      await this.memory.recordAnswer({
        questionId: q.id, subject: q.subject, topic: q.topic, isCorrect,
        userAnswer, correctAnswer: q.answer, questionContent: q.content,
      });
      return { isCorrect: false, sections: cached, fromCache: true };
    }

    // 未命中 → 流式生成（自动重试：超时/网络错误重试 1 次；用户中止不重试）
    const system = "你是一位资深的考研辅导老师。请用中文分析这道错题，严格按给定 JSON 结构输出，不要输出任何其他文字。";
    const user = "题目：" + q.content + "\n你的答案：" + userAnswer + "\n正确答案：" + q.answer
      + "\n\n请输出分层错题分析 JSON，必须严格遵循以下模板（5 个字段，字段间用逗号分隔，JSON 必须完整不截断）：\n"
      + '{"考点":"核心知识点","错因":"为什么错","解析":["第1步...","第2步..."],"避坑":"易错提醒","同类":"举一反三的题目提示"}\n'
      + "注意：解析是字符串数组；直接输出 JSON，不要加序号、代码块或任何前缀。";

    let full = "";
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        full = await callAIStream(settings, system, user, (acc) => {
          if (onStreaming) onStreaming(acc);
        }, signal);
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // 用户中止：不重试，直接抛
        if (e instanceof AbortError) throw e;
        // 第 1 次失败（超时/网络）→ 提示重试中，继续循环
        if (attempt === 0) {
          console.warn("[gradeAnswer] 第 1 次流式失败，自动重试: " + lastErr.message);
          continue;
        }
      }
    }
    if (!full && lastErr) throw lastErr;

    // 解析分层 JSON（容错四级）
    const sections = parseAnalysisSections(full);
    // 缓存保护：仅当五段完整解析成功才写缓存（避免缓存坏结果）
    if (sections.考点 || sections.错因 || sections.解析.length > 0) {
      await setCachedAnalysis(cacheKey, sections);
    } else {
      console.warn("[gradeAnswer] 解析结果为空，不写缓存");
    }

    await this.memory.recordAnswer({
      questionId: q.id, subject: q.subject, topic: q.topic, isCorrect,
      userAnswer, correctAnswer: q.answer, questionContent: q.content,
    });
    return { isCorrect: false, sections, fromCache: false };
  }

  /** 弱项强化练习：优先出错题本中知识点相关题目 */
  async generateWeakFocusPractice(settings: AppSettings, subject: string, count = 5): Promise<Question[]> {
    const queue = await this.memory.getReviewQueue(10);
    const topics = queue.map((e) => e.topic).filter(Boolean).slice(0, 5);
    if (topics.length === 0) return this.generateQuestions(settings, subject, undefined, count);
    const system = "你是一位资深考研命题老师。只输出 JSON 数组。";
    const user = "请围绕以下薄弱知识点各出 1-2 道单选题：" + topics.join("、") + "，共 " + count + " 道。\n"
      + '每道题格式：{"topic": "知识点", "content": "题干", "options": ["A. ...","B. ...","C. ...","D. ..."], "answer": "A", "explanation": "解析"}\n'
      + "只输出 JSON 数组。";
    const raw = await callAI(settings, system, user);
    const list = parseJsonResponse<Array<Record<string, unknown>>>(raw);
    const now = Date.now();
    return list.map((q, i) => ({
      id: "weak_" + now + "_" + i,
      subject,
      chapter: "",
      topic: String(q.topic ?? ""),
      content: String(q.content ?? ""),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      answer: String(q.answer ?? ""),
      explanation: String(q.explanation ?? ""),
      source: "ai" as const,
      createdAt: now,
    }));
  }
}

/**
 * 从 AI 输出中解析五段分层分析（容错四级）：
 * 1. 完整 JSON（含前缀清洗 + 缺逗号容错）
 * 2. 正则按字段名切分（最鲁棒，不依赖完整 JSON.parse）
 * 3. 【考点】标题切分
 * 4. 纯文本 → 全部放解析
 */
function parseAnalysisSections(content: string): AnalysisSections {
  try {
    const snippet = (content || "").slice(0, 200).replace(/\n/g, " ");
    console.debug("[parseAnalysisSections] 原始输入(" + (content || "").length + "字符): " + snippet);

    // 清洗前缀（1. / ```json / 前导文字）
    let cleaned: string;
    try {
      cleaned = stripJsonPrefix(content);
      if (cleaned !== content.trim()) {
        console.debug("[parseAnalysisSections] 已清洗前缀 → " + cleaned.slice(0, 100) + "...");
      }
    } catch (e) {
      console.warn("[parseAnalysisSections] stripJsonPrefix 异常: " + (e instanceof Error ? e.stack || e.message : String(e)));
      cleaned = content.trim(); // 异常时回退原始输入
    }

    // 1. 完整 JSON
    try {
      const obj = parseJsonResponse<Partial<AnalysisSections>>(cleaned);
      if (obj && typeof obj === "object" && (obj.考点 || obj.错因 || obj.解析)) {
        const sections: AnalysisSections = {
          考点: String(obj.考点 ?? ""),
          错因: String(obj.错因 ?? ""),
          解析: Array.isArray(obj.解析) ? obj.解析.map(String) : [String(obj.解析 ?? "")].filter(Boolean),
          避坑: String(obj.避坑 ?? ""),
          同类: String(obj.同类 ?? ""),
        };
        console.debug("[parseAnalysisSections] 命中 JSON: 考点=" + sections.考点.slice(0, 20) + " 步骤=" + sections.解析.length);
        return sections;
      }
      console.warn("[parseAnalysisSections] JSON 成功但字段缺失: " + JSON.stringify(obj));
    } catch (e) {
      console.debug("[parseAnalysisSections] JSON 解析失败: " + (e instanceof Error ? e.message : String(e)));
    }

    // 2. 正则按字段名切分
    let byRegex: AnalysisSections | null = null;
    try {
      byRegex = extractSectionsByRegex(cleaned);
    } catch (e) {
      console.warn("[parseAnalysisSections] extractSectionsByRegex 异常: " + (e instanceof Error ? e.stack || e.message : String(e)));
    }
    if (byRegex) {
      console.debug("[parseAnalysisSections] 命中正则五段切分");
      return byRegex;
    }
    console.debug("[parseAnalysisSections] 正则未命中，尝试标题切分");

    // 3. 【标题】切分
    const labels = ["考点", "错因", "解析", "避坑", "同类"];
    const sections: Record<string, string> = {};
    for (const lb of labels) {
      const re = new RegExp("【" + lb + "】([\\s\\S]*?)(?=【|$)", "g");
      const m = re.exec(cleaned);
      if (m) sections[lb] = m[1].trim();
    }
    if (sections["考点"] || sections["错因"] || sections["解析"]) {
      console.debug("[parseAnalysisSections] 命中标题切分");
      return {
        考点: sections["考点"] ?? "",
        错因: sections["错因"] ?? "",
        解析: (sections["解析"] ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean),
        避坑: sections["避坑"] ?? "",
        同类: sections["同类"] ?? "",
      };
    }
    console.debug("[parseAnalysisSections] 标题切分未命中，进入兜底");

    // 4. 纯文本兜底
    console.warn("[parseAnalysisSections] 兜底: 全部入解析");
    return { 考点: "", 错因: "", 解析: [cleaned || content.trim()], 避坑: "", 同类: "" };
  } catch (e) {
    // 兜底：任何未捕获异常都记录并返回纯文本，保证调用方不炸
    console.warn("[parseAnalysisSections] 异常: " + (e instanceof Error ? e.stack || e.message : String(e)));
    return { 考点: "", 错因: "", 解析: [String(content ?? "").trim()], 避坑: "", 同类: "" };
  }
}

function extractSectionsByRegex(content: string): AnalysisSections | null {
  const labels: Record<string, string> = {};
  let anyHit = false;

  // 提取 "字段名": "值"
  const fieldRe = new RegExp('"(考点|错因|解析|避坑|同类)"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', "g");
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(content)) !== null) {
    labels[m[1]] = m[2].replace(/\\n/g, "\n");
    anyHit = true;
  }

  // 解析字段可能是数组
  const arrRe = new RegExp('"解析"\\s*:\\s*\\[([\\s\\S]*?)\\]');
  const am = arrRe.exec(content);
  if (am) {
    const items = am[1]
      .split(",")
      .map((x) => x.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n"))
      .filter((x) => x.length > 0);
    if (items.length > 0) {
      labels["解析"] = items.join("\n");
      anyHit = true;
    }
  }

  if (!anyHit) return null;
  return {
    考点: labels["考点"] ?? "",
    错因: labels["错因"] ?? "",
    解析: (labels["解析"] ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean),
    避坑: labels["避坑"] ?? "",
    同类: labels["同类"] ?? "",
  };
}