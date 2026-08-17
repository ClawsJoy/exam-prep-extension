import { QuizRecord, StudyReport } from "./types.js";
import { loadSettings } from "./settings.js";

/**
 * 报告引擎：学习记录聚合 → 报告。
 * 数据源 = memory_answer_log（练习/考试经 MemoryEngine.recordAnswer 实时写入），
 * 不再使用孤立的 report_records。
 */
export class ReportEngine {
  private cache: QuizRecord[] = [];

  private async load(): Promise<QuizRecord[]> {
    // memory_answer_log 由 MemoryEngine 写入（含 user 后缀：memory_answer_log_default）
    const r = await chrome.storage.local.get(null);
    const all = r as Record<string, unknown>;
    const records: QuizRecord[] = [];
    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith("memory_answer_log") && Array.isArray(val)) {
        for (const rec of val as Array<Record<string, unknown>>) {
          if (rec && typeof rec.isCorrect === "boolean" && rec.timestamp != null) {
            records.push({
              subject: String(rec.subject ?? ""),
              topic: String(rec.topic ?? ""),
              isCorrect: rec.isCorrect as boolean,
              timestamp: rec.timestamp as number,
            });
          }
        }
      }
    }
    return records;
  }

  /** 便捷记录（兼容旧调用；实际答题已由 recordAnswer 写入 memory log） */
  async addRecord(subject: string, topic: string, isCorrect: boolean): Promise<void> {
    // 数据已由 MemoryEngine.recordAnswer 统一写入 memory_answer_log，此处无需重复写
    void subject; void topic; void isCorrect;
  }

  async generateReport(days = 30): Promise<StudyReport> {
    this.cache = await this.load();
    const records = this.cache;
    const settings = await loadSettings();
    const cutoff = Date.now() - days * 86400_000;
    const recent = records.filter((r) => r.timestamp >= cutoff);

    const totalAnswered = recent.length;
    const accuracy = totalAnswered ? recent.filter((r) => r.isCorrect).length / totalAnswered : 0;

    const byTopic = new Map<string, { total: number; correct: number }>();
    for (const r of recent) {
      const cur = byTopic.get(r.topic) ?? { total: 0, correct: 0 };
      cur.total++;
      if (r.isCorrect) cur.correct++;
      byTopic.set(r.topic, cur);
    }
    const weakAreas: string[] = [];
    const strongAreas: string[] = [];
    for (const [topic, s] of byTopic) {
      const acc = s.correct / s.total;
      if (acc < 0.6) weakAreas.push(topic + "（" + Math.round(acc * 100) + "%）");
      else if (acc > 0.85) strongAreas.push(topic);
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dailyDone = records.filter((r) => r.timestamp >= dayStart.getTime()).length;

    return {
      totalAnswered,
      accuracy,
      weakAreas: weakAreas.slice(0, 5),
      strongAreas: strongAreas.slice(0, 5),
      trend: this.accuracyOverTime(7),
      dailyDone,
      dailyGoal: settings.dailyGoal,
    };
  }

  /** 近 N 天正确率趋势（需先 generateReport 预载 cache） */
  accuracyOverTime(intervalDays = 7): { date: string; accuracy: number }[] {
    const records = this.cache;
    const out: { date: string; accuracy: number }[] = [];
    const now = new Date();
    for (let i = intervalDays - 1; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const dayRecords = records.filter((r) => r.timestamp >= dayStart.getTime() && r.timestamp < dayEnd.getTime());
      const acc = dayRecords.length ? dayRecords.filter((r) => r.isCorrect).length / dayRecords.length : 0;
      out.push({ date: dayStart.toISOString().slice(5, 10), accuracy: Math.round(acc * 100) });
    }
    return out;
  }
}