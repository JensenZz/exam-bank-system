import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AiServiceConfig, ExtractedQuestion, ExtractedCategory } from '../types/ai'

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

const MAX_CHARS_PER_AI_REQUEST = 6000
const MIN_CHARS_PER_AI_REQUEST = 1200
const MAX_TIMEOUT_SPLIT_DEPTH = 3

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

export const useImportStore = defineStore('import', () => {
  // 状态
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
  const error = ref<string | null>(null)

  // 计算属性
  const isProcessing = computed(() => progress.value.status === 'processing')
  const hasQuestions = computed(() => questions.value.length > 0)

  /**
   * 开始导入流程
   * @param pdfPath PDF 文件路径
   * @param config AI 服务配置
   */
  async function startImport(pdfPath: string, config: AiServiceConfig) {
    currentFile.value = pdfPath
    error.value = null

    const mergeResult = (result: { questions: ExtractedQuestion[]; categories: ExtractedCategory[] }) => {
      questions.value.push(...result.questions)

      for (const cat of result.categories) {
        const exists = categories.value.some(c => c.name === cat.name)
        if (!exists) {
          categories.value.push(cat)
        }
      }
    }

    const processChunk = async (
      chunk: string,
      baseConfig: AiServiceConfig,
      depth: number,
      index: number,
      total: number
    ): Promise<void> => {
      aiChunkProgress.value = {
        current: index,
        total,
        filePath: pdfPath,
        message: `AI 解析分片 ${index}/${total}`
      }

      try {
        const result = await window.electronAPI.ai.extractQuestions(chunk, { ...baseConfig })
        mergeResult(result)
      } catch (err) {
        if (isTimeoutError(err) && depth < MAX_TIMEOUT_SPLIT_DEPTH && chunk.length > MIN_CHARS_PER_AI_REQUEST) {
          const [left, right] = splitChunkInHalf(chunk)
          if (left && right && left !== chunk && right !== chunk) {
            await processChunk(left, baseConfig, depth + 1, index, total)
            await processChunk(right, baseConfig, depth + 1, index, total)
            return
          }
        }
        throw err
      }
    }

    try {
      // 提取 PDF 文本
      const pdfResult = await window.electronAPI.file.extractPdfText(pdfPath)

      if (!pdfResult.text || pdfResult.text.trim().length === 0) {
        throw new Error('PDF 文件中没有提取到文本内容')
      }

      // 调用 AI 提取题目（长文本自动分片，超时时递归二分）
      const chunks = splitTextForAi(pdfResult.text)
      if (chunks.length === 0) {
        throw new Error('PDF 提取后文本为空')
      }

      for (let i = 0; i < chunks.length; i++) {
        await processChunk(chunks[i], config, 0, i + 1, chunks.length)
      }

      aiChunkProgress.value = {
        current: chunks.length,
        total: chunks.length,
        filePath: pdfPath,
        message: 'AI 分片解析完成'
      }
    } catch (err) {
      error.value = (err as Error).message
      throw err
    }
  }

  /**
   * 确认导入到数据库
   */
  async function confirmImport(metadata?: { examYear: number; examLevel: '初级' | '中级' | '高级'; qualificationName: string }) {
    const questionStore = useQuestionStore()

    for (const question of questions.value) {
      // 检查/创建分类
      let categoryId: number | undefined

      if (question.categoryName) {
        const existingCategory = await findOrCreateCategory(String(question.categoryName))
        categoryId = existingCategory?.id
      }

      // 添加题目到数据库（强制转换为 plain object，避免 structured clone 报错）
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
        examYear: Number(metadata?.examYear ?? question.examYear),
        examLevel: (metadata?.examLevel ?? question.examLevel) as '初级' | '中级' | '高级' | undefined,
        qualificationName: String(metadata?.qualificationName ?? question.qualificationName ?? '')
      })
    }
  }

  /**
   * 查找或创建分类
   */
  async function findOrCreateCategory(categoryName: string) {
    // 获取现有分类
    const existingCategories = await window.electronAPI.db.getCategories()
    const existing = existingCategories.find(c => c.name === categoryName)

    if (existing) {
      return existing
    }

    // 创建新分类
    return await window.electronAPI.db.addCategory(categoryName)
  }

  /**
   * 重置状态
   */
  function reset() {
    questions.value = []
    categories.value = []
    progress.value = { current: 0, total: 0, status: 'idle' }
    currentFile.value = ''
    selectedFiles.value = []
    aiChunkProgress.value = null
    error.value = null
  }

  /**
   * 移除特定题目
   */
  function removeQuestion(index: number) {
    questions.value.splice(index, 1)
  }

  /**
   * 更新题目
   */
  function updateQuestion(index: number, question: ExtractedQuestion) {
    questions.value[index] = question
  }

  return {
    questions,
    categories,
    progress,
    currentFile,
    selectedFiles,
    aiChunkProgress,
    error,
    isProcessing,
    hasQuestions,
    startImport,
    confirmImport,
    reset,
    removeQuestion,
    updateQuestion
  }
})

// 导入 questionStore 类型
import { useQuestionStore } from './questionStore'
