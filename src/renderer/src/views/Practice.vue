<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useQuestionStore, type Question } from '../stores/questionStore'

const store = useQuestionStore()

// 练习状态
const isPracticing = ref(false)
const currentIndex = ref(0)
const selectedAnswer = ref('')
const showAnswer = ref(false)
const practiceQuestions = ref<Question[]>([])
const answers = ref<Map<number, string>>(new Map())

// 筛选条件
const selectedType = ref('')
const selectedCategory = ref<number | null>(null)
const questionCount = ref(10)

const questionTypes = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'fill', label: '填空题' },
  { value: 'essay', label: '简答题' }
]

// 当前题目
const currentQuestion = computed(() => {
  if (!isPracticing.value || practiceQuestions.value.length === 0) return null
  return practiceQuestions.value[currentIndex.value]
})

// 进度
const progress = computed(() => {
  if (practiceQuestions.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / practiceQuestions.value.length) * 100)
})

// 开始练习
const startPractice = async () => {
  await store.loadQuestions({
    type: selectedType.value || undefined,
    categoryId: selectedCategory.value || undefined,
    limit: questionCount.value
  })

  if (store.questions.length === 0) {
    alert('没有符合条件的题目，请调整筛选条件')
    return
  }

  // 随机打乱题目顺序
  practiceQuestions.value = [...store.questions].sort(() => Math.random() - 0.5)
  isPracticing.value = true
  currentIndex.value = 0
  selectedAnswer.value = ''
  showAnswer.value = false
  answers.value = new Map()
}

// 提交答案
const submitAnswer = () => {
  if (!currentQuestion.value) return
  answers.value.set(currentQuestion.value.id!, selectedAnswer.value)
  showAnswer.value = true
}

// 下一题
const nextQuestion = () => {
  if (currentIndex.value < practiceQuestions.value.length - 1) {
    currentIndex.value++
    selectedAnswer.value = answers.value.get(practiceQuestions.value[currentIndex.value].id!) || ''
    showAnswer.value = false
  }
}

// 上一题
const prevQuestion = () => {
  if (currentIndex.value > 0) {
    currentIndex.value--
    selectedAnswer.value = answers.value.get(practiceQuestions.value[currentIndex.value].id!) || ''
    showAnswer.value = false
  }
}

// 结束练习
const endPractice = () => {
  if (confirm('确定要结束练习吗？')) {
    isPracticing.value = false
    practiceQuestions.value = []
    currentIndex.value = 0
    selectedAnswer.value = ''
    showAnswer.value = false
    answers.value = new Map()
  }
}

// 获取选项标签
const getOptionLabel = (index: number) => {
  return String.fromCharCode(65 + index)
}

// 检查答案是否正确
const isCorrect = (question: Question) => {
  const userAnswer = answers.value.get(question.id!)
  if (!userAnswer) return false
  return userAnswer.toLowerCase().trim() === question.answer.toLowerCase().trim()
}

onMounted(() => {
  store.loadCategories()
})
</script>

<template>
  <div class="practice-page">
    <!-- 练习设置界面 -->
    <div v-if="!isPracticing" class="practice-setup">
      <header class="page-header">
        <h1>做题练习</h1>
        <p class="subtitle">选择练习条件，开始答题</p>
      </header>

      <div class="setup-form">
        <div class="form-group">
          <label>题目类型</label>
          <select v-model="selectedType" class="form-select">
            <option value="">全部类型</option>
            <option v-for="t in questionTypes" :key="t.value" :value="t.value">
              {{ t.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>题目分类</label>
          <select v-model="selectedCategory" class="form-select">
            <option :value="null">全部分类</option>
            <option v-for="c in store.categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>题目数量</label>
          <input v-model.number="questionCount" type="number" min="1" max="50" class="form-input" />
        </div>

        <button class="btn-start" @click="startPractice">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          开始练习
        </button>
      </div>
    </div>

    <!-- 练习界面 -->
    <div v-else-if="currentQuestion" class="practice-container">
      <!-- 进度条 -->
      <div class="practice-header">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          <span class="progress-text">{{ currentIndex + 1 }} / {{ practiceQuestions.length }}</span>
        </div>
        <button class="btn-end" @click="endPractice">结束练习</button>
      </div>

      <!-- 题目区域 -->
      <div class="question-area">
        <div class="question-header">
          <span class="question-type" :class="currentQuestion.type">
            {{ questionTypes.find(t => t.value === currentQuestion?.type)?.label }}
          </span>
          <span class="question-difficulty" :class="'level-' + currentQuestion.difficulty">
            {{ ['', '简单', '中等', '困难'][currentQuestion.difficulty] }}
          </span>
        </div>

        <h2 class="question-title">{{ currentQuestion.title }}</h2>
        <p v-if="currentQuestion.content" class="question-content">{{ currentQuestion.content }}</p>

        <!-- 单选题 -->
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
              :disabled="showAnswer"
            />
            <span class="option-label">{{ getOptionLabel(index) }}.</span>
            <span class="option-text">{{ option }}</span>
          </label>
        </div>

        <!-- 多选题 -->
        <div v-else-if="currentQuestion.type === 'multiple' && currentQuestion.options" class="options-list">
          <label
            v-for="(option, index) in currentQuestion.options"
            :key="index"
            class="option-item"
            :class="{
              selected: selectedAnswer.includes(getOptionLabel(index)),
              correct: showAnswer && currentQuestion.answer.includes(getOptionLabel(index)),
              wrong: showAnswer && selectedAnswer.includes(getOptionLabel(index)) && !currentQuestion.answer.includes(getOptionLabel(index))
            }"
          >
            <input
              type="checkbox"
              :value="getOptionLabel(index)"
              v-model="selectedAnswer"
              :disabled="showAnswer"
            />
            <span class="option-label">{{ getOptionLabel(index) }}.</span>
            <span class="option-text">{{ option }}</span>
          </label>
        </div>

        <!-- 填空题和简答题 -->
        <div v-else class="answer-input">
          <textarea
            v-model="selectedAnswer"
            class="form-textarea"
            rows="4"
            placeholder="请输入答案"
            :disabled="showAnswer"
          ></textarea>
        </div>

        <!-- 答案解析 -->
        <div v-if="showAnswer" class="answer-analysis">
          <div class="correct-answer">
            <span class="label">正确答案：</span>
            <span class="value">{{ currentQuestion.answer }}</span>
          </div>
          <div v-if="currentQuestion.analysis" class="analysis-content">
            <span class="label">解析：</span>
            <p>{{ currentQuestion.analysis }}</p>
          </div>
        </div>
      </div>

      <!-- 底部导航 -->
      <div class="practice-footer">
        <button
          class="btn-nav"
          :disabled="currentIndex === 0"
          @click="prevQuestion"
        >
          上一题
        </button>

        <button
          v-if="!showAnswer"
          class="btn-submit"
          :disabled="!selectedAnswer"
          @click="submitAnswer"
        >
          提交答案
        </button>

        <button
          v-else
          class="btn-submit"
          :disabled="currentIndex === practiceQuestions.length - 1"
          @click="nextQuestion"
        >
          {{ currentIndex === practiceQuestions.length - 1 ? '已完成' : '下一题' }}
        </button>

        <button
          class="btn-nav"
          :disabled="currentIndex === practiceQuestions.length - 1"
          @click="nextQuestion"
        >
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
  margin-bottom: 24px;
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

.setup-form {
  background: white;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  max-width: 500px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.form-select,
.form-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-select:focus,
.form-input:focus {
  outline: none;
  border-color: #409eff;
}

.btn-start {
  width: 100%;
  padding: 14px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.2s;
}

.btn-start:hover {
  opacity: 0.9;
}

/* 练习界面 */
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

.progress-bar {
  flex: 1;
  max-width: 300px;
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

.question-type.single { background: #e6f7ff; color: #1890ff; }
.question-type.multiple { background: #f6ffed; color: #52c41a; }
.question-type.fill { background: #fff7e6; color: #fa8c16; }
.question-type.essay { background: #f9f0ff; color: #722ed1; }

.question-difficulty {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
}

.question-difficulty.level-1 { background: #f0f9eb; color: #67c23a; }
.question-difficulty.level-2 { background: #fdf6ec; color: #e6a23c; }
.question-difficulty.level-3 { background: #fef0f0; color: #f56c6c; }

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

.option-item:hover:not(.selected):not([disabled]) {
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
  width: 100%;
  padding: 16px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  font-size: 14px;
  resize: vertical;
  min-height: 120px;
}

.form-textarea:focus {
  outline: none;
  border-color: #409eff;
}

.answer-analysis {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 20px;
  margin-top: 24px;
}

.correct-answer {
  margin-bottom: 12px;
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
</style>
