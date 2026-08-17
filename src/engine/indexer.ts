import { DocChunk } from "./types.js";

const KEY_CHUNKS = "indexer_chunks";

/** 文档索引器：文本分块 + 关键词检索（浏览器版） */
export class DocumentIndexer {
  private chunkSize = 512;
  private overlap = 64;

  private async load(): Promise<DocChunk[]> {
    const r = await chrome.storage.local.get(KEY_CHUNKS);
    return (r[KEY_CHUNKS] as DocChunk[]) ?? [];
  }

  private async save(list: DocChunk[]): Promise<void> {
    await chrome.storage.local.set({ [KEY_CHUNKS]: list });
  }

  /** 将文本分块（512 字，64 字重叠） */
  private chunkText(title: string, text: string, source: string): DocChunk[] {
    const clean = text.replace(/\s+/g, " ").trim();
    const chunks: DocChunk[] = [];
    for (let i = 0; i < clean.length; i += this.chunkSize - this.overlap) {
      chunks.push({
        id: title + "_" + i,
        docTitle: title,
        text: clean.slice(i, i + this.chunkSize),
        source,
      });
    }
    return chunks;
  }

  /** 索引一段文本（网页抓取/粘贴） */
  async indexText(title: string, text: string, source = "manual"): Promise<number> {
    const chunks = this.chunkText(title, text, source);
    const list = await this.load();
    list.push(...chunks);
    await this.save(list);
    return chunks.length;
  }

  /** 关键词检索 */
  async search(keyword: string): Promise<DocChunk[]> {
    const list = await this.load();
    const kw = keyword.toLowerCase();
    return list
      .filter((c) => c.text.toLowerCase().includes(kw))
      .slice(0, 20);
  }

  async documentCount(): Promise<number> {
    const list = await this.load();
    return new Set(list.map((c) => c.docTitle)).size;
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(KEY_CHUNKS);
  }
}
