import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Question {
  id?: number
  title: string
  content?: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options?: string[]
  answer: string
  analysis?: string
  images?: string[]
  categoryId?: number
  difficulty: number
  source?: string
  createdAt?: string
  updatedAt?: string
}

export interface Category {
  id: number
  name: string
  parentId: number
  sortOrder: number
}

export const useQuestionStore = defineStore('question', () => {
  const questions = ref<Question[]>([])
  const categories = ref<Category[]>([])
  const currentQuestion = ref<Question | null>(null)
  const isLoading = ref(false)

  // 获取题目列表
  async function loadQuestions(filters?: { categoryId?: number; type?: string; keyword?: string }) {
    isLoading.value = true
    try {
      const result = await window.electronAPI.db.getQuestions(filters)
      questions.value = result.map((q: any) => ({
        ...q,
        options: q.options ? JSON.parse(q.options) : [],
        images: q.images ? JSON.parse(q.images) : []
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
      source: String(question.source || '')
    }
  }

  // 添加题目
  async function addQuestion(question: Question) {
    try {
      const payload = toPlainQuestionPayload(question)
      const result = await window.electronAPI.db.addQuestion(payload)
      questions.value.unshift(result)
      return result
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
      await window.electronAPI.db.updateQuestion(question)
      const index = questions.value.findIndex(q => q.id === question.id)
      if (index !== -1) {
        questions.value[index] = question
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
    addCategory
  }
})