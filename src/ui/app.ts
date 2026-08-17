import { loadSettings, hasApiKey, buildSubjects } from "../engine/settings.js";
import { getSubjectChapters } from "../engine/knowledge.js";
import { listFiles, getSubjectFileCount, addFile, removeFile, KB_SUBJECTS } from "../engine/kb-files.js";
import { StudySubject, AppSettings, DEFAULT_SETTINGS } from "../engine/types.js";
import { PracticeEngine } from "../engine/practice.js";
import { AbortError, StreamTimeoutError, NetworkError } from "../engine/deepseek.js";
import { ExamEngine } from "../engine/exam.js";
import { MemoryEngine } from "../engine/memory.js";
import { KnowledgeEngine } from "../engine/knowledge.js";
import { ReportEngine } from "../engine/report.js";
import { Question } from "../engine/types.js";
import { initTheme } from "../engine/theme-manager.js";

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
const main = $("main")!;

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function ensureKey(): Promise<boolean> {
  const s = await loadSettings();
  if (!hasApiKey(s)) {
    main.innerHTML = '<div class="card"><h2>🔑 需要配置 API Key</h2><p class="fs-14 text-muted mb-14">AI 出题、讲解等功能需要 DeepSeek API Key 才能使用。</p><button class="btn btn-primary" id="goOpt">去设置页配置</button></div>';
    $("goOpt")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
    return false;
  }
  return true;
}



// ── 分层错题分析渲染 ──────────────────────────────────────
const SECTION_META = [
  { key: "考点", icon: "📌" },
  { key: "错因", icon: "🔍" },
  { key: "解析", icon: "📝" },
  { key: "避坑", icon: "⚠️" },
  { key: "同类", icon: "💡" },
];

/** 分层卡片骨架（标题先显示，内容流式填充） */
function renderAnalysisSkeleton(): string {
  return '<div class="answer-wrong">❌ 回答错误，正确答案：' + esc(currentQuestion?.answer ?? "") + '</div>'
    + SECTION_META.map((m) =>
      '<div class="sec-card" data-sec="' + m.key + '">'
      + '<div class="sec-title">' + m.icon + " " + m.key + "</div>"
      + '<div class="sec-body">' + (m.key === "解析" ? "" : '<span class="text-faint">生成中…</span>') + '</div>'
      + "</div>").join("");
}

/** 流式增量：尝试解析当前累积 JSON 并逐卡片填充 */
function renderStreamingAnalysis(acc: string, root?: HTMLElement) {
  try {
    const obj = parsePartialAnalysis(acc);
    SECTION_META.forEach((m) => {
      const base = root ?? document;
      const card = base.querySelector(".sec-card[data-sec=\"" + m.key + "\"]");
      const body = card?.querySelector(".sec-body");
      if (!card || !body) return;
      if (m.key === "解析") {
        const arr = obj?.["解析"];
        if (Array.isArray(arr) && arr.length) {
          body.innerHTML = arr.map((x, i) => '<div class="sec-step">' + (i + 1) + ". " + esc(String(x)) + "</div>").join("");
        }
      } else {
        const v = obj?.[m.key as keyof typeof obj];
        if (typeof v === "string" && v.trim()) body.textContent = v;
      }
    });
  } catch { /* 累积文本未成完整 JSON，忽略 */ }
}

/** 解析已完成的字段（容错：字段可能尚未闭合） */
function parsePartialAnalysis(acc: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /\"([^\"]+)\"\s*:\s*(\"(?:[^\"\\]|\\.)*\"|\[[^\]]*\]|\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(acc)) !== null) {
    const raw = m[2];
    if (raw.startsWith("\"")) out[m[1]] = raw.slice(1, -1);
    else if (raw.startsWith("[")) {
      const items = raw.slice(1, -1).split(",").map((x) => x.trim().replace(/^\"|\"$/g, "")).filter(Boolean);
      out[m[1]] = items;
    } else out[m[1]] = Number(raw);
  }
  return out;
}

/** 最终渲染：完整分层卡片 */
function renderAnalysisCards(sec: { 考点: string; 错因: string; 解析: string[]; 避坑: string; 同类: string }, root?: HTMLElement) {
  SECTION_META.forEach((m) => {
    const base = root ?? document;
    const card = base.querySelector(".sec-card[data-sec=\"" + m.key + "\"]");
    const body = card?.querySelector(".sec-body");
    if (!card || !body) return;
    if (m.key === "解析") {
      const arr = sec["解析"] ?? [];
      body.innerHTML = arr.length
        ? arr.map((x, i) => '<div class="sec-step">' + (i + 1) + ". " + esc(x) + "</div>").join("")
        : '<span class="text-faint">（无）</span>';
    } else {
      const v = sec[m.key as keyof typeof sec] ?? "";
      body.innerHTML = v ? esc(String(v)) : '<span class="text-faint">（无）</span>';
    }
  });
}

// 全局当前题目引用（供分层渲染显示正确答案）
let currentQuestion: Question | null = null;

// ── 全局状态 ─────────────────────────────────────────────
let currentSettings: AppSettings = DEFAULT_SETTINGS;


// ── 流式解析并发控制：同一时间只允许一个请求 ──
let activeAnalysisController: AbortController | null = null;
let activeAnalysisBtn: HTMLButtonElement | null = null;
let activeAnalysisSlot: HTMLElement | null = null;
let activeAnalyzeFn: (() => Promise<void>) | null = null;

/** 新请求前取消旧请求（连续点击自动中止前一个） */
function acquireAnalysisSlot(btn: HTMLButtonElement, slot: HTMLElement): AbortController {
  // 中止旧请求
  if (activeAnalysisController) {
    try { activeAnalysisController.abort(); } catch { /* ignore */ }
  }
  const controller = new AbortController();
  activeAnalysisController = controller;
  activeAnalysisBtn = btn;
  activeAnalysisSlot = slot;
  return controller;
}

/** 渲染解析失败卡（含重试按钮），绝不停留"生成中…" */
function renderAnalysisError(slot: HTMLElement, message: string, retryFn: () => Promise<void>) {
  slot.innerHTML = '<div style="background:var(--danger-bg);border:1px solid var(--danger-border);border-radius:10px;padding:12px 14px;margin-top:10px;">'
    + '<div class="fs-13 text-danger fw-600">⚠️ ' + esc(message) + '</div>'
    + '<div class="mt-12"><button class="btn btn-primary" data-retry-analyze style="font-size:13px;padding:6px 16px;">🔄 点击重试</button></div>'
    + '</div>';
  const retryBtn = slot.querySelector("[data-retry-analyze]") as HTMLButtonElement | null;
  retryBtn?.addEventListener("click", () => {
    slot.innerHTML = renderAnalysisSkeleton();
    void retryFn();
  });
}

/** 错题本条目 AI 解析：就地展开，复用 gradeAnswer 链路（缓存优先 → 流式 → 五段 + 停止/重试） */
async function analyzeErrorBookEntry(
  practice: PracticeEngine,
  question: Question,
  userAnswer: string,
  btn: HTMLButtonElement,
  slot: HTMLElement,
): Promise<void> {
  // 单飞行：新解析自动中止旧请求
  const controller = acquireAnalysisSlot(btn, slot);
  slot.innerHTML = renderAnalysisSkeleton();
  btn.disabled = true;
  btn.textContent = "⏳ 解析中…";

  const runAnalyze = async (): Promise<void> => {
    const s = await loadSettings();
    const res = await practice.gradeAnswer(s, question, userAnswer, (acc) => {
      renderStreamingAnalysis(acc, slot);
    }, controller.signal);
    renderAnalysisCards(res.sections!, slot);
  };

  try {
    await runAnalyze();
  } catch (e) {
    // AbortError：静默（用户停止/被新请求取代）
    if (e instanceof AbortError) {
      return;
    }
    // 超时/网络/其他 → 错误卡 + 重试
    const msg = e instanceof StreamTimeoutError ? "解析超时（15 秒无响应）"
      : e instanceof NetworkError ? "网络连接失败"
      : e instanceof Error ? "解析生成失败：" + e.message
      : "解析生成失败";
    renderAnalysisError(slot, msg, () => analyzeErrorBookEntry(practice, question, userAnswer, btn, slot));
  } finally {
    finishAnalysis(controller, btn);
  }
}

/** AbortError 静默：将槽内"生成中…"标记为"已取消"，避免视觉卡死 */
function markSlotCancelled(slot: HTMLElement) {
  slot.querySelectorAll(".sec-body").forEach((b) => {
    const span = b.querySelector(".text-faint");
    if (span && span.textContent === "生成中…") span.textContent = "已取消";
  });
}

/** 解析成功收尾：清空活动状态 */
function finishAnalysis(controller: AbortController, btn: HTMLButtonElement) {
  if (activeAnalysisController === controller) {
    activeAnalysisController = null;
    activeAnalysisBtn = null;
    activeAnalysisSlot = null;
  }
  btn.disabled = false;
  btn.textContent = "📖 AI 解析";
}


// ── 全局科目状态 ──────────────────────────────────────────
let currentSubject: StudySubject | null = null;
let subjectChapters: string[] = [];   // 当前科目的章节框架
let subjectReady = false;             // 章节框架是否就绪
let subjectLoading = false;           // 是否正在加载框架

/** 切换科目：加载其章节框架 */
async function switchSubject(sub: StudySubject) {
  currentSubject = sub;
  subjectChapters = [];
  subjectReady = false;
  // 更新科目栏高亮
  document.querySelectorAll("#subjectBar .subj-btn").forEach((b) => {
    const bid = (b as HTMLElement).dataset.subj;
    b.classList.toggle("active", bid === sub.id);
  });
  await ensureSubjectChapters();
}

/** 确保当前科目章节框架就绪（专业课直接用 majorChapters，其余走 AI 框架） */
async function ensureSubjectChapters(): Promise<boolean> {
  if (!currentSubject) return false;
  const s = await loadSettings();
  if (currentSubject.id === "major") {
    // 专业课：走 AI/缓存（key 含学校+专业）；无 Key 或失败时回退用户 majorChapters
    if (!hasApiKey(s)) {
      subjectChapters = s.majorChapters;
      subjectReady = true;
      return true;
    }
    if (subjectLoading) return false;
    subjectLoading = true;
    try {
      const fc = await getSubjectChapters(s, currentSubject.subjectName);
      if (fc.chapters.length > 0) {
        subjectChapters = fc.chapters;
        subjectReady = true;
      } else {
        subjectChapters = s.majorChapters; // AI 失败兜底
        subjectReady = true;
      }
      return true;
    } catch {
      subjectChapters = s.majorChapters;
      subjectReady = true;
      return true;
    } finally {
      subjectLoading = false;
    }
  }
  if (!hasApiKey(s)) {
    subjectReady = false;
    return false;
  }
  if (subjectLoading) return false;
  subjectLoading = true;
  try {
    const fc = await getSubjectChapters(s, currentSubject.subjectName);
    subjectChapters = fc.chapters;
    subjectReady = subjectChapters.length > 0;
    return subjectReady;
  } finally {
    subjectLoading = false;
  }
}

/** 渲染科目栏 */
function renderSubjectBar(): string {
  const subs = buildSubjects(currentSettings);
  return '<div id="subjectBar" class="subject-bar">'
    + subs.map((sub) => {
      const active = currentSubject?.id === sub.id ? ' active' : "";
      const icon = sub.id === "math" ? "📐" : sub.id === "english" ? "📖" : sub.id === "politics" ? "🏛️" : "🔬";
      return '<button class="subj-btn" data-subj="' + sub.id + '"' + active + '>' + icon + " " + esc(sub.label) + "</button>";
    }).join("")
    + "</div>";
}

// ── 仪表盘 ──────────────────────────────────────────────
async function renderDashboard() {
  const mem = new MemoryEngine();
  const st = await mem.getStats();
  const report = new ReportEngine();
  const rep = await report.generateReport(30);
  main.innerHTML = '<div class="grid2">'
    + '<div class="metric"><div class="num">' + st.totalAnswered + '</div><div class="label">累计答题</div></div>'
    + '<div class="metric"><div class="num">' + Math.round(st.accuracy * 100) + '%</div><div class="label">正确率</div></div>'
    + '<div class="metric"><div class="num">' + st.activeErrors + '</div><div class="label">待复习错题</div></div>'
    + '<div class="metric"><div class="num">' + rep.dailyDone + '/' + rep.dailyGoal + '</div><div class="label">今日进度</div></div>'
    + '</div>'
    + '<div class="card"><h2>📅 近 7 天正确率</h2><div id="trend"></div></div>'
    + '<div class="card"><h2>⚠️ 薄弱知识点</h2><div id="weak"></div></div>';
  const trend = $("trend");
  if (trend) {
    trend.innerHTML = rep.trend.map((t) => {
      const h = Math.max(2, Math.min(100, t.accuracy));
      return '<div class="trend-wrap"><div class="trend-track"><div class="trend-bar" style="height:' + h + '%;"></div></div><div class="trend-date">' + t.date + '</div></div>';
    }).join('');
  }
  $("weak")!.innerHTML = rep.weakAreas.length
    ? rep.weakAreas.map((w) => '<span class="tag">' + esc(w) + '</span>').join('')
    : '<div class="empty">暂无数据，快去练习吧！</div>';
}

// ── 练习 ────────────────────────────────────────────────
let practiceQs: Question[] = [];
let practiceIdx = 0;
let practiceCorrect = 0;

async function renderPractice() {
  if (!(await ensureKey())) return;
  currentSettings = await loadSettings();
  if (!currentSubject) {
    const subs = buildSubjects(currentSettings);
    currentSubject = subs[0] ?? null;
    if (currentSubject) await ensureSubjectChapters();
  }
  main.innerHTML = renderSubjectBar() + '<div class="card"><h2>✍️ AI 练习 · ' + esc(currentSubject?.label ?? "") + '</h2>'
    + '<div class="row">'
    + (subjectReady && subjectChapters.length > 0
        ? '<select id="chapter"><option value="">随机章节</option>' + subjectChapters.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select>'
        : '<div class="warn-inline">⚠️ ' + esc(currentSubject?.label ?? "") + '章节框架需连接 API Key 后由 AI 初始化（专业课将使用默认章节）</div>')
    + '<select id="count"><option value="5">5 题</option><option value="10" selected>10 题</option></select>'
    + '<button class="btn btn-primary" id="start">开始练习</button></div>'
    + '<div id="quizArea"></div></div>';
  // 科目栏点击切换
  document.querySelectorAll("#subjectBar .subj-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.subj;
      const subs = buildSubjects(currentSettings);
      const target = subs.find((x) => x.id === id);
      if (target) {
        await switchSubject(target);
        renderPractice();
      }
    });
  });
  $("start")?.addEventListener("click", async () => {
    const chapter = ($("chapter") as HTMLSelectElement)?.value ?? "";
    const count = Number(($("count") as HTMLSelectElement).value);
    const btn = $("start") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "AI 生成中……";
    try {
      const engine = new PracticeEngine();
      const subj = currentSubject;
      practiceQs = await engine.generateQuestions(currentSettings, subj?.subjectName ?? "考研专业课", chapter || undefined, count, subjectReady ? subjectChapters : undefined);
      practiceIdx = 0;
      practiceCorrect = 0;
      renderPracticeQuestion();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "开始练习";
      $("quizArea")!.innerHTML = '<div class="empty error-inline">生成失败：' + esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  });
}

async function renderPracticeQuestion() {
  const area = $("quizArea")!;
  if (practiceIdx >= practiceQs.length) {
    const total = practiceQs.length;
    area.innerHTML = '<div class="card"><h2>✅ 练习完成</h2><p style="font-size:15px;margin:10px 0;">共 ' + total + ' 题，答对 ' + practiceCorrect + ' 题，正确率 ' + Math.round((practiceCorrect / total) * 100) + '%</p><button class="btn btn-primary" id="again">再来一组</button></div>';
    $("again")?.addEventListener("click", renderPractice);
    return;
  }
  const q = practiceQs[practiceIdx];
  currentQuestion = q;
  const opts = q.options
    ? q.options.map((o, i) => '<button class="opt" data-opt="' + String.fromCharCode(65 + i) + '">' + esc(o) + '</button>').join('')
    : '<input type="text" id="freeAnswer" placeholder="输入你的答案">';
  area.innerHTML = '<div class="q"><div class="topic">' + (practiceIdx + 1) + '/' + practiceQs.length + ' · ' + esc(q.chapter) + ' · ' + esc(q.topic) + '</div>'
    + '<div class="content">' + esc(q.content) + '</div>'
    + opts
    + '<div style="margin-top:12px;"><button class="btn btn-success" id="submit">提交</button></div>'
    + '<div id="feedback"></div></div>';
  area.querySelectorAll(".opt").forEach((b) => {
    b.addEventListener("click", () => {
      area.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
  });
  $("submit")?.addEventListener("click", async () => {
    const selected = area.querySelector(".opt.selected");
    const free = ($("freeAnswer") as HTMLInputElement | null)?.value ?? "";
    const ans = selected ? (selected as HTMLElement).dataset.opt! : free.trim();
    if (!ans) { alert("请选择答案"); return; }
    const engine = new PracticeEngine();
    const s = await loadSettings();
    const feedback = $("feedback")!;

    area.querySelectorAll(".opt").forEach((b) => {
      const opt = (b as HTMLElement).dataset.opt!;
      if (opt === q.answer) b.classList.add("correct");
      else if (opt === ans) b.classList.add("wrong");
    });
    ($("submit") as HTMLButtonElement).disabled = true;

    if (ans.toUpperCase() === q.answer.toUpperCase()) {
      // ── 答对：简洁确认 + 原题解析（不调 AI） ──
      practiceCorrect++;
      feedback.innerHTML = '<div class="answer-correct">✅ 回答正确！</div>'
        + '<div class="explain">' + esc(q.explanation || "本题解析见题目答案。") + '</div>'
        + '<div style="margin-top:12px;"><button class="btn btn-primary" id="next">下一题 →</button></div>';
      $("next")?.addEventListener("click", () => { practiceIdx++; renderPracticeQuestion(); });
      return;
    }

    // ── 答错：分层分析（单飞行 + 缓存优先 → 流式 → 错误卡/重试） ──
    // 新答题自动中止上一个流式请求
    const controller = acquireAnalysisSlot($("submit") as HTMLButtonElement, feedback);
    feedback.innerHTML = renderAnalysisSkeleton()
      + '<div style="margin-top:12px;display:flex;gap:10px;"><button class="btn btn-ghost" id="stopStream">⏹ 停止</button><button class="btn btn-primary" id="next" style="display:none;">下一题 →</button></div>';
    const stopBtn = $("stopStream");
    stopBtn?.addEventListener("click", () => controller.abort());

    const runAnalyze = async (): Promise<void> => {
      const r = await engine.gradeAnswer(s, q, ans, (acc) => {
        // 流式增量：打字机更新当前卡片（绑定 feedback 容器）
        renderStreamingAnalysis(acc, feedback);
      }, controller.signal);
      renderAnalysisCards(r.sections!, feedback);
      if (stopBtn) stopBtn.style.display = "none";
      const nextBtn = $("next");
      if (nextBtn) nextBtn.style.display = "inline-block";
      $("next")?.addEventListener("click", () => { practiceIdx++; renderPracticeQuestion(); });
    };

    try {
      await runAnalyze();
    } catch (e) {
      // AbortError：静默（用户停止/被新请求取代）
      if (e instanceof AbortError) {
        if (stopBtn) stopBtn.style.display = "none";
        const nextBtn = $("next");
        if (nextBtn) nextBtn.style.display = "inline-block";
        return;
      }
      // 超时/网络/其他 → 错误卡 + 重试
      const msg = e instanceof StreamTimeoutError ? "解析超时（15 秒无响应）"
        : e instanceof NetworkError ? "网络连接失败"
        : e instanceof Error ? "解析生成失败：" + e.message
        : "解析生成失败";
      renderAnalysisError(feedback, msg, async () => {
        try { await runAnalyze(); }
        catch (e2) {
          if (e2 instanceof AbortError) return;
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          renderAnalysisError(feedback, "解析生成失败：" + m2, runAnalyze);
        }
      });
    } finally {
      finishAnalysis(controller, $("submit") as HTMLButtonElement);
    }
  });
}

// ── 模拟考试 ────────────────────────────────────────────
let examQs: Question[] = [];
let examAnswers: Record<string, string> = {};
let examTimer: number | null = null;
let examSeconds = 0;

async function renderExam() {
  if (!(await ensureKey())) return;
  currentSettings = await loadSettings();
  if (!currentSubject) {
    const subs = buildSubjects(currentSettings);
    currentSubject = subs[0] ?? null;
    if (currentSubject) await ensureSubjectChapters();
  }
  main.innerHTML = renderSubjectBar() + '<div class="card"><h2>📝 模拟考试 · ' + esc(currentSubject?.label ?? "") + '</h2>'
    + '<div class="row"><select id="examCount"><option value="10">10 题</option><option value="20" selected>20 题</option></select>'
    + '<button class="btn btn-primary" id="startExam">生成试卷</button></div>'
    + '<div id="examArea"></div></div>';
  document.querySelectorAll("#subjectBar .subj-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.subj;
      const subs = buildSubjects(currentSettings);
      const target = subs.find((x) => x.id === id);
      if (target) {
        await switchSubject(target);
        renderExam();
      }
    });
  });
  $("startExam")?.addEventListener("click", async () => {
    const count = Number(($("examCount") as HTMLSelectElement).value);
    const btn = $("startExam") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "AI 生成中……";
    try {
      const engine = new ExamEngine();
      examQs = await engine.generateExam(currentSubject?.subjectName ?? "考研专业课", count, subjectReady ? subjectChapters : undefined);
      examAnswers = {};
      examSeconds = count * 60;
      if (examTimer) window.clearInterval(examTimer);
      examTimer = window.setInterval(() => {
        examSeconds--;
        const t = $("timer");
        if (t) t.textContent = "⏱️ " + Math.floor(examSeconds / 60) + ":" + String(examSeconds % 60).padStart(2, "0");
        if (examSeconds <= 0) submitExam();
      }, 1000);
      renderExamQuestion(0);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "生成试卷";
      $("examArea")!.innerHTML = '<div class="empty error-inline">生成失败：' + esc(e instanceof Error ? e.message : String(e)) + '</div>';
    }
  });
}

function renderExamQuestion(idx: number) {
  const area = $("examArea")!;
  if (idx >= examQs.length) { submitExam(); return; }
  const q = examQs[idx];
  const saved = examAnswers[q.id] ?? "";
  area.innerHTML = '<div class="timer" id="timer">⏱️ ' + Math.floor(examSeconds / 60) + ":" + String(examSeconds % 60).padStart(2, "0") + '</div>'
    + '<div class="q"><div class="topic">' + (idx + 1) + '/' + examQs.length + ' · ' + esc(q.chapter) + '</div>'
    + '<div class="content">' + esc(q.content) + '</div>'
    + (q.options ? q.options.map((o, i) => {
      const letter = String.fromCharCode(65 + i);
      return '<button class="opt' + (saved === letter ? ' selected' : '') + '" data-opt="' + letter + '">' + esc(o) + '</button>';
    }).join('') : '')
    + '<div style="margin-top:12px;display:flex;gap:10px;">'
    + (idx > 0 ? '<button class="btn btn-ghost" id="prevQ">← 上一题</button>' : '')
    + (idx < examQs.length - 1 ? '<button class="btn btn-primary" id="nextQ">下一题 →</button>' : '<button class="btn btn-success" id="finish">交卷</button>')
    + '</div></div>';
  area.querySelectorAll(".opt").forEach((b) => {
    b.addEventListener("click", () => {
      area.querySelectorAll(".opt").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      examAnswers[q.id] = (b as HTMLElement).dataset.opt!;
    });
  });
  $("nextQ")?.addEventListener("click", () => renderExamQuestion(idx + 1));
  $("prevQ")?.addEventListener("click", () => renderExamQuestion(idx - 1));
  $("finish")?.addEventListener("click", submitExam);
}

async function submitExam() {
  if (examTimer) { window.clearInterval(examTimer); examTimer = null; }
  const engine = new ExamEngine();
  const r = await engine.gradeExam(examQs, examAnswers);
  const pct = Math.round((r.score / r.total) * 100);

  // 成绩 + 错题回顾
  const wrong = r.wrongQuestions ?? [];
  main.innerHTML = '<div class="card"><h2>📊 考试成绩</h2>'
    + '<div class="center" style="padding:20px 0;"><div class="score-num">' + r.score + '/' + r.total + '</div><div class="score-sub">正确率 ' + pct + '%</div></div>'
    + '<div style="text-align:center;"><button class="btn btn-primary" id="redoExam">再考一次</button></div></div>'
    + (wrong.length > 0
      ? '<div class="card"><h2>📕 错题回顾（' + wrong.length + ' 道）</h2>'
        + '<div style="font-size:12.5px;color:var(--text-muted);margin-bottom:12px;">点击「AI 解析」查看分层错因分析（缓存命中秒出，未命中流式生成）</div>'
        + wrong.map((w, i) => '<div class="q" data-wrong="' + i + '">'
          + '<div class="topic">' + (i + 1) + '. ' + esc(w.question.chapter || "") + ' · ' + esc(w.question.topic || "") + '</div>'
          + '<div class="content">' + esc(w.question.content) + '</div>'
          + '<div style="margin:6px 0;font-size:13px;"><span class="text-danger">你的答案：' + esc(w.userAnswer || "未作答") + '</span> <span class="text-success">正确答案：' + esc(w.question.answer) + '</span></div>'
          + '<button class="btn btn-primary" data-analyze="' + i + '" style="font-size:13px;padding:6px 16px;">📖 AI 解析</button>'
          + '<div class="analysis-slot mt-12"></div>'
          + '</div>').join('')
        + '</div>'
      : '<div class="card"><div class="empty">🎉 全部答对，太棒了！</div></div>');

  $("redoExam")?.addEventListener("click", renderExam);

  // 错题 AI 解析（单飞行并发控制 + 缓存优先 → 流式 → 五段卡片 + 错误卡/重试）
  const practice = new PracticeEngine();
  const analyzeOne = async (i: number, btn: HTMLButtonElement, slot: HTMLElement): Promise<void> => {
    const w = wrong[i];
    if (!w) return;
    // 获取单飞行槽位（自动中止旧请求）
    const controller = acquireAnalysisSlot(btn, slot);
    slot.innerHTML = renderAnalysisSkeleton();
    btn.disabled = true;
    btn.textContent = "⏳ 解析中…";
    try {
      const s = await loadSettings();
      const res = await practice.gradeAnswer(s, w.question, w.userAnswer, (acc) => {
        renderStreamingAnalysis(acc, slot);
      }, controller.signal);
      renderAnalysisCards(res.sections!, slot);
    } catch (e) {
      // AbortError：用户停止/被新请求取消 → 静默终止（保留已生成内容，不显示错误）
      if (e instanceof AbortError) {
        markSlotCancelled(slot);
        return;
      }
      // 超时/网络/其他 → 错误卡 + 重试
      const msg = e instanceof StreamTimeoutError ? "解析超时（15 秒无响应）"
        : e instanceof NetworkError ? "网络连接失败"
        : e instanceof Error ? "解析生成失败：" + e.message
        : "解析生成失败";
      renderAnalysisError(slot, msg, () => analyzeOne(i, btn, slot));
    } finally {
      finishAnalysis(controller, btn);
    }
  };

  document.querySelectorAll("[data-analyze]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number((btn as HTMLElement).dataset.analyze);
      const slot = btn.parentElement?.querySelector(".analysis-slot") as HTMLElement | null;
      if (!slot) return;
      void analyzeOne(i, btn as HTMLButtonElement, slot);
    });
  });
}

// ── 错题本 ──────────────────────────────────────────────
// ── 错题本 ──────────────────────────────────────────────
// 独立科目过滤状态（不依赖练习页 currentSubject）
let errorBookFilter: string | undefined; // undefined = 全部科目
let errorBookPage = 0;
const PAGE_SIZE = 10;

async function renderErrorBook() {
  const mem = new MemoryEngine();
  // 分科目统计概览
  const dist = await mem.getSubjectDistribution();
  const distKeys = Object.keys(dist);

  if (distKeys.length === 0) {
    main.innerHTML = '<div class="card"><div class="empty">🎉 错题本是空的，继续保持！</div></div>';
    return;
  }

  // 科目统计 chips：可点击切换（全部 + 各科目）
  const allActive = !errorBookFilter ? ' style="background:var(--brand-primary);color:var(--text-on-brand);border-color:var(--brand-primary);"' : "";
  const chips = '<button class="tag subj-chip" data-subj=""' + allActive + '>全部科目</button>'
    + distKeys.map((k) => {
      const d = dist[k];
      const active = errorBookFilter === k ? ' style="background:var(--brand-primary);color:var(--text-on-brand);border-color:var(--brand-primary);"' : "";
      return '<button class="tag subj-chip" data-subj="' + esc(k) + '"' + active + '>' + esc(k) + "：" + d.active + " 待复习 · " + d.mastered + " 掌握</button>";
    }).join("");

  // 按过滤取队列（不分页截断，分页在渲染层做）
  const queue = await mem.getReviewQueue(500, errorBookFilter);
  const total = queue.length;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  if (errorBookPage > maxPage) errorBookPage = maxPage;
  const pageItems = queue.slice(errorBookPage * PAGE_SIZE, (errorBookPage + 1) * PAGE_SIZE);

  main.innerHTML = '<div class="card"><h2>📕 错题本 · 遗忘曲线复习队列' + (errorBookFilter ? "（" + esc(errorBookFilter) + "）" : "（全部科目）") + '</h2>'
    + '<div class="fs-12-5 text-muted mb-10">分科目统计（点击切换）</div>'
    + '<div class="mb-14">' + chips + '</div>'
    + '<div class="fs-12-5 text-muted mb-14">' + (errorBookFilter ? "当前科目 " : "全部 ") + '待复习 ' + total + ' 道 · 第 ' + (errorBookPage + 1) + '/' + (maxPage + 1) + ' 页</div>'
    + '<div id="errList"></div>'
    + '<div class="mt-12 flex gap-10" id="errPages"></div></div>';

  // chips 点击切换科目
  document.querySelectorAll(".subj-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      errorBookFilter = (chip as HTMLElement).dataset.subj || undefined;
      errorBookPage = 0;
      renderErrorBook();
    });
  });

  // 列表
  const list = $("errList")!;
  if (pageItems.length === 0) {
    list.innerHTML = '<div class="empty">' + (errorBookFilter ? "当前科目暂无待复习错题 🎉" : "🎉 错题本是空的，继续保持！") + '</div>';
  } else {
    list.innerHTML = pageItems.map((e, pi) => '<div class="q" data-eb="' + e.questionId + '">'
      + '<div class="topic">' + esc(e.subject) + ' · ' + esc(e.topic) + ' · 错 ' + e.errorCount + ' 次</div>'
      + '<div class="content">' + esc(e.questionContent) + '</div>'
      + '<div class="fs-13 text-success" style="margin:6px 0;">正确答案：' + esc(e.correctAnswer) + '</div>'
      + '<div class="flex gap-10 mt-8">'
      + '<button class="btn btn-primary" data-eb-analyze="' + e.questionId + '" style="font-size:12.5px;padding:6px 14px;">📖 AI 解析</button>'
      + '<button class="btn btn-ghost" data-master="' + e.questionId + '" style="font-size:12.5px;padding:6px 14px;">✓ 已掌握，移出队列</button>'
      + '</div>'
      + '<div class="eb-analysis mt-12" data-eb-slot="' + e.questionId + '"></div>'
      + '</div>').join('');

    // 已掌握
    list.querySelectorAll("[data-master]").forEach((b) => {
      b.addEventListener("click", async () => {
        await mem.markMastered((b as HTMLElement).dataset.master!);
        renderErrorBook();
      });
    });

    // AI 解析（就地展开，复用 gradeAnswer 链路：缓存优先 → 流式 → 五段卡片 + 停止/重试）
    const practice = new PracticeEngine();
    list.querySelectorAll("[data-eb-analyze]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qid = (btn as HTMLElement).dataset.ebAnalyze!;
        const entry = queue.find((x) => x.questionId === qid);
        if (!entry) return;
        const slot = list.querySelector('[data-eb-slot="' + qid + '"]') as HTMLElement | null;
        if (!slot) return;
        // 构造 Question 对象
        const question: Question = {
          id: entry.questionId,
          subject: entry.subject,
          chapter: "",
          topic: entry.topic,
          content: entry.questionContent,
          answer: entry.correctAnswer,
          explanation: "",
          source: "manual",
          createdAt: entry.createdAt,
        };
        void analyzeErrorBookEntry(practice, question, entry.lastUserAnswer, btn as HTMLButtonElement, slot);
      });
    });
  }

  // 分页按钮
  const pages = $("errPages")!;
  if (maxPage > 0) {
    pages.innerHTML = (errorBookPage > 0
        ? '<button class="btn btn-ghost" id="errPrev">← 上一页</button>' : "")
      + '<span class="fs-12-5 text-muted" style="align-self:center;">第 ' + (errorBookPage + 1) + ' / ' + (maxPage + 1) + ' 页</span>'
      + (errorBookPage < maxPage
        ? '<button class="btn btn-ghost" id="errNext">下一页 →</button>' : "");
    $("errPrev")?.addEventListener("click", () => { errorBookPage--; renderErrorBook(); });
    $("errNext")?.addEventListener("click", () => { errorBookPage++; renderErrorBook(); });
  }
}


async function renderLibrary() {
  // 知识库：本地文件系统（按科目目录）+ 网页收藏知识点
  const eng = new KnowledgeEngine();
  const [files, counts, points] = await Promise.all([
    listFiles(),
    getSubjectFileCount(),
    eng.list(),
  ]);
  main.innerHTML = '<div class="card"><h2>📚 知识库</h2>'
    + '<div class="fs-12-5 text-muted mb-12">上传本地资料（txt/md：真题、笔记、课本），AI 将优先基于你的资料出题与解析。网页划词右键也可收藏知识点。</div>'
    + '<div class="row"><input type="file" id="kbFile" accept=".txt,.md" multiple>'
    + '<select id="kbSubject">' + KB_SUBJECTS.map((s) => '<option>' + s + '</option>').join('') + '</select>'
    + '<button class="btn btn-primary" id="kbUpload">📤 上传</button></div>'
    + '<div id="kbMsg" style="font-size:12.5px;margin-top:6px;"></div>'
    + '<div class="fs-13 text-secondary" style="margin:14px 0;">📁 按科目目录：' + KB_SUBJECTS.map((s) => s + " (" + (counts[s] ?? 0) + ")").join(" · ") + '</div>'
    + '<div id="kbList"></div>'
    + '<div class="divider-top"><div class="fs-13 text-muted mb-8">🌐 网页收藏知识点（右键「加入考研错题本」）</div>'
    + '<div id="kpList"></div></div></div>';

  // 文件上传
  $("kbUpload")?.addEventListener("click", async () => {
    const input = $("kbFile") as HTMLInputElement;
    const subject = ($("kbSubject") as HTMLSelectElement).value;
    const msg = $("kbMsg")!;
    if (!input.files || input.files.length === 0) { msg.textContent = "请先选择文件"; return; }
    let ok = 0, fail = 0;
    for (const f of Array.from(input.files)) {
      try {
        await addFile(subject, f);
        ok++;
      } catch (e) { fail++; msg.textContent = "❌ " + (e instanceof Error ? e.message : String(e)); }
    }
    if (ok > 0) { msg.textContent = "✅ 已上传 " + ok + " 个文件" + (fail ? "，" + fail + " 失败" : ""); renderLibrary(); }
  });

  // 文件列表
  const list = $("kbList")!;
  if (files.length === 0) {
    list.innerHTML = '<div class="empty">还没有本地资料，上传 txt/md 文件开始构建你的专属题库</div>';
  } else {
    list.innerHTML = '<div class="fs-13 fw-600 text-secondary mb-8">📂 本地资料（' + files.length + ' 个）</div>'
      + files.slice(0, 20).map((f) => '<div class="q" style="padding:10px 14px;margin-bottom:8px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;">'
        + '<div><span class="tag">' + esc(f.subject) + '</span> <span style="font-size:13.5px;font-weight:600;">' + esc(f.name) + '</span></div>'
        + '<button class="btn btn-ghost fs-12" data-del="' + f.id + '" style="padding:4px 10px;color:var(--danger);">删除</button></div>'
        + '<div class="fs-12 text-faint mt-8">' + (f.size / 1024).toFixed(1) + " KB · " + new Date(f.createdAt).toLocaleDateString("zh-CN") + '</div>'
        + '</div>').join('');
    list.querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        await removeFile((b as HTMLElement).dataset.del!);
        renderLibrary();
      });
    });
  }

  // 网页收藏知识点
  const kp = $("kpList")!;
  if (points.length === 0) {
    kp.innerHTML = '<div class="empty">暂无网页收藏，去网页上划词右键收藏吧</div>';
  } else {
    kp.innerHTML = points.slice(0, 10).map((p) => '<div class="q" style="padding:10px 14px;margin-bottom:8px;">'
      + '<div class="topic">' + esc(p.chapter) + '</div>'
      + '<div class="content" style="font-size:13px;">' + esc(p.content.slice(0, 200)) + (p.content.length > 200 ? '…' : '') + '</div>'
      + '</div>').join('');
  }
}

// ── 报告 ────────────────────────────────────────────────
async function renderReport() {
  const report = new ReportEngine();
  const rep = await report.generateReport(30);
  main.innerHTML = '<div class="card"><h2>📈 学习报告（近 30 天）</h2>'
    + '<div class="stat"><span>累计答题</span><b>' + rep.totalAnswered + '</b></div>'
    + '<div class="stat"><span>总体正确率</span><b>' + Math.round(rep.accuracy * 100) + '%</b></div>'
    + '<div class="stat"><span>今日进度</span><b>' + rep.dailyDone + ' / ' + rep.dailyGoal + '</b></div>'
    + '<div class="mt-8"><div class="fs-12-5 text-muted mb-6">今日目标完成度</div><div class="bar"><div style="width:' + Math.min(100, Math.round((rep.dailyDone / rep.dailyGoal) * 100)) + '%;"></div></div></div>'
    + '</div>'
    + '<div class="card"><h2>⚠️ 薄弱知识点</h2>' + (rep.weakAreas.length ? rep.weakAreas.map((w) => '<span class="tag">' + esc(w) + '</span>').join('') : '<div class="empty">暂无</div>') + '</div>'
    + '<div class="card"><h2>💪 掌握较好的知识点</h2>' + (rep.strongAreas.length ? rep.strongAreas.map((w) => '<span class="tag">' + esc(w) + '</span>').join('') : '<div class="empty">暂无</div>') + '</div>';
}

// ── 路由 ────────────────────────────────────────────────
const PAGES: Record<string, () => Promise<void>> = {
  dashboard: renderDashboard,
  practice: renderPractice,
  exam: renderExam,
  errorbook: renderErrorBook,
  library: renderLibrary,
  report: renderReport,
};

async function init() {
  const s = await loadSettings();
  currentSettings = s;
  const ks = $("keyStatus");
  if (ks) {
    if (hasApiKey(s)) ks.textContent = "🔑 已配置";
    else {
      ks.textContent = "🔑 未配置";
      ks.addEventListener("click", () => chrome.runtime.openOptionsPage());
    }
  }
  document.querySelectorAll("#nav a").forEach((a) => {
    a.addEventListener("click", () => {
      document.querySelectorAll("#nav a").forEach((x) => x.classList.remove("active"));
      a.classList.add("active");
      const page = (a as HTMLElement).dataset.page!;
      void (PAGES[page] ?? renderDashboard)();
    });
  });
  const params = new URLSearchParams(location.search);
  const page = params.get("page") ?? "dashboard";
  const target = PAGES[page] ?? renderDashboard;
  document.querySelectorAll("#nav a").forEach((a) => {
    if ((a as HTMLElement).dataset.page === page) a.classList.add("active");
    else a.classList.remove("active");
  });
  await target();
}
initTheme().catch(() => {});
init();