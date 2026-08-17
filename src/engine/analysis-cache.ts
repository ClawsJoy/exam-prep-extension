// ── 错题分析缓存：缓存 AI 生成的分层解析，命中时免流式直出 ──
import { AnalysisSections } from "./types.js";

const KEY = "analysis_cache";
const MAX_ENTRIES = 200;

export interface CachedAnalysis {
  key: string;
  sections: AnalysisSections;
  createdAt: number;
}

/** 简单 hash（非加密用途，仅做缓存键） */
export function hashKey(...parts: string[]): string {
  const str = parts.join("|");
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return "h" + (h >>> 0).toString(36);
}

/** 读缓存（命中返回分层，未命中返回 null） */
export async function getCachedAnalysis(cacheKey: string): Promise<AnalysisSections | null> {
  const r = await chrome.storage.local.get(KEY);
  const list = (r[KEY] as CachedAnalysis[]) ?? [];
  const hit = list.find((c) => c.key === cacheKey);
  return hit ? hit.sections : null;
}

/** 写缓存（超上限淘汰最旧） */
export async function setCachedAnalysis(cacheKey: string, sections: AnalysisSections): Promise<void> {
  const r = await chrome.storage.local.get(KEY);
  const list = (r[KEY] as CachedAnalysis[]) ?? [];
  // 去重同 key
  const filtered = list.filter((c) => c.key !== cacheKey);
  filtered.push({ key: cacheKey, sections, createdAt: Date.now() });
  // 超限淘汰最旧
  const trimmed = filtered.length > MAX_ENTRIES
    ? filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ENTRIES)
    : filtered;
  await chrome.storage.local.set({ [KEY]: trimmed });
}

/** 清空分析缓存 */
export async function clearAnalysisCache(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
