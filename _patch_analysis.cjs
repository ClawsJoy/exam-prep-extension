
const fs = require("fs");
const p = "src/engine/practice.ts";
let s = fs.readFileSync(p, "utf8");

// import stripJsonPrefix
s = s.replace(
  'import { callAI, callAIStream, parseJsonResponse } from "./deepseek.js";',
  'import { callAI, callAIStream, parseJsonResponse, stripJsonPrefix } from "./deepseek.js";'
);

// 找到 parseAnalysisSections 函数的起止位置
const fnStart = s.indexOf("function parseAnalysisSections");
const fnEnd = s.indexOf("

/**", fnStart); // 下一个注释块前
if (fnStart < 0) { console.log("✗ 未找到函数"); process.exit(1); }
const endPos = fnEnd > 0 ? fnEnd : s.length;

const neu = `function parseAnalysisSections(content: string): AnalysisSections {
  // 日志：记录原始内容摘要与长度，区分 AI 格式问题 vs 解析问题
  const snippet = (content || "").slice(0, 120).replace(/\\n/g, " ");
  console.warn("[parseAnalysisSections] 输入(" + (content || "").length + "字符): " + snippet);

  // 清洗 AI 输出前缀（1. / ```json / 前导文字），再做解析
  const cleaned = stripJsonPrefix(content);
  if (cleaned !== content.trim()) {
    console.warn("[parseAnalysisSections] 已清洗前缀 → " + cleaned.slice(0, 80) + "...");
  }

  // 1. 完整 JSON
  try {
    const obj = parseJsonResponse(cleaned) as Partial<AnalysisSections>;
    if (obj && typeof obj === "object" && (obj.考点 || obj.错因 || obj.解析)) {
      const sections: AnalysisSections = {
        考点: String(obj.考点 ?? ""),
        错因: String(obj.错因 ?? ""),
        解析: Array.isArray(obj.解析) ? obj.解析.map(String) : [String(obj.解析 ?? "")].filter(Boolean),
        避坑: String(obj.避坑 ?? ""),
        同类: String(obj.同类 ?? ""),
      };
      console.warn("[parseAnalysisSections] 命中 JSON: 考点=" + sections.考点.slice(0, 20) + " 步骤=" + sections.解析.length);
      return sections;
    }
    console.warn("[parseAnalysisSections] JSON 成功但字段缺失: " + JSON.stringify(obj));
  } catch (e) {
    console.warn("[parseAnalysisSections] JSON 失败: " + (e instanceof Error ? e.message : String(e)));
  }

  // 2. 【标题】切分
  const labels = ["考点", "错因", "解析", "避坑", "同类"];
  const sections: Record<string, string> = {};
  for (const lb of labels) {
    const re = new RegExp("【" + lb + "】([\\\\s\\\\S]*?)(?=【|$)", "g");
    const m = re.exec(cleaned);
    if (m) sections[lb] = m[1].trim();
  }
  if (sections["考点"] || sections["错因"] || sections["解析"]) {
    console.warn("[parseAnalysisSections] 命中标题切分");
    return {
      考点: sections["考点"] ?? "",
      错因: sections["错因"] ?? "",
      解析: (sections["解析"] ?? "").split(/\\n+/).map((x) => x.trim()).filter(Boolean),
      避坑: sections["避坑"] ?? "",
      同类: sections["同类"] ?? "",
    };
  }

  // 3. 纯文本兜底
  console.warn("[parseAnalysisSections] 兜底: 全部入解析");
  return { 考点: "", 错因: "", 解析: [cleaned || content.trim()], 避坑: "", 同类: "" };
}`;

s = s.slice(0, fnStart) + neu + s.slice(endPos);
fs.writeFileSync(p, s, "utf8");
console.log("✓ parseAnalysisSections 已替换");
