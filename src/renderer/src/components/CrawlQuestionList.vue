<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ParsedQuestionDraft } from '../types'

const props = defineProps<{
  questions: ParsedQuestionDraft[]
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
  remove: [index: number]
  update: [index: number, question: ParsedQuestionDraft]
}>()

const selected = ref<Set<number>>(new Set())
const editingIndex = ref<number | null>(null)
const editForm = ref<ParsedQuestionDraft | null>(null)
const imageText = ref('')
const warningText = ref('')

const allSelected = computed(() => props.questions.length > 0 && selected.value.size === props.questions.length)

const typeOptions = [
  { label: '单选题', value: 'single' },
  { label: '多选题', value: 'multiple' },
  { label: '填空题', value: 'fill' },
  { label: '简答/材料题', value: 'essay' }
] as const

function toggleSelectAll(): void {
  if (allSelected.value) {
    selected.value.clear()
    return
  }
  selected.value = new Set(props.questions.map((_, index) => index))
}

function toggleSelect(index: number): void {
  if (selected.value.has(index)) {
    selected.value.delete(index)
  } else {
    selected.value.add(index)
  }
}

function startEdit(index: number): void {
  editingIndex.value = index
  const question = props.questions[index]
  editForm.value = {
    ...question,
    options: [...(question.options || [])],
    images: [...(question.images || [])],
    warnings: [...(question.warnings || [])]
  }
  imageText.value = (question.images || []).join('\n')
  warningText.value = (question.warnings || []).join('\n')
}

function addOption(): void {
  if (!editForm.value) return
  editForm.value.options = [...(editForm.value.options || []), '']
}

function saveEdit(): void {
  if (editingIndex.value === null || !editForm.value) return
  emit('update', editingIndex.value, {
    ...editForm.value,
    options: (editForm.value.options || []).map((item) => String(item).trim()).filter(Boolean),
    images: imageText.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    warnings: warningText.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  })
  editingIndex.value = null
  editForm.value = null
  imageText.value = ''
  warningText.value = ''
}

function handleRemove(index: number): void {
  emit('remove', index)
  selected.value.delete(index)
}

function handleConfirm(): void {
  if (selected.value.size === 0) {
    emit('confirm')
    return
  }

  const selectedIndexes = new Set(selected.value)
  for (let index = props.questions.length - 1; index >= 0; index -= 1) {
    if (!selectedIndexes.has(index)) {
      emit('remove', index)
    }
  }
  emit('confirm')
}

function getTypeLabel(type: string): string {
  return typeOptions.find((item) => item.value === type)?.label || type
}
</script>

<template>
  <div class="crawl-question-list">
    <div class="list-header">
      <div>
        <h3>抓取预览</h3>
        <p>共 {{ questions.length }} 道题，可在入库前人工修正。</p>
      </div>
      <label class="select-all">
        <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
        <span>全选</span>
      </label>
    </div>

    <div class="question-list">
      <article v-for="(question, index) in questions" :key="`${index}-${question.title}`" class="question-card">
        <div class="card-top">
          <label class="question-check">
            <input type="checkbox" :checked="selected.has(index)" @change="toggleSelect(index)" />
          </label>
          <span class="question-type">{{ getTypeLabel(question.type) }}</span>
          <span v-if="question.categoryName" class="pill">{{ question.categoryName }}</span>
          <span v-for="warning in question.warnings || []" :key="warning" class="pill warning">{{ warning }}</span>
          <div class="card-actions">
            <button class="btn-link" @click="startEdit(index)">编辑</button>
            <button class="btn-link danger" @click="handleRemove(index)">删除</button>
          </div>
        </div>

        <template v-if="editingIndex !== index">
          <h4>{{ question.title }}</h4>
          <p v-if="question.content" class="content">{{ question.content }}</p>
          <div v-if="question.options?.length" class="option-list">
            <div v-for="(option, optionIndex) in question.options" :key="`${index}-${optionIndex}`" class="option-item">
              <strong>{{ String.fromCharCode(65 + optionIndex) }}.</strong>
              <span>{{ option }}</span>
            </div>
          </div>
          <p><strong>答案：</strong>{{ question.answer || '未识别' }}</p>
          <p v-if="question.analysis"><strong>解析：</strong>{{ question.analysis }}</p>
          <div v-if="question.images?.length" class="image-list">
            <a v-for="image in question.images" :key="image" :href="image" target="_blank" rel="noreferrer">{{ image }}</a>
          </div>
        </template>

        <div v-else class="edit-panel">
          <label>
            标题
            <textarea v-model="editForm!.title" rows="2"></textarea>
          </label>
          <label>
            题干
            <textarea v-model="editForm!.content" rows="4"></textarea>
          </label>
          <div class="edit-grid">
            <label>
              题型
              <select v-model="editForm!.type">
                <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>
              答案
              <input v-model="editForm!.answer" type="text" />
            </label>
          </div>
          <label>
            解析
            <textarea v-model="editForm!.analysis" rows="3"></textarea>
          </label>
          <div class="option-editor">
            <div class="editor-head">
              <span>选项</span>
              <button class="btn-link" @click="addOption">新增选项</button>
            </div>
            <input v-for="(_, optionIndex) in editForm!.options" :key="optionIndex" v-model="editForm!.options![optionIndex]" type="text" />
          </div>
          <label>
            图片链接（每行一个）
            <textarea v-model="imageText" rows="3"></textarea>
          </label>
          <label>
            预警标记（每行一个）
            <textarea v-model="warningText" rows="3"></textarea>
          </label>
          <div class="edit-actions">
            <button class="btn-secondary" @click="editingIndex = null; editForm = null; imageText = ''; warningText = ''">取消</button>
            <button class="btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </article>
    </div>

    <div class="footer">
      <button class="btn-secondary" @click="$emit('cancel')">取消</button>
      <button class="btn-primary" :disabled="questions.length === 0" @click="handleConfirm">确认入库</button>
    </div>
  </div>
</template>

<style scoped>
.crawl-question-list { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
.list-header, .card-top, .footer, .edit-grid, .editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.list-header { margin-bottom: 16px; }
.question-list { display: flex; flex-direction: column; gap: 12px; max-height: 620px; overflow: auto; }
.question-card { border: 1px solid #ebeef5; border-radius: 10px; padding: 14px; background: #fcfcfd; }
.question-type, .pill { display: inline-flex; padding: 4px 10px; border-radius: 999px; background: #ecf5ff; color: #409eff; font-size: 12px; }
.pill.warning { background: #fff7e6; color: #d48806; }
.card-actions { margin-left: auto; display: flex; gap: 10px; }
.content, .option-item, .question-card p { color: #606266; line-height: 1.7; }
.option-list { display: grid; gap: 6px; margin: 10px 0; }
.image-list { display: flex; flex-direction: column; gap: 4px; }
.edit-panel { display: grid; gap: 12px; }
label { display: grid; gap: 6px; color: #606266; font-size: 13px; }
textarea, input, select { width: 100%; padding: 10px 12px; border: 1px solid #dcdfe6; border-radius: 8px; font-size: 14px; }
.btn-link { border: none; background: transparent; color: #409eff; cursor: pointer; }
.btn-link.danger { color: #f56c6c; }
.btn-primary, .btn-secondary { border-radius: 8px; padding: 10px 18px; cursor: pointer; }
.btn-primary { border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
.btn-secondary { border: 1px solid #dcdfe6; background: #fff; color: #606266; }
.footer { margin-top: 16px; justify-content: flex-end; }
</style>
