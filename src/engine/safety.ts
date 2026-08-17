// ── 内容安全模块 ────────────────────────────────────────────
// 原则：仅做基础的关键词过滤（防止极端不当内容），不存储完整对话内容。
// 使用日志只记录元数据（时间/类型/结果），不记录用户输入与 AI 输出原文，
// 以最小化隐私暴露。日志仅存浏览器本地。

const KEY_LOG = "safety_usage_log";
const LOG_MAX = 500;

// 基础敏感词表（按类别分组，作为示例可扩展；不追求穷尽）
// 说明：仅拦截明显违规的极端内容，普通考研学习内容不受影响。
const SENSITIVE_PATTERNS: { category: string; patterns: RegExp[] }[] = [
  {
    category: "暴力恐怖",
    patterns: [
      /制造爆炸|恐怖袭击|自杀式袭击|杀人教程|制作炸弹|砍人/i,
      /血腥暴力|肢解|虐杀/i,
    ],
  },
  {
    category: "色情低俗",
    patterns: [
      /色情交易|招嫖|卖淫|淫秽视频|成人影片/i,
      /约炮|一夜情交易/i,
    ],
  },
  {
    category: "仇恨歧视",
    patterns: [
      /种族灭绝|屠杀.*(?:民族|种族)|极端种族主义/i,
      /仇视.*(?:民族|宗教)/i,
    ],
  },
  {
    category: "违法犯罪",
    patterns: [
      /毒品交易|制毒|贩卖枪支|洗钱教程|网络诈骗教程/i,
      /入侵.*系统.*教程|盗取.*银行卡/i,
    ],
  },
  {
    category: "政治敏感",
    patterns: [
      /颠覆国家政权|分裂国家|邪教组织|宣扬邪教/i,
    ],
  },
];

export interface SafetyCheck {
  blocked: boolean;
  categories: string[];
}

/** 检查文本是否命中敏感内容 */
export function checkContent(text: string): SafetyCheck {
  if (!text) return { blocked: false, categories: [] };
  const hits: string[] = [];
  for (const g of SENSITIVE_PATTERNS) {
    for (const p of g.patterns) {
      if (p.test(text)) {
        hits.push(g.category);
        break;
      }
    }
  }
  return { blocked: hits.length > 0, categories: hits };
}

export interface UsageLogEntry {
  ts: number;
  type: "ai_chat" | "collect_save";
  blocked: boolean;
  category?: string;
  charLen: number; // 只记长度，不记内容
  provider?: string;
}

/** 记录一条使用日志（仅元数据） */
export async function logUsage(entry: UsageLogEntry): Promise<void> {
  try {
    const r = await chrome.storage.local.get(KEY_LOG);
    const list = (r[KEY_LOG] as UsageLogEntry[]) ?? [];
    list.push(entry);
    // 只保留最近 LOG_MAX 条，避免无限增长
    const trimmed = list.slice(-LOG_MAX);
    await chrome.storage.local.set({ [KEY_LOG]: trimmed });
  } catch { /* 日志失败不影响主流程 */ }
}

/** 读取日志（供设置页展示"隐私与合规"） */
export async function getUsageLog(): Promise<UsageLogEntry[]> {
  const r = await chrome.storage.local.get(KEY_LOG);
  return (r[KEY_LOG] as UsageLogEntry[]) ?? [];
}

/** 清空日志 */
export async function clearUsageLog(): Promise<void> {
  await chrome.storage.local.remove(KEY_LOG);
}
