<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ExtractedQuestion, ExtractedCategory } from '../types/ai'

const props = defineProps<{
  questions: ExtractedQuestion[]
  categories: ExtractedCategory[]
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const selectedQuestions = ref<Set<number>>(new Set())
const expandedQuestions = ref<Set<number>>(new Set())
const editingIndex = ref<number | null>(null)
const editForm = ref<ExtractedQuestion | null>(null)

// 全选状态
const allSelected = computed(() =>
  props.questions.length > 0 && selectedQuestions.value.size === props.questions.length
)

// 切换全选
const toggleSelectAll = () => {
  if (allSelected.value) {
    selectedQuestions.value.clear()
  } else {
    selectedQuestions.value = new Set(props.questions.map((_, i) => i))
  }
}

// 切换单个选择
const toggleSelect = (index: number) => {
  if (selectedQuestions.value.has(index)) {
    selectedQuestions.value.delete(index)
  } else {
    selectedQuestions.value.add(index)
  }
}

// 切换展开
const toggleExpand = (index: number) => {
  if (expandedQuestions.value.has(index)) {
    expandedQuestions.value.delete(index)
  } else {
    expandedQuestions.value.add(index)
  }
}

// 开始编辑
const startEdit = (index: number) => {
  editingIndex.value = index
  editForm.value = { ...props.questions[index] }
}

// 保存编辑
const saveEdit = () => {
  if (editingIndex.value !== null && editForm.value) {
    props.questions[editingIndex.value] = editForm.value
    editingIndex.value = null
    editForm.value = null
  }
}

// 取消编辑
const cancelEdit = () => {
  editingIndex.value = null
  editForm.value = null
}

// 删除题目
const removeQuestion = (index: number) => {
  props.questions.splice(index, 1)
  selectedQuestions.value.delete(index)
}

// 获取类型标签
const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    single: '单选题',
    multiple: '多选题',
    fill: '填空题',
    essay: '简答题'
  }
  return labels[type] || type
}

// 获取类型样式
const getTypeClass = (type: string) => type

// 获取难度标签
const getDifficultyLabel = (level?: number) => {
  const labels = ['', '简单', '中等', '困难']
  return labels[level || 1] || '未知'
}

// 确认导入
const handleConfirm = () => {
  // 只保留选中的题目
  if (selectedQuestions.value.size > 0 && selectedQuestions.value.size < props.questions.length) {
    const selected = Array.from(selectedQuestions.value).sort((a, b) => b - a)
    const newQuestions: ExtractedQuestion[] = []
    for (const index of selected) {
      newQuestions.unshift(props.questions[index])
    }
    props.questions.length = 0
    props.questions.push(...newQuestions)
  }
  emit('confirm')
}
</script>

<template>
  <div class="question-list">
    <div class="list-header">
      <div class="header-info">
        <h3>识别结果</h3>
        <span class="count">共 {{ questions.length }} 道题目</span>
      </div>
      <div class="header-actions">
        <label class="select-all">
          <input
            type="checkbox"
            :checked="allSelected"
            @change="toggleSelectAll"
          />
          <span>全选</span>
        </label>
      </div>
    </div>

    <!-- 分类列表 -->
    <div v-if="categories.length > 0" class="category-section">
      <h4>识别到的分类</h4>
      <div class="category-tags">
        <span v-for="cat in categories" :key="cat.name" class="category-tag">
          {{ cat.name }}
          <span v-if="cat.parentName" class="parent">({{ cat.parentName }})</span>
        </span>
      </div>
    </div>

    <!-- 题目列表 -->
    <div class="questions-container">
      <div
        v-for="(question, index) in questions"
        :key="index"
        class="question-card"
        :class="{ selected: selectedQuestions.has(index), expanded: expandedQuestions.has(index) }"
      >
        <!-- 卡片头部 -->
        <div class="card-header">
          <label class="checkbox-wrapper">
            <input
              type="checkbox"
              :checked="selectedQuestions.has(index)"
              @change="toggleSelect(index)"
            />
          </label>

          <span class="question-type" :class="getTypeClass(question.type)">
            {{ getTypeLabel(question.type) }}
          </span>

          <span v-if="question.difficulty" class="difficulty">
            {{ getDifficultyLabel(question.difficulty) }}
          </span>

          <span v-if="question.categoryName" class="category-name">
            {{ question.categoryName }}
          </span>

          <div class="card-actions">
            <button class="btn-icon" @click="toggleExpand(index)">
              {{ expandedQuestions.has(index) ? '收起' : '展开' }}
            </button>
            <button class="btn-icon" @click="startEdit(index)">编辑</button>
            <button class="btn-icon danger" @click="removeQuestion(index)">删除</button>
          </div>
        </div>

        <!-- 卡片内容 -->
        <div v-if="editingIndex !== index" class="card-content">
          <h4 class="question-title">{{ question.title }}</h4>
          <p v-if="question.content" class="question-content">{{ question.content }}</p>

          <!-- 选项 -->
          <div v-if="question.options && question.options.length > 0" class="options-list">
            <div
              v-for="(option, optIndex) in question.options"
              :key="optIndex"
              class="option-item"
              :class="{ correct: question.answer.includes(String.fromCharCode(65 + optIndex)) }"
            >
              <span class="option-label">{{ String.fromCharCode(65 + optIndex) }}.</span>
              <span class="option-text">{{ option }}</span>
            </div>
          </div>

          <!-- 展开详情 -->
          <div v-if="expandedQuestions.has(index)" class="question-details">
            <div class="detail-row">
              <span class="detail-label">答案：</span>
              <span class="detail-value answer">{{ question.answer }}</span>
            </div>
            <div v-if="question.analysis" class="detail-row">
              <span class="detail-label">解析：</span>
              <span class="detail-value">{{ question.analysis }}</span>
            </div>
            <div v-if="question.source" class="detail-row">
              <span class="detail-label">来源：</span>
              <span class="detail-value">{{ question.source }}</span>
            </div>
          </div>
        </div>

        <!-- 编辑表单 -->
        <div v-else class="edit-form">
          <div class="form-group">
            <label>标题</label>
            <input v-model="editForm!.title" type="text" />
          </div>
          <div class="form-group">
            <label>内容</label>
            <textarea v-model="editForm!.content" rows="3"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>类型</label>
              <select v-model="editForm!.type">
                <option value="single">单选题</option>
                <option value="multiple">多选题</option>
                <option value="fill">填空题</option>
                <option value="essay">简答题</option>
              </select>
            </div>
            <div class="form-group">
              <label>答案</label>
              <input v-model="editForm!.answer" type="text" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" @click="cancelEdit">取消</button>
            <button class="btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="list-footer">
      <div class="selection-info">
        已选择 {{ selectedQuestions.size }} 道题目
      </div>
      <div class="footer-actions">
        <button class="btn-secondary" @click="$emit('cancel')">取消</button>
        <button class="btn-primary" @click="handleConfirm" :disabled="selectedQuestions.size === 0">
          确认导入 ({{ selectedQuestions.size }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.question-list {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-info h3 {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.count {
  font-size: 14px;
  color: #909399;
}

.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #606266;
}

/* 分类部分 */
.category-section {
  padding: 16px 24px;
  border-bottom: 1px solid #e4e7ed;
  background: #f5f7fa;
}

.category-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #606266;
}

.category-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-tag {
  padding: 6px 12px;
  background: white;
  border-radius: 16px;
  font-size: 13px;
  color: #409eff;
  border: 1px solid #d9ecff;
}

.category-tag .parent {
  color: #909399;
  margin-left: 4px;
}

/* 题目容器 */
.questions-container {
  max-height: 500px;
  overflow-y: auto;
  padding: 16px;
}

.question-card {
  border: 2px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.2s;
}

.question-card:hover {
  border-color: #c0c4cc;
}

.question-card.selected {
  border-color: #409eff;
  background: #f0f9ff;
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.checkbox-wrapper {
  display: flex;
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

.difficulty {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: #f5f7fa;
  color: #606266;
}

.category-name {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  background: #ecf5ff;
  color: #409eff;
}

.card-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.btn-icon {
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
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

/* 卡片内容 */
.card-content {
  padding-left: 28px;
}

.question-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 500;
  color: #303133;
  line-height: 1.5;
}

.question-content {
  margin: 0 0 12px;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

/* 选项列表 */
.options-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 14px;
}

.option-item.correct {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}

.option-label {
  font-weight: 600;
  color: #909399;
}

.option-item.correct .option-label {
  color: #52c41a;
}

/* 详情 */
.question-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #dcdfe6;
}

.detail-row {
  display: flex;
  margin-bottom: 8px;
  font-size: 14px;
}

.detail-label {
  color: #909399;
  min-width: 60px;
}

.detail-value {
  color: #606266;
}

.detail-value.answer {
  color: #67c23a;
  font-weight: 500;
}

/* 编辑表单 */
.edit-form {
  padding-left: 28px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 14px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* 底部操作栏 */
.list-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-top: 1px solid #e4e7ed;
  background: #f5f7fa;
  border-radius: 0 0 12px 12px;
}

.selection-info {
  font-size: 14px;
  color: #606266;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary {
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
