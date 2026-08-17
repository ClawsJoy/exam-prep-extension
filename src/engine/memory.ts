import { AnswerRecord, ErrorEntry } from "./types.js";

// 艾宾浩斯遗忘曲线默认记忆强度
const DEFAULT_STRENGTH = 0.5;
// 每轮正确复习后的强度提升
const STRENGTH_GAIN = 0.15;
// 达到此强度视为掌握
const MASTERED_THRESHOLD = 0.85;

const KEY_ERRORS = "memory_error_log";
const KEY_RECORDS = "memory_answer_log";

/** 遗忘曲线：记忆保留率随时间的指数衰减 */
export function forgettingCurve(tHours: number, S = DEFAULT_STRENGTH): number {
  // 对齐 Python 版：retention = e^(-t / (S * 24))
  return Math.exp(-tHours / (S * 24));
}

/** 复习紧迫度：错题次数越多、距上次复习越久，越该复习 */
export function calculateUrgency(
  errorCount: number,
  hoursSinceLastReview: number,
  strength = DEFAULT_STRENGTH,
): number {
  const retention = forgettingCurve(hoursSinceLastReview, strength);
  // 对齐 Python 版：urgency = (1 - retention) * errorCount
  return (1 - retention) * errorCount;
}

/** 错题本数据访问（chrome.storage.local） */
export class MemoryEngine {
  private userId: string;

  constructor(userId = "default") {
    this.userId = userId;
  }

  private key(k: string): string {
    return k + "_" + this.userId;
  }

  private async loadErrors(): Promise<ErrorEntry[]> {
    const r = await chrome.storage.local.get(this.key(KEY_ERRORS));
    return (r[this.key(KEY_ERRORS)] as ErrorEntry[]) ?? [];
  }

  private async saveErrors(list: ErrorEntry[]): Promise<void> {
    await chrome.storage.local.set({ [this.key(KEY_ERRORS)]: list });
  }

  private async loadRecords(): Promise<AnswerRecord[]> {
    const r = await chrome.storage.local.get(this.key(KEY_RECORDS));
    return (r[this.key(KEY_RECORDS)] as AnswerRecord[]) ?? [];
  }

  private async saveRecords(list: AnswerRecord[]): Promise<void> {
    await chrome.storage.local.set({ [this.key(KEY_RECORDS)]: list });
  }

  /** 记录一次答题：正确则强化，错误则记入错题本 */
  async recordAnswer(rec: Omit<AnswerRecord, "id" | "timestamp">): Promise<ErrorEntry | null> {
    const record: AnswerRecord = {
      ...rec,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const records = await this.loadRecords();
    records.push(record);
    await this.saveRecords(records);

    // 更新错题本
    const errors = await this.loadErrors();
    const idx = errors.findIndex((e) => e.questionId === rec.questionId);
    if (rec.isCorrect) {
      // 答对：若在错题本中则增强强度
      if (idx >= 0) {
        const e = errors[idx];
        e.strength = Math.min(1, e.strength + STRENGTH_GAIN);
        e.lastReviewedAt = record.timestamp;
        if (e.strength >= MASTERED_THRESHOLD) e.mastered = true;
        errors[idx] = e;
        await this.saveErrors(errors);
        return e;
      }
      return null;
    }

    if (idx >= 0) {
      const e = errors[idx];
      e.errorCount += 1;
      e.lastUserAnswer = rec.userAnswer;
      e.lastReviewedAt = record.timestamp;
      errors[idx] = e;
    } else {
      errors.push({
        questionId: rec.questionId,
        subject: rec.subject,
        topic: rec.topic,
        questionContent: rec.questionContent,
        correctAnswer: rec.correctAnswer,
        lastUserAnswer: rec.userAnswer,
        errorCount: 1,
        lastReviewedAt: record.timestamp,
        strength: DEFAULT_STRENGTH,
        mastered: false,
        createdAt: record.timestamp,
      });
    }
    await this.saveErrors(errors);
    return errors.find((e) => e.questionId === rec.questionId) ?? null;
  }

  /** 获取错题本（未掌握的优先，可按科目过滤） */
  async getErrorLog(subject?: string): Promise<ErrorEntry[]> {
    const errors = await this.loadErrors();
    return errors
      .filter((e) => !e.mastered)
      .filter((e) => !subject || e.subject === subject)
      .sort((a, b) => b.errorCount - a.errorCount);
  }

  /** 复习队列：按紧迫度排序 */
  async getReviewQueue(maxItems = 20, subject?: string): Promise<ErrorEntry[]> {
    const errors = await this.loadErrors();
    const now = Date.now();
    return errors
      .filter((e) => !e.mastered)
      .filter((e) => !subject || e.subject === subject)
      .map((e) => {
        const hours = (now - e.lastReviewedAt) / 3600_000;
        return { ...e, _urgency: calculateUrgency(e.errorCount, hours, e.strength) };
      })
      .sort((a, b) => b._urgency - a._urgency)
      .slice(0, maxItems)
      .map(({ _urgency, ...rest }) => rest);
  }

  /** 标记掌握 */
  async markMastered(questionId: string): Promise<boolean> {
    const errors = await this.loadErrors();
    const idx = errors.findIndex((e) => e.questionId === questionId);
    if (idx < 0) return false;
    errors[idx].mastered = true;
    await this.saveErrors(errors);
    return true;
  }

  /** 统计 */
  async getStats() {
    const errors = await this.loadErrors();
    const records = await this.loadRecords();
    const active = errors.filter((e) => !e.mastered);
    return {
      errorTotal: errors.length,
      activeErrors: active.length,
      mastered: errors.length - active.length,
      totalAnswered: records.length,
      correct: records.filter((r) => r.isCorrect).length,
      accuracy: records.length ? records.filter((r) => r.isCorrect).length / records.length : 0,
    };
  }

  /** 分科目错题统计：{ "数学一": {active, mastered}, ... } */
  async getSubjectDistribution(): Promise<Record<string, { active: number; mastered: number }>> {
    const errors = await this.loadErrors();
    const dist: Record<string, { active: number; mastered: number }> = {};
    for (const e of errors) {
      const key = e.subject || "其他";
      if (!dist[key]) dist[key] = { active: 0, mastered: 0 };
      if (e.mastered) dist[key].mastered++;
      else dist[key].active++;
    }
    return dist;
  }

  async reset(): Promise<void> {
    await chrome.storage.local.remove([this.key(KEY_ERRORS), this.key(KEY_RECORDS)]);
  }
}