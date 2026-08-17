import { AppSettings, Question } from "./types.js";
import { generateExamPaper } from "./deepseek.js";
import { getSubjectChapters } from "./knowledge.js";
import { MemoryEngine } from "./memory.js";
import { loadSettings } from "./settings.js";

/** 模拟考试引擎 */
export class ExamEngine {
  private memory: MemoryEngine;

  constructor(userId = "default") {
    this.memory = new MemoryEngine(userId);
  }

  /** 生成整卷（数学/英语/政治按科目框架，专业课按用户章节） */
  async generateExam(subject: string, count = 20, chaptersOverride?: string[]): Promise<Question[]> {
    const settings = await loadSettings();
    let chapters = chaptersOverride ?? [];
    if (chapters.length === 0) {
      if (subject.includes("专业课") || subject.includes("工程热力学")) {
        chapters = settings.majorChapters;
      } else {
        const fc = await getSubjectChapters(settings, subject);
        chapters = fc.chapters;
      }
    }
    const list = await generateExamPaper(settings, subject, chapters, count);
    // AI 可能不严格遵守题数 → 截断到 count，保证"选几题考几题"
    const trimmed = list.slice(0, count);
    const now = Date.now();
    return trimmed.map((q, i) => ({
      id: "exam_" + now + "_" + i,
      subject,
      chapter: String(q.chapter ?? ""),
      topic: String(q.topic ?? ""),
      content: String(q.content ?? ""),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      answer: String(q.answer ?? ""),
      explanation: String(q.explanation ?? ""),
      source: "ai" as const,
      createdAt: now,
    }));
  }

  /** 判卷并批量记录；返回错题列表（含用户答案），供交卷后错题回顾/AI 解析 */
  async gradeExam(questions: Question[], userAnswers: Record<string, string>): Promise<{
    score: number;
    total: number;
    detail: { questionId: string; isCorrect: boolean }[];
    wrongQuestions: { question: Question; userAnswer: string }[];
  }> {
    let correct = 0;
    const detail: { questionId: string; isCorrect: boolean }[] = [];
    const wrongQuestions: { question: Question; userAnswer: string }[] = [];
    for (const q of questions) {
      const raw = (userAnswers[q.id] ?? "").trim();
      const ua = raw.toUpperCase();
      const isCorrect = ua === q.answer.trim().toUpperCase();
      if (isCorrect) correct++;
      else wrongQuestions.push({ question: q, userAnswer: raw || "未作答" });
      detail.push({ questionId: q.id, isCorrect });
      await this.memory.recordAnswer({
        questionId: q.id,
        subject: q.subject,
        topic: q.topic,
        isCorrect,
        userAnswer: raw || "未作答",
        correctAnswer: q.answer,
        questionContent: q.content,
      });
    }
    return { score: correct, total: questions.length, detail, wrongQuestions };
  }
}