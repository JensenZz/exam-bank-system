<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useImportStore } from '../stores/importStore'
import { useQuestionStore } from '../stores/questionStore'
import AiConfig from '../components/AiConfig.vue'
import QuestionList from '../components/QuestionList.vue'
import ProgressIndicator from '../components/ProgressIndicator.vue'
import type { AiServiceConfig } from '../types/ai'
import type { ExamLevel } from '../types'

const importStore = useImportStore()
const questionStore = useQuestionStore()

const showAiConfig = ref(false)
const aiConfig = ref<AiServiceConfig | null>(null)
const error = ref<string | null>(null)
const examYear = ref<number | null>(new Date().getFullYear())
const examLevel = ref<ExamLevel | ''>('')
const qualificationName = ref('')
const examLevels: ExamLevel[] = ['初级', '中级', '高级']

const currentStep = computed<'select' | 'config' | 'processing' | 'preview' | 'complete'>(() => {
  if (importStore.progress.status === 'processing') return 'processing'
  if (importStore.progress.status === 'completed') return 'complete'
  if (importStore.questions.length > 0) return 'preview'
  if (importStore.selectedFiles.length > 0) return 'config'
  return 'select'
})
const extractStatusMessage = ref('')
const extractProgress = ref<{ page?: number; totalPages?: number; stage: 'text' | 'ocr' } | null>(null)

let stopExtractProgressListener: (() => void) | null = null

// 页面加载时自动读取已保存的 AI 配置
onMounted(async () => {
  try {
    const savedConfig = await window.electronAPI.config.load()
    if (savedConfig?.apiKey && savedConfig?.model) {
      aiConfig.value = savedConfig as AiServiceConfig
    }
  } catch (err) {
    console.error('加载 AI 配置失败:', err)
  }

  stopExtractProgressListener = window.electronAPI.file.onExtractPdfTextProgress((payload) => {
    extractStatusMessage.value = payload.message
    extractProgress.value = {
      stage: payload.stage,
      page: payload.page,
      totalPages: payload.totalPages
    }
  })
})

onBeforeUnmount(() => {
  stopExtractProgressListener?.()
  stopExtractProgressListener = null
})

const progress = computed(() => {
  if (importStore.progress.total === 0) return 0
  return Math.round((importStore.progress.current / importStore.progress.total) * 100)
})

const canStartImport = computed(() => {
  const validYear = Number.isFinite(Number(examYear.value)) && Number(examYear.value) >= 1900 && Number(examYear.value) <= 2100
  const validLevel = Boolean(examLevel.value)
  const validQualification = qualificationName.value.trim().length > 0
  return validYear && validLevel && validQualification
})

// 处理文件选择
const handleFileSelect = async () => {
  try {
    const files = await window.electronAPI.file.selectPdf()
    if (files && files.length > 0) {
      const selectedFile = files[0]
      importStore.selectedFiles = [selectedFile]
      importStore.progress.status = 'idle'
      error.value = files.length > 1 ? '一次仅支持导入 1 个 PDF，已自动保留第一个文件。' : null
    }
  } catch (err) {
    error.value = '选择文件失败：' + (err as Error).message
  }
}

// 处理拖拽上传
const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files || [])
    .filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    .map(f => f.path)

  if (files.length > 0) {
    importStore.progress.status = 'idle'
    importStore.selectedFiles = [files[0]]
    error.value = files.length > 1 ? '一次仅支持导入 1 个 PDF，已自动保留第一个文件。' : null
  }
}

// 处理 AI 配置确认
const handleConfigReady = async (config: AiServiceConfig) => {
  aiConfig.value = config
  showAiConfig.value = false
  await startImport()
}

// 开始导入流程
const startImport = async () => {
  if (!aiConfig.value || importStore.selectedFiles.length === 0) return
  if (!canStartImport.value) {
    error.value = '请先填写完整的年份、级别和资格名称'
    return
  }

  importStore.progress.status = 'processing'
  error.value = null
  extractStatusMessage.value = '准备开始处理...'
  extractProgress.value = null

  try {
    importStore.progress.total = importStore.selectedFiles.length
    importStore.progress.current = 0

    for (const file of importStore.selectedFiles) {
      await importStore.startImport(file, aiConfig.value)
      importStore.progress.current++
    }

    extractStatusMessage.value = '处理完成，正在生成预览...'
    importStore.progress.status = 'idle'
  } catch (err) {
    error.value = '导入失败：' + (err as Error).message
    importStore.progress.status = 'idle'
  } finally {
    if (importStore.progress.status !== 'processing') {
      extractProgress.value = null
      importStore.aiChunkProgress = null
    }
  }
}

// 确认导入到题库
const handleConfirmImport = async () => {
  try {
    if (!canStartImport.value || !examLevel.value) {
      error.value = '请先填写完整的年份、级别和资格名称'
      return
    }

    await importStore.confirmImport({
      examYear: Number(examYear.value),
      examLevel: examLevel.value,
      qualificationName: qualificationName.value.trim()
    })
    importStore.progress.status = 'completed'

    // 刷新题库数据
    await questionStore.loadQuestions()
  } catch (err) {
    error.value = '保存失败：' + (err as Error).message
  }
}

// 重新开始
const handleRestart = () => {
  importStore.selectedFiles = []
  aiConfig.value = null
  error.value = null
  examYear.value = new Date().getFullYear()
  examLevel.value = ''
  qualificationName.value = ''
  extractStatusMessage.value = ''
  extractProgress.value = null
  importStore.reset()
  importStore.progress.status = 'idle'
}

// 获取文件名
const getFileName = (path: string) => {
  return path.split('\\').pop()?.split('/').pop() || path
}

// 移除文件
const removeFile = (index: number) => {
  importStore.selectedFiles.splice(index, 1)
}
</script>

<template>
  <div class="import-page">
    <header class="page-header">
      <h1>AI 导入题库</h1>
      <p class="subtitle">使用 AI 智能识别 PDF 中的题目并自动导入</p>
    </header>

    <!-- 步骤指示器 -->
    <div class="step-indicator">
      <div class="step" :class="{ active: currentStep === 'select', completed: currentStep !== 'select' }">
        <div class="step-number">1</div>
        <span>选择文件</span>
      </div>
      <div class="step-line" :class="{ completed: currentStep !== 'select' }"></div>
      <div class="step" :class="{ active: currentStep === 'config', completed: ['processing', 'preview', 'complete'].includes(currentStep) }">
        <div class="step-number">2</div>
        <span>AI 配置</span>
      </div>
      <div class="step-line" :class="{ completed: ['processing', 'preview', 'complete'].includes(currentStep) }"></div>
      <div class="step" :class="{ active: currentStep === 'preview', completed: currentStep === 'complete' }">
        <div class="step-number">3</div>
        <span>预览确认</span>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-alert">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>{{ error }}</span>
      <button class="btn-close" @click="error = null">×</button>
    </div>

    <!-- 步骤 1: 选择文件 -->
    <div v-if="currentStep === 'select'" class="step-content">
      <div
        class="upload-area"
        @drop="handleDrop"
        @dragover.prevent
        @dragenter.prevent
      >
        <div class="upload-icon">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="#c0c4cc">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15.5l2.5-3.01L12.5 14l2.5-3.01L18 16H6l2-2.5z"/>
          </svg>
        </div>
        <h3>拖拽 PDF 文件到此处</h3>
        <p>或</p>
        <button class="btn-primary" @click="handleFileSelect">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
          选择文件
        </button>
        <p class="upload-hint">一次仅支持导入 1 个 PDF 文件</p>
      </div>
    </div>

    <!-- 步骤 2: AI 配置 -->
    <div v-if="currentStep === 'config'" class="step-content">
      <div class="file-list">
        <h3>已选择的文件</h3>
        <div v-for="(file, index) in importStore.selectedFiles" :key="file" class="file-item">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#f56c6c">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
          <span class="file-name">{{ getFileName(file) }}</span>
          <button class="btn-remove" @click="removeFile(index)">×</button>
        </div>
      </div>

      <div class="metadata-form">
        <h3>试题元数据（必填）</h3>
        <div class="metadata-row">
          <div class="metadata-group">
            <label>年份</label>
            <input v-model.number="examYear" type="number" min="1900" max="2100" class="form-input" placeholder="例如：2025" />
          </div>
          <div class="metadata-group">
            <label>级别</label>
            <select v-model="examLevel" class="form-select">
              <option value="">请选择级别</option>
              <option v-for="level in examLevels" :key="level" :value="level">{{ level }}</option>
            </select>
          </div>
        </div>
        <div class="metadata-group">
          <label>资格名称</label>
          <input v-model="qualificationName" type="text" class="form-input" placeholder="请输入资格名称" />
        </div>
      </div>

      <div v-if="aiConfig" class="config-hint">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#67c23a"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        已加载 AI 配置 ({{ aiConfig.provider }} / {{ aiConfig.model }})
        <button class="btn-link" @click="showAiConfig = true">重新配置</button>
      </div>

      <div class="config-actions">
        <button class="btn-secondary" @click="handleRestart">重新选择</button>
        <button v-if="aiConfig" class="btn-primary" :disabled="!canStartImport" @click="startImport">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          开始导入
        </button>
        <button v-else class="btn-primary" @click="showAiConfig = true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          配置 AI 服务
        </button>
      </div>
    </div>

    <!-- 步骤 3: 处理中 -->
    <div v-if="currentStep === 'processing'" class="step-content">
      <div class="processing-state">
        <ProgressIndicator :progress="progress" size="large" />
        <h3>正在处理...</h3>
        <p>{{ importStore.progress.current }} / {{ importStore.progress.total }} 个文件</p>
        <p v-if="importStore.currentFile" class="current-file">
          正在处理: {{ getFileName(importStore.currentFile) }}
        </p>
        <p v-if="extractStatusMessage" class="extract-status">
          {{ extractStatusMessage }}
        </p>
        <p v-if="extractProgress?.stage === 'ocr' && extractProgress?.totalPages" class="extract-substatus">
          OCR 进度：第 {{ extractProgress.page || 0 }} / {{ extractProgress.totalPages }} 页
        </p>
        <p v-if="importStore.aiChunkProgress" class="extract-substatus">
          AI 分片进度：{{ importStore.aiChunkProgress.current }} / {{ importStore.aiChunkProgress.total }}
          <span v-if="importStore.aiChunkProgress.filePath">（{{ getFileName(importStore.aiChunkProgress.filePath) }}）</span>
        </p>
        <p v-if="importStore.aiChunkProgress?.message" class="extract-substatus">
          {{ importStore.aiChunkProgress.message }}
        </p>
      </div>
    </div>

    <!-- 步骤 4: 预览确认 -->
    <div v-if="currentStep === 'preview'" class="step-content">
      <QuestionList
        :questions="importStore.questions"
        :categories="importStore.categories"
        @confirm="handleConfirmImport"
        @cancel="handleRestart"
      />
    </div>

    <!-- 步骤 5: 完成 -->
    <div v-if="currentStep === 'complete'" class="step-content">
      <div class="complete-state">
        <div class="success-icon">
          <svg viewBox="0 0 24 24" width="80" height="80" fill="#67c23a">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
        <h3>导入成功！</h3>
        <p>成功导入 {{ importStore.questions.length }} 道题目</p>
        <div class="complete-actions">
          <button class="btn-secondary" @click="handleRestart">继续导入</button>
          <router-link to="/library" class="btn-primary">
            查看题库
          </router-link>
        </div>
      </div>
    </div>

    <!-- AI 配置弹窗 -->
    <AiConfig v-model="showAiConfig" @config-ready="handleConfigReady" />
  </div>
</template>

<style scoped>
.import-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  text-align: center;
  margin-bottom: 32px;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.subtitle {
  color: #909399;
  font-size: 14px;
}

/* 步骤指示器 */
.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 40px;
  padding: 0 20px;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #e4e7ed;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  transition: all 0.3s;
}

.step.active .step-number {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.step.completed .step-number {
  background: #67c23a;
  color: white;
}

.step span {
  font-size: 14px;
  color: #909399;
}

.step.active span {
  color: #409eff;
  font-weight: 500;
}

.step-line {
  width: 60px;
  height: 2px;
  background: #e4e7ed;
  margin: 0 16px;
  margin-bottom: 20px;
  transition: all 0.3s;
}

.step-line.completed {
  background: #67c23a;
}

/* 错误提示 */
.error-alert {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 8px;
  color: #f56c6c;
  margin-bottom: 20px;
}

.error-alert .btn-close {
  margin-left: auto;
  background: transparent;
  border: none;
  font-size: 20px;
  color: #f56c6c;
  cursor: pointer;
}

/* 上传区域 */
.upload-area {
  border: 2px dashed #dcdfe6;
  border-radius: 12px;
  padding: 60px 40px;
  text-align: center;
  transition: all 0.3s;
  background: #f5f7fa;
}

.upload-area:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.upload-icon {
  margin-bottom: 20px;
}

.upload-area h3 {
  font-size: 18px;
  color: #606266;
  margin-bottom: 16px;
}

.upload-area p {
  color: #909399;
  margin-bottom: 16px;
}

.upload-hint {
  margin-top: 16px !important;
  font-size: 12px !important;
}

/* 文件列表 */
.file-list {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin-bottom: 16px;
}

.file-list h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: #303133;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
  margin-bottom: 8px;
}

.file-name {
  flex: 1;
  font-size: 14px;
  color: #606266;
}

.btn-remove {
  width: 24px;
  height: 24px;
  background: #fde2e2;
  border: none;
  border-radius: 4px;
  color: #f56c6c;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 按钮 */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #e4e7ed;
}

.config-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.metadata-form {
  background: white;
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin-bottom: 16px;
}

.metadata-form h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: #303133;
}

.metadata-row {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.metadata-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.metadata-group label {
  font-size: 14px;
  color: #606266;
}

.form-input,
.form-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
}

.config-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: #f0f9eb;
  border: 1px solid #c2e7b0;
  border-radius: 8px;
  font-size: 13px;
  color: #67c23a;
  margin-bottom: 16px;
}

.btn-link {
  background: none;
  border: none;
  color: #409eff;
  cursor: pointer;
  font-size: 13px;
  padding: 0;
  margin-left: 4px;
  text-decoration: underline;
}

/* 处理中状态 */
.processing-state {
  text-align: center;
  padding: 60px 40px;
}

.processing-state h3 {
  margin: 24px 0 8px;
  font-size: 20px;
  color: #303133;
}

.processing-state p {
  color: #909399;
}

.current-file {
  margin-top: 16px;
  font-size: 14px;
  color: #606266;
}

.extract-status {
  margin-top: 10px;
  font-size: 14px;
  color: #409eff;
}

.extract-substatus {
  margin-top: 6px;
  font-size: 13px;
  color: #909399;
}

/* 完成状态 */
.complete-state {
  text-align: center;
  padding: 60px 40px;
}

.success-icon {
  margin-bottom: 24px;
}

.complete-state h3 {
  font-size: 24px;
  color: #67c23a;
  margin-bottom: 8px;
}

.complete-state p {
  color: #606266;
  margin-bottom: 32px;
}

.complete-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
}
</style>
