<script setup lang="ts">
import { ref, watch } from 'vue'
import { useQuestionStore } from '../stores/questionStore'
import type { Question } from '../types'
import BaseDialog from './BaseDialog.vue'
import { useDialog } from '../composables/useDialog'

const props = defineProps<{
  question?: Question | null
}>()

const emit = defineEmits<{
  submit: []
  cancel: []
}>()

const store = useQuestionStore()
const { dialogState, closeDialog, showInfoDialog } = useDialog()

const form = ref<Question>({
  title: '',
  content: '',
  type: 'single',
  options: ['', '', '', ''],
  answer: '',
  analysis: '',
  categoryId: undefined,
  difficulty: 1,
  source: ''
})

const questionTypes = [
  { value: 'single', label: '单选题' },
  { value: 'multiple', label: '多选题' },
  { value: 'fill', label: '填空题' },
  { value: 'essay', label: '简答题' }
]

const resetForm = () => {
  form.value = {
    title: '',
    content: '',
    type: 'single',
    options: ['', '', '', ''],
    answer: '',
    analysis: '',
    categoryId: undefined,
    difficulty: 1,
    source: ''
  }
}

// 编辑模式下填充表单
watch(() => props.question, (newVal) => {
  if (newVal) {
    form.value = {
      ...newVal,
      options: newVal.options ? [...newVal.options] : ['', '', '', '']
    }
  } else {
    resetForm()
  }
}, { immediate: true })

const addOption = () => {
  form.value.options?.push('')
}

const removeOption = (index: number) => {
  form.value.options?.splice(index, 1)
}

const handleSubmit = async () => {
  try {
    // 清理选项（填空题和简答题不需要选项）
    const submitData = { ...form.value }
    if (submitData.type === 'fill' || submitData.type === 'essay') {
      submitData.options = undefined
    }

    if (props.question?.id) {
      await store.updateQuestion({ ...submitData, id: props.question.id })
    } else {
      await store.addQuestion(submitData)
    }
    emit('submit')
    resetForm()
  } catch (error) {
    console.error('保存题目失败:', error)
    await showInfoDialog('保存失败，请检查输入', '保存失败')
  }
}
</script>

<template>
  <form class="question-form" @submit.prevent="handleSubmit">
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
    <div class="form-body">
      <div class="form-group">
        <label>题目类型 <span class="required">*</span></label>
        <select v-model="form.type" class="form-select">
          <option v-for="t in questionTypes" :key="t.value" :value="t.value">
            {{ t.label }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>题目标题 <span class="required">*</span></label>
        <input
          v-model="form.title"
          type="text"
          class="form-input"
          placeholder="请输入题目标题"
          required
        />
      </div>

      <div class="form-group">
        <label>题目内容</label>
        <textarea
          v-model="form.content"
          class="form-textarea"
          rows="3"
          placeholder="请输入题目详细内容（可选）"
        />
      </div>

      <!-- 单选题和多选题的选项 -->
      <div v-if="form.type === 'single' || form.type === 'multiple'" class="form-group">
        <label>选项 <span class="required">*</span></label>
        <div class="options-list">
          <div
            v-for="(option, index) in form.options"
            :key="index"
            class="option-item"
          >
            <span class="option-label">{{ String.fromCharCode(65 + index) }}.</span>
            <input
              v-model="form.options![index]"
              type="text"
              class="form-input"
              :placeholder="`选项 ${String.fromCharCode(65 + index)}`"
              required
            />
            <button
              v-if="form.options!.length > 2"
              type="button"
              class="btn-remove"
              @click="removeOption(index)"
            >
              ×
            </button>
          </div>
        </div>
        <button type="button" class="btn-add" @click="addOption">
          + 添加选项
        </button>
      </div>

      <div class="form-group">
        <label>
          {{ form.type === 'single' ? '正确答案（填写选项字母，如 A）' :
             form.type === 'multiple' ? '正确答案（填写选项字母，如 AB）' :
             '正确答案' }}
          <span class="required">*</span>
        </label>
        <input
          v-model="form.answer"
          type="text"
          class="form-input"
          :placeholder="form.type === 'single' ? '如：A' : form.type === 'multiple' ? '如：ABC' : '请输入正确答案'"
          required
        />
      </div>

      <div class="form-group">
        <label>答案解析</label>
        <textarea
          v-model="form.analysis"
          class="form-textarea"
          rows="3"
          placeholder="请输入答案解析（可选）"
        />
      </div>

      <div class="form-row">
        <div class="form-group half">
          <label>分类</label>
          <select v-model="form.categoryId" class="form-select">
            <option :value="undefined">未分类</option>
            <option v-for="c in store.categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>

        <div class="form-group half">
          <label>难度</label>
          <select v-model="form.difficulty" class="form-select">
            <option :value="1">简单</option>
            <option :value="2">中等</option>
            <option :value="3">困难</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>来源</label>
        <input
          v-model="form.source"
          type="text"
          class="form-input"
          placeholder="题目来源（可选）"
        />
      </div>
    </div>

    <div class="form-footer">
      <button type="button" class="btn-secondary" @click="$emit('cancel')">
        取消
      </button>
      <button type="submit" class="btn-primary">
        {{ question ? '保存' : '添加' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.question-form {
  padding: 20px;
}

.form-body {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.required {
  color: #f56c6c;
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: #409eff;
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-group.half {
  flex: 1;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-label {
  font-weight: 500;
  color: #606266;
  min-width: 24px;
}

.btn-remove {
  width: 28px;
  height: 28px;
  border: none;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 4px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: all 0.2s;
}

.btn-remove:hover {
  background: #f56c6c;
  color: white;
}

.btn-add {
  margin-top: 8px;
  padding: 8px 16px;
  border: 1px dashed #dcdfe6;
  background: #f5f7fa;
  color: #606266;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-add:hover {
  border-color: #409eff;
  color: #409eff;
}

.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.btn-primary {
  padding: 10px 24px;
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
  padding: 10px 24px;
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #e4e7ed;
}
</style>
