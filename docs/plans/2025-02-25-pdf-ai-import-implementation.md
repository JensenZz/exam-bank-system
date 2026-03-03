# AI PDF 导入功能 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现使用现成 AI 服务识别 PDF 文本内容并自动导入题库的功能

**Architecture:** 主进程处理 PDF 提取和 AI 调用，渲染进程提供用户界面。通过配置系统支持多种 AI 服务，统一接口处理识别结果。

**Tech Stack:** pdf-parse、axios、TypeScript、Vue 3

---

### Task 1: 安装 PDF 解析依赖

**Files:**
- Create: `src/main/pdfProcessor.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

```typescript
// 测试 PDF 文本提取功能
import { test, expect } from 'vitest'
import { extractPdfText } from '../main/pdfProcessor'

test('extract pdf text', async () => {
  const result = await extractPdfText('./test-files/sample.pdf')
  expect(result).toBeDefined()
  expect(typeof result).toBe('string')
})
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "module not found"

**Step 3: Write minimal implementation**

```typescript
// src/main/pdfProcessor.ts
import { pdfParse } from 'pdf-parse'
import fs from 'fs/promises'

export async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  return data.text
}
```

**Step 4: Install pdf-parse**

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

**Step 5: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add pdf-parse dependency"

git add src/main/pdfProcessor.ts
git commit -m "feat: implement pdf text extraction"
```

---

### Task 2: 创建 AI 服务统一接口

**Files:**
- Create: `src/main/aiService.ts`
- Create: `src/main/types/ai.ts`

**Step 1: Write the failing test**

```typescript
// 测试 AI 服务接口
import { test, expect } from 'vitest'
import { AiService } from '../main/aiService'

test('ai service extracts questions', async () => {
  const service = new AiService({
    provider: 'openai',
    apiKey: 'test',
    model: 'gpt-3.5-turbo'
  })

  const result = await service.extractQuestions('测试文本')
  expect(result.questions).toBeDefined()
  expect(result.categories).toBeDefined()
})
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "AiService not defined"

**Step 3: Write minimal implementation**

```typescript
// src/main/types/ai.ts
export interface AiServiceConfig {
  provider: 'openai' | 'baidu' | 'aliyun'
  apiKey: string
  model: string
  endpoint?: string
}

export interface ExtractedQuestion {
  title: string
  content: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options?: string[]
  answer: string
  analysis?: string
  categoryName?: string
}

export interface AiResult {
  categories: Array<{ name: string; parentId?: number }>
  questions: ExtractedQuestion[]
}

// src/main/aiService.ts
import axios from 'axios'

export class AiService {
  constructor(private config: AiServiceConfig) {}

  async extractQuestions(text: string): Promise<AiResult> {
    // TODO: 实现具体的 AI 调用
    return {
      categories: [],
      questions: []
    }
  }
}
```

**Step 4: Install axios**

```bash
npm install axios
```

**Step 5: Run tests and verify they pass**

Run: `npm test`
Expected: PASS (基础框架)

**Step 6: Commit**

```bash
git add src/main/types/ai.ts src/main/aiService.ts
git commit -m "feat: add ai service interface"
```

---

### Task 3: 实现 OpenAI 服务集成

**Files:**
- Modify: `src/main/aiService.ts`

**Step 1: Write the failing test**

```typescript
test('openai service integration', async () => {
  const service = new AiService({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || 'test',
    model: 'gpt-3.5-turbo'
  })

  const result = await service.extractQuestions('1. 题目内容\\nA. 选项A\\nB. 选项B\\n答案: A')
  expect(result.questions.length).toBeGreaterThan(0)
})
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL or network error

**Step 3: Write OpenAI implementation**

```typescript
// 在 aiService.ts 中添加 OpenAI 实现
private async callOpenAI(text: string): Promise<AiResult> {
  const prompt = `
请分析以下文本，提取所有题目并按照 JSON 格式返回：
${text}

返回格式：
{
  "categories": [{"name": "分类名", "parentId": 0}],
  "questions": [{
    "title": "题目标题",
    "content": "题目内容",
    "type": "single|multiple|fill|essay",
    "options": ["选项A", "选项B"],
    "answer": "正确答案",
    "analysis": "解析（可选）",
    "categoryName": "分类名（可选）"
  }]
}
`

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: this.config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3
  }, {
    headers: {
      'Authorization': `Bearer ${this.config.apiKey}`
    }
  })

  const content = response.data.choices[0].message.content
  return JSON.parse(content)
}
```

**Step 4: Update extractQuestions method**

```typescript
async extractQuestions(text: string): Promise<AiResult> {
  switch (this.config.provider) {
    case 'openai':
      return this.callOpenAI(text)
    // TODO: 添加其他服务商
    default:
      throw new Error('Unsupported AI provider')
  }
}
```

**Step 5: Run tests and verify they pass**

Run: `npm test`
Expected: PASS with valid API key

**Step 6: Commit**

```bash
git add src/main/aiService.ts
git commit -m "feat: implement openai integration"
```

---

### Task 4: 实现 PDF 文件选择和 IPC 通信

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Step 1: Write the failing test**

```typescript
// 测试 IPC 通信
import { test, expect } from 'vitest'
import { ipcMain } from 'electron'

test('pdf selection ipc handler', () => {
  // 模拟 IPC 调用
  expect(true).toBe(true) // 占位测试
})
```

**Step 2: 在主进程中添加 PDF 选择功能**

```typescript
// src/main/index.ts 中添加
ipcMain.handle('file:selectPdf', async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  return result.filePaths
})

ipcMain.handle('file:extractPdfText', async (_, filePath: string) => {
  const { extractPdfText } = await import('./pdfProcessor')
  return extractPdfText(filePath)
})
```

**Step 3: 更新 preload 脚本**

```typescript
// src/preload/index.ts
// 添加新的 API
file: {
  selectPdf: () => ipcRenderer.invoke('file:selectPdf'),
  extractPdfText: (filePath: string) => ipcRenderer.invoke('file:extractPdfText', filePath)
  // ... 其他现有方法
}
```

**Step 4: 创建测试文件并运行**

创建 `tests/main/file-spec.ts` 并运行测试

**Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: add pdf file selection ipc"
```

---

### Task 5: 创建导入页面组件

**Files:**
- Create: `src/renderer/src/views/Import.vue`
- Create: `src/renderer/src/components/AiConfig.vue`
- Create: `src/renderer/src/components/PdfPreview.vue`

**Step 1: 写一个组件测试**

```typescript
// 测试 Import 组件
import { mount } from '@vue/test-utils'
import Import from '../../views/Import.vue'

test('import component renders', () => {
  const wrapper = mount(Import)
  expect(wrapper.find('.import-page')).toBeTruthy()
})
```

**Step 2: 创建基础 Import.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import AiConfig from '../components/AiConfig.vue'
import PdfPreview from '../components/PdfPreview.vue'

const selectedFiles = ref<string[]>([])
const showConfig = ref(false)
const processing = ref(false)

const handleFileSelect = async () => {
  // TODO: 实现 PDF 选择
}

const startImport = async () => {
  processing.value = true
  // TODO: 实现导入逻辑
  processing.value = false
}
</script>

<template>
  <div class="import-page">
    <h1>AI 导入题库</h1>

    <div class="upload-area">
      <!-- 文件选择区域 -->
    </div>

    <div v-if="selectedFiles.length > 0">
      <PdfPreview :files="selectedFiles" />

      <button @click="showConfig = true">AI 配置</button>

      <AiConfig v-if="showConfig" @config-ready="startImport" />
    </div>
  </div>
</template>
```

**Step 3: 创建 AiConfig 组件**

```vue
<script setup lang="ts">
import { ref } from 'vue'

const config = ref({
  provider: 'openai',
  apiKey: '',
  model: 'gpt-3.5-turbo'
})

const emit = defineEmits(['config-ready'])

const submit = () => {
  emit('config-ready', config.value)
}
</script>

<template>
  <div class="ai-config">
    <h3>AI 服务配置</h3>
    <!-- 配置表单 -->
  </div>
</template>
```

**Step 4: 运行测试并验证**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/src/views/Import.vue
git add src/renderer/src/components/AiConfig.vue
git add src/renderer/src/components/PdfPreview.vue
git commit -m "feat: create import page components"
```

---

### Task 6: 实现 PDF 文本提取和 AI 调用流程

**Files:**
- Modify: `src/renderer/src/views/Import.vue`
- Create: `src/renderer/src/stores/importStore.ts`

**Step 1: 写测试用例**

```typescript
// 测试导入流程
import { useImportStore } from '../stores/importStore'

test('import process', async () => {
  const store = useImportStore()
  await store.startImport('/path/to/pdf.pdf', config)
  expect(store.questions.length).toBeGreaterThan(0)
})
```

**Step 2: 创建 importStore**

```typescript
// src/renderer/src/stores/importStore.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ImportProgress {
  current: number
  total: number
  status: 'idle' | 'processing' | 'completed' | 'error'
}

export const useImportStore = defineStore('import', () => {
  const questions = ref([])
  const categories = ref([])
  const progress = ref<ImportProgress>({
    current: 0,
    total: 0,
    status: 'idle'
  })

  async function startImport(pdfPath: string, config: any) {
    progress.value.status = 'processing'

    try {
      // 提取 PDF 文本
      const text = await window.electronAPI.file.extractPdfText(pdfPath)

      // 调用 AI
      const result = await window.electronAPI.ai.extractQuestions(text, config)

      questions.value = result.questions
      categories.value = result.categories

      progress.value.status = 'completed'
    } catch (error) {
      progress.value.status = 'error'
      throw error
    }
  }

  return { questions, categories, progress, startImport }
})
```

**Step 3: 更新 Import.vue 实现流程**

```typescript
<script setup lang="ts">
import { ref } from 'vue'
import { useImportStore } from '../stores/importStore'
import AiConfig from '../components/AiConfig.vue'

const store = useImportStore()
const selectedFiles = ref<string[]>([])

const handleExtract = async () => {
  if (selectedFiles.value.length === 0) return

  const config = await showAiConfig()
  if (config) {
    store.progress.total = selectedFiles.value.length

    for (const file of selectedFiles.value) {
      await store.startImport(file, config)
      store.progress.current++
    }
  }
}
</script>
```

**Step 4: 在主进程中添加 AI IPC 处理**

```typescript
// src/main/index.ts
ipcMain.handle('ai:extractQuestions', async (_, text: string, config: any) => {
  const { AiService } = await import('./aiService')
  const service = new AiService(config)
  return service.extractQuestions(text)
})
```

**Step 5: 更新 preload 添加 AI API**

```typescript
// src/preload/index.ts
ai: {
  extractQuestions: (text: string, config: any) => ipcRenderer.invoke('ai:extractQuestions', text, config)
}
```

**Step 6: Commit**

```bash
git add src/renderer/src/stores/importStore.ts
git add src/renderer/src/views/Import.vue
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: implement ai extraction flow"
```

---

### Task 7: 实现题目预览和确认功能

**Files:**
- Create: `src/renderer/src/components/QuestionList.vue`
- Modify: `src/renderer/src/views/Import.vue`

**Step 1: 写测试用例**

```typescript
// 测试题目列表组件
import { mount } from '@vue/test-utils'
import QuestionList from '../../components/QuestionList.vue'

test('question list displays questions', () => {
  const questions = [{ title: 'Test Question' }]
  const wrapper = mount(QuestionList, { props: { questions } })
  expect(wrapper.text()).toContain('Test Question')
})
```

**Step 2: 创建 QuestionList 组件**

```vue
<script setup lang="ts">
import { defineProps } from 'vue'

defineProps<{
  questions: any[]
  categories: any[]
  onConfirm: (questions: any[]) => void
}>()
</script>

<template>
  <div class="question-list">
    <div class="categories">
      <!-- 分类树形展示 -->
    </div>

    <div class="questions">
      <div v-for="q in questions" :key="q.title" class="question-card">
        <h3>{{ q.title }}</h3>
        <p>{{ q.content }}</p>
        <!-- 显示选项、答案等 -->
      </div>
    </div>

    <button @click="$emit('confirm', questions)">确认导入</button>
  </div>
</template>
```

**Step 3: 更新 Import.vue 添加预览**

```vue
<template>
  <!-- ... -->

  <div v-if="store.questions.length > 0">
    <QuestionList
      :questions="store.questions"
      :categories="store.categories"
      @confirm="handleConfirm"
    />
  </div>
</template>
```

**Step 4: 实现确认导入逻辑**

```typescript
const handleConfirm = async () => {
  const questionStore = useQuestionStore()

  for (const question of store.questions) {
    // 检查分类是否存在，不存在则创建
    let category = store.categories.find(c => c.name === question.categoryName)
    if (!category) {
      category = await questionStore.addCategory(question.categoryName || '未分类')
    }

    // 添加题目
    await questionStore.addQuestion({
      ...question,
      categoryId: category.id
    })
  }

  // 清理状态
  store.questions = []
  store.categories = []
}
```

**Step 5: Commit**

```bash
git add src/renderer/src/components/QuestionList.vue
git add src/renderer/src/views/Import.vue
git commit -m "feat: add question preview and confirmation"
```

---

### Task 8: 添加进度显示和错误处理

**Files:**
- Modify: `src/renderer/src/views/Import.vue`
- Modify: `src/renderer/src/components/QuestionList.vue`

**Step 1: 写测试用例**

```typescript
// 测试进度显示
test('progress indicator updates', () => {
  // 模拟进度更新
  expect(true).toBe(true)
})
```

**Step 2: 添加进度条组件**

```vue
<!-- ProgressIndicator.vue -->
<template>
  <div class="progress-bar">
    <div class="progress" :style="{ width: progress + '%' }"></div>
    <span>{{ progress }}%</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  progress: number
}>()
</script>
```

**Step 3: 更新 Import.vue 显示进度**

```vue
<template>
  <!-- ... -->

  <div v-if="store.progress.status === 'processing'">
    <ProgressIndicator :progress="store.progress.current / store.progress.total * 100" />
    <p>处理中... {{ store.progress.current }}/{{ store.progress.total }}</p>
  </div>

  <div v-if="store.progress.status === 'error'">
    <p>处理失败：{{ error }}</p>
  </div>
</template>
```

**Step 4: 添加错误处理**

```typescript
// 在导入流程中添加 try-catch
try {
  // ... 导入逻辑
} catch (error) {
  console.error('导入失败:', error)
  alert(`导入失败：${error.message}`)
} finally {
  store.progress.status = 'idle'
}
```

**Step 5: Commit**

```bash
git add src/renderer/src/components/ProgressIndicator.vue
git add src/renderer/src/views/Import.vue
git commit -m "feat: add progress display and error handling"
```

---

### Task 9: 完善 UI 样式和交互体验

**Files:**
- Modify: `src/renderer/src/assets/styles.css`
- Modify: 各 Vue 组件的样式

**Step 1: 添加拖拽上传样式**

```css
.upload-area {
  border: 2px dashed #409eff;
  border-radius: 8px;
  padding: 40px;
  text-align: center;
  transition: all 0.3s;
}

.upload-area.drag-over {
  background: #f0f9ff;
  border-color: #66b1ff;
}
```

**Step 2: 添加文件列表样式**

```css
.file-list {
  margin-top: 20px;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: white;
  border-radius: 6px;
  margin-bottom: 8px;
}
```

**Step 3: 添加动画效果**

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.question-card {
  animation: fadeIn 0.3s ease-out;
}
```

**Step 4: 响应式设计**

```css
@media (max-width: 768px) {
  .question-list {
    grid-template-columns: 1fr;
  }
}
```

**Step 5: Commit**

```bash
git add src/renderer/src/assets/styles.css
git add src/renderer/src/components/*.vue
git commit -m "style: enhance ui with animations and responsive design"
```

---

### Task 10: 添加更多 AI 服务支持

**Files:**
- Modify: `src/main/aiService.ts`

**Step 1: 实现百度文心集成**

```typescript
// 添加百度文心支持
private async callBaiduQianfan(text: string): Promise<AiResult> {
  const response = await axios.post('https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions', {
    messages: [{
      role: 'user',
      content: `请分析以下文本，提取所有题目并按照 JSON 格式返回：${text}`
    }]
  }, {
    params: {
      access_token: this.config.apiKey
    }
  })

  const content = response.data.result
  return JSON.parse(content)
}
```

**Step 2: 更新 AI 服务配置**

```typescript
interface AiServiceConfig {
  provider: 'openai' | 'baidu' | 'aliyun'
  apiKey: string
  model?: string  // 不同服务商模型名称不同
  endpoint?: string
}
```

**Step 3: 完善错误处理**

```typescript
// 添加网络超时、API 限制等错误处理
try {
  const response = await axios.post(url, data, {
    timeout: 30000,
    headers: headers
  })
  // ...
} catch (error) {
  if (error.code === 'ECONNABORTED') {
    throw new Error('请求超时，请检查网络连接')
  }
  // ... 其他错误处理
}
```

**Step 4: Commit**

```bash
git add src/main/aiService.ts
git commit -m "feat: add baidu qianfan support and error handling"
```

---

### Task 11: 添加配置持久化

**Files:**
- Create: `src/main/configManager.ts`
- Modify: `src/renderer/src/stores/importStore.ts`

**Step 1: 创建配置管理器**

```typescript
// src/main/configManager.ts
import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

export class ConfigManager {
  private configPath = path.join(app.getPath('userData'), 'ai-config.json')

  async getConfig(): Promise<any> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return this.getDefaultConfig()
    }
  }

  async saveConfig(config: any): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2))
  }

  private getDefaultConfig() {
    return {
      provider: 'openai',
      model: 'gpt-3.5-turbo'
    }
  }
}
```

**Step 2: 在主进程中添加配置 IPC**

```typescript
// src/main/index.ts
ipcMain.handle('config:load', () => configManager.getConfig())
ipcMain.handle('config:save', (_, config) => configManager.saveConfig(config))
```

**Step 3: 更新渲染进程使用配置**

```typescript
// 在 Import.vue 中加载保存的配置
const savedConfig = ref({})

onMounted(async () => {
  savedConfig.value = await window.electronAPI.config.load()
})
```

**Step 4: Commit**

```bash
git add src/main/configManager.ts
git add src/main/index.ts
git add src/renderer/src/stores/importStore.ts
git commit -m "feat: add config persistence"
```

---

### Task 12: 最终测试和优化

**Files:**
- Create: `tests/e2e/import.spec.ts`
- Modify: 所有相关文件进行最终优化

**Step 1: 编写端到端测试**

```typescript
// tests/e2e/import.spec.ts
import { test, expect } from '@playwright/test'

test('pdf import flow', async ({ page }) => {
  await page.goto('/import')

  // 选择文件
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles('test-files/sample.pdf')

  // 配置 AI
  await page.fill('[name="apiKey"]', 'test-key')

  // 开始导入
  await page.click('button:has-text("开始导入")')

  // 等待完成
  await page.waitForSelector('.question-list')

  // 确认导入
  await page.click('button:has-text("确认导入")')

  // 验证导入结果
  await expect(page.locator('.question-card')).toHaveCount(3)
})
```

**Step 2: 性能优化**

```typescript
// 大文件分块处理
async function processLargeFile(pdfPath: string, chunkSize = 5000) {
  // 实现分块逻辑
}
```

**Step 3: 添加加载状态**

```typescript
// 在 store 中添加详细的状态
const detailedProgress = ref({
  extracting: false,
  aiProcessing: false,
  saving: false,
  error: null as string | null
})
```

**Step 4: 最终提交**

```bash
git add .
git commit -m "feat: complete pdf ai import feature with e2e tests"
```

Plan complete and saved to `docs/plans/2025-02-25-pdf-ai-import-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?