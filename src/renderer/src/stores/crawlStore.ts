import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import type { AiServiceConfig } from '../types/ai'
import type { CrawlSession, CrawlSiteType, CrawlTask, ParsedQuestionDraft, ExamLevel } from '../types'
import { useQuestionStore } from './questionStore'

interface CrawlMetadata {
  examYear: number
  examLevel: ExamLevel | ''
  qualificationName: string
}

function normalizeTask(raw: any): CrawlTask {
  return {
    id: Number(raw?.id || 0),
    siteType: (raw?.siteType ?? raw?.site_type ?? 'auto') as CrawlSiteType,
    url: String(raw?.url || ''),
    domain: String(raw?.domain || ''),
    sessionRef: raw?.sessionRef ?? raw?.session_ref ? String(raw?.sessionRef ?? raw?.session_ref) : undefined,
    status: String(raw?.status || 'pending') as CrawlTask['status'],
    progressMessage: raw?.progressMessage ?? raw?.progress_message ? String(raw?.progressMessage ?? raw?.progress_message) : undefined,
    errorMessage: raw?.errorMessage ?? raw?.error_message ? String(raw?.errorMessage ?? raw?.error_message) : undefined,
    preview: raw?.preview,
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  }
}

function normalizeSession(raw: any): CrawlSession | null {
  if (!raw) return null
  return {
    id: Number(raw?.id || 0),
    domain: String(raw?.domain || ''),
    siteType: (raw?.siteType ?? raw?.site_type ?? 'auto') as CrawlSiteType,
    status: String(raw?.status || 'idle') as CrawlSession['status'],
    loginUrl: String(raw?.loginUrl ?? raw?.login_url ?? ''),
    cookiePreview: raw?.cookiePreview ?? raw?.cookie_preview ? String(raw?.cookiePreview ?? raw?.cookie_preview) : undefined,
    createdAt: raw?.createdAt ?? raw?.created_at,
    updatedAt: raw?.updatedAt ?? raw?.updated_at
  }
}

export const useCrawlStore = defineStore('crawl', () => {
  const siteType = ref<CrawlSiteType>('auto')
  const url = ref('')
  const session = ref<CrawlSession | null>(null)
  const task = ref<CrawlTask | null>(null)
  const questions = ref<ParsedQuestionDraft[]>([])
  const metadata = ref<CrawlMetadata>({
    examYear: new Date().getFullYear(),
    examLevel: '',
    qualificationName: ''
  })
  const manualCookie = ref('')
  const isPolling = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function clearPoll(): void {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    isPolling.value = false
  }

  function setPreviewQuestions(next: ParsedQuestionDraft[]): void {
    questions.value = next.map((item) => ({
      ...item,
      options: Array.isArray(item.options) ? item.options.map((option) => String(option)) : [],
      images: Array.isArray(item.images) ? item.images.map((image) => String(image)) : [],
      warnings: Array.isArray(item.warnings) ? item.warnings.map((warning) => String(warning)) : []
    }))
  }

  async function refreshSession(): Promise<void> {
    if (!url.value.trim()) return
    session.value = normalizeSession(await window.electronAPI.crawl.getSessionByUrl(url.value.trim()))
  }

  async function openLoginWindow(): Promise<void> {
    if (!url.value.trim()) {
      throw new Error('请先输入网页链接')
    }
    error.value = null
    await window.electronAPI.crawl.openLoginWindow({ url: url.value.trim(), siteType: siteType.value })
    await refreshSession()
  }

  async function saveManualCookie(): Promise<void> {
    if (!url.value.trim() || !manualCookie.value.trim()) {
      throw new Error('请先输入链接和 Cookie')
    }
    error.value = null
    session.value = normalizeSession(
      await window.electronAPI.crawl.saveManualCookie({
        url: url.value.trim(),
        siteType: siteType.value,
        cookie: manualCookie.value.trim()
      })
    )
  }

  async function pollTask(taskId: number): Promise<void> {
    clearPoll()
    isPolling.value = true

    const loop = async () => {
      const nextTask = normalizeTask(await window.electronAPI.crawl.getTask(taskId))
      task.value = nextTask
      if (nextTask.preview?.questions) {
        setPreviewQuestions(nextTask.preview.questions)
      }

      if (['ready_for_preview', 'completed', 'failed', 'auth_required'].includes(nextTask.status)) {
        clearPoll()
        return
      }

      pollTimer = setTimeout(() => {
        void loop()
      }, 1200)
    }

    await loop()
  }

  async function startTask(aiConfig?: AiServiceConfig | null): Promise<void> {
    if (!url.value.trim()) {
      throw new Error('请先输入网页链接')
    }

    const plainAiConfig = aiConfig
      ? {
          provider: String(toRaw(aiConfig).provider || 'openai') as AiServiceConfig['provider'],
          apiKey: String(toRaw(aiConfig).apiKey || ''),
          model: String(toRaw(aiConfig).model || ''),
          endpoint: toRaw(aiConfig).endpoint ? String(toRaw(aiConfig).endpoint) : undefined,
          temperature: Number.isFinite(Number(toRaw(aiConfig).temperature)) ? Number(toRaw(aiConfig).temperature) : undefined,
          maxTokens: Number.isFinite(Number(toRaw(aiConfig).maxTokens)) ? Number(toRaw(aiConfig).maxTokens) : undefined,
          promptTemplate: toRaw(aiConfig).promptTemplate ? String(toRaw(aiConfig).promptTemplate) : undefined
        }
      : undefined

    error.value = null
    isLoading.value = true
    try {
      const created = normalizeTask(await window.electronAPI.crawl.createTask({
        url: url.value.trim(),
        siteType: siteType.value,
        sessionRef: session.value?.id ? String(session.value.id) : undefined,
        aiConfig: plainAiConfig
      }))
      task.value = created
      questions.value = []
      await pollTask(created.id)
    } finally {
      isLoading.value = false
    }
  }

  async function importQuestions(): Promise<number> {
    const questionStore = useQuestionStore()
    if (!task.value?.id) {
      throw new Error('抓取任务不存在')
    }
    if (!metadata.value.examLevel || !metadata.value.qualificationName.trim()) {
      throw new Error('请先填写年份、级别和资格名称')
    }

    await window.electronAPI.crawl.markTaskImporting(task.value.id)

    let importedCount = 0
    try {
      for (const question of questions.value) {
        let categoryId: number | undefined
        if (question.categoryName?.trim()) {
          const existingCategories = await window.electronAPI.db.getCategories()
          const matched = existingCategories.find((item: any) => String(item?.name || '').trim() === question.categoryName?.trim())
          if (matched) {
            categoryId = Number((matched as any).id)
          } else {
            const created = await window.electronAPI.db.addCategory(question.categoryName.trim())
            categoryId = Number((created as any).id)
          }
        }

        await questionStore.addQuestion({
          title: question.title,
          content: question.content,
          type: question.type,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          images: question.images,
          categoryId,
          difficulty: Number(question.difficulty || 1),
          source: question.source || task.value.url,
          examYear: Number(metadata.value.examYear),
          examLevel: metadata.value.examLevel || undefined,
          qualificationName: metadata.value.qualificationName.trim()
        })
        importedCount += 1
      }

      task.value = normalizeTask(await window.electronAPI.crawl.completeTask(task.value.id, { importedCount }))
      await questionStore.loadQuestions()
      return importedCount
    } catch (err) {
      await window.electronAPI.crawl.failTask(task.value.id, (err as Error).message)
      throw err
    }
  }

  function removeQuestion(index: number): void {
    questions.value = questions.value.filter((_, currentIndex) => currentIndex !== index)
  }

  function updateQuestion(index: number, draft: ParsedQuestionDraft): void {
    questions.value = questions.value.map((item, currentIndex) => (currentIndex === index ? { ...draft } : item))
  }

  function reset(): void {
    clearPoll()
    session.value = null
    task.value = null
    questions.value = []
    manualCookie.value = ''
    error.value = null
    isLoading.value = false
  }

  return {
    siteType,
    url,
    session,
    task,
    questions,
    metadata,
    manualCookie,
    isPolling,
    isLoading,
    error,
    refreshSession,
    openLoginWindow,
    saveManualCookie,
    startTask,
    importQuestions,
    removeQuestion,
    updateQuestion,
    reset,
    clearPoll
  }
})

