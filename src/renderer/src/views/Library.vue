<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useQuestionStore } from '../stores/questionStore'
import type { Question, ExamLevel } from '../types'
import QuestionForm from '../components/QuestionForm.vue'
import BaseDialog from '../components/BaseDialog.vue'
import { useDialog } from '../composables/useDialog'

const store = useQuestionStore()

const searchKeyword = ref('')
const selectedType = ref('')
const selectedCategory = ref<number | null>(null)
const selectedExamYear = ref<number | null>(null)
const selectedExamLevel = ref<ExamLevel | ''>('')
const qualificationKeyword = ref('')
const examLevels: ExamLevel[] = ['初级', '中级', '高级']
const showAddModal = ref(false)
const editingQuestion = ref<Question | null>(null)
const selectedQuestionIds = ref<Set<number>>(new Set())
const isBatchDeleting = ref(false)

const { dialogState, closeDialog, showConfirmDialog } = useDialog()

const questionTypes = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'fill', label: '填空题' },
  { value: 'essay', label: '简答题' }
]

const filteredQuestions = computed(() => {
  let result = store.questions
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(q =>
      q.title.toLowerCase().includes(keyword) ||
      q.content?.toLowerCase().includes(keyword)
    )
  }
  if (selectedType.value) {
    result = result.filter(q => q.type === selectedType.value)
  }
  if (selectedCategory.value) {
    result = result.filter(q => q.categoryId === selectedCategory.value)
  }
  if (selectedExamYear.value) {
    result = result.filter(q => Number(q.examYear) === Number(selectedExamYear.value))
  }
  if (selectedExamLevel.value) {
    result = result.filter(q => q.examLevel === selectedExamLevel.value)
  }
  if (qualificationKeyword.value.trim()) {
    const keyword = qualificationKeyword.value.trim().toLowerCase()
    result = result.filter(q => q.qualificationName?.toLowerCase().includes(keyword))
  }
  return result
})

onMounted(() => {
  store.loadQuestions()
})

watch(
  () => filteredQuestions.value.map((q) => Number(q.id)).filter((id) => Number.isFinite(id)),
  (visibleIds) => {
    selectedQuestionIds.value = new Set(
      Array.from(selectedQuestionIds.value).filter((id) => visibleIds.includes(id))
    )
  },
  { immediate: true }
)

const handleSearch = () => {
  store.loadQuestions({
    keyword: searchKeyword.value,
    type: selectedType.value || undefined,
    categoryId: selectedCategory.value || undefined,
    examYear: selectedExamYear.value || undefined,
    examLevel: selectedExamLevel.value || undefined,
    qualificationKeyword: qualificationKeyword.value.trim() || undefined
  })
}

const visibleQuestionIds = computed(() =>
  filteredQuestions.value
    .map((q) => Number(q.id))
    .filter((id) => Number.isFinite(id))
)

const allVisibleSelected = computed(() =>
  visibleQuestionIds.value.length > 0 &&
  visibleQuestionIds.value.every((id) => selectedQuestionIds.value.has(id))
)

const toggleSelectAllVisible = () => {
  if (allVisibleSelected.value) {
    selectedQuestionIds.value = new Set(
      Array.from(selectedQuestionIds.value).filter((id) => !visibleQuestionIds.value.includes(id))
    )
    return
  }

  selectedQuestionIds.value = new Set([
    ...Array.from(selectedQuestionIds.value),
    ...visibleQuestionIds.value
  ])
}

const toggleSelectQuestion = (id: number) => {
  if (!Number.isFinite(id)) {
    return
  }

  if (selectedQuestionIds.value.has(id)) {
    selectedQuestionIds.value = new Set(Array.from(selectedQuestionIds.value).filter((item) => item !== id))
    return
  }

  selectedQuestionIds.value = new Set([...Array.from(selectedQuestionIds.value), id])
}

const handleDeleteSelected = async () => {
  if (selectedQuestionIds.value.size === 0 || isBatchDeleting.value) {
    return
  }

  const ids = Array.from(selectedQuestionIds.value)
  const confirmed = await showConfirmDialog(`确定要删除已选择的 ${ids.length} 道题目吗？此操作不可恢复。`, {
    title: '批量删除确认',
    confirmText: '删除',
    cancelText: '取消',
    tone: 'danger'
  })

  if (!confirmed) {
    return
  }

  isBatchDeleting.value = true
  try {
    for (const id of ids) {
      await store.deleteQuestion(id)
    }
    selectedQuestionIds.value = new Set()
  } finally {
    isBatchDeleting.value = false
  }
}

const handleEdit = (question: Question) => {
  editingQuestion.value = { ...question }
  showAddModal.value = true
}

const handleDelete = async (id: number) => {
  const confirmed = await showConfirmDialog('确定要删除这道题目吗？', {
    title: '删除确认',
    confirmText: '删除',
    cancelText: '取消',
    tone: 'danger'
  })

  if (confirmed) {
    await store.deleteQuestion(id)
  }
}

const getTypeLabel = (type: string) => {
  return questionTypes.find(t => t.value === type)?.label || type
}

const getDifficultyLabel = (level: number) => {
  const labels = ['', '简单', '中等', '困难']
  return labels[level] || '未知'
}
</script>

<template>
  <div class="library-page">
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
    <header class="page-header">
      <h1>题库管理</h1>
      <button class="btn-primary" @click="showAddModal = true; editingQuestion = null">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
        添加题目
      </button>
    </header>

    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input
          v-model="searchKeyword"
          type="text"
          placeholder="搜索题目..."
          @keyup.enter="handleSearch"
        />
      </div>

      <select v-model="selectedType" class="filter-select" @change="handleSearch">
        <option value="">全部类型</option>
        <option v-for="t in questionTypes" :key="t.value" :value="t.value">
          {{ t.label }}
        </option>
      </select>

      <select v-model="selectedCategory" class="filter-select" @change="handleSearch">
        <option :value="null">全部分类</option>
        <option v-for="c in store.categories" :key="c.id" :value="c.id">
          {{ c.name }}
        </option>
      </select>

      <input
        v-model.number="selectedExamYear"
        type="number"
        min="1900"
        max="2100"
        class="filter-input"
        placeholder="年份"
        @keyup.enter="handleSearch"
      />

      <select v-model="selectedExamLevel" class="filter-select" @change="handleSearch">
        <option value="">全部级别</option>
        <option v-for="level in examLevels" :key="level" :value="level">
          {{ level }}
        </option>
      </select>

      <input
        v-model="qualificationKeyword"
        type="text"
        class="filter-input"
        placeholder="资格名称关键词"
        @keyup.enter="handleSearch"
      />

      <button class="btn-secondary" @click="handleSearch">搜索</button>
    </div>

    <div v-if="filteredQuestions.length > 0" class="batch-toolbar">
      <label class="select-all-label">
        <input type="checkbox" :checked="allVisibleSelected" @change="toggleSelectAllVisible" />
        <span>全选当前列表 ({{ visibleQuestionIds.length }})</span>
      </label>
      <span class="selected-count">已选 {{ selectedQuestionIds.size }} 道</span>
      <button
        class="btn-danger"
        :disabled="selectedQuestionIds.size === 0 || isBatchDeleting"
        @click="handleDeleteSelected"
      >
        {{ isBatchDeleting ? '删除中...' : `删除已选 (${selectedQuestionIds.size})` }}
      </button>
    </div>

    <div class="question-list">
      <div v-if="store.isLoading" class="loading-state">
        加载中...
      </div>

      <div v-else-if="filteredQuestions.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="#c0c4cc">
          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
        </svg>
        <p>暂无题目</p>
        <button class="btn-primary" @click="showAddModal = true">添加第一道题目</button>
      </div>

      <div v-else class="question-cards">
        <div
          v-for="question in filteredQuestions"
          :key="question.id"
          class="question-card"
          :class="{ selected: question.id && selectedQuestionIds.has(question.id) }"
        >
          <div class="question-header">
            <label class="question-select-label" :title="`选择题目 #${question.id}`">
              <input
                type="checkbox"
                :checked="question.id ? selectedQuestionIds.has(question.id) : false"
                @change="question.id && toggleSelectQuestion(question.id)"
              />
            </label>
            <span class="question-type" :class="question.type">
              {{ getTypeLabel(question.type) }}
            </span>
            <span class="question-difficulty" :class="'level-' + question.difficulty">
              {{ getDifficultyLabel(question.difficulty) }}
            </span>
          </div>
          <h3 class="question-title">{{ question.title }}</h3>
          <p v-if="question.content" class="question-content">{{ question.content }}</p>
          <div class="question-meta" v-if="question.examYear || question.examLevel || question.qualificationName">
            <span v-if="question.examYear" class="meta-tag">年份: {{ question.examYear }}</span>
            <span v-if="question.examLevel" class="meta-tag">级别: {{ question.examLevel }}</span>
            <span v-if="question.qualificationName" class="meta-tag">资格: {{ question.qualificationName }}</span>
          </div>
          <div class="question-footer">
            <span class="question-source" v-if="question.source">来源: {{ question.source }}</span>
            <div class="question-actions">
              <button class="btn-icon" @click="handleEdit(question)" title="编辑">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
              </button>
              <button class="btn-icon danger" @click="handleDelete(question.id!)" title="删除">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加/编辑题目弹窗 -->
    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editingQuestion ? '编辑题目' : '添加题目' }}</h2>
          <button class="btn-close" @click="showAddModal = false">×</button>
        </div>
        <QuestionForm
          :question="editingQuestion"
          @submit="showAddModal = false"
          @cancel="showAddModal = false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.library-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f5f7fa;
}

.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 10px 0;
  outline: none;
  font-size: 14px;
}

.filter-select,
.filter-input {
  padding: 10px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: white;
  font-size: 14px;
}

.filter-select {
  cursor: pointer;
}

.batch-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.select-all-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #606266;
  font-size: 14px;
}

.selected-count {
  color: #909399;
  font-size: 14px;
}

.question-list {
  flex: 1;
  overflow-y: auto;
}

.question-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 16px;
}

.question-card {
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  transition: box-shadow 0.2s;
}

.question-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.question-card.selected {
  border: 1px solid #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15);
}

.question-header {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}

.question-select-label {
  display: inline-flex;
  align-items: center;
}

.question-type {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.question-type.single { background: #e6f7ff; color: #1890ff; }
.question-type.multiple { background: #f6ffed; color: #52c41a; }
.question-type.fill { background: #fff7e6; color: #fa8c16; }
.question-type.essay { background: #f9f0ff; color: #722ed1; }

.question-difficulty {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
}

.question-difficulty.level-1 { background: #f0f9eb; color: #67c23a; }
.question-difficulty.level-2 { background: #fdf6ec; color: #e6a23c; }
.question-difficulty.level-3 { background: #fef0f0; color: #f56c6c; }

.question-title {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
  line-height: 1.4;
}

.question-content {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.question-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.meta-tag {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
}

.question-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.question-source {
  font-size: 12px;
  color: #909399;
}

.question-actions {
  display: flex;
  gap: 8px;
}

.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  padding: 10px 20px;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-danger {
  padding: 8px 14px;
  background: #f56c6c;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  padding: 6px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #909399;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #f5f7fa;
  color: #409eff;
}

.btn-icon.danger:hover {
  color: #f56c6c;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: #909399;
}

.empty-state p {
  margin: 16px 0;
  font-size: 16px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #ebeef5;
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
}

.btn-close {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  font-size: 24px;
  color: #909399;
  cursor: pointer;
  border-radius: 4px;
}

.btn-close:hover {
  background: #f5f7fa;
}
</style>