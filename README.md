# 🎓 考研智复习 · AI刷题助手（浏览器插件）

路线 C：**插件为壳，复用引擎逻辑** —— 与本地独立工具（`../exam-prep/`，Streamlit 版）共存。

基于 DeepSeek 的考研复习浏览器插件：AI 按章节出题、错题本 + 艾宾浩斯遗忘曲线复习队列、网页一键抓取知识点。**所有数据存本地，隐私由你掌控。**

## ✨ 功能
| 模块 | 说明 |
|---|---|
| ✍️ 练习引擎 | AI 按章节出题，难度可调，即练即讲 |
| 📝 考试引擎 | 一键生成模拟试卷，倒计时 + 自动判卷 |
| 📕 记忆引擎 | 错题自动入库，遗忘曲线计算复习紧迫度 |
| 🧠 知识引擎 | AI 提炼章节考点；网页右键一键收藏知识点 |
| 📈 报告引擎 | 正确率趋势、薄弱知识点分析 |
| 📚 文档索引 | 文本分块检索（本地 IndexedDB） |
| 📊 仪表盘 | 累计答题 / 正确率 / 待复习 / 今日进度 |

## 🔑 配置 DeepSeek API Key（必需）
1. 访问 https://platform.deepseek.com/ 注册并登录
2. 「API Keys」→「创建 API Key」→ 立即复制保存（仅显示一次）
3. 打开插件设置页 → 粘贴 Key → 点击「测试连接」→ 保存

> ⚠️ API Key 仅存浏览器本地（`chrome.storage.local`），不上传任何服务器。建议设置消费上限。

## 🚀 安装（开发者模式）
1. `npm install` 安装依赖
2. `npm run build` 构建 → 产物在 `dist/`
3. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/` 目录

## 📁 目录结构
```
exam-prep-extension/
├── manifest.json          # MV3 清单
├── src/
│   ├── background.ts      # Service Worker：AI 请求转发（绕 CORS）+ 首次安装引导
│   ├── content.ts         # 内容脚本：划词右键加入错题本
│   ├── engine/            # 引擎层（纯 TS，与 Python 版同构）
│   │   ├── types.ts       # 共享类型
│   │   ├── settings.ts    # chrome.storage 设置管理 + API Key 测试
│   │   ├── deepseek.ts    # DeepSeek 客户端（JSON 容错解析）
│   │   ├── memory.ts      # 遗忘曲线 / 错题本 / 复习队列
│   │   ├── practice.ts    # 练习引擎
│   │   ├── exam.ts        # 考试引擎
│   │   ├── knowledge.ts   # 知识引擎
│   │   ├── report.ts      # 报告引擎
│   │   └── indexer.ts     # 文档索引
│   └── ui/                # 页面
│       ├── onboarding.html/ts  # 首次安装引导
│       ├── options.html/ts     # 设置页（API Key / 备考目标 / 数据管理）
│       ├── popup.html/ts       # 弹窗快捷入口
│       └── app.html/ts         # 工作台（仪表盘/练习/考试/错题本/知识库/报告）
├── icons/                 # 图标（16/48/128）
├── scripts/build.mjs      # 构建脚本
└── CHROME_WEB_STORE.md    # 商店上架文案
```

## 🛠️ 开发
```bash
npm run build      # 完整构建
npm run typecheck  # 仅类型检查
```

## 🔒 安全说明
- API Key 与学习数据均存 `chrome.storage.local`（浏览器本地）
- AI 请求经 Service Worker 转发，Key 不暴露给网页
- 无任何远程服务器依赖

## 🔄 版本管理与更新日志

遵循 [SemVer](https://semver.org/lang/zh-CN/) 语义化版本号：`主.次.补丁`。

```bash
node scripts/bump.mjs            # 查看当前版本
node scripts/bump.mjs patch "说明"   # 1.0.0 → 1.0.1 修 Bug/性能
node scripts/bump.mjs minor "说明"   # 1.0.1 → 1.1.0 新功能
node scripts/bump.mjs major "说明"   # 1.1.0 → 2.0.0 重大更新
```

- 每次发版同步更新 [CHANGELOG.md](CHANGELOG.md) + 插件内 What's New 页 + 商店版本说明
- 推陈出新规划见 [ROADMAP.md](ROADMAP.md)

## 💎 产品定位

**本地优先（Local-first）的 AI 考研复习工具，与后端服务彻底解耦：**
- 数据（学习记录/错题本）只存在用户浏览器，API Key 只在用户本地与 DeepSeek 之间传输
- 无需服务器：零运营成本、零用户量风险、隐私即卖点
- 收入模式：向用户收取软件功能使用费（订阅/买断），AI 调用成本由用户自理
- 你的责任边界：保障插件功能稳定好用、持续更新；API 稳定性/费用由用户与 DeepSeek 直接解决

## 🛡️ 合规与安全

### 最小权限原则
manifest.json 仅申请功能必需的 2 项权限：
- `storage`：学习数据与 API Key 的本地存储
- `contextMenus`：右键"加入考研错题本"（划词收藏）

网络权限仅保留 DeepSeek 核心域名；其余 AI 供应商（OpenAI/月之暗面/通义/智谱）列为 `optional_host_permissions`，按需授予，避免不必要的全站网络访问。

### 内容安全
- AI 输入/输出经过基础敏感词过滤（`src/engine/safety.ts`），拦截极端不当内容；
- 使用日志**仅记录元数据**（时间/类型/是否拦截/长度），**不存储**输入输出原文；
- 日志仅存本地，可在设置页查看与清空。

### 隐私与用户协议
- [隐私政策](PRIVACY_POLICY.md)：数据收集/用途/存储/删除的完整说明
- [用户协议](TERMS_OF_SERVICE.md)：使用行为规范与免责声明
- 插件设置页内置隐私政策入口与使用日志管理

### 功能聚焦声明
本项目**始终聚焦"AI 考研复习"**这一核心用途：
- 不做广告、不做浏览器首页/新标签页劫持、不采集浏览行为；
- 所有功能（出题/错题/复习/报告/知识库）均服务于备考场景；
- 未来更新保持该边界，避免功能大杂烩带来的合规风险。

### 政策更新机制
- 定期（建议每季度）复查 [Chrome Web Store 开发者政策](https://developer.chrome.com/docs/webstore/program-policies/)；
- 隐私政策/用户协议如有重大变更，会在设置页显著提示；
- 商店后台的"预检"工具是上架前的第一道防线。