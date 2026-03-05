import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AiServiceConfig, ExtractedQuestion, ExtractedCategory } from '../types/ai'
import type {
  Category,
  ExamLevel,
  ImportChunkInput,
  ImportChunkStatus,
  ImportResumeContext,
  ImportSession,
  ImportSessionChunk,
  ImportSessionDetails,
  ImportSessionFilters,
  ImportSessionStatus,
  SaveImportChunkResultInput
} from '../types'
import { useQuestionStore } from './questionStore'

export interface ImportProgress {
  current: number
  total: number
  status: 'idle' | 'processing' | 'completed' | 'error'
}

export interface AiChunkProgress {
  current: number
  total: number
  filePath: string
  message: string
}

export interface ImportMetadata {
  examYear: number
  examLevel: '初级' | '中级' | '高级'
  qualificationName: string
}

type ChunkPreviewResult = {
  questions: ExtractedQuestion[]
  categories: ExtractedCategory[]
}

const MAX_CHARS_PER_AI_REQUEST = 6000
const MIN_CHARS_PER_AI_REQUEST = 1200
const MAX_TIMEOUT_SPLIT_DEPTH = 3

const IMPORT_SESSION_STATUSES: ImportSessionStatus[] = [
  'created',
  'ocr_processing',
  'ocr_completed',
  'ai_processing',
  'preview_ready',
  'importing',
  'completed',
  'failed',
  'canceled'
]

const IMPORT_CHUNK_STATUSES: ImportChunkStatus[] = ['pending', 'processing', 'success', 'failed']

const QUESTION_TYPES = ['single', 'multiple', 'fill', 'essay'] as const

function splitTextForAi(text: string): string[] {
  const normalized = text?.trim() || ''
  if (!normalized) return []
  if (normalized.length <= MAX_CHARS_PER_AI_REQUEST) return [normalized]

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    let end = Math.min(start + MAX_CHARS_PER_AI_REQUEST, normalized.length)

    if (end < normalized.length) {
      const softLimit = start + Math.floor(MAX_CHARS_PER_AI_REQUEST * 0.6)
      const lineBreakPos = normalized.lastIndexOf('\n', end)
      if (lineBreakPos > softLimit) {
        end = lineBreakPos
      }
    }

    const chunk = normalized.slice(start, end).trim()
    if (chunk) chunks.push(chunk)

    start = end
    while (start < normalized.length && /\s/.test(normalized[start])) {
      start += 1
    }
  }

  return chunks
}

function splitChunkInHalf(chunk: string): [string, string] {
  const mid = Math.floor(chunk.length / 2)
  const softMin = Math.floor(chunk.length * 0.3)
  const softMax = Math.floor(chunk.length * 0.7)

  const before = chunk.lastIndexOf('\n', mid)
  const after = chunk.indexOf('\n', mid)

  let cut = mid
  if (before >= softMin) {
    cut = before
  } else if (after > 0 && after <= softMax) {
    cut = after
  }

  const left = chunk.slice(0, cut).trim()
  const right = chunk.slice(cut).trim()

  if (!left || !right) {
    const forcedCut = Math.max(1, Math.floor(chunk.length / 2))
    return [chunk.slice(0, forcedCut).trim(), chunk.slice(forcedCut).trim()]
  }

  return [left, right]
}

function isTimeoutError(error: unknown): boolean {
  const msg = (error as Error)?.message || ''
  return msg.includes('请求超时') || msg.includes('timeout') || msg.includes('ECONNABORTED')
}

function normalizeImportSessionStatus(value: unknown): ImportSessionStatus {
  const safeValue = String(value || '').trim() as ImportSessionStatus
  return IMPORT_SESSION_STATUSES.includes(safeValue) ? safeValue : 'created'
}

function normalizeImportChunkStatus(value: unknown): ImportChunkStatus {
  const safeValue = String(value || '').trim() as ImportChunkStatus
  return IMPORT_CHUNK_STATUSES.includes(safeValue) ? safeValue : 'pending'
}

function normalizeExamLevel(value: unknown): ExamLevel | undefined {
  const safeValue = String(value || '').trim()
  if (safeValue === '初级' || safeValue === '中级' || safeValue === '高级') {
    return safeValue
  }
  return undefined
}

type CategoryCandidate = Pick<Category, 'id' | 'name'>

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[]
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function normalizeQuestionType(value: unknown): ExtractedQuestion['type'] {
  const safeType = String(value || '').trim()
  if (QUESTION_TYPES.includes(safeType as (typeof QUESTION_TYPES)[number])) {
    return safeType as ExtractedQuestion['type']
  }
  return 'single'
}

function normalizeExtractedQuestion(raw: unknown): ExtractedQuestion {
  const source = (raw ?? {}) as Record<string, unknown>
  const safeExamYear = Number(source.examYear ?? source.exam_year)
  const safeDifficulty = Number(source.difficulty)

  return {
    title: String(source.title || ''),
    content: source.content ? String(source.content) : undefined,
    type: normalizeQuestionType(source.type),
    options: Array.isArray(source.options) ? source.options.map((item) => String(item)) : [],
    answer: String(source.answer || ''),
    analysis: source.analysis ? String(source.analysis) : undefined,
    categoryName: source.categoryName ? String(source.categoryName) : source.category_name ? String(source.category_name) : undefined,
    difficulty: Number.isFinite(safeDifficulty) ? safeDifficulty : undefined,
    source: source.source ? String(source.source) : undefined,
    examYear: Number.isFinite(safeExamYear) ? safeExamYear : undefined,
    examLevel: normalizeExamLevel(source.examLevel ?? source.exam_level),
    qualificationName: source.qualificationName ? String(source.qualificationName) : source.qualification_name ? String(source.qualification_name) : undefined
  }
}

function normalizeExtractedCategory(raw: unknown): ExtractedCategory | null {
  const source = (raw ?? {}) as Record<string, unknown>
  const name = String(source.name || '').trim()
  if (!name) {
    return null
  }

  const parentId = Number(source.parentId ?? source.parent_id)

  return {
    name,
    parentId: Number.isFinite(parentId) ? parentId : undefined,
    parentName: source.parentName ? String(source.parentName) : source.parent_name ? String(source.parent_name) : undefined
  }
}

function dedupeCategories(list: ExtractedCategory[]): ExtractedCategory[] {
  const categoryMap = new Map<string, ExtractedCategory>()
  for (const item of list) {
    const key = String(item.name || '').trim()
    if (!key) continue
    if (!categoryMap.has(key)) {
      categoryMap.set(key, item)
    }
  }
  return [...categoryMap.values()]
}

function normalizeChunkPreviewResult(raw: unknown): ChunkPreviewResult {
  const source = (raw ?? {}) as Record<string, unknown>
  const questions = parseJsonArray<unknown>(source.questions)
    .map((item) => normalizeExtractedQuestion(item))
    .filter((item) => item.title || item.content)

  const categories = dedupeCategories(
    parseJsonArray<unknown>(source.categories)
      .map((item) => normalizeExtractedCategory(item))
      .filter((item): item is ExtractedCategory => Boolean(item))
  )

  return {
    questions,
    categories
  }
}

function mergeChunkPreviewResult(base: ChunkPreviewResult, incoming: ChunkPreviewResult): ChunkPreviewResult {
  return {
    questions: [...base.questions, ...incoming.questions],
    categories: dedupeCategories([...base.categories, ...incoming.categories])
  }
}

function normalizeImportSession(raw: unknown): ImportSession {
  const source = (raw ?? {}) as Record<string, unknown>

  const safeId = Number(source.id)
  const safeExamYear = Number(source.examYear ?? source.exam_year)
  const safeOcrTextLength = Number(source.ocrTextLength ?? source.ocr_text_length)
  const safeOcrTotalPages = Number(source.ocrTotalPages ?? source.ocr_total_pages)
  const safeChunkTotal = Number(source.chunkTotal ?? source.chunk_total)
  const safeChunkSuccess = Number(source.chunkSuccess ?? source.chunk_success)
  const safeChunkFailed = Number(source.chunkFailed ?? source.chunk_failed)
  const safePreviewQuestionCount = Number(source.previewQuestionCount ?? source.preview_question_count)
  const safeImportedQuestionCount = Number(source.importedQuestionCount ?? source.imported_question_count)

  return {
    id: Number.isFinite(safeId) ? safeId : 0,
    filePath: String(source.filePath ?? source.file_path ?? ''),
    fileName: String(source.fileName ?? source.file_name ?? ''),
    examYear: Number.isFinite(safeExamYear) ? safeExamYear : undefined,
    examLevel: normalizeExamLevel(source.examLevel ?? source.exam_level),
    qualificationName: source.qualificationName ? String(source.qualificationName) : source.qualification_name ? String(source.qualification_name) : undefined,
    status: normalizeImportSessionStatus(source.status),
    ocrText: source.ocrText ? String(source.ocrText) : source.ocr_text ? String(source.ocr_text) : undefined,
    ocrTextLength: Number.isFinite(safeOcrTextLength) ? safeOcrTextLength : 0,
    ocrTotalPages: Number.isFinite(safeOcrTotalPages) ? safeOcrTotalPages : 0,
    chunkTotal: Number.isFinite(safeChunkTotal) ? safeChunkTotal : 0,
    chunkSuccess: Number.isFinite(safeChunkSuccess) ? safeChunkSuccess : 0,
    chunkFailed: Number.isFinite(safeChunkFailed) ? safeChunkFailed : 0,
    previewQuestionCount: Number.isFinite(safePreviewQuestionCount) ? safePreviewQuestionCount : 0,
    importedQuestionCount: Number.isFinite(safeImportedQuestionCount) ? safeImportedQuestionCount : 0,
    lastError: source.lastError ? String(source.lastError) : source.last_error ? String(source.last_error) : undefined,
    createdAt: source.createdAt ? String(source.createdAt) : source.created_at ? String(source.created_at) : undefined,
    updatedAt: source.updatedAt ? String(source.updatedAt) : source.updated_at ? String(source.updated_at) : undefined,
    completedAt: source.completedAt ? String(source.completedAt) : source.completed_at ? String(source.completed_at) : undefined
  }
}

function normalizeImportSessionChunk(raw: unknown): ImportSessionChunk {
  const source = (raw ?? {}) as Record<string, unknown>

  const safeId = Number(source.id)
  const safeSessionId = Number(source.sessionId ?? source.session_id)
  const safeChunkIndex = Number(source.chunkIndex ?? source.chunk_index)
  const safeAttemptCount = Number(source.attemptCount ?? source.attempt_count)

  return {
    id: Number.isFinite(safeId) ? safeId : 0,
    sessionId: Number.isFinite(safeSessionId) ? safeSessionId : 0,
    chunkIndex: Number.isFinite(safeChunkIndex) ? safeChunkIndex : 0,
    chunkText: String(source.chunkText ?? source.chunk_text ?? ''),
    status: normalizeImportChunkStatus(source.status),
    attemptCount: Number.isFinite(safeAttemptCount) ? safeAttemptCount : 0,
    questionsJson: source.questionsJson ? String(source.questionsJson) : source.questions_json ? String(source.questions_json) : undefined,
    categoriesJson: source.categoriesJson ? String(source.categoriesJson) : source.categories_json ? String(source.categories_json) : undefined,
    errorMessage: source.errorMessage ? String(source.errorMessage) : source.error_message ? String(source.error_message) : undefined,
    createdAt: source.createdAt ? String(source.createdAt) : source.created_at ? String(source.created_at) : undefined,
    updatedAt: source.updatedAt ? String(source.updatedAt) : source.updated_at ? String(source.updated_at) : undefined,
    completedAt: source.completedAt ? String(source.completedAt) : source.completed_at ? String(source.completed_at) : undefined
  }
}

function normalizeImportResumeContext(raw: unknown): ImportResumeContext {
  const source = (raw ?? {}) as Record<string, unknown>

  const chunks = parseJsonArray<unknown>(source.chunks).map((item) => normalizeImportSessionChunk(item))
  const resumableChunks = parseJsonArray<unknown>(source.resumableChunks)
    .map((item) => normalizeImportSessionChunk(item))
    .filter((item) => item.chunkIndex > 0)

  const aggregatedPreview = normalizeChunkPreviewResult(source.aggregatedPreview)

  return {
    session: normalizeImportSession(source.session),
    chunks,
    resumableChunks,
    aggregatedPreview
  }
}

export const useImportStore = defineStore('import', () => {
  const questions = ref<ExtractedQuestion[]>([])
  const categories = ref<ExtractedCategory[]>([])
  const progress = ref<ImportProgress>({
    current: 0,
    total: 0,
    status: 'idle'
  })
  const currentFile = ref<string>('')
  const selectedFiles = ref<string[]>([])
  const aiChunkProgress = ref<AiChunkProgress | null>(null)
  const metadata = ref<ImportMetadata | null>(null)
  const error = ref<string | null>(null)
  const activeSessionId = ref<number | null>(null)
  const historySessions = ref<ImportSession[]>([])
  const historyLoading = ref(false)

  const isProcessing = computed(() => progress.value.status === 'processing')
  const hasQuestions = computed(() => questions.value.length > 0)

  function setPreviewData(data: ChunkPreviewResult): void {
    questions.value = [...data.questions]
    categories.value = [...dedupeCategories(data.categories)]
  }

  function appendPreviewData(data: ChunkPreviewResult): void {
    questions.value = [...questions.value, ...data.questions]
    categories.value = dedupeCategories([...categories.value, ...data.categories])
  }

  async function processChunkWithSplitRetry(
    chunkText: string,
    config: AiServiceConfig,
    depth: number
  ): Promise<ChunkPreviewResult> {
    try {
      const result = await window.electronAPI.ai.extractQuestions(chunkText, { ...config })
      return normalizeChunkPreviewResult(result)
    } catch (err) {
      if (
        isTimeoutError(err) &&
        depth < MAX_TIMEOUT_SPLIT_DEPTH &&
        chunkText.length > MIN_CHARS_PER_AI_REQUEST
      ) {
        const [left, right] = splitChunkInHalf(chunkText)
        if (left && right && left !== chunkText && right !== chunkText) {
          const leftResult = await processChunkWithSplitRetry(left, config, depth + 1)
          const rightResult = await processChunkWithSplitRetry(right, config, depth + 1)
          return mergeChunkPreviewResult(leftResult, rightResult)
        }
      }
      throw err
    }
  }

  async function processSessionChunks(
    sessionId: number,
    chunks: ImportSessionChunk[],
    config: AiServiceConfig,
    filePath: string,
    totalChunkCount: number
  ): Promise<void> {
    for (const chunk of chunks) {
      aiChunkProgress.value = {
        current: Math.min(Math.max(chunk.chunkIndex, 1), totalChunkCount),
        total: totalChunkCount,
        filePath,
        message: `AI 解析分片 ${chunk.chunkIndex}/${totalChunkCount}`
      }

      try {
        const preview = await processChunkWithSplitRetry(chunk.chunkText, config, 0)
        appendPreviewData(preview)

        const payload: SaveImportChunkResultInput = {
          status: 'success',
          questions: preview.questions,
          categories: preview.categories
        }
        await window.electronAPI.db.saveImportChunkResult(sessionId, chunk.chunkIndex, payload)
      } catch (chunkError) {
        const chunkMessage = (chunkError as Error).message || 'AI 分片解析失败'
        await window.electronAPI.db.saveImportChunkResult(sessionId, chunk.chunkIndex, {
          status: 'failed',
          errorMessage: chunkMessage
        })
        throw chunkError
      }
    }
  }

  async function loadImportHistory(filters?: ImportSessionFilters): Promise<void> {
    historyLoading.value = true
    try {
      const result = await window.electronAPI.db.listImportSessions(filters ?? { limit: 30 })
      historySessions.value = result
        .map((item) => normalizeImportSession(item))
        .filter((item) => item.id > 0)
    } finally {
      historyLoading.value = false
    }
  }

  async function getImportSessionDetails(sessionId: number): Promise<ImportSessionDetails> {
    const raw = await window.electronAPI.db.getImportSessionDetails(sessionId)
    return {
      session: normalizeImportSession((raw as { session?: unknown })?.session),
      chunks: parseJsonArray<unknown>((raw as { chunks?: unknown })?.chunks).map((item) => normalizeImportSessionChunk(item))
    }
  }

  async function startImport(pdfPath: string, config: AiServiceConfig): Promise<void> {
    currentFile.value = pdfPath
    error.value = null
    questions.value = []
    categories.value = []

    const safeMetadata = metadata.value
    const session = normalizeImportSession(
      await window.electronAPI.db.createImportSession({
        filePath: pdfPath,
        examYear: safeMetadata?.examYear,
        examLevel: safeMetadata?.examLevel,
        qualificationName: safeMetadata?.qualificationName
      })
    )

    activeSessionId.value = session.id

    try {
      await window.electronAPI.db.markImportSessionStatus(session.id, 'ocr_processing')

      const pdfResult = await window.electronAPI.file.extractPdfText(pdfPath)
      const extractedText = String(pdfResult?.text || '')
      if (!extractedText.trim()) {
        throw new Error('PDF 文件中没有提取到文本内容')
      }

      await window.electronAPI.db.saveImportOcrResult(session.id, {
        ocrText: extractedText,
        ocrTextLength: extractedText.length,
        ocrTotalPages: Number(pdfResult?.numpages || 0)
      })

      const chunks = splitTextForAi(extractedText)
      if (chunks.length === 0) {
        throw new Error('PDF 提取后文本为空')
      }

      const chunkPayloads: ImportChunkInput[] = chunks.map((chunkText, index) => ({
        chunkIndex: index + 1,
        chunkText,
        status: 'pending'
      }))

      await window.electronAPI.db.upsertImportChunks(session.id, chunkPayloads)
      await window.electronAPI.db.markImportSessionStatus(session.id, 'ai_processing')

      const chunkModels: ImportSessionChunk[] = chunkPayloads.map((item, index) => ({
        id: index + 1,
        sessionId: session.id,
        chunkIndex: item.chunkIndex,
        chunkText: item.chunkText,
        status: 'pending',
        attemptCount: 0
      }))

      await processSessionChunks(session.id, chunkModels, config, pdfPath, chunkPayloads.length)

      currentFile.value = pdfPath

      aiChunkProgress.value = {
        current: chunkPayloads.length,
        total: chunkPayloads.length,
        filePath: currentFile.value,
        message: 'AI 分片解析完成'
      }

      await window.electronAPI.db.markImportSessionStatus(session.id, 'preview_ready')
      await loadImportHistory()
    } catch (err) {
      const message = (err as Error).message || '导入失败'
      error.value = message

      if (activeSessionId.value) {
        await window.electronAPI.db.markImportSessionStatus(activeSessionId.value, 'failed', message)
      }

      await loadImportHistory()
      throw err
    }
  }

  async function processResumeContext(context: ImportResumeContext, config?: AiServiceConfig): Promise<void> {
    activeSessionId.value = context.session.id
    currentFile.value = context.session.filePath
    selectedFiles.value = context.session.filePath ? [context.session.filePath] : []

    if (
      Number.isFinite(Number(context.session.examYear)) &&
      context.session.examLevel &&
      context.session.qualificationName
    ) {
      metadata.value = {
        examYear: Number(context.session.examYear),
        examLevel: context.session.examLevel,
        qualificationName: context.session.qualificationName
      }
    } else {
      metadata.value = null
    }

    setPreviewData(context.aggregatedPreview)

    if (context.session.status === 'completed') {
      progress.value = { current: 1, total: 1, status: 'completed' }
      await loadImportHistory()
      return
    }

    const pendingChunks = [...context.resumableChunks]
      .filter((chunk) => chunk.status === 'pending' || chunk.status === 'failed')
      .sort((a, b) => a.chunkIndex - b.chunkIndex)

    if (pendingChunks.length === 0) {
      await window.electronAPI.db.markImportSessionStatus(context.session.id, 'preview_ready')
      aiChunkProgress.value = null
      await loadImportHistory()
      return
    }

    if (!config) {
      throw new Error('请先配置 AI 服务后再继续导入')
    }

    await window.electronAPI.db.markImportSessionStatus(context.session.id, 'ai_processing')

    const totalChunkCount = context.chunks.length > 0
      ? context.chunks.length
      : Math.max(...pendingChunks.map((item) => item.chunkIndex))

    const safeFilePath = context.session.filePath || currentFile.value || ''

    await processSessionChunks(
      context.session.id,
      pendingChunks,
      config,
      safeFilePath,
      totalChunkCount
    )

    currentFile.value = safeFilePath

    aiChunkProgress.value = {
      current: totalChunkCount,
      total: totalChunkCount,
      filePath: currentFile.value,
      message: 'AI 分片解析完成'
    }

    await window.electronAPI.db.markImportSessionStatus(context.session.id, 'preview_ready')
    await loadImportHistory()
  }

  async function resumeImport(sessionId: number, config?: AiServiceConfig): Promise<void> {
    error.value = null

    const context = normalizeImportResumeContext(await window.electronAPI.db.getImportResumeContext(sessionId))

    try {
      await processResumeContext(context, config)
    } catch (err) {
      const message = (err as Error).message || '继续导入失败'
      error.value = message
      await window.electronAPI.db.markImportSessionStatus(context.session.id, 'failed', message)
      await loadImportHistory()
      throw err
    }
  }

  async function retryFailedChunks(sessionId: number, config?: AiServiceConfig): Promise<void> {
    error.value = null

    const context = normalizeImportResumeContext(await window.electronAPI.db.getImportResumeContext(sessionId))
    const failedChunks = context.resumableChunks.filter((chunk) => chunk.status === 'failed')

    if (failedChunks.length === 0) {
      throw new Error('当前会话没有失败分片可重试')
    }

    const retryContext: ImportResumeContext = {
      ...context,
      resumableChunks: failedChunks
    }

    try {
      await processResumeContext(retryContext, config)
    } catch (err) {
      const message = (err as Error).message || '失败分片重试失败'
      error.value = message
      await window.electronAPI.db.markImportSessionStatus(context.session.id, 'failed', message)
      await loadImportHistory()
      throw err
    }
  }

  async function confirmImport(metadataOverride?: ImportMetadata): Promise<void> {
    const questionStore = useQuestionStore()
    const effectiveMetadata = metadataOverride ?? metadata.value

    if (!effectiveMetadata?.examLevel || !effectiveMetadata?.qualificationName || !Number.isFinite(Number(effectiveMetadata.examYear))) {
      throw new Error('导入元数据不完整，无法入库')
    }

    if (activeSessionId.value) {
      await window.electronAPI.db.markImportSessionStatus(activeSessionId.value, 'importing')
    }

    const safeMetadata: ImportMetadata = {
      examYear: Number(effectiveMetadata.examYear),
      examLevel: effectiveMetadata.examLevel,
      qualificationName: String(effectiveMetadata.qualificationName).trim()
    }

    let importedCount = 0

    try {
      for (const question of questions.value) {
        let categoryId: number | undefined

        if (question.categoryName) {
          const existingCategory = await findOrCreateCategory(String(question.categoryName))
          categoryId = existingCategory?.id
        }

        const safeExamYear = Number(safeMetadata.examYear ?? question.examYear)

        await questionStore.addQuestion({
          title: String(question.title || ''),
          content: String(question.content || ''),
          type: question.type,
          options: Array.isArray(question.options) ? [...question.options.map((item) => String(item))] : [],
          answer: String(question.answer || ''),
          analysis: String(question.analysis || ''),
          categoryId,
          difficulty: Number(question.difficulty || 1),
          source: String(question.source || ''),
          examYear: Number.isFinite(safeExamYear) ? safeExamYear : undefined,
          examLevel: (safeMetadata.examLevel ?? question.examLevel) as '初级' | '中级' | '高级' | undefined,
          qualificationName: String(safeMetadata.qualificationName ?? question.qualificationName ?? '')
        })

        importedCount += 1
      }

      if (activeSessionId.value) {
        await window.electronAPI.db.completeImportSession(activeSessionId.value, {
          importedQuestionCount: importedCount,
          previewQuestionCount: questions.value.length
        })
      }

      await loadImportHistory()
    } catch (err) {
      const message = (err as Error).message || '题目入库失败'
      if (activeSessionId.value) {
        await window.electronAPI.db.markImportSessionStatus(activeSessionId.value, 'failed', message)
      }
      await loadImportHistory()
      throw err
    }
  }

  async function findOrCreateCategory(categoryName: string): Promise<CategoryCandidate | null> {
    const safeCategoryName = String(categoryName || '').trim()
    if (!safeCategoryName) {
      return null
    }

    const existingCategories = await window.electronAPI.db.getCategories()
    const existing = existingCategories.find((item) => String((item as { name?: unknown }).name || '').trim() === safeCategoryName)

    if (existing) {
      return {
        id: Number((existing as { id?: unknown }).id),
        name: String((existing as { name?: unknown }).name || '')
      }
    }

    const created = await window.electronAPI.db.addCategory(safeCategoryName)
    return {
      id: Number((created as { id?: unknown }).id),
      name: String((created as { name?: unknown }).name || safeCategoryName)
    }
  }

  function reset(): void {
    questions.value = []
    categories.value = []
    progress.value = { current: 0, total: 0, status: 'idle' }
    currentFile.value = ''
    selectedFiles.value = []
    aiChunkProgress.value = null
    metadata.value = null
    error.value = null
    activeSessionId.value = null
  }

  function removeQuestion(index: number): void {
    questions.value = questions.value.filter((_, i) => i !== index)
  }

  function updateQuestion(index: number, question: ExtractedQuestion): void {
    questions.value = questions.value.map((item, i) => (i === index ? { ...question } : item))
  }

  return {
    questions,
    categories,
    progress,
    currentFile,
    selectedFiles,
    aiChunkProgress,
    metadata,
    error,
    activeSessionId,
    historySessions,
    historyLoading,
    isProcessing,
    hasQuestions,
    startImport,
    resumeImport,
    confirmImport,
    loadImportHistory,
    getImportSessionDetails,
    retryFailedChunks,
    reset,
    removeQuestion,
    updateQuestion
  }
})
