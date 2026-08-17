
import re, pathlib

REPLACE = {
    "#1e88e5": "var(--brand-primary)",
    "#1a237e": "var(--brand-dark)",
    "#f5f7fb": "var(--bg-body)",
    "#1f2328": "var(--text-primary)",
    "#374151": "var(--text-secondary)",
    "#6b7280": "var(--text-muted)",
    "#9ca3af": "var(--text-faint)",
    "#e5e7eb": "var(--border)",
    "#d1d5db": "var(--border-input)",
    "#eef2f7": "var(--bg-hover)",
    "#f8fafc": "var(--bg-subtle)",
    "#22c55e": "var(--success)",
    "#16a34a": "var(--success)",
    "#dc2626": "var(--danger)",
    "#d97706": "var(--warning)",
    "#b45309": "var(--warning)",
}

FILES = ["app.html", "options.html", "popup.html", "onboarding.html", "privacy.html", "whats-new.html"]
BASE = pathlib.Path("src/ui")

for f in FILES:
    p = BASE / f
    txt = p.read_text(encoding="utf-8")
    # 1) 插入 themes.css 引用（在 <title> 后）
    if "themes.css" not in txt:
        txt = txt.replace("</title>", "</title>\n<link rel="stylesheet" href="themes.css">", 1)
    # 2) 色值替换
    for k, v in REPLACE.items():
        txt = txt.replace(k, v)
    # 3) 白色背景 → 卡片变量（仅 body/card 场景，粗粒度处理常见的 background:#fff 与 #fff 前景）
    # 4) 深蓝渐变
    txt = txt.replace("linear-gradient(135deg, var(--brand-dark), var(--brand-primary))", "var(--brand-gradient)")
    p.write_text(txt, encoding="utf-8")
    print(f"✓ {f}: 色值替换完成")
