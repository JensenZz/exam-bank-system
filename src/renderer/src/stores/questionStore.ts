import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  Question,
  Category,
  PracticeSessionInput,
  PracticeSession,
  PracticeRecordDetail,
  PracticeRecordDraftInput,
  SavePracticeResultOutput,
  ExamLevel,
  QuestionFilters
} from '../types'

export type {
  Question,
  Category,
  PracticeSessionInput,
  PracticeSession,
  PracticeRecordDetail,
  ExamLevel
} from '../types'

export type PracticeDraftMode = 'filtered' | 'random'

export interface PracticeDraftFilters {
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
  type?: Question['type']
  categoryId?: number
  randomCount?: number
}

export interface PracticeDraft {
  id: string
  mode: PracticeDraftMode
  filters: PracticeDraftFilters
  questions: Question[]
  currentIndex: number
  answers: Record<string, string>
  selectedAnswer: string
  showAnswer: boolean
  createdAt: string
  updatedAt: string
}

export interface PracticeDraftUpsertInput {
  id?: string
  mode: PracticeDraftMode
  filters: PracticeDraftFilters
  questions: Question[]
  currentIndex: number
  answers: Record<string, string>
  selectedAnswer: string
  showAnswer: boolean
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch (error) {
    console.warn('解析 JSON 数组失败:', error)
    return []
  }
}

const PRACTICE_DRAFT_STORAGE_KEY = 'practice_drafts_v1'

function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function isValidQuestionType(value: unknown): value is Question['type'] {
  return value === 'single' || value === 'multiple' || value === 'fill' || value === 'essay'
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeDraftFilters(raw: unknown): PracticeDraftFilters {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const level = source.examLevel
  const examYear = toOptionalNumber(source.examYear)
  const categoryId = toOptionalNumber(source.categoryId)
  const randomCount = toOptionalNumber(source.randomCount)

  return {
    examYear,
    examLevel: level === '初级' || level === '中级' || level === '高级' ? level : undefined,
    qualificationName: source.qualificationName ? String(source.qualificationName) : undefined,
    type: isValidQuestionType(source.type) ? source.type : undefined,
    categoryId,
    randomCount: randomCount !== undefined ? Math.max(1, randomCount) : undefined
  }
}

function normalizeDraft(raw: unknown): PracticeDraft | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const source = raw as Record<string, unknown>
  const mode = source.mode === 'random' ? 'random' : source.mode === 'filtered' ? 'filtered' : null
  if (!mode) {
    return null
  }

  const questionArray = Array.isArray(source.questions) ? source.questions as Question[] : []
  const answersSource = source.answers && typeof source.answers === 'object' ? source.answers as Record<string, unknown> : {}
  const answers = Object.entries(answersSource).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = String(value || '')
    return acc
  }, {})

  const currentIndex = Number(source.currentIndex)
  const normalizedIndex = Number.isFinite(currentIndex) ? Math.max(0, Math.min(currentIndex, Math.max(questionArray.length - 1, 0))) : 0

  return {
    id: source.id ? String(source.id) : createDraftId(),
    mode,
    filters: normalizeDraftFilters(source.filters),
    questions: questionArray,
    currentIndex: normalizedIndex,
    answers,
    selectedAnswer: String(source.selectedAnswer || ''),
    showAnswer: Boolean(source.showAnswer),
    createdAt: source.createdAt ? String(source.createdAt) : new Date().toISOString(),
    updatedAt: source.updatedAt ? String(source.updatedAt) : new Date().toISOString()
  }
}

function loadDraftsFromStorage(): PracticeDraft[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(PRACTICE_DRAFT_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => normalizeDraft(item))
      .filter((item): item is PracticeDraft => Boolean(item))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  } catch (error) {
    console.warn('读取练习草稿失败:', error)
    return []
  }
}

function persistDraftsToStorage(drafts: PracticeDraft[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(PRACTICE_DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  } catch (error) {
    console.warn('保存练习草稿失败:', error)
  }
}

export const useQuestionStore = defineStore('question', () => {
  const questions = ref<Question[]>([])
  const categories = ref<Category[]>([])
  const currentQuestion = ref<Question | null>(null)
  const isLoading = ref(false)
  const practiceDrafts = ref<PracticeDraft[]>(loadDraftsFromStorage())

  // 获取题目列表
  async function loadQuestions(filters?: QuestionFilters) {
    isLoading.value = true
    try {
      const result = await window.electronAPI.db.getQuestions(filters)
      questions.value = result.map((q: any) => ({
        ...q,
        categoryId: q.categoryId ?? q.category_id,
        examYear: q.examYear ?? q.exam_year,
        examLevel: q.examLevel ?? q.exam_level,
        qualificationName: q.qualificationName ?? q.qualification_name,
        createdAt: q.createdAt ?? q.created_at,
        updatedAt: q.updatedAt ?? q.updated_at,
        options: parseJsonArray(q.options),
        images: parseJsonArray(q.images)
      }))
    } catch (error) {
      console.error('加载题目失败:', error)
    } finally {
      isLoading.value = false
    }
  }

  // 获取分类列表
  async function loadCategories() {
    try {
      categories.value = await window.electronAPI.db.getCategories()
    } catch (error) {
      console.error('加载分类失败:', error)
    }
  }

  function toPlainQuestionPayload(question: Question) {
    const safeCategoryId = Number(question.categoryId)
    const safeDifficulty = Number(question.difficulty)
    const safeExamYear = Number(question.examYear)

    return {
      title: String(question.title || ''),
      content: String(question.content || ''),
      type: question.type,
      options: Array.isArray(question.options) ? question.options.map(item => String(item)) : [],
      answer: String(question.answer || ''),
      analysis: String(question.analysis || ''),
      images: Array.isArray(question.images) ? question.images.map(item => String(item)) : [],
      categoryId: Number.isFinite(safeCategoryId) ? safeCategoryId : undefined,
      difficulty: Number.isFinite(safeDifficulty) ? safeDifficulty : 1,
      source: String(question.source || ''),
      examYear: Number.isFinite(safeExamYear) ? safeExamYear : undefined,
      examLevel: question.examLevel,
      qualificationName: question.qualificationName ? String(question.qualificationName) : undefined
    }
  }

  // 添加题目
  async function addQuestion(question: Question) {
    try {
      const payload = toPlainQuestionPayload(question)
      const result = await window.electronAPI.db.addQuestion(payload)
      const normalized = {
        ...result,
        categoryId: (result as any).categoryId ?? (result as any).category_id,
        examYear: (result as any).examYear ?? (result as any).exam_year,
        examLevel: (result as any).examLevel ?? (result as any).exam_level,
        qualificationName: (result as any).qualificationName ?? (result as any).qualification_name,
        createdAt: (result as any).createdAt ?? (result as any).created_at,
        updatedAt: (result as any).updatedAt ?? (result as any).updated_at,
        options: parseJsonArray((result as any).options),
        images: parseJsonArray((result as any).images)
      } as Question

      questions.value.unshift(normalized)
      return normalized
    } catch (error) {
      console.error('添加题目失败:', error)
      throw error
    }
  }

  // 批量添加题目
  async function addQuestions(questionList: Question[]) {
    const results = []
    for (const question of questionList) {
      const result = await addQuestion(question)
      results.push(result)
    }
    return results
  }

  // 更新题目
  async function updateQuestion(question: Question) {
    try {
      const questionId = Number(question.id)
      if (!Number.isFinite(questionId)) {
        throw new Error('题目 ID 无效，无法更新')
      }

      const payload = toPlainQuestionPayload(question)
      const result = await window.electronAPI.db.updateQuestion({ ...payload, id: questionId })
      const normalized = {
        ...result,
        categoryId: (result as any).categoryId ?? (result as any).category_id,
        examYear: (result as any).examYear ?? (result as any).exam_year,
        examLevel: (result as any).examLevel ?? (result as any).exam_level,
        qualificationName: (result as any).qualificationName ?? (result as any).qualification_name,
        createdAt: (result as any).createdAt ?? (result as any).created_at,
        updatedAt: (result as any).updatedAt ?? (result as any).updated_at,
        options: parseJsonArray((result as any).options),
        images: parseJsonArray((result as any).images)
      } as Question

      const index = questions.value.findIndex(q => q.id === question.id)
      if (index !== -1) {
        questions.value[index] = normalized
      }
    } catch (error) {
      console.error('更新题目失败:', error)
      throw error
    }
  }

  // 删除题目
  async function deleteQuestion(id: number) {
    try {
      await window.electronAPI.db.deleteQuestion(id)
      questions.value = questions.value.filter(q => q.id !== id)
    } catch (error) {
      console.error('删除题目失败:', error)
      throw error
    }
  }

  // 添加分类
  async function addCategory(name: string, parentId?: number) {
    try {
      const result = await window.electronAPI.db.addCategory(name, parentId)
      categories.value.push(result)
      return result
    } catch (error) {
      console.error('添加分类失败:', error)
      throw error
    }
  }

  async function getPracticeSessions(filters?: Pick<QuestionFilters, 'examYear' | 'examLevel' | 'qualificationKeyword'>) {
    const result = await window.electronAPI.db.getPracticeSessions(filters)
    return result.map((item: any) => ({
      ...item,
      examYear: item.examYear ?? item.exam_year,
      examLevel: item.examLevel ?? item.exam_level,
      qualificationName: item.qualificationName ?? item.qualification_name,
      totalCount: item.totalCount ?? item.total_count,
      correctCount: item.correctCount ?? item.correct_count,
      createdAt: item.createdAt ?? item.created_at
    })) as PracticeSession[]
  }

  async function getPracticeSessionDetails(sessionId: number) {
    const result = await window.electronAPI.db.getPracticeSessionDetails(sessionId)
    return result.map((item: any) => ({
      ...item,
      sessionId: item.sessionId ?? item.session_id,
      questionId: item.questionId ?? item.question_id,
      questionOrder: item.questionOrder ?? item.question_order,
      isCorrect: item.isCorrect ?? item.is_correct,
      practicedAt: item.practicedAt ?? item.practiced_at,
      examYear: item.examYear ?? item.exam_year,
      examLevel: item.examLevel ?? item.exam_level,
      qualificationName: item.qualificationName ?? item.qualification_name,
      options: parseJsonArray(item.options)
    })) as PracticeRecordDetail[]
  }

  async function savePracticeResult(input: {
    session: PracticeSessionInput
    records: PracticeRecordDraftInput[]
  }) {
    const payload = {
      session: {
        examYear: Number.isFinite(Number(input.session.examYear)) ? Number(input.session.examYear) : undefined,
        examLevel: input.session.examLevel,
        qualificationName: input.session.qualificationName ? String(input.session.qualificationName) : undefined,
        totalCount: Number(input.session.totalCount),
        correctCount: Number(input.session.correctCount),
        accuracy: Number(input.session.accuracy)
      },
      records: input.records.map((record, index) => ({
        questionId: Number(record.questionId),
        userAnswer: String(record.userAnswer || ''),
        isCorrect: Boolean(record.isCorrect),
        questionOrder: Number.isFinite(Number(record.questionOrder)) ? Number(record.questionOrder) : index + 1
      }))
    }

    const result = await window.electronAPI.db.savePracticeResult(payload)
    return {
      session: {
        ...result.session,
        examYear: (result.session as any).examYear ?? (result.session as any).exam_year,
        examLevel: (result.session as any).examLevel ?? (result.session as any).exam_level,
        qualificationName: (result.session as any).qualificationName ?? (result.session as any).qualification_name,
        createdAt: (result.session as any).createdAt ?? (result.session as any).created_at
      },
      inserted: Number(result.inserted || 0)
    } as SavePracticeResultOutput
  }

  function syncPracticeDrafts(nextDrafts: PracticeDraft[]) {
    const normalized = [...nextDrafts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    practiceDrafts.value = normalized
    persistDraftsToStorage(normalized)
  }

  function upsertPracticeDraft(input: PracticeDraftUpsertInput): PracticeDraft {
    const existing = input.id ? practiceDrafts.value.find((draft) => draft.id === input.id) : undefined
    const now = new Date().toISOString()
    const normalizedQuestions = Array.isArray(input.questions) ? [...input.questions] : []
    const boundedIndex = Math.max(0, Math.min(Number(input.currentIndex) || 0, Math.max(normalizedQuestions.length - 1, 0)))

    const draft: PracticeDraft = {
      id: existing?.id || input.id || createDraftId(),
      mode: input.mode,
      filters: {
        ...normalizeDraftFilters(input.filters)
      },
      questions: normalizedQuestions,
      currentIndex: boundedIndex,
      answers: {
        ...(input.answers || {})
      },
      selectedAnswer: String(input.selectedAnswer || ''),
      showAnswer: Boolean(input.showAnswer),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    const nextDrafts = existing
      ? practiceDrafts.value.map((item) => (item.id === draft.id ? draft : item))
      : [draft, ...practiceDrafts.value]

    syncPracticeDrafts(nextDrafts)
    return draft
  }

  function removePracticeDraft(id: string) {
    const nextDrafts = practiceDrafts.value.filter((draft) => draft.id !== id)
    syncPracticeDrafts(nextDrafts)
  }

  function getPracticeDraft(id: string) {
    return practiceDrafts.value.find((draft) => draft.id === id) || null
  }

  function clearPracticeDrafts() {
    syncPracticeDrafts([])
  }

  return {
    questions,
    categories,
    currentQuestion,
    isLoading,
    practiceDrafts,
    loadQuestions,
    loadCategories,
    addQuestion,
    addQuestions,
    updateQuestion,
    deleteQuestion,
    addCategory,
    getPracticeSessions,
    getPracticeSessionDetails,
    savePracticeResult,
    upsertPracticeDraft,
    removePracticeDraft,
    getPracticeDraft,
    clearPracticeDrafts
  }
})