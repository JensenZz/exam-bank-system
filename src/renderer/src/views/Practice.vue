<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useQuestionStore } from '../stores/questionStore'
import type { Question, ExamLevel } from '../types'
import type { PracticeDraft, PracticeDraftFilters, PracticeDraftMode } from '../stores/questionStore'
import BaseDialog from '../components/BaseDialog.vue'
import { useDialog } from '../composables/useDialog'

const store = useQuestionStore()

const examLevels: ExamLevel[] = ['初级', '中级', '高级']
const questionTypes: Array<{ value: Question['type']; label: string }> = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'fill', label: '填空题' },
  { value: 'essay', label: '简答题' }
]
const randomCountOptions = [5, 10, 20, 30, 50, 100]

const allQuestions = ref<Question[]>([])
const isInitializing = ref(false)

// 练习状态
const isPracticing = ref(false)
const currentIndex = ref(0)
const selectedAnswer = ref('')
const showAnswer = ref(false)
const practiceQuestions = ref<Question[]>([])
const answers = ref<Record<string, string>>({})
const currentDraftId = ref<string | null>(null)
const activeDraftMode = ref<PracticeDraftMode | null>(null)
const activeDraftFilters = ref<PracticeDraftFilters>({})
const isSavingResult = ref(false)

// 条件选题
const selectedExamYear = ref<number | null>(null)
const selectedExamLevel = ref<ExamLevel | ''>('')
const selectedQualificationName = ref('')
const selectedQuestionType = ref<Question['type'] | ''>('')
const selectedCategoryId = ref<number | null>(null)

// 随机选题
const randomExamYear = ref<number | null>(null)
const randomExamLevel = ref<ExamLevel | ''>('')
const randomQualificationName = ref('')
const randomQuestionType = ref<Question['type'] | ''>('')
const randomCategoryId = ref<number | null>(null)
const randomTotal = ref(20)

type DraftModeFilter = 'all' | 'filtered' | 'random'
type DraftSortType = 'updatedDesc' | 'updatedAsc' | 'progressDesc'

const draftModeFilter = ref<DraftModeFilter>('all')
const draftSortType = ref<DraftSortType>('updatedDesc')
const draftKeyword = ref('')

const { dialogState, showDialog, closeDialog, showInfoDialog, showConfirmDialog } = useDialog()

const currentQuestion = computed(() => {
  if (!isPracticing.value || practiceQuestions.value.length === 0) return null
  return practiceQuestions.value[currentIndex.value]
})

const progress = computed(() => {
  if (practiceQuestions.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / practiceQuestions.value.length) * 100)
})

const setupQuestionCount = computed(() => allQuestions.value.length)
const unfinishedDrafts = computed(() =>
  store.practiceDrafts.filter((draft) => Array.isArray(draft.questions) && draft.questions.length > 0)
)

const filteredUnfinishedDrafts = computed(() => {
  const keyword = draftKeyword.value.trim().toLowerCase()

  const modeFiltered = unfinishedDrafts.value.filter((draft) => {
    if (draftModeFilter.value === 'all') return true
    return draft.mode === draftModeFilter.value
  })

  const keywordFiltered = modeFiltered.filter((draft) => {
    if (!keyword) {
      return true
    }

    const conditionText = [
      draft.filters.qualificationName || '',
      draft.filters.examLevel || '',
      String(draft.filters.examYear || ''),
      getTypeLabel(draft.filters.type),
      formatDraftFilters(draft.filters)
    ]
      .join(' ')
      .toLowerCase()

    return conditionText.includes(keyword)
  })

  const sorted = [...keywordFiltered]
  sorted.sort((a, b) => {
    if (draftSortType.value === 'updatedAsc') {
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    }
    if (draftSortType.value === 'progressDesc') {
      const aProgress = a.questions.length === 0 ? 0 : (Number(a.currentIndex) + 1) / a.questions.length
      const bProgress = b.questions.length === 0 ? 0 : (Number(b.currentIndex) + 1) / b.questions.length
      return bProgress - aProgress
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })

  return sorted
})

const currentAnsweredCount = computed(() => {
  if (!isPracticing.value) {
    return 0
  }
  return Object.values(answers.value).filter((answer) => String(answer || '').trim().length > 0).length
})

const questionNavItems = computed(() => {
  return practiceQuestions.value.map((question, index) => {
    const key = getQuestionKey(question)
    const userAnswer = key ? String(answers.value[key] || '').trim() : ''
    const hasAnswer = userAnswer.length > 0
    const answeredCorrect = hasAnswer ? isCorrectAnswer(question, userAnswer) : false

    return {
      index,
      label: index + 1,
      active: index === currentIndex.value,
      answered: hasAnswer,
      answeredCorrect,
      answeredWrong: hasAnswer && !answeredCorrect
    }
  })
})

const availableExamYears = computed(() => {
  const yearSet = new Set<number>()
  allQuestions.value.forEach((question) => {
    const year = Number(question.examYear)
    if (Number.isFinite(year)) {
      yearSet.add(year)
    }
  })
  return Array.from(yearSet).sort((a, b) => b - a)
})

const availableQualificationNames = computed(() => {
  const nameSet = new Set<string>()
  allQuestions.value.forEach((question) => {
    const name = String(question.qualificationName || '').trim()
    if (name) {
      nameSet.add(name)
    }
  })
  return Array.from(nameSet).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

const availableCategories = computed(() => {
  const usedCategoryIds = new Set<number>()
  allQuestions.value.forEach((question) => {
    const categoryId = Number(question.categoryId)
    if (Number.isFinite(categoryId)) {
      usedCategoryIds.add(categoryId)
    }
  })
  return store.categories.filter((category) => {
    if (usedCategoryIds.size === 0) {
      return true
    }
    return usedCategoryIds.has(Number(category.id))
  })
})

const hasFilteredCondition = computed(() => {
  return Boolean(
    normalizeOptionalNumber(selectedExamYear.value) !== undefined ||
      selectedExamLevel.value ||
      selectedQualificationName.value ||
      selectedQuestionType.value ||
      normalizeOptionalNumber(selectedCategoryId.value) !== undefined
  )
})

const canStartFilteredPractice = computed(() => {
  return setupQuestionCount.value > 0 && hasFilteredCondition.value
})

const canStartRandomPractice = computed(() => {
  const total = Number(randomTotal.value)
  return setupQuestionCount.value > 0 && Number.isFinite(total) && total > 0
})

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString()
}

const getTypeLabel = (type?: Question['type']) => {
  return questionTypes.find((item) => item.value === type)?.label || '未知题型'
}

const getDifficultyLabel = (difficulty?: number) => {
  const labels = ['', '简单', '中等', '困难']
  return labels[Number(difficulty)] || '未标注'
}

const getPracticeModeLabel = (mode: PracticeDraftMode | null) => {
  if (mode === 'random') return '随机练习'
  if (mode === 'filtered') return '条件练习'
  return '练习'
}

const normalizeOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const getQuestionKey = (question: Question | null | undefined) => {
  const questionId = Number(question?.id)
  if (!Number.isFinite(questionId)) {
    return null
  }
  return String(questionId)
}

const resolveSelectedAnswerByIndex = (index: number) => {
  const question = practiceQuestions.value[index]
  const key = getQuestionKey(question)
  if (!key) {
    return ''
  }
  return answers.value[key] || ''
}

const buildPracticeFilters = (input: {
  examYear?: number | null
  examLevel?: ExamLevel | ''
  qualificationName?: string
  type?: Question['type'] | ''
  categoryId?: number | null
  randomCount?: number
}): PracticeDraftFilters => {
  const examYearNumber = normalizeOptionalNumber(input.examYear)
  const categoryIdNumber = normalizeOptionalNumber(input.categoryId)
  const randomCountNumber = normalizeOptionalNumber(input.randomCount)

  return {
    examYear: examYearNumber,
    examLevel: input.examLevel || undefined,
    qualificationName: input.qualificationName ? String(input.qualificationName) : undefined,
    type: input.type || undefined,
    categoryId: categoryIdNumber,
    randomCount: randomCountNumber !== undefined ? Math.max(1, randomCountNumber) : undefined
  }
}

const setActivePracticeContext = (mode: PracticeDraftMode, filters: PracticeDraftFilters) => {
  activeDraftMode.value = mode
  activeDraftFilters.value = { ...filters }
}

const persistActiveDraft = () => {
  if (!isPracticing.value || !activeDraftMode.value || practiceQuestions.value.length === 0) {
    return
  }

  const draft = store.upsertPracticeDraft({
    id: currentDraftId.value || undefined,
    mode: activeDraftMode.value,
    filters: { ...activeDraftFilters.value },
    questions: [...practiceQuestions.value],
    currentIndex: currentIndex.value,
    answers: { ...answers.value },
    selectedAnswer: selectedAnswer.value,
    showAnswer: showAnswer.value
  })

  currentDraftId.value = draft.id
}

const removeActiveDraft = () => {
  if (!currentDraftId.value) {
    return
  }
  store.removePracticeDraft(currentDraftId.value)
  currentDraftId.value = null
}

const resetPracticeState = (options?: { keepDraft?: boolean }) => {
  if (!options?.keepDraft) {
    removeActiveDraft()
  }

  isPracticing.value = false
  practiceQuestions.value = []
  currentIndex.value = 0
  selectedAnswer.value = ''
  showAnswer.value = false
  answers.value = {}
  activeDraftMode.value = null
  activeDraftFilters.value = {}
}

const normalizeAnswer = (answer: string, questionType: Question['type']) => {
  const base = String(answer || '').trim().toUpperCase()
  if (questionType === 'multiple') {
    return base
      .split('')
      .filter((char) => /[A-Z]/.test(char))
      .sort()
      .join('')
  }
  return base
}

const isCorrectAnswer = (question: Question, userAnswer: string) => {
  const normalizedUser = normalizeAnswer(userAnswer, question.type)
  const normalizedCorrect = normalizeAnswer(question.answer, question.type)
  return normalizedUser === normalizedCorrect
}

const filterQuestions = (filters: {
  examYear?: number | null
  examLevel?: ExamLevel | ''
  qualificationName?: string
  type?: Question['type'] | ''
  categoryId?: number | null
}) => {
  const targetExamYear = normalizeOptionalNumber(filters.examYear)
  const targetCategoryId = normalizeOptionalNumber(filters.categoryId)

  return allQuestions.value.filter((question) => {
    if (targetExamYear !== undefined && Number(question.examYear) !== targetExamYear) {
      return false
    }
    if (filters.examLevel && question.examLevel !== filters.examLevel) {
      return false
    }
    if (filters.qualificationName && question.qualificationName !== filters.qualificationName) {
      return false
    }
    if (filters.type && question.type !== filters.type) {
      return false
    }
    if (targetCategoryId !== undefined && Number(question.categoryId) !== targetCategoryId) {
      return false
    }
    return true
  })
}

const startPracticeSession = (questions: Question[], mode: PracticeDraftMode, filters: PracticeDraftFilters) => {
  if (!Array.isArray(questions) || questions.length === 0) {
    return
  }

  practiceQuestions.value = [...questions]
  isPracticing.value = true
  currentIndex.value = 0
  selectedAnswer.value = ''
  showAnswer.value = false
  answers.value = {}
  currentDraftId.value = null
  setActivePracticeContext(mode, filters)
  persistActiveDraft()
}

const startFilteredPractice = async () => {
  if (!hasFilteredCondition.value) {
    await showInfoDialog('请至少选择一个筛选条件')
    return
  }

  const matchedQuestions = filterQuestions({
    examYear: selectedExamYear.value,
    examLevel: selectedExamLevel.value,
    qualificationName: selectedQualificationName.value,
    type: selectedQuestionType.value,
    categoryId: selectedCategoryId.value
  })

  if (matchedQuestions.length === 0) {
    await showInfoDialog('未匹配到题目，请调整筛选条件')
    return
  }

  const filters = buildPracticeFilters({
    examYear: selectedExamYear.value,
    examLevel: selectedExamLevel.value,
    qualificationName: selectedQualificationName.value,
    type: selectedQuestionType.value,
    categoryId: selectedCategoryId.value
  })

  await showInfoDialog(`匹配到 ${matchedQuestions.length} 道题目，将加载全部题目开始练习`)
  startPracticeSession(matchedQuestions, 'filtered', filters)
}

const shuffleQuestions = (source: Question[]) => {
  const shuffled = [...source]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

const startRandomPractice = async () => {
  const requestedCount = Number(randomTotal.value)
  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    await showInfoDialog('随机总数必须大于 0')
    return
  }

  const matchedQuestions = filterQuestions({
    examYear: randomExamYear.value,
    examLevel: randomExamLevel.value,
    qualificationName: randomQualificationName.value,
    type: randomQuestionType.value,
    categoryId: randomCategoryId.value
  })

  if (matchedQuestions.length === 0) {
    await showInfoDialog('当前随机条件未匹配到题目，请调整筛选条件')
    return
  }

  const actualCount = Math.min(Math.floor(requestedCount), matchedQuestions.length)
  const randomQuestions = shuffleQuestions(matchedQuestions).slice(0, actualCount)
  const filters = buildPracticeFilters({
    examYear: randomExamYear.value,
    examLevel: randomExamLevel.value,
    qualificationName: randomQualificationName.value,
    type: randomQuestionType.value,
    categoryId: randomCategoryId.value,
    randomCount: actualCount
  })

  await showInfoDialog(`已随机抽取 ${actualCount} 道题目开始练习（候选题目 ${matchedQuestions.length} 道）`)
  startPracticeSession(randomQuestions, 'random', filters)
}

const restoreDraftById = async (draftId: string) => {
  const draft = store.getPracticeDraft(draftId)
  if (!draft) {
    await showInfoDialog('未找到该未完成练习，可能已被删除')
    return
  }

  if (!Array.isArray(draft.questions) || draft.questions.length === 0) {
    await showInfoDialog('该未完成练习没有可用题目，无法恢复')
    store.removePracticeDraft(draft.id)
    return
  }

  const boundedIndex = Math.max(0, Math.min(Number(draft.currentIndex) || 0, draft.questions.length - 1))

  practiceQuestions.value = [...draft.questions]
  currentIndex.value = boundedIndex
  answers.value = { ...draft.answers }
  showAnswer.value = Boolean(draft.showAnswer)
  selectedAnswer.value = draft.selectedAnswer || resolveSelectedAnswerByIndex(boundedIndex)
  isPracticing.value = true
  currentDraftId.value = draft.id
  setActivePracticeContext(draft.mode, draft.filters)

  selectedExamYear.value = draft.filters.examYear ?? null
  selectedExamLevel.value = draft.filters.examLevel || ''
  selectedQualificationName.value = draft.filters.qualificationName || ''
  selectedQuestionType.value = draft.filters.type || ''
  selectedCategoryId.value = draft.filters.categoryId ?? null

  randomExamYear.value = draft.filters.examYear ?? null
  randomExamLevel.value = draft.filters.examLevel || ''
  randomQualificationName.value = draft.filters.qualificationName || ''
  randomQuestionType.value = draft.filters.type || ''
  randomCategoryId.value = draft.filters.categoryId ?? null
  const randomCount = normalizeOptionalNumber(draft.filters.randomCount)
  if (randomCount !== undefined) {
    randomTotal.value = randomCount
  }

  persistActiveDraft()
}

const deleteDraftById = async (draft: PracticeDraft) => {
  const confirmed = await showConfirmDialog('确定删除该未完成练习吗？删除后不可恢复。', {
    title: '删除确认',
    confirmText: '删除',
    cancelText: '取消',
    tone: 'danger'
  })

  if (!confirmed) {
    return
  }
  store.removePracticeDraft(draft.id)
}

const updateMultipleAnswer = (optionLabel: string, checked: boolean) => {
  const current = selectedAnswer.value
    .toUpperCase()
    .split('')
    .filter((char) => /[A-Z]/.test(char))

  const next = checked
    ? Array.from(new Set([...current, optionLabel]))
    : current.filter((char) => char !== optionLabel)

  selectedAnswer.value = next.sort().join('')
}

const handleMultipleAnswerChange = (optionLabel: string, event: Event) => {
  const target = event.target as HTMLInputElement
  updateMultipleAnswer(optionLabel, target.checked)
}

const submitAnswer = () => {
  if (!currentQuestion.value) return

  const key = getQuestionKey(currentQuestion.value)
  if (!key) return

  const answer =
    currentQuestion.value.type === 'multiple'
      ? normalizeAnswer(selectedAnswer.value, 'multiple')
      : selectedAnswer.value

  answers.value = {
    ...answers.value,
    [key]: answer
  }
  selectedAnswer.value = answer
  showAnswer.value = true
  persistActiveDraft()
}

const nextQuestion = () => {
  if (currentIndex.value < practiceQuestions.value.length - 1) {
    currentIndex.value += 1
    selectedAnswer.value = resolveSelectedAnswerByIndex(currentIndex.value)
    showAnswer.value = false
    persistActiveDraft()
  }
}

const prevQuestion = () => {
  if (currentIndex.value > 0) {
    currentIndex.value -= 1
    selectedAnswer.value = resolveSelectedAnswerByIndex(currentIndex.value)
    showAnswer.value = false
    persistActiveDraft()
  }
}

const jumpToQuestion = (targetIndex: number) => {
  if (!Number.isFinite(Number(targetIndex))) {
    return
  }
  const boundedIndex = Math.max(0, Math.min(Number(targetIndex), practiceQuestions.value.length - 1))
  if (boundedIndex === currentIndex.value) {
    return
  }
  currentIndex.value = boundedIndex
  selectedAnswer.value = resolveSelectedAnswerByIndex(boundedIndex)
  showAnswer.value = false
  persistActiveDraft()
}

const endPractice = async () => {
  const confirmed = await showConfirmDialog('确定要结束练习吗？未完成进度会被清理。', {
    title: '结束确认',
    confirmText: '结束练习',
    cancelText: '继续作答',
    tone: 'danger'
  })

  if (confirmed) {
    resetPracticeState()
  }
}

const finalizePractice = async () => {
  isSavingResult.value = true

  try {
    const draftRecords = practiceQuestions.value
      .map((question, index) => {
        const questionId = Number(question.id)
        if (!Number.isFinite(questionId)) {
          return null
        }

        const key = String(questionId)
        const userAnswer = answers.value[key] || ''
        return {
          questionId,
          userAnswer,
          isCorrect: isCorrectAnswer(question, userAnswer),
          questionOrder: index + 1
        }
      })
      .filter((item): item is { questionId: number; userAnswer: string; isCorrect: boolean; questionOrder: number } => Boolean(item))

    const totalCount = draftRecords.length
    if (totalCount === 0) {
      await showInfoDialog('当前练习题目数据异常，无法保存成绩')
      return
    }

    const correctCount = draftRecords.filter((record) => record.isCorrect).length
    const accuracy = Number(((correctCount / totalCount) * 100).toFixed(2))

    await store.savePracticeResult({
      session: {
        examYear: activeDraftFilters.value.examYear,
        examLevel: activeDraftFilters.value.examLevel,
        qualificationName: activeDraftFilters.value.qualificationName,
        totalCount,
        correctCount,
        accuracy
      },
      records: draftRecords
    })

    await showDialog({
      title: '练习完成',
      message: `共 ${totalCount} 题，答对 ${correctCount} 题，正确率 ${accuracy}%`,
      confirmText: '好的',
      showCancel: false,
      tone: 'success'
    })
    resetPracticeState()
  } catch (error) {
    console.error('保存练习成绩失败:', error)
    await showInfoDialog('保存练习成绩失败，请重试', '保存失败')
  } finally {
    isSavingResult.value = false
  }
}

const getOptionLabel = (index: number) => String.fromCharCode(65 + index)

const isCorrect = (question: Question) => {
  const key = getQuestionKey(question)
  if (!key) return false
  const userAnswer = answers.value[key]
  if (!userAnswer) return false
  return isCorrectAnswer(question, userAnswer)
}

const getDraftProgress = (draft: PracticeDraft) => {
  const total = draft.questions.length
  if (total === 0) {
    return '0 / 0'
  }
  const current = Math.min((Number(draft.currentIndex) || 0) + 1, total)
  return `${current} / ${total}`
}

const getDraftAnsweredCount = (draft: PracticeDraft) => {
  return Object.values(draft.answers).filter((answer) => String(answer || '').trim().length > 0).length
}

const formatDraftFilters = (filters: PracticeDraftFilters) => {
  const segments: string[] = []
  const examYear = normalizeOptionalNumber(filters.examYear)
  const categoryId = normalizeOptionalNumber(filters.categoryId)
  const randomCount = normalizeOptionalNumber(filters.randomCount)

  if (examYear !== undefined) {
    segments.push(`年份 ${examYear}`)
  }
  if (filters.examLevel) {
    segments.push(`级别 ${filters.examLevel}`)
  }
  if (filters.qualificationName) {
    segments.push(`资格 ${filters.qualificationName}`)
  }
  if (filters.type) {
    segments.push(`题型 ${getTypeLabel(filters.type)}`)
  }
  if (categoryId !== undefined) {
    const category = availableCategories.value.find((item) => Number(item.id) === categoryId)
    if (category) {
      segments.push(`分类 ${category.name}`)
    }
  }
  if (randomCount !== undefined) {
    segments.push(`随机 ${randomCount} 题`)
  }
  return segments.length > 0 ? segments.join(' / ') : '无筛选条件'
}

const loadSetupData = async () => {
  isInitializing.value = true
  try {
    await Promise.all([store.loadQuestions(), store.loadCategories()])
    allQuestions.value = [...store.questions]
  } catch (error) {
    console.error('加载练习题源失败:', error)
    await showInfoDialog('加载练习题源失败，请稍后重试', '加载失败')
  } finally {
    isInitializing.value = false
  }
}

watch(selectedAnswer, () => {
  if (isPracticing.value) {
    persistActiveDraft()
  }
})

onMounted(() => {
  loadSetupData()
})

onBeforeUnmount(() => {
  persistActiveDraft()
})
</script>

<template>
  <div class="practice-page">
    <BaseDialog
      :visible="dialogState.visible"
      :title="dialogState.title"
      :message="dialogState.message"
      :confirm-text="dialogState.confirmText"
      :cancel-text="dialogState.cancelText"
      :show-cancel="dialogState.showCancel"
      :tone="dialogState.tone"
      @confirm="closeDialog(true)"
      @cancel="closeDialog(false)"
    />
    <div v-if="!isPracticing" class="practice-setup">
      <header class="page-header">
        <h1>做题练习</h1>
        <p class="subtitle">支持继续未完成练习、条件选题与随机选题</p>
      </header>

      <section v-if="unfinishedDrafts.length > 0" class="setup-panel draft-panel">
        <div class="panel-header">
          <h2>未完成练习</h2>
          <span class="panel-tip">支持按模式、关键词筛选</span>
        </div>

        <div class="draft-toolbar">
          <select v-model="draftModeFilter" class="form-select">
            <option value="all">全部模式</option>
            <option value="filtered">条件练习</option>
            <option value="random">随机练习</option>
          </select>

          <select v-model="draftSortType" class="form-select">
            <option value="updatedDesc">最近更新优先</option>
            <option value="updatedAsc">最早更新优先</option>
            <option value="progressDesc">进度高优先</option>
          </select>

          <input
            v-model="draftKeyword"
            type="text"
            class="draft-keyword-input"
            placeholder="搜索资格/年份/级别/题型"
          />
        </div>

        <p class="draft-summary">共 {{ unfinishedDrafts.length }} 条，当前显示 {{ filteredUnfinishedDrafts.length }} 条</p>

        <div v-if="filteredUnfinishedDrafts.length > 0" class="draft-list">
          <article v-for="draft in filteredUnfinishedDrafts" :key="draft.id" class="draft-card">
            <div class="draft-main">
              <div class="draft-title-row">
                <span class="draft-mode">{{ getPracticeModeLabel(draft.mode) }}</span>
                <span class="draft-time">{{ formatDateTime(draft.updatedAt) }}</span>
              </div>
              <p class="draft-filters">{{ formatDraftFilters(draft.filters) }}</p>
              <p class="draft-progress">
                进度 {{ getDraftProgress(draft) }} · 已答 {{ getDraftAnsweredCount(draft) }} 题
              </p>
            </div>
            <div class="draft-actions">
              <button class="btn-primary btn-sm" @click="restoreDraftById(draft.id)">继续练习</button>
              <button class="btn-danger btn-sm" @click="deleteDraftById(draft)">删除</button>
            </div>
          </article>
        </div>

        <p v-else class="empty-draft-text">没有匹配的未完成练习</p>
      </section>

      <div class="setup-grid" :class="{ loading: isInitializing }">
        <section class="setup-panel">
          <div class="panel-header">
            <h2>条件选题</h2>
            <span class="panel-tip">至少选择一个条件，加载全部匹配题目</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label>题目类型</label>
              <select v-model="selectedQuestionType" class="form-select">
                <option value="">全部题型</option>
                <option v-for="item in questionTypes" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>题目分类</label>
              <select v-model="selectedCategoryId" class="form-select">
                <option :value="null">全部分类</option>
                <option v-for="category in availableCategories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>年份</label>
              <select v-model="selectedExamYear" class="form-select">
                <option :value="null">全部年份</option>
                <option v-for="year in availableExamYears" :key="year" :value="year">{{ year }}</option>
              </select>
            </div>

            <div class="form-group">
              <label>级别</label>
              <select v-model="selectedExamLevel" class="form-select">
                <option value="">全部级别</option>
                <option v-for="level in examLevels" :key="level" :value="level">
                  {{ level }}
                </option>
              </select>
            </div>

            <div class="form-group form-group-full">
              <label>资格名称</label>
              <select v-model="selectedQualificationName" class="form-select">
                <option value="">全部资格</option>
                <option v-for="name in availableQualificationNames" :key="name" :value="name">
                  {{ name }}
                </option>
              </select>
            </div>
          </div>

          <button class="btn-primary" :disabled="!canStartFilteredPractice" @click="startFilteredPractice">
            开始条件练习
          </button>
        </section>

        <section class="setup-panel">
          <div class="panel-header">
            <h2>随机选题</h2>
            <span class="panel-tip">按筛选条件随机抽取指定数量题目</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label>题目类型</label>
              <select v-model="randomQuestionType" class="form-select">
                <option value="">全部题型</option>
                <option v-for="item in questionTypes" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>随机总数</label>
              <select v-model.number="randomTotal" class="form-select">
                <option v-for="count in randomCountOptions" :key="count" :value="count">{{ count }} 题</option>
              </select>
            </div>

            <div class="form-group">
              <label>题目分类</label>
              <select v-model="randomCategoryId" class="form-select">
                <option :value="null">全部分类</option>
                <option v-for="category in availableCategories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>年份</label>
              <select v-model="randomExamYear" class="form-select">
                <option :value="null">全部年份</option>
                <option v-for="year in availableExamYears" :key="year" :value="year">{{ year }}</option>
              </select>
            </div>

            <div class="form-group">
              <label>级别</label>
              <select v-model="randomExamLevel" class="form-select">
                <option value="">全部级别</option>
                <option v-for="level in examLevels" :key="level" :value="level">
                  {{ level }}
                </option>
              </select>
            </div>

            <div class="form-group form-group-full">
              <label>资格名称</label>
              <select v-model="randomQualificationName" class="form-select">
                <option value="">全部资格</option>
                <option v-for="name in availableQualificationNames" :key="name" :value="name">
                  {{ name }}
                </option>
              </select>
            </div>
          </div>

          <button class="btn-primary" :disabled="!canStartRandomPractice" @click="startRandomPractice">
            开始随机练习
          </button>
        </section>
      </div>

      <p class="setup-summary">当前题源总数：{{ setupQuestionCount }} 题</p>
    </div>

    <div v-else-if="currentQuestion" class="practice-container">
      <div class="practice-header">
        <div class="progress-wrapper">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progress + '%' }"></div>
            <span class="progress-text">{{ currentIndex + 1 }} / {{ practiceQuestions.length }}</span>
          </div>
          <span class="mode-pill">{{ getPracticeModeLabel(activeDraftMode) }}</span>
          <span class="answered-pill">已答 {{ currentAnsweredCount }} / {{ practiceQuestions.length }}</span>
        </div>
        <button class="btn-end" :disabled="isSavingResult" @click="endPractice">结束练习</button>
      </div>

      <div class="question-nav-wrap">
        <div class="question-nav-list">
          <button
            v-for="item in questionNavItems"
            :key="item.index"
            class="question-nav-btn"
            :class="{ active: item.active, answered: item.answered, correct: item.answeredCorrect, wrong: item.answeredWrong }"
            @click="jumpToQuestion(item.index)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="question-nav-legend">
          <span class="legend-item current">
            <i class="legend-dot"></i>
            当前
          </span>
          <span class="legend-item correct">
            <i class="legend-dot"></i>
            做对
          </span>
          <span class="legend-item wrong">
            <i class="legend-dot"></i>
            做错
          </span>
        </div>
      </div>

      <div class="question-area">
        <div class="question-header">
          <span class="question-type" :class="currentQuestion.type">
            {{ getTypeLabel(currentQuestion.type) }}
          </span>
          <span class="question-difficulty" :class="'level-' + currentQuestion.difficulty">
            {{ getDifficultyLabel(currentQuestion.difficulty) }}
          </span>
        </div>

        <h2 class="question-title">{{ currentQuestion.title }}</h2>
        <p v-if="currentQuestion.content" class="question-content">{{ currentQuestion.content }}</p>

        <div v-if="currentQuestion.type === 'single' && currentQuestion.options" class="options-list">
          <label
            v-for="(option, index) in currentQuestion.options"
            :key="index"
            class="option-item"
            :class="{
              selected: selectedAnswer === getOptionLabel(index),
              correct: showAnswer && getOptionLabel(index) === currentQuestion.answer,
              wrong: showAnswer && selectedAnswer === getOptionLabel(index) && selectedAnswer !== currentQuestion.answer
            }"
          >
            <input
              type="radio"
              :value="getOptionLabel(index)"
              v-model="selectedAnswer"
              :disabled="showAnswer || isSavingResult"
            />
            <span class="option-label">{{ getOptionLabel(index) }}.</span>
            <span class="option-text">{{ option }}</span>
          </label>
        </div>

        <div v-else-if="currentQuestion.type === 'multiple' && currentQuestion.options" class="options-list">
          <label
            v-for="(option, index) in currentQuestion.options"
            :key="index"
            class="option-item"
            :class="{
              selected: selectedAnswer.includes(getOptionLabel(index)),
              correct: showAnswer && currentQuestion.answer.includes(getOptionLabel(index)),
              wrong:
                showAnswer &&
                selectedAnswer.includes(getOptionLabel(index)) &&
                !currentQuestion.answer.includes(getOptionLabel(index))
            }"
          >
            <input
              type="checkbox"
              :checked="selectedAnswer.includes(getOptionLabel(index))"
              :disabled="showAnswer || isSavingResult"
              @change="handleMultipleAnswerChange(getOptionLabel(index), $event)"
            />
            <span class="option-label">{{ getOptionLabel(index) }}.</span>
            <span class="option-text">{{ option }}</span>
          </label>
        </div>

        <div v-else class="answer-input">
          <textarea
            v-model="selectedAnswer"
            class="form-textarea"
            rows="4"
            placeholder="请输入答案"
            :disabled="showAnswer || isSavingResult"
          ></textarea>
        </div>

        <div v-if="showAnswer" class="answer-analysis">
          <div class="correct-answer">
            <span class="label">正确答案：</span>
            <span class="value">{{ currentQuestion.answer }}</span>
            <span class="judge" :class="isCorrect(currentQuestion) ? 'ok' : 'bad'">
              {{ isCorrect(currentQuestion) ? '回答正确' : '回答错误' }}
            </span>
          </div>
          <div v-if="currentQuestion.analysis" class="analysis-content">
            <span class="label">解析：</span>
            <p>{{ currentQuestion.analysis }}</p>
          </div>
        </div>
      </div>

      <div class="practice-footer">
        <button class="btn-nav" :disabled="currentIndex === 0" @click="prevQuestion">上一题</button>

        <button v-if="!showAnswer" class="btn-submit" :disabled="!selectedAnswer.trim()" @click="submitAnswer">
          提交答案
        </button>

        <button
          v-else
          class="btn-submit"
          :disabled="isSavingResult"
          @click="currentIndex === practiceQuestions.length - 1 ? finalizePractice() : nextQuestion()"
        >
          {{ currentIndex === practiceQuestions.length - 1 ? (isSavingResult ? '保存中...' : '完成并保存成绩') : '下一题' }}
        </button>

        <button class="btn-nav" :disabled="currentIndex === practiceQuestions.length - 1 || isSavingResult" @click="nextQuestion">
          下一题
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.practice-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.subtitle {
  color: #909399;
  font-size: 14px;
}

.practice-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.setup-grid.loading {
  opacity: 0.75;
}

.setup-panel {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.panel-header h2 {
  font-size: 18px;
  color: #303133;
}

.panel-tip {
  font-size: 12px;
  color: #909399;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group-full {
  grid-column: 1 / -1;
}

.form-group label {
  font-size: 13px;
  color: #606266;
}

.form-select,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
}

.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: #409eff;
}

.setup-summary {
  font-size: 13px;
  color: #909399;
}

.draft-panel {
  gap: 12px;
}

.draft-toolbar {
  display: grid;
  grid-template-columns: 180px 180px 1fr;
  gap: 10px;
}

.draft-keyword-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
}

.draft-keyword-input:focus {
  outline: none;
  border-color: #409eff;
}

.draft-summary {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.empty-draft-text {
  margin: 0;
  color: #909399;
  font-size: 13px;
}

.draft-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.draft-card {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.draft-main {
  min-width: 0;
}

.draft-title-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.draft-mode {
  font-size: 12px;
  color: #409eff;
  background: #ecf5ff;
  border-radius: 999px;
  padding: 2px 8px;
}

.draft-time {
  font-size: 12px;
  color: #909399;
}

.draft-filters,
.draft-progress {
  margin: 0;
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
}

.draft-actions {
  display: flex;
  gap: 8px;
}

.btn-sm {
  padding: 8px 12px;
  font-size: 13px;
}

.btn-primary {
  width: 100%;
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: #f56c6c;
  color: #fff;
  cursor: pointer;
}

.practice-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.practice-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #ebeef5;
}

.progress-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.progress-bar {
  flex: 1;
  max-width: 360px;
  height: 8px;
  background: #e4e7ed;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 4px;
  transition: width 0.3s;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: #606266;
  font-weight: 500;
}

.mode-pill {
  font-size: 12px;
  color: #67c23a;
  background: #f0f9eb;
  border-radius: 999px;
  padding: 4px 10px;
}

.answered-pill {
  font-size: 12px;
  color: #409eff;
  background: #ecf5ff;
  border-radius: 999px;
  padding: 4px 10px;
}

.question-nav-wrap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid #ebeef5;
  background: #fafcff;
}

.question-nav-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.question-nav-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #606266;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  border: 1px solid transparent;
}

.legend-item.current .legend-dot {
  background: #409eff;
}

.legend-item.correct .legend-dot {
  background: #67c23a;
}

.legend-item.wrong .legend-dot {
  background: #f56c6c;
}

.question-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.question-nav-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.question-nav-btn.answered {
  border-color: #c0c4cc;
  color: #606266;
  background: #f5f7fa;
}

.question-nav-btn.correct {
  border-color: #67c23a;
  color: #67c23a;
  background: #f0f9eb;
}

.question-nav-btn.wrong {
  border-color: #f56c6c;
  color: #f56c6c;
  background: #fef0f0;
}

.question-nav-btn.active {
  border-color: #409eff;
  background: #409eff;
  color: #fff;
}

.btn-end {
  padding: 8px 16px;
  background: #fef0f0;
  color: #f56c6c;
  border: 1px solid #fde2e2;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-end:hover {
  background: #f56c6c;
  color: white;
}

.question-area {
  flex: 1;
  padding: 32px;
  overflow-y: auto;
}

.question-header {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.question-type {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.question-type.single {
  background: #e6f7ff;
  color: #1890ff;
}

.question-type.multiple {
  background: #f6ffed;
  color: #52c41a;
}

.question-type.fill {
  background: #fff7e6;
  color: #fa8c16;
}

.question-type.essay {
  background: #f9f0ff;
  color: #722ed1;
}

.question-difficulty {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
}

.question-difficulty.level-1 {
  background: #f0f9eb;
  color: #67c23a;
}

.question-difficulty.level-2 {
  background: #fdf6ec;
  color: #e6a23c;
}

.question-difficulty.level-3 {
  background: #fef0f0;
  color: #f56c6c;
}

.question-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
  line-height: 1.5;
}

.question-content {
  font-size: 15px;
  color: #606266;
  margin-bottom: 24px;
  line-height: 1.6;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.option-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 2px solid #e4e7ed;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.option-item:hover:not(.selected) {
  border-color: #409eff;
  background: #f5f7fa;
}

.option-item.selected {
  border-color: #409eff;
  background: #f0f9ff;
}

.option-item.correct {
  border-color: #67c23a;
  background: #f0f9eb;
}

.option-item.wrong {
  border-color: #f56c6c;
  background: #fef0f0;
}

.option-item input {
  margin-top: 2px;
}

.option-label {
  font-weight: 600;
  color: #303133;
  min-width: 20px;
}

.option-text {
  flex: 1;
  color: #606266;
  line-height: 1.5;
}

.answer-input {
  margin-bottom: 24px;
}

.form-textarea {
  resize: vertical;
  min-height: 120px;
}

.answer-analysis {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 20px;
  margin-top: 24px;
}

.correct-answer {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.correct-answer .label {
  font-weight: 500;
  color: #303133;
}

.correct-answer .value {
  color: #67c23a;
  font-weight: 600;
  font-size: 16px;
}

.judge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
}

.judge.ok {
  color: #67c23a;
  background: #f0f9eb;
}

.judge.bad {
  color: #f56c6c;
  background: #fef0f0;
}

.analysis-content .label {
  font-weight: 500;
  color: #303133;
}

.analysis-content p {
  margin-top: 8px;
  color: #606266;
  line-height: 1.6;
}

.practice-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 16px 24px;
  border-top: 1px solid #ebeef5;
}

.btn-nav {
  padding: 12px 24px;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-nav:hover:not(:disabled) {
  background: #e4e7ed;
}

.btn-nav:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-submit {
  padding: 12px 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-submit:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 1280px) {
  .setup-grid {
    grid-template-columns: 1fr;
  }

  .draft-toolbar {
    grid-template-columns: 1fr;
  }

  .question-nav-wrap {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
