<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useQuestionStore } from '../stores/questionStore'
import type { PracticeSession, PracticeRecordDetail, ExamLevel } from '../types'

const store = useQuestionStore()

const sessions = ref<PracticeSession[]>([])
const selectedSessionId = ref<number | null>(null)
const details = ref<PracticeRecordDetail[]>([])
const loadingSessions = ref(false)
const loadingDetails = ref(false)
const selectedExamYear = ref<number | null>(null)
const selectedExamLevel = ref<ExamLevel | ''>('')
const qualificationKeyword = ref('')
const examLevels: ExamLevel[] = ['初级', '中级', '高级']

const loadSessions = async () => {
  loadingSessions.value = true
  try {
    sessions.value = await store.getPracticeSessions({
      examYear: selectedExamYear.value || undefined,
      examLevel: selectedExamLevel.value || undefined,
      qualificationKeyword: qualificationKeyword.value.trim() || undefined
    })
    if (sessions.value.length === 0) {
      selectedSessionId.value = null
      details.value = []
    }
  } catch (error) {
    console.error('加载成绩会话失败:', error)
    alert('加载成绩会话失败')
  } finally {
    loadingSessions.value = false
  }
}

const viewSessionDetail = async (sessionId: number) => {
  selectedSessionId.value = sessionId
  loadingDetails.value = true
  try {
    details.value = await store.getPracticeSessionDetails(sessionId)
  } catch (error) {
    console.error('加载成绩明细失败:', error)
    alert('加载成绩明细失败')
  } finally {
    loadingDetails.value = false
  }
}

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString()
}

onMounted(() => {
  loadSessions()
})
</script>

<template>
  <div class="history-page">
    <header class="page-header">
      <h1>成绩记录</h1>
      <p class="subtitle">查看每次练习的汇总与明细</p>
    </header>

    <div class="toolbar">
      <input
        v-model.number="selectedExamYear"
        type="number"
        min="1900"
        max="2100"
        class="filter-input"
        placeholder="年份"
      />

      <select v-model="selectedExamLevel" class="filter-select">
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
      />

      <button class="btn-secondary" @click="loadSessions">查询</button>
    </div>

    <div class="content">
      <section class="session-list">
        <h2>练习汇总</h2>

        <div v-if="loadingSessions" class="state-text">加载中...</div>
        <div v-else-if="sessions.length === 0" class="state-text">暂无记录</div>

        <div v-else class="cards">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="session-card"
            :class="{ active: selectedSessionId === session.id }"
            @click="viewSessionDetail(session.id)"
          >
            <div class="row">
              <span class="label">时间</span>
              <span>{{ formatDateTime(session.createdAt) }}</span>
            </div>
            <div class="row">
              <span class="label">范围</span>
              <span>
                {{ session.examYear || '-' }} / {{ session.examLevel || '-' }} / {{ session.qualificationName || '-' }}
              </span>
            </div>
            <div class="row">
              <span class="label">成绩</span>
              <span>{{ session.correctCount }} / {{ session.totalCount }}（{{ session.accuracy }}%）</span>
            </div>
          </div>
        </div>
      </section>

      <section class="detail-list">
        <h2>作答明细</h2>

        <div v-if="!selectedSessionId" class="state-text">请选择左侧会话查看明细</div>
        <div v-else-if="loadingDetails" class="state-text">加载中...</div>
        <div v-else-if="details.length === 0" class="state-text">该会话暂无明细</div>

        <div v-else class="detail-table-wrap">
          <table class="detail-table">
            <thead>
              <tr>
                <th>#</th>
                <th>题目</th>
                <th>你的答案</th>
                <th>正确答案</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in details" :key="item.id">
                <td>{{ item.questionOrder }}</td>
                <td class="title-cell">{{ item.title }}</td>
                <td>{{ item.userAnswer || '-' }}</td>
                <td>{{ item.answer }}</td>
                <td>
                  <span :class="Number(item.isCorrect) ? 'ok' : 'bad'">{{ Number(item.isCorrect) ? '正确' : '错误' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.history-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  margin-bottom: 16px;
}

.page-header h1 {
  font-size: 24px;
  color: #303133;
  margin-bottom: 6px;
}

.subtitle {
  font-size: 14px;
  color: #909399;
}

.toolbar {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #fff;
  margin-bottom: 16px;
}

.filter-input,
.filter-select {
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
}

.btn-secondary {
  padding: 8px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #f5f7fa;
  cursor: pointer;
}

.content {
  flex: 1;
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 16px;
  min-height: 0;
}

.session-list,
.detail-list {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  overflow: auto;
}

.session-list h2,
.detail-list h2 {
  font-size: 16px;
  margin-bottom: 12px;
}

.state-text {
  color: #909399;
  font-size: 14px;
  padding: 12px 0;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.session-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
}

.session-card.active {
  border-color: #409eff;
  background: #f0f9ff;
}

.row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.label {
  min-width: 40px;
  color: #909399;
}

.detail-table-wrap {
  overflow: auto;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
}

.detail-table th,
.detail-table td {
  border-bottom: 1px solid #ebeef5;
  padding: 8px;
  text-align: left;
  font-size: 13px;
}

.title-cell {
  max-width: 420px;
}

.ok {
  color: #67c23a;
  font-weight: 500;
}

.bad {
  color: #f56c6c;
  font-weight: 500;
}
</style>
