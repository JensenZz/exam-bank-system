<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useImportStore } from '../stores/importStore'
import { useQuestionStore } from '../stores/questionStore'
import AiConfig from '../components/AiConfig.vue'
import QuestionList from '../components/QuestionList.vue'
import WebCrawlerTab from '../components/WebCrawlerTab.vue'
import ProgressIndicator from '../components/ProgressIndicator.vue'
import type { AiServiceConfig } from '../types/ai'
import type {
  ExamLevel,
  ImportChunkStatus,
  ImportSession,
  ImportSessionChunk,
  ImportSessionDetails,
  ImportSessionStatus
} from '../types'

const router = useRouter()
const importStore = useImportStore()
const questionStore = useQuestionStore()

const showAiConfig = ref(false)
const aiConfig = ref<AiServiceConfig | null>(null)
const error = ref<string | null>(null)
const examYear = ref<number | null>(new Date().getFullYear())
const examLevel = ref<ExamLevel | ''>('')
const qualificationName = ref('')
const examLevels: ExamLevel[] = ['初级', '中级', '高级']
const pendingResumeSessionId = ref<number | null>(null)
const pendingRetrySessionId = ref<number | null>(null)
const activeTab = ref<'pdf' | 'web'>('pdf')

type HistoryFilter = 'all' | 'incomplete' | 'failed' | 'completed'
const historyFilter = ref<HistoryFilter>('all')

const showChunkDrawer = ref(false)
const chunkDetailsLoading = ref(false)
const chunkDetailsError = ref<string | null>(null)
const selectedSessionDetails = ref<ImportSessionDetails | null>(null)

const metadataSnapshot = computed(() => ({
  examYear: Number(examYear.value),
  examLevel: examLevel.value,
  qualificationName: qualificationName.value.trim()
}))

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

const progress = computed(() => {
  if (importStore.progress.total === 0) return 0
  return Math.round((importStore.progress.current / importStore.progress.total) * 100)
})

const canStartImport = computed(() => {
  const validYear = Number.isFinite(metadataSnapshot.value.examYear) && metadataSnapshot.value.examYear >= 1900 && metadataSnapshot.value.examYear <= 2100
  const validLevel = Boolean(metadataSnapshot.value.examLevel)
  const validQualification = metadataSnapshot.value.qualificationName.length > 0
  return validYear && validLevel && validQualification
})

const sessionStatusTextMap: Record<ImportSessionStatus, string> = {
  created: '已创建',
  ocr_processing: 'OCR处理中',
  ocr_completed: 'OCR完成',
  ai_processing: 'AI处理中',
  preview_ready: '待确认入库',
  importing: '入库中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消'
}

const chunkStatusTextMap: Record<ImportChunkStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  success: '成功',
  failed: '失败'
}

const resumeConfigRequiredStatus: ImportSessionStatus[] = ['ocr_completed', 'ai_processing', 'failed']

const historyCounts = computed(() => {
  const sessions = importStore.historySessions
  return {
    all: sessions.length,
    incomplete: sessions.filter((session) => session.status !== 'completed' && session.status !== 'canceled').length,
    failed: sessions.filter((session) => session.status === 'failed').length,
    completed: sessions.filter((session) => session.status === 'completed').length
  }
})

const filteredHistorySessions = computed(() => {
  const sessions = importStore.historySessions
  if (historyFilter.value === 'incomplete') {
    return sessions.filter((session) => session.status !== 'completed' && session.status !== 'canceled')
  }
  if (historyFilter.value === 'failed') {
    return sessions.filter((session) => session.status === 'failed')
  }
  if (historyFilter.value === 'completed') {
    return sessions.filter((session) => session.status === 'completed')
  }
  return sessions
})

const selectedSessionChunks = computed(() => {
  if (!selectedSessionDetails.value) return []
  return [...selectedSessionDetails.value.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
})

const selectedChunkSummary = computed(() => {
  return selectedSessionChunks.value.reduce(
    (acc, chunk) => {
      acc.total += 1
      if (chunk.status === 'success') acc.success += 1
      if (chunk.status === 'failed') acc.failed += 1
      if (chunk.status === 'processing') acc.processing += 1
      if (chunk.status === 'pending') acc.pending += 1
      return acc
    },
    { total: 0, success: 0, failed: 0, processing: 0, pending: 0 }
  )
})

watch(
  metadataSnapshot,
  (value) => {
    if (!canStartImport.value || !value.examLevel) {
      importStore.metadata = null
      return
    }

    importStore.metadata = {
      examYear: value.examYear,
      examLevel: value.examLevel,
      qualificationName: value.qualificationName
    }

    if (error.value === '请先填写完整的年份、级别和资格名称') {
      error.value = null
    }
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    const savedConfig = await window.electronAPI.config.load()
    if (savedConfig?.apiKey && savedConfig?.model) {
      aiConfig.value = savedConfig as AiServiceConfig
    }
  } catch (err) {
    console.error('加载 AI 配置失败:', err)
  }

  await importStore.loadImportHistory({ limit: 30 })

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

const applySessionMetadata = (session: ImportSession) => {
  if (Number.isFinite(Number(session.examYear))) {
    examYear.value = Number(session.examYear)
  }
  examLevel.value = session.examLevel || ''
  qualificationName.value = session.qualificationName || ''

  if (
    Number.isFinite(Number(session.examYear)) &&
    session.examLevel &&
    session.qualificationName
  ) {
    importStore.metadata = {
      examYear: Number(session.examYear),
      examLevel: session.examLevel,
      qualificationName: session.qualificationName
    }
  } else {
    importStore.metadata = null
  }
}

const refreshHistory = async () => {
  await importStore.loadImportHistory({ limit: 30 })

  if (showChunkDrawer.value && selectedSessionDetails.value?.session.id) {
    await openChunkDrawer(selectedSessionDetails.value.session.id)
  }
}

const handleFileSelect = async () => {
  try {
    const files = await window.electronAPI.file.selectPdf()
    if (files && files.length > 0) {
      const selectedFile = files[0]
      importStore.selectedFiles = [selectedFile]
      importStore.progress.status = 'idle'
      importStore.progress.current = 0
      importStore.progress.total = 0
      error.value = files.length > 1 ? '一次仅支持导入 1 个 PDF，已自动保留第一个文件。' : null
    }
  } catch (err) {
    error.value = '选择文件失败：' + (err as Error).message
  }
}

const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files || [])
    .filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    .map((f) => f.path)

  if (files.length > 0) {
    importStore.progress.status = 'idle'
    importStore.progress.current = 0
    importStore.progress.total = 0
    importStore.selectedFiles = [files[0]]
    error.value = files.length > 1 ? '一次仅支持导入 1 个 PDF，已自动保留第一个文件。' : null
  }
}

const startImport = async () => {
  if (!aiConfig.value || importStore.selectedFiles.length === 0) return
  if (!canStartImport.value || !metadataSnapshot.value.examLevel) {
    error.value = '请先填写完整的年份、级别和资格名称'
    return
  }

  importStore.metadata = {
    examYear: metadataSnapshot.value.examYear,
    examLevel: metadataSnapshot.value.examLevel,
    qualificationName: metadataSnapshot.value.qualificationName
  }

  importStore.progress.status = 'processing'
  importStore.progress.total = importStore.selectedFiles.length
  importStore.progress.current = 0
  error.value = null
  extractStatusMessage.value = '准备开始处理...'
  extractProgress.value = null

  try {
    for (const file of importStore.selectedFiles) {
      await importStore.startImport(file, aiConfig.value)
      importStore.progress.current += 1
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

const runResume = async (sessionId: number) => {
  importStore.progress.status = 'processing'
  importStore.progress.total = 1
  importStore.progress.current = 0
  error.value = null
  extractStatusMessage.value = '正在恢复导入会话...'
  extractProgress.value = null

  try {
    await importStore.resumeImport(sessionId, aiConfig.value || undefined)
    importStore.progress.current = 1

    const latest = importStore.historySessions.find((item) => item.id === sessionId)
    if (latest?.status === 'completed') {
      importStore.progress.status = 'completed'
    } else {
      importStore.progress.status = 'idle'
    }

    if (importStore.metadata) {
      examYear.value = importStore.metadata.examYear
      examLevel.value = importStore.metadata.examLevel
      qualificationName.value = importStore.metadata.qualificationName
    }
  } catch (err) {
    error.value = '继续导入失败：' + (err as Error).message
    importStore.progress.status = 'idle'
  } finally {
    if (importStore.progress.status !== 'processing') {
      extractProgress.value = null
      importStore.aiChunkProgress = null
    }
  }
}

const handleResumeSession = async (session: ImportSession) => {
  if (session.status === 'completed') {
    await goLibrary()
    return
  }

  applySessionMetadata(session)
  importStore.selectedFiles = session.filePath ? [session.filePath] : []
  importStore.currentFile = session.filePath
  importStore.activeSessionId = session.id

  if (!aiConfig.value && resumeConfigRequiredStatus.includes(session.status)) {
    pendingResumeSessionId.value = session.id
    showAiConfig.value = true
    return
  }

  await runResume(session.id)
}

const handleConfigReady = async (config: AiServiceConfig) => {
  aiConfig.value = config
  showAiConfig.value = false

  if (pendingResumeSessionId.value) {
    const sessionId = pendingResumeSessionId.value
    pendingResumeSessionId.value = null
    await runResume(sessionId)
    return
  }

  if (pendingRetrySessionId.value) {
    const sessionId = pendingRetrySessionId.value
    pendingRetrySessionId.value = null
    await runRetryFailedChunks(sessionId)
    return
  }

  if (importStore.selectedFiles.length > 0) {
    await startImport()
  }
}

const handleConfirmImport = async () => {
  try {
    const currentMetadata = importStore.metadata
    if (!currentMetadata || !currentMetadata.examLevel) {
      error.value = '请先填写完整的年份、级别和资格名称'
      return
    }

    await importStore.confirmImport(currentMetadata)
    importStore.progress.status = 'completed'
    importStore.metadata = null

    await questionStore.loadQuestions()
  } catch (err) {
    error.value = '保存失败：' + (err as Error).message
  }
}

const handleRestart = () => {
  importStore.selectedFiles = []
  error.value = null
  examYear.value = new Date().getFullYear()
  examLevel.value = ''
  qualificationName.value = ''
  extractStatusMessage.value = ''
  extractProgress.value = null
  importStore.reset()
  importStore.metadata = null
  importStore.progress.status = 'idle'
  pendingResumeSessionId.value = null
  pendingRetrySessionId.value = null
  closeChunkDrawer()
}

const removeFile = (index: number) => {
  importStore.selectedFiles = importStore.selectedFiles.filter((_, i) => i !== index)
}

const getFileName = (targetPath: string, fallback?: string) => {
  if (fallback) return fallback
  if (!targetPath) return '-'
  return targetPath.split('\\').pop()?.split('/').pop() || targetPath
}

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString()
}

const getStatusText = (status: ImportSessionStatus) => {
  return sessionStatusTextMap[status] || status
}

const getStatusClass = (status: ImportSessionStatus) => {
  if (status === 'completed') return 'status-completed'
  if (status === 'failed') return 'status-failed'
  if (status === 'preview_ready') return 'status-preview'
  if (status === 'ai_processing' || status === 'ocr_processing' || status === 'importing') return 'status-processing'
  return 'status-default'
}

const getSessionProgressText = (session: ImportSession) => {
  if (session.chunkTotal <= 0) return '分片：-'
  return `分片：${session.chunkSuccess}/${session.chunkTotal} 成功，${session.chunkFailed} 失败`
}

const getChunkStatusText = (status: ImportChunkStatus) => {
  return chunkStatusTextMap[status] || status
}

const getChunkStatusClass = (status: ImportChunkStatus) => {
  if (status === 'success') return 'status-completed'
  if (status === 'failed') return 'status-failed'
  if (status === 'processing') return 'status-processing'
  return 'status-default'
}

const parseJsonArrayLength = (value?: string) => {
  if (!value) return 0
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

const getChunkQuestionCount = (chunk: ImportSessionChunk) => {
  return parseJsonArrayLength(chunk.questionsJson)
}

const getChunkCategoryCount = (chunk: ImportSessionChunk) => {
  return parseJsonArrayLength(chunk.categoriesJson)
}

const getChunkTextPreview = (text: string) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '-'
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 140)}...`
}

const closeChunkDrawer = () => {
  showChunkDrawer.value = false
  chunkDetailsLoading.value = false
  chunkDetailsError.value = null
  selectedSessionDetails.value = null
}

const openChunkDrawer = async (sessionId: number) => {
  showChunkDrawer.value = true
  chunkDetailsLoading.value = true
  chunkDetailsError.value = null

  try {
    const details = await importStore.getImportSessionDetails(sessionId)
    selectedSessionDetails.value = details
  } catch (err) {
    chunkDetailsError.value = '加载分片详情失败：' + (err as Error).message
    selectedSessionDetails.value = null
  } finally {
    chunkDetailsLoading.value = false
  }
}

const handleViewChunkDetails = async (session: ImportSession) => {
  await openChunkDrawer(session.id)
}

const runRetryFailedChunks = async (sessionId: number) => {
  importStore.progress.status = 'processing'
  importStore.progress.total = 1
  importStore.progress.current = 0
  error.value = null
  extractStatusMessage.value = '正在重试失败分片...'
  extractProgress.value = null

  try {
    await importStore.retryFailedChunks(sessionId, aiConfig.value || undefined)
    importStore.progress.current = 1
    importStore.progress.status = 'idle'

    if (importStore.metadata) {
      examYear.value = importStore.metadata.examYear
      examLevel.value = importStore.metadata.examLevel
      qualificationName.value = importStore.metadata.qualificationName
    }

    if (showChunkDrawer.value && selectedSessionDetails.value?.session.id === sessionId) {
      await openChunkDrawer(sessionId)
    }
  } catch (err) {
    error.value = '重试失败分片失败：' + (err as Error).message
    importStore.progress.status = 'idle'
  } finally {
    if (importStore.progress.status !== 'processing') {
      extractProgress.value = null
      importStore.aiChunkProgress = null
    }
  }
}

const handleRetryFailedChunks = async (session: ImportSession) => {
  if (session.chunkFailed <= 0) {
    error.value = '当前会话没有失败分片可重试'
    return
  }

  applySessionMetadata(session)
  importStore.selectedFiles = session.filePath ? [session.filePath] : []
  importStore.currentFile = session.filePath
  importStore.activeSessionId = session.id

  if (!aiConfig.value) {
    pendingRetrySessionId.value = session.id
    showAiConfig.value = true
    return
  }

  await runRetryFailedChunks(session.id)
}

const goLibrary = async () => {
  await router.push('/library')
}
</script>

<template>
  <div class="import-page">
    <header class="page-header">
      <h1>AI 导入题库</h1>
      <p class="subtitle">使用 AI 智能识别 PDF 中的题目并自动导入</p>
    </header>

    <div class="import-tabs">
      <button class="tab-chip" :class="{ active: activeTab === 'pdf' }" @click="activeTab = 'pdf'">PDF 导入</button>
      <button class="tab-chip" :class="{ active: activeTab === 'web' }" @click="activeTab = 'web'">互联网抓题</button>
    </div>

    <WebCrawlerTab v-if="activeTab === 'web'" :ai-config="aiConfig" />

    <template v-if="activeTab === 'pdf'">
    <section class="history-panel">
      <div class="history-header">
        <h2>导入历史</h2>
        <button class="btn-link" @click="refreshHistory">刷新</button>
      </div>

      <div class="history-filter" v-if="!importStore.historyLoading && importStore.historySessions.length > 0">
        <button
          class="filter-chip"
          :class="{ active: historyFilter === 'all' }"
          @click="historyFilter = 'all'"
        >
          全部 ({{ historyCounts.all }})
        </button>
        <button
          class="filter-chip"
          :class="{ active: historyFilter === 'incomplete' }"
          @click="historyFilter = 'incomplete'"
        >
          未完成 ({{ historyCounts.incomplete }})
        </button>
        <button
          class="filter-chip"
          :class="{ active: historyFilter === 'failed' }"
          @click="historyFilter = 'failed'"
        >
          失败 ({{ historyCounts.failed }})
        </button>
        <button
          class="filter-chip"
          :class="{ active: historyFilter === 'completed' }"
          @click="historyFilter = 'completed'"
        >
          已完成 ({{ historyCounts.completed }})
        </button>
      </div>

      <div v-if="importStore.historyLoading" class="history-state">加载历史中...</div>
      <div v-else-if="filteredHistorySessions.length === 0" class="history-state">当前筛选下暂无导入记录</div>
      <div v-else class="history-list">
        <article v-for="session in filteredHistorySessions" :key="session.id" class="history-card">
          <div class="history-main">
            <div class="history-title-row">
              <strong class="history-file">{{ getFileName(session.filePath, session.fileName) }}</strong>
              <span class="status-badge" :class="getStatusClass(session.status)">{{ getStatusText(session.status) }}</span>
            </div>

            <div class="history-meta">
              <span>时间：{{ formatDateTime(session.createdAt) }}</span>
              <span>范围：{{ session.examYear || '-' }} / {{ session.examLevel || '-' }} / {{ session.qualificationName || '-' }}</span>
              <span>{{ getSessionProgressText(session) }}</span>
            </div>

            <div v-if="session.lastError" class="history-error">
              最近错误：{{ session.lastError }}
            </div>
          </div>

          <div class="history-actions">
            <button class="btn-secondary" @click="handleViewChunkDetails(session)">查看分片详情</button>
            <button
              v-if="session.chunkFailed > 0 && session.status !== 'completed'"
              class="btn-secondary"
              @click="handleRetryFailedChunks(session)"
            >
              重试失败分片
            </button>
            <button
              v-if="session.status !== 'completed'"
              class="btn-secondary"
              @click="handleResumeSession(session)"
            >
              继续导入
            </button>
            <button v-else class="btn-secondary" @click="goLibrary">查看题库</button>
          </div>
        </article>
      </div>
    </section>

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

    <div v-if="error" class="error-alert">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>{{ error }}</span>
      <button class="btn-close" @click="error = null">×</button>
    </div>

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

    <div v-if="currentStep === 'preview'" class="step-content">
      <div class="metadata-preview" :class="{ invalid: !importStore.metadata }">
        <h3>当前导入元数据</h3>
        <template v-if="importStore.metadata">
          <div class="metadata-tags">
            <span class="meta-tag">年份：{{ importStore.metadata.examYear }}</span>
            <span class="meta-tag">级别：{{ importStore.metadata.examLevel }}</span>
            <span class="meta-tag">资格：{{ importStore.metadata.qualificationName }}</span>
          </div>
        </template>
        <template v-else>
          <p class="metadata-warning">未检测到完整元数据，请返回上一步补全后再确认导入。</p>
        </template>
      </div>

      <QuestionList
        :questions="importStore.questions"
        :categories="importStore.categories"
        @confirm="handleConfirmImport"
        @cancel="handleRestart"
      />
    </div>

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

    </template>

    <AiConfig v-model="showAiConfig" @config-ready="handleConfigReady" />

    <div v-if="showChunkDrawer" class="chunk-drawer-mask" @click.self="closeChunkDrawer">
      <aside class="chunk-drawer">
        <div class="chunk-drawer-header">
          <h3>分片详情</h3>
          <button class="btn-close" @click="closeChunkDrawer">×</button>
        </div>

        <div v-if="chunkDetailsLoading" class="chunk-state">加载分片详情中...</div>
        <div v-else-if="chunkDetailsError" class="chunk-state chunk-state-error">{{ chunkDetailsError }}</div>
        <template v-else-if="selectedSessionDetails">
          <div class="chunk-session-meta">
            <div>
              <strong>文件：</strong>{{ getFileName(selectedSessionDetails.session.filePath, selectedSessionDetails.session.fileName) }}
            </div>
            <div>
              <strong>状态：</strong>
              <span class="status-badge" :class="getStatusClass(selectedSessionDetails.session.status)">
                {{ getStatusText(selectedSessionDetails.session.status) }}
              </span>
            </div>
            <div>
              <strong>统计：</strong>
              总 {{ selectedChunkSummary.total }} / 成功 {{ selectedChunkSummary.success }} / 失败 {{ selectedChunkSummary.failed }} /
              处理中 {{ selectedChunkSummary.processing }} / 待处理 {{ selectedChunkSummary.pending }}
            </div>
          </div>

          <div v-if="selectedSessionChunks.length === 0" class="chunk-state">当前会话没有分片记录</div>
          <div v-else class="chunk-list">
            <article v-for="chunk in selectedSessionChunks" :key="chunk.id" class="chunk-card">
              <div class="chunk-title-row">
                <strong>分片 #{{ chunk.chunkIndex }}</strong>
                <span class="status-badge" :class="getChunkStatusClass(chunk.status)">
                  {{ getChunkStatusText(chunk.status) }}
                </span>
              </div>

              <div class="chunk-meta">
                <span>尝试次数：{{ chunk.attemptCount }}</span>
                <span>题目数：{{ getChunkQuestionCount(chunk) }}</span>
                <span>分类数：{{ getChunkCategoryCount(chunk) }}</span>
                <span>更新时间：{{ formatDateTime(chunk.updatedAt || chunk.createdAt) }}</span>
              </div>

              <p class="chunk-preview">{{ getChunkTextPreview(chunk.chunkText) }}</p>

              <div v-if="chunk.errorMessage" class="chunk-error">
                错误：{{ chunk.errorMessage }}
              </div>
            </article>
          </div>
        </template>
      </aside>
    </div>
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
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.import-tabs { display: flex; gap: 10px; margin-bottom: 20px; }

.tab-chip { padding: 8px 14px; border-radius: 999px; border: 1px solid #dcdfe6; background: #fff; color: #606266; cursor: pointer; }

.tab-chip.active { color: #409eff; border-color: #b3d8ff; background: #ecf5ff; }

.subtitle {
  color: #909399;
  font-size: 14px;
}

.history-panel {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin-bottom: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.history-header h2 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.history-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.filter-chip {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  font-size: 12px;
  cursor: pointer;
}

.filter-chip.active {
  color: #409eff;
  border-color: #b3d8ff;
  background: #ecf5ff;
}

.history-state {
  padding: 8px 0;
  color: #909399;
  font-size: 13px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow: auto;
}

.history-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.history-main {
  flex: 1;
  min-width: 0;
}

.history-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.history-file {
  color: #303133;
  font-size: 14px;
  word-break: break-all;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.status-default {
  color: #909399;
  background: #f4f4f5;
  border-color: #e9e9eb;
}

.status-processing {
  color: #409eff;
  background: #ecf5ff;
  border-color: #d9ecff;
}

.status-preview {
  color: #e6a23c;
  background: #fdf6ec;
  border-color: #faecd8;
}

.status-completed {
  color: #67c23a;
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.status-failed {
  color: #f56c6c;
  background: #fef0f0;
  border-color: #fde2e2;
}

.history-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #909399;
}

.history-error {
  margin-top: 8px;
  font-size: 12px;
  color: #f56c6c;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 6px;
  padding: 6px 8px;
}

.history-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

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
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 13px;
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

.metadata-preview {
  background: #f0f9ff;
  border: 1px solid #d9ecff;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.metadata-preview.invalid {
  background: #fef0f0;
  border-color: #fde2e2;
}

.metadata-preview h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: #303133;
}

.metadata-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  color: #409eff;
  background: #ecf5ff;
}

.metadata-warning {
  margin: 0;
  font-size: 13px;
  color: #f56c6c;
}

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

.chunk-drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 1000;
}

.chunk-drawer {
  width: min(720px, 96vw);
  height: 100%;
  background: #fff;
  box-shadow: -6px 0 20px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
}

.chunk-drawer-header {
  padding: 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chunk-drawer-header h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.chunk-state {
  padding: 16px;
  font-size: 13px;
  color: #909399;
}

.chunk-state-error {
  color: #f56c6c;
}

.chunk-session-meta {
  padding: 12px 16px;
  border-bottom: 1px solid #f2f6fc;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.chunk-list {
  padding: 12px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.chunk-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
}

.chunk-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.chunk-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.chunk-preview {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #606266;
  background: #f5f7fa;
  border-radius: 6px;
  padding: 8px;
}

.chunk-error {
  margin-top: 8px;
  font-size: 12px;
  color: #f56c6c;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 6px;
  padding: 6px 8px;
}
</style>


