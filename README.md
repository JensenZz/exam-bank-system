# Exam Bank System（题库管理系统）

一个基于 **Electron + Vue 3 + TypeScript** 的桌面题库应用，支持从 PDF 中提取题目，并通过 AI + OCR 辅助完成题目录入、管理与练习。

> 当前仓库地址：<https://github.com/JensenZz/exam-bank-system.git>

---

## 功能特性

- 题库管理：新增、编辑、删除题目
- 分类管理：按分类组织题目
- PDF 导入：从试题 PDF 提取文本
- AI 解析：将文本结构化为题目数据
- OCR 回退：图片型 PDF 自动 OCR 识别
- 导入确认：支持预览并选择题目后入库
- 本地存储：使用 SQLite 持久化题库数据

---

## 技术栈

- **桌面框架**：Electron 33 + Electron Vite
- **前端**：Vue 3 + TypeScript + Pinia + Vue Router
- **数据库**：better-sqlite3（SQLite）
- **PDF / OCR**：pdf-parse、pdfjs-dist、tesseract.js、@napi-rs/canvas
- **网络请求**：axios

---

## 快速开始

### 1) 环境要求

- Node.js 18+
- npm 9+
- Windows（当前主要开发与验证环境）

### 2) 安装依赖

```bash
npm install
```

### 3) 启动开发

```bash
npm run dev
```

### 4) 生产构建

```bash
npm run build
```

### 5) 构建 Windows 安装包

```bash
npm run build:win
```

---

## 使用流程

1. 打开 **Settings** 页面，配置 AI 服务参数（provider / apiKey / model / endpoint）
2. 点击“测试连接”，成功后保存配置
3. 打开 **Import** 页面，选择 PDF 文件
4. 系统先提取文本；若文本不足，会自动执行 OCR
5. AI 解析后在页面预览题目，勾选后点击确认导入
6. 在 **Library / Practice** 页面管理和练习题目

---

## AI 配置说明（简要）

当前支持的 provider：

- `openai`
- `aliyun`
- `baidu`
- `custom`

说明：

- 自定义 endpoint 需与模型接口匹配
- 某些平台需要以 `/chat/completions` 作为请求路径
- 导入长文本时已内置分片与超时重试机制

---

## 项目结构

```text
src/
├─ main/       # Electron 主进程（IPC、数据库、AI、PDF/OCR）
├─ preload/    # 预加载脚本（安全桥接 window.electronAPI）
└─ renderer/   # Vue 前端
```

核心目录：

- `src/main`：主进程逻辑（数据库、配置、AI 调用、PDF 处理）
- `src/renderer/src/views`：页面视图（Import / Library / Practice / Settings）
- `src/renderer/src/stores`：Pinia 状态管理

---

## 常见问题

### 1) 测试连接返回 404

请检查 endpoint 与 provider、model 是否匹配，必要时补全接口路径（如 `/chat/completions`）。

### 2) 导入时超时

可先缩小导入范围或拆分 PDF。系统已支持分片解析与超时递归二分重试。

### 3) 图片型 PDF 提取不到文本

这是常见情况，系统会自动走 OCR。请确认 OCR 相关依赖已正确安装。

---

## 开发命令

- `npm run dev`：本地开发（热更新）
- `npm run build`：生产构建
- `npm run preview`：预览构建结果
- `npm run build:win`：打包 Windows 安装程序

---

## 贡献指南

欢迎提交 Issue 和 PR。

建议流程：

1. Fork 本仓库
2. 新建分支：`feature/xxx` 或 `fix/xxx`
3. 提交代码并保证可构建
4. 发起 Pull Request，说明改动背景与测试方式

---

## Roadmap（计划）

- [ ] 更完善的题目去重能力
- [ ] 导入流程更细粒度的错误提示
- [ ] 更多题型与解析模板
- [ ] 导出与备份能力

---

## License

MIT
