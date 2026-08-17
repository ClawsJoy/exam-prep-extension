// ── 知识库本地文件系统 ─────────────────────────────────────
// 支持 txt / md（pdf/docx 后续）。按科目建目录：数学/英语/政治/专业课/其他。
import { AppSettings } from "./types.js";

const KEY_FILES = "kb_files";

export interface KBFile {
  id: string;
  subject: string;      // 所属科目目录：数学/英语/政治/专业课/其他
  name: string;         // 文件名
  content: string;      // 全文（文本类）
  size: number;         // 字节
  createdAt: number;
}

export const KB_SUBJECTS = ["数学", "英语", "政治", "专业课", "其他"];

/** 将学科名映射到知识库目录（数学一 → 数学，工程热力学 → 专业课） */
export function subjectToKBDir(subjectName: string): string {
  if (subjectName.includes("数学")) return "数学";
  if (subjectName.includes("英语")) return "英语";
  if (subjectName.includes("政治")) return "政治";
  if (subjectName.includes("专业") || subjectName.includes("工程热力学")) return "专业课";
  return "其他";
}

async function loadAll(): Promise<KBFile[]> {
  const r = await chrome.storage.local.get(KEY_FILES);
  return (r[KEY_FILES] as KBFile[]) ?? [];
}

async function saveAll(list: KBFile[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_FILES]: list });
}

/** 读取文件（仅文本类） */
export async function readFileAsText(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!["txt", "md"].includes(ext)) {
    throw new Error("暂不支持 " + ext + " 格式，目前支持 txt / md（pdf/docx 后续版本）");
  }
  return await file.text();
}

/** 上传文件到指定科目目录 */
export async function addFile(subject: string, file: File): Promise<KBFile> {
  const content = await readFileAsText(file);
  const entry: KBFile = {
    id: "kb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    subject,
    name: file.name,
    content,
    size: file.size,
    createdAt: Date.now(),
  };
  const list = await loadAll();
  list.push(entry);
  await saveAll(list);
  return entry;
}

/** 按科目列出文件 */
export async function listFiles(subject?: string): Promise<KBFile[]> {
  const list = await loadAll();
  return list
    .filter((f) => !subject || f.subject === subject)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 按科目分组统计 */
export async function getSubjectFileCount(): Promise<Record<string, number>> {
  const list = await loadAll();
  const out: Record<string, number> = {};
  for (const f of list) out[f.subject] = (out[f.subject] ?? 0) + 1;
  return out;
}

/** 删除文件 */
export async function removeFile(id: string): Promise<void> {
  const list = await loadAll();
  await saveAll(list.filter((f) => f.id !== id));
}

/**
 * 检索某科目的参考资料片段（供 AI 出题/解析引用，优先本地知识库）。
 * 返回最多 maxChunks 段，每段截取上下文。
 */
export async function searchReferences(subjectName: string, keyword: string, maxChunks = 3): Promise<string[]> {
  const dir = subjectToKBDir(subjectName);
  const list = await loadAll();
  const inDir = list.filter((f) => f.subject === dir);
  if (inDir.length === 0) return [];
  const kw = keyword.toLowerCase();
  const out: string[] = [];
  for (const f of inDir) {
    const idx = f.content.toLowerCase().indexOf(kw);
    if (idx >= 0) {
      const start = Math.max(0, idx - 100);
      const end = Math.min(f.content.length, idx + kw.length + 200);
      out.push("【" + f.name + "】…" + f.content.slice(start, end) + "…");
      if (out.length >= maxChunks) break;
    }
  }
  return out;
}

/** 清空知识库 */
export async function clearFiles(): Promise<void> {
  await chrome.storage.local.remove(KEY_FILES);
}
