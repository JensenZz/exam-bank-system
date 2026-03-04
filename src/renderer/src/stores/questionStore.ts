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

export const useQuestionStore = defineStore('question', () => {
  const questions = ref<Question[]>([])
  const categories = ref<Category[]>([])
  const currentQuestion = ref<Question | null>(null)
  const isLoading = ref(false)

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

  return {
    questions,
    categories,
    currentQuestion,
    isLoading,
    loadQuestions,
    loadCategories,
    addQuestion,
    addQuestions,
    updateQuestion,
    deleteQuestion,
    addCategory,
    getPracticeSessions,
    getPracticeSessionDetails,
    savePracticeResult
  }
})