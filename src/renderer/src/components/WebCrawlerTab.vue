<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AiServiceConfig } from '../types/ai'
import type { ExamLevel } from '../types'
import { useCrawlStore } from '../stores/crawlStore'
import CrawlQuestionList from './CrawlQuestionList.vue'

const props = defineProps<{
  aiConfig?: AiServiceConfig | null
}>()

const crawlStore = useCrawlStore()
const successMessage = ref('')
const examLevels: ExamLevel[] = ['初级', '中级', '高级']


const canStart = computed(() => Boolean(crawlStore.url.trim()))
const showPreview = computed(() => crawlStore.questions.length > 0 && crawlStore.task?.status !== 'completed')
const canImport = computed(() => Boolean(
  crawlStore.questions.length > 0 &&
  crawlStore.metadata.examYear &&
  crawlStore.metadata.examLevel &&
  crawlStore.metadata.qualificationName.trim()
))

async function handleRefreshSession(): Promise<void> {
  try {
    await crawlStore.refreshSession()
  } catch (err) {
    crawlStore.error = (err as Error).message
  }
}

async function handleOpenLogin(): Promise<void> {
  try {
    await crawlStore.openLoginWindow()
    successMessage.value = '登录窗口已打开，登录成功并拿到有效 Cookie 后会自动关闭。'
  } catch (err) {
    crawlStore.error = (err as Error).message
  }
}

async function handleSaveCookie(): Promise<void> {
  try {
    await crawlStore.saveManualCookie()
    successMessage.value = 'Cookie 已保存并通过验证。'
  } catch (err) {
    crawlStore.error = (err as Error).message
  }
}

async function handleStart(): Promise<void> {
  try {
    successMessage.value = ''
    await crawlStore.startTask(props.aiConfig || null)
  } catch (err) {
    crawlStore.error = (err as Error).message
  }
}

async function handleImport(): Promise<void> {
  try {
    const count = await crawlStore.importQuestions()
    successMessage.value = `已成功导入 ${count} 道题目。`
  } catch (err) {
    crawlStore.error = (err as Error).message
  }
}

function handleCancelPreview(): void {
  crawlStore.reset()
}

function handleStartNewTask(): void {
  crawlStore.task = null
  crawlStore.error = null
  successMessage.value = ''
}

onMounted(() => {
  crawlStore.clearPoll()
})

onBeforeUnmount(() => {
  crawlStore.clearPoll()
})
</script>

<template>
  <div class="crawl-tab">
    <section class="panel form-panel">
      <div class="panel-header">
        <div>
          <h2>互联网抓取题目</h2>
          <p>建议填写包含完整题目内容的网页链接，例如答题页或解析页，而不是目录页。</p>
        </div>
      </div>

      <div class="form-grid single-column">
        <label>
          题目链接
          <input v-model="crawlStore.url" type="url" placeholder="例如：https://rk.51cto.com/t/n/exam/answer/em-5/18840" />
        </label>
      </div>

      <div class="hint-card">
        小提示：优先填具体题目页、答案页、解析页。目录页、列表页、登录首页通常无法直接解析成题目。
      </div>

      <div class="session-card">
        <div>
          <strong>登录状态：</strong>
          <span v-if="crawlStore.session">{{ crawlStore.session.status }}<span v-if="crawlStore.session.cookiePreview"> / {{ crawlStore.session.cookiePreview }}</span></span>
          <span v-else>未获取会话</span>
        </div>
        <div class="action-row">
          <button class="btn-secondary" :disabled="!crawlStore.url.trim()" @click="handleOpenLogin">去登录</button>
          <button class="btn-secondary" :disabled="!crawlStore.url.trim()" @click="handleRefreshSession">刷新登录状态</button>
        </div>
      </div>

      <label>
        手动 Cookie（兜底）
        <textarea v-model="crawlStore.manualCookie" rows="4" placeholder="如果站点无法在内置窗口完成登录，可以把浏览器 Cookie 粘贴到这里"></textarea>
      </label>

      <div class="action-row">
        <button class="btn-secondary" :disabled="!crawlStore.manualCookie.trim() || !crawlStore.url.trim()" @click="handleSaveCookie">保存 Cookie</button>
        <button class="btn-primary" :disabled="!canStart || crawlStore.isLoading || crawlStore.isPolling" @click="handleStart">开始 AI 抓取</button>
      </div>
    </section>

    <section v-if="crawlStore.task" class="panel status-panel">
      <div class="status-grid">
        <div><strong>任务状态：</strong>{{ crawlStore.task.status }}</div>
        <div><strong>站点：</strong>{{ crawlStore.task.siteType }}</div>
        <div><strong>链接：</strong>{{ crawlStore.task.url }}</div>
        <div><strong>进度：</strong>{{ crawlStore.task.progressMessage || '-' }}</div>
      </div>
      <p v-if="crawlStore.task.errorMessage" class="error-text">{{ crawlStore.task.errorMessage }}</p>
    </section>

    <section v-if="showPreview" class="panel metadata-panel">
      <h3>入库元数据</h3>
      <div class="form-grid metadata-grid">
        <label>
          年份
          <input v-model.number="crawlStore.metadata.examYear" type="number" min="1900" max="2100" />
        </label>
        <label>
          级别
          <select v-model="crawlStore.metadata.examLevel">
            <option value="">请选择</option>
            <option v-for="level in examLevels" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
        <label>
          资格名称
          <input v-model="crawlStore.metadata.qualificationName" type="text" placeholder="例如：系统架构设计师" />
        </label>
      </div>
    </section>

    <CrawlQuestionList
      v-if="showPreview"
      :questions="crawlStore.questions"
      @remove="crawlStore.removeQuestion"
      @update="crawlStore.updateQuestion"
      @cancel="handleCancelPreview"
      @confirm="handleImport"
    />

    <section v-if="crawlStore.task?.status === 'completed'" class="panel completed-panel">
      <h3>导入完成</h3>
      <p>{{ crawlStore.task.progressMessage || '题目已导入完成。' }}</p>
      <p class="completed-hint">当前任务已经结束，预览区已关闭，避免重复点击导致重复入库。</p>
      <div class="action-row">
        <button class="btn-secondary" @click="handleStartNewTask">继续抓取新网页</button>
      </div>
    </section>

    <p v-if="crawlStore.error" class="feedback error-text">{{ crawlStore.error }}</p>
    <p v-if="successMessage" class="feedback success-text">{{ successMessage }}</p>
    <p v-if="showPreview && !canImport" class="feedback warning-text">确认入库前需要填写年份、级别和资格名称。</p>
  </div>
</template>

<style scoped>
.crawl-tab { display: grid; gap: 16px; }
.panel { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
.panel-header h2 { margin: 0 0 8px; }
.panel-header p { margin: 0; color: #909399; }
.form-grid { display: grid; grid-template-columns: 220px 1fr; gap: 16px; }
.single-column { grid-template-columns: 1fr; }
.metadata-grid { grid-template-columns: repeat(3, 1fr); }
.url-field { grid-column: 2 / 3; }
label { display: grid; gap: 6px; color: #606266; font-size: 14px; }
input, select, textarea { width: 100%; padding: 10px 12px; border: 1px solid #dcdfe6; border-radius: 8px; font-size: 14px; }
.hint-card, .session-card { margin-top: 16px; border-radius: 10px; padding: 14px 16px; background: #f6f8fb; }
.completed-hint { color: #606266; }
.session-card { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.action-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.status-grid { display: grid; gap: 8px; color: #606266; }
.feedback { margin: 0; padding: 12px 16px; border-radius: 10px; }
.error-text { color: #c45656; background: #fef0f0; }
.success-text { color: #67c23a; background: #f0f9eb; }
.warning-text { color: #d48806; background: #fff7e6; }
.btn-primary, .btn-secondary { border-radius: 8px; padding: 10px 18px; cursor: pointer; }
.btn-primary { border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
.btn-secondary { border: 1px solid #dcdfe6; background: #fff; color: #606266; }
.btn-primary:disabled, .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
@media (max-width: 960px) {
  .form-grid, .metadata-grid { grid-template-columns: 1fr; }
  .url-field { grid-column: auto; }
  .session-card { flex-direction: column; align-items: flex-start; }
}
</style>

