# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 Electron + Vue 3 的桌面题库管理系统，支持 AI 识别 PDF 导入题目。

## 常用命令

- `npm run dev` - 启动开发服务器（热重载，自动打开 DevTools）
- `npm run build` - 构建生产版本
- `npm run build:win` - 构建 Windows 安装包
- `npm run preview` - 预览生产构建

## 技术栈

- **桌面框架**: Electron 33 + Electron Vite
- **前端**: Vue 3 (Composition API) + TypeScript
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **数据库**: Better SQLite3（同步 API）
- **构建工具**: Vite + electron-builder

## 项目架构

### 三进程结构

```
src/
├── main/       # Electron 主进程（Node.js 环境）
├── preload/    # 预加载脚本（桥接渲染进程和主进程）
└── renderer/   # 渲染进程（Vue 应用）
```

### 进程通信（IPC）

所有数据库操作和系统级功能通过 `ipcMain.handle`（主进程）和 `window.electronAPI`（渲染进程）进行通信。

**主进程定义的 IPC 通道**（位于 `src/main/index.ts`）：

| 通道名 | 功能 |
|--------|------|
| `db:getQuestions` | 获取题目列表，支持按分类、类型、关键词过滤 |
| `db:addQuestion` | 添加新题目 |
| `db:updateQuestion` | 更新题目 |
| `db:deleteQuestion` | 删除题目 |
| `db:getCategories` | 获取分类列表 |
| `db:addCategory` | 添加新分类 |
| `file:selectPdf` | 选择 PDF 文件 |
| `file:readPdf` | 读取 PDF 内容（待实现） |
| `window:minimize` | 最小化窗口 |
| `window:maximize` | 最大化/还原窗口 |
| `window:close` | 关闭窗口 |

### 数据库结构

数据库使用 SQLite，存储位置：`app.getPath('userData')/exam-bank.db`

**表结构**：

- `questions` - 题目表
  - `type`: single（单选）、multiple（多选）、fill（填空）、essay（简答）
  - `options`: JSON 格式存储选项数组
  - `images`: JSON 格式存储图片路径数组

- `categories` - 题目分类表（支持树形结构）

- `tags` - 标签表

- `question_tags` - 题目-标签关联表

- `practice_records` - 做题记录表

### 路径别名

在 `src/renderer/src/` 中使用 `@renderer/*` 别名引用该目录下的文件。

### 窗口配置

- 无边框窗口（`frame: false`）
- 自定义标题栏（需实现拖拽功能）
- 最小尺寸：1000x700
- 默认尺寸：1400x900

## 开发注意事项

1. **数据库操作**: Better SQLite3 使用同步 API，不要在主线程进行耗时查询

2. **窗口控制**: 由于是无边框窗口，需要在 Vue 组件中实现标题栏拖拽功能

3. **类型定义**: 共享类型定义在 `src/renderer/src/types/index.ts`

4. **状态管理**: 题库相关状态使用 Pinia store（`src/renderer/src/stores/`）

5. **PDF 解析**: 当前 `file:readPdf` 只是返回 base64，需要集成 PDF 解析库实现 AI 识别
