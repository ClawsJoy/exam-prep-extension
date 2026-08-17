// 构建脚本：tsc 编译 src/**/*.ts → dist/，再复制 HTML/manifest/icons
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

// 清空 dist
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 复制 manifest.json（HTML 引用路径保持 src 结构）
writeFileSync(join(dist, "manifest.json"), readFileSync(join(root, "manifest.json"), "utf8"));

// 复制 ui HTML
mkdirSync(join(dist, "ui"), { recursive: true });
  cpSync(join(root, "src", "ui", "themes.css"), join(dist, "ui", "themes.css"));
for (const f of ["onboarding.html", "options.html", "popup.html", "app.html", "privacy.html", "whats-new.html"]) {
  cpSync(join(root, "src", "ui", f), join(dist, "ui", f));
}

// 复制 icons
mkdirSync(join(dist, "icons"), { recursive: true });
for (const f of ["icon16.png", "icon48.png", "icon128.png"]) {
  cpSync(join(root, "icons", f), join(dist, "icons", f));
}

console.log("✓ 静态资源已复制到 dist/");
console.log("（TS 编译由 tsc 完成，输出到 dist/ 根目录）");