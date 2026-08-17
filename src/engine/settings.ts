import { AppSettings, DEFAULT_SETTINGS, EnglishType, MathType, StudySubject } from "./types.js";
import { majorChaptersKey } from "./knowledge.js";

const KEY = "app_settings";

/** 读取设置（合并默认值） */
export async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<AppSettings> | undefined;
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  // 旧数据兼容：politics 缺失 → 默认 true
  if (typeof merged.politics !== "boolean") merged.politics = true;
  // 非法 math/english 值 → 回退默认
  const mathOk = ["数学一", "数学二", "数学三"].includes(merged.mathType);
  if (!mathOk) merged.mathType = "数学一";
  const engOk = ["英语一", "英语二"].includes(merged.englishType);
  if (!engOk) merged.englishType = "英语一";
  return merged;
}

/** 保存设置 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** 是否已配置 API Key */
export function hasApiKey(s: AppSettings): boolean {
  return typeof s.apiKey === "string" && s.apiKey.trim().length > 0;
}

/** 测试 DeepSeek API Key 是否有效（发一个最小 chat 请求） */
export async function testApiKey(
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey.trim(),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    if (resp.ok) return { ok: true, message: "连接成功，API Key 有效" };
    let msg = "HTTP " + resp.status;
    try {
      const j = await resp.json();
      if (j?.error?.message) msg = j.error.message;
    } catch { /* ignore */ }
    return { ok: false, message: msg };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 清除设置（重置） */
export async function resetSettings(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

// ── 数学/英语联动规则（考研规定：数学一↔英语一；数学二/三↔英语二） ──
export const MATH_ENGLISH_LINK: Record<MathType, EnglishType> = {
  "数学一": "英语一",
  "数学二": "英语二",
  "数学三": "英语二",
};

/**
 * 联动：根据数学类型返回应配套的英语类型。
 * 规则：数学一 → 英语一；数学二/数学三 → 英语二
 */
export function linkedEnglishType(mathType: MathType): EnglishType {
  return MATH_ENGLISH_LINK[mathType] ?? "英语一";
}

/** 反向联动：英语二 时数学只能选 数学二/数学三 */
export function mathAllowedFor(englishType: EnglishType): MathType[] {
  return englishType === "英语二"
    ? ["数学二", "数学三"]
    : ["数学一", "数学二", "数学三"];
}

/** 根据设置构建学习页科目栏（含启用状态） */
export function buildSubjects(s: AppSettings): StudySubject[] {
  const subjects: StudySubject[] = [];
  subjects.push({
    id: "math",
    label: s.mathType,
    subjectName: "考研数学（" + s.mathType + "）",
    type: s.mathType,
    enabled: true,
  });
  subjects.push({
    id: "english",
    label: s.englishType,
    subjectName: "考研英语（" + s.englishType + "）",
    type: s.englishType,
    enabled: true,
  });
  if (s.politics) {
    subjects.push({
      id: "politics",
      label: "政治",
      subjectName: "考研政治",
      enabled: true,
    });
  }
  subjects.push({
    id: "major",
    label: s.majorSubject || "专业课",
    subjectName: majorChaptersKey(s.targetUniversity, s.majorSubject || "专业课"),
    enabled: true,
  });
  return subjects;
}