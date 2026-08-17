
const fs = require("fs");
const p = "src/ui/app.ts";
let s = fs.readFileSync(p, "utf8");
let count = 0;
function rep(oldStr, newStr, label) {
  if (s.includes(oldStr)) { s = s.split(oldStr).join(newStr); count++; console.log("✓ " + label); }
  else console.log("· skip " + label);
}

// ── B 类：状态色 ──
// 科目按钮激活态
rep(
  "const active = currentSubject?.id === sub.id ? ' style="background:var(--brand-primary);color:var(--text-on-brand);border-color:var(--brand-primary);"' : "";",
  "const active = currentSubject?.id === sub.id ? ' active' : "";",
  "B1 科目按钮 active"
);
rep(
  "return '<button class="subj-btn" data-subj="' + sub.id + '"' + active + ' style="border:1px solid var(--border-input);border-radius:8px;padding:8px 16px;font-size:13.5px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--text-secondary);">'",
  "return '<button class="subj-btn" data-subj="' + sub.id + '"' + active + '>'",
  "B1b 科目按钮基础样式"
);
// 科目栏容器
rep(
  "return '<div id="subjectBar" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">'",
  "return '<div id="subjectBar" class="subject-bar">'",
  "B2 科目栏容器"
);
// 错题 chips 警告态
rep(
  "const active = d.active > 0 ? ' style="background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger-text);"' : "";",
  "const active = d.active > 0 ? ' warn' : "";",
  "B3 错题 chip warn"
);
// 答对框
rep(
  "feedback.innerHTML = '<div class="explain" style="background:var(--success-bg);border:1px solid var(--success-border);color:var(--success);">✅ 回答正确！</div>'",
  "feedback.innerHTML = '<div class="answer-correct">✅ 回答正确！</div>'",
  "B4 答对框"
);
// 答错标题（已在 C 类处理 answer-wrong）
// 趋势条
rep(
  "return '<div style="display:inline-block;margin-right:14px;text-align:center;width:36px;"><div style="height:80px;display:flex;align-items:flex-end;"><div style="width:22px;background:var(--brand-primary);border-radius:4px;height:' + h + '%;"></div></div><div style="font-size:11px;color:var(--text-muted);">' + t.date + '</div></div>';",
  "return '<div class="trend-wrap"><div class="trend-track"><div class="trend-bar" style="height:' + h + '%;"></div></div><div class="trend-date">' + t.date + '</div></div>';",
  "B5 趋势条"
);
// 正确率大数字
rep(
  "main.innerHTML = '<div class="card"><h2>📊 考试成绩</h2>'"
  + "\n    + '<div style="text-align:center;padding:20px 0;"><div style="font-size:48px;font-weight:800;color:var(--brand-dark);">' + r.score + '/' + r.total + '</div><div style="font-size:18px;color:var(--text-muted);margin-top:6px;">正确率 ' + pct + '%</div></div>'",
  "main.innerHTML = '<div class="card"><h2>📊 考试成绩</h2>'"
  + "\n    + '<div class="center" style="padding:20px 0;"><div class="score-num">' + r.score + '/' + r.total + '</div><div class="score-sub">正确率 ' + pct + '%</div></div>'",
  "B6 成绩大数字"
);

// ── A 类：静态布局（部分高频） ──
rep("<p style="font-size:14px;color:var(--text-muted);margin-bottom:14px;">", "<p class="fs-14 text-muted mb-14">", "A1 API Key 提示");
rep("'<div class="empty" style="color:var(--danger);">生成失败：'", "'<div class="empty error-inline">生成失败：'", "A2 生成失败");
rep("'<div style="font-size:13px;color:var(--warning);">⚠️ '", "'<div class="warn-inline">⚠️ '", "A3 章节锁定提示");
rep("'<p style="font-size:15px;margin:10px 0;">共 '", "'<p class="fs-15" style="margin:10px 0;">共 '", "A4 练习完成");
rep("'<div style="margin-top:12px;"><button class="btn btn-success" id="submit">提交</button></div>'", "'<div class="mt-12"><button class="btn btn-success" id="submit">提交</button></div>'", "A5 提交按钮");
rep("'<div style="margin-top:12px;"><button class="btn btn-primary" id="next">下一题 →</button></div>'", "'<div class="mt-12"><button class="btn btn-primary" id="next">下一题 →</button></div>'", "A6 下一题");
rep("'<div style="margin-top:12px;display:flex;gap:10px;"><button class="btn btn-ghost" id="stopStream">⏹ 停止</button><button class="btn btn-primary" id="next" style="display:none;">下一题 →</button></div>'", "'<div class="mt-12 flex gap-10"><button class="btn btn-ghost" id="stopStream">⏹ 停止</button><button class="btn btn-primary" id="next" style="display:none;">下一题 →</button></div>'", "A7 停止/下一题");
rep("'<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">共 '", "'<div class="fs-12-5 text-muted mb-14">共 '", "A8 错题计数");
rep("'<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px;">分科目统计</div>'", "'<div class="fs-12-5 text-muted mb-10">分科目统计</div>'", "A9 分科目统计");
rep("'<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px;">' + (subjFilter ? "当前科目 " : "全部 ") + '待复习 '", "'<div class="fs-12-5 text-muted mb-14">' + (subjFilter ? "当前科目 " : "全部 ") + '待复习 '", "A10 队列说明");
rep("'<div style="font-size:13px;color:var(--success);margin:6px 0;">正确答案：'", "'<div class="fs-13 text-success" style="margin:6px 0;">正确答案：'", "A11 正确答案");
rep("'<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">上传本地资料", "'<div class="fs-12-5 text-muted mb-12">上传本地资料", "A12 知识库说明");
rep("'<div style="font-size:13px;color:var(--text-secondary);">📁 按科目目录：'", "'<div class="fs-13 text-secondary">📁 按科目目录：'", "A13 科目目录");
rep("'<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px;"><div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">🌐 网页收藏知识点", "'<div class="divider-top"><div class="fs-13 text-muted mb-8">🌐 网页收藏知识点", "A14 网页收藏分隔");
rep("'<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">📂 本地资料（'", "'<div class="fs-13 fw-600 text-secondary mb-8">📂 本地资料（'", "A15 文件列表标题");
rep("'<div style="font-size:12px;color:var(--text-faint);margin-top:4px;">' + (f.size / 1024).toFixed(1)", "'<div class="fs-12 text-faint mt-8">' + (f.size / 1024).toFixed(1)", "A16 文件大小");
rep("'<button class="btn btn-ghost" data-del="' + f.id + '" style="font-size:12px;padding:4px 10px;color:var(--danger);">删除</button>'", "'<button class="btn btn-ghost" data-del="' + f.id + '" class="fs-12" style="padding:4px 10px;color:var(--danger);">删除</button>'", "A17 删除按钮");
rep("'<div style="display:flex;justify-content:space-between;align-items:center;">'", "'<div class="flex space-between">'", "A18 文件行");
rep("'<span style="font-size:13.5px;font-weight:600;">' + esc(f.name) + '</span>'", "'<span class="fs-13-5 fw-600">' + esc(f.name) + '</span>'", "A19 文件名");
rep("'<div style="margin:14px 0;font-size:13px;color:var(--text-secondary);">📁 按科目目录：'", "'<div class="fs-13 text-secondary" style="margin:14px 0;">📁 按科目目录：'", "A20 科目目录(修正)");
rep("'<div id="kbMsg" style="font-size:12.5px;margin-top:6px;"></div>'", "'<div id="kbMsg" class="fs-12-5" style="margin-top:6px;"></div>'", "A21 kbMsg");
rep("'<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">上传本地资料", "'<div class="fs-12-5 text-muted mb-12">上传本地资料", "A22 重复知识库说明");

fs.writeFileSync(p, s, "utf8");
console.log("\n共替换 " + count + " 处");
// 残留内联 style 统计
const remain = (s.match(/style=\\?"/g) || []).length;
console.log("剩余 style= 出现次数:", remain);
