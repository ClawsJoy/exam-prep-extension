// ── 共享类型定义 ────────────────────────────────────────────────

export interface AppSettings {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  provider: string;
  targetUniversity: string;
  targetMajor: string;
  mathType: MathType;
  englishType: EnglishType;
  politics: boolean; // 政治是否参与学习（默认 true）
  majorSubject: string;
  majorChapters: string[];
  dailyGoal: number;
  difficulty: number;
  reviewMode: "spaced" | "daily";
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  apiBaseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  provider: "deepseek",
  targetUniversity: "中国石油大学（北京）",
  targetMajor: "工程热力学",
  mathType: "数学一",
  englishType: "英语一",
  politics: true,
  majorSubject: "工程热力学（847）",
  majorChapters: [
    "第1章 基本概念与定义",
    "第2章 热力学第一定律",
    "第3章 理想气体的性质与过程",
    "第4章 热力学第二定律",
    "第5章 熵与㶲",
    "第6章 水蒸气的热力性质",
    "第7章 气体与蒸汽的流动",
    "第8章 动力循环",
    "第9章 制冷循环",
    "第10章 湿空气与热力系统",
  ],
  dailyGoal: 20,
  difficulty: 0.5,
  reviewMode: "spaced",
  onboarded: false,
};




/** 错题分层分析（五段式） */
export interface AnalysisSections {
  考点: string;
  错因: string;
  解析: string[];   // 分步骤
  避坑: string;
  同类: string;
}

/** 判分返回（答对无 AI 分析；答错含分层） */
export interface GradeResult {
  isCorrect: boolean;
  sections: AnalysisSections | null;
  fromCache: boolean;
  explanation?: string; // 答对时原题解析
}

// ── 科目体系 ─────────────────────────────────────────────
export type MathType = "数学一" | "数学二" | "数学三";
export type EnglishType = "英语一" | "英语二";
export type PoliticsType = "政治"; // 政治为固定公共课

/** 学习页科目：数学(带类型)/英语(带类型)/政治/专业课 */
export interface StudySubject {
  id: string;        // "math" | "english" | "politics" | "major"
  label: string;     // 显示名，如 "数学一" / "英语一" / "政治" / "工程热力学"
  subjectName: string; // 传给 AI 的出题名，如 "考研数学（数学一）"
  type?: MathType | EnglishType;
  enabled: boolean;  // 是否在科目栏显示
}

/** 科目章节框架缓存：{ "数学一": ["高数:极限", ...], ... } */
export interface ChapterCache {
  [subjectName: string]: string[];
}

// ── 题目 ─────────────────────────────────────────────────────
export interface Question {
  id: string;
  subject: string;
  chapter: string;
  topic: string;
  content: string;
  options?: string[];
  answer: string;
  explanation: string;
  source: "ai" | "manual";
  createdAt: number;
}

// ── 答题记录 / 错题 ───────────────────────────────────────────
export interface AnswerRecord {
  id: string;
  questionId: string;
  subject: string;
  topic: string;
  isCorrect: boolean;
  userAnswer: string;
  correctAnswer: string;
  questionContent: string;
  timestamp: number;
}

export interface ErrorEntry {
  questionId: string;
  subject: string;
  topic: string;
  questionContent: string;
  correctAnswer: string;
  lastUserAnswer: string;
  errorCount: number;
  lastReviewedAt: number;
  strength: number;
  mastered: boolean;
  createdAt: number;
}

// ── 知识点 / 文档 ─────────────────────────────────────────────
export interface KnowledgePoint {
  subject: string;
  chapter: string;
  content: string;
  source: string;
  createdAt: number;
}

export interface DocChunk {
  id: string;
  docTitle: string;
  text: string;
  source: string;
}

// ── 报告 ──────────────────────────────────────────────────────
export interface QuizRecord {
  subject: string;
  topic: string;
  isCorrect: boolean;
  timestamp: number;
}

export interface StudyReport {
  totalAnswered: number;
  accuracy: number;
  weakAreas: string[];
  strongAreas: string[];
  trend: { date: string; accuracy: number }[];
  dailyDone: number;
  dailyGoal: number;
}