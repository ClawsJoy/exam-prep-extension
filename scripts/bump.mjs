// 版本号管理脚本：遵循语义化版本号（SemVer）
// 用法：
//   node scripts/bump.mjs patch   → 1.0.0 → 1.0.1（修复Bug/性能）
//   node scripts/bump.mjs minor   → 1.0.1 → 1.1.0（新增小功能）
//   node scripts/bump.mjs major   → 1.1.0 → 2.0.0（重大更新/架构调整）
//   node scripts/bump.mjs         → 仅显示当前版本
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const type = process.argv[2];

function readJSON(p) {
  return JSON.parse(readFileSync(join(root, p), "utf8"));
}
function writeJSON(p, obj) {
  writeFileSync(join(root, p), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

const manifest = readJSON("manifest.json");
const current = manifest.version;
const [major, minor, patch] = current.split(".").map(Number);

if (!type) {
  console.log("当前版本: " + current);
  console.log("用法: node scripts/bump.mjs [patch|minor|major] [说明]");
  process.exit(0);
}

let next;
switch (type) {
  case "patch": next = major + "." + minor + "." + (patch + 1); break;
  case "minor": next = major + "." + (minor + 1) + ".0"; break;
  case "major": next = (major + 1) + ".0.0"; break;
  default:
    console.error("错误: 参数必须是 patch / minor / major");
    process.exit(1);
}

// 同步更新 manifest.json 与 package.json
manifest.version = next;
writeJSON("manifest.json", manifest);
const pkg = readJSON("package.json");
pkg.version = next;
writeJSON("package.json", pkg);

const desc = process.argv.slice(3).join(" ") || "(待补充更新说明)";

// 在 CHANGELOG.md 顶部插入新版本条目
const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const today = new Date().toISOString().slice(0, 10);
const entry = "## [" + next + "] - " + today + "\n\n### 🔄 " + (type === "major" ? "重大更新" : type === "minor" ? "新功能" : "修复与优化") + "\n\n- " + desc + "\n\n---\n\n";
writeFileSync(changelogPath, changelog.replace("---\n", "---\n\n" + entry), "utf8");

console.log("✅ 版本已升级: " + current + " → " + next);
console.log("   manifest.json ✓  package.json ✓  CHANGELOG.md 已插入占位条目");
console.log("   请补充 CHANGELOG.md 中的更新说明，然后 npm run build 并提交");
