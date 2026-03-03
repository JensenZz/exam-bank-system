<template>
  <div class="settings-page">
    <header class="page-header">
      <h1>⚙️ 系统设置</h1>
    </header>

    <div class="settings-content">
      <!-- AI 模型配置 -->
      <section class="setting-section">
        <div class="section-header">
          <h2>🤖 AI 模型配置</h2>
          <p class="section-desc">配置用于识别 PDF 题目的 AI 服务</p>
        </div>

        <div class="setting-form">
          <div class="form-group">
            <label>AI 提供商 <span class="required">*</span></label>
            <select v-model="config.provider" class="form-select">
              <option value="openai">OpenAI</option>
              <option value="baidu">百度文心一言</option>
              <option value="aliyun">阿里通义千问</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          <div class="form-group">
            <label>API 密钥 <span class="required">*</span></label>
            <div class="input-with-help">
              <input
                v-model="config.apiKey"
                type="password"
                class="form-input"
                placeholder="请输入您的 API 密钥"
              />
              <span class="help-text">
                <template v-if="config.provider === 'openai'">
                  从 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI 控制台</a> 获取
                </template>
                <template v-else-if="config.provider === 'baidu'">
                  从 <a href="https://console.bce.baidu.com/" target="_blank">百度智能云</a> 获取
                </template>
                <template v-else-if="config.provider === 'aliyun'">
                  从 <a href="https://dashscope.aliyun.com/" target="_blank">阿里云 DashScope</a> 获取
                </template>
                <template v-else>
                  请输入您的自定义 API 密钥
                </template>
              </span>
            </div>
          </div>

          <div class="form-group">
            <label>模型名称 <span class="required">*</span></label>
            <input
              v-model="config.model"
              type="text"
              class="form-input"
              :placeholder="getModelPlaceholder()"
            />
            <span class="help-text">{{ getModelHelp() }}</span>
          </div>

          <div class="form-group" v-if="config.provider === 'custom'">
            <label>API 端点 <span class="required">*</span></label>
            <input
              v-model="config.endpoint"
              type="text"
              class="form-input"
              placeholder="https://api.example.com/v1/chat/completions"
            />
          </div>

          <div class="form-row">
            <div class="form-group half">
              <label>Temperature</label>
              <input
                v-model.number="config.temperature"
                type="number"
                min="0"
                max="2"
                step="0.1"
                class="form-input"
              />
              <span class="help-text">控制生成文本的随机性 (0-2)</span>
            </div>

            <div class="form-group half">
              <label>Max Tokens</label>
              <input
                v-model.number="config.maxTokens"
                type="number"
                min="100"
                max="8000"
                step="100"
                class="form-input"
              />
              <span class="help-text">最大生成 token 数</span>
            </div>
          </div>

          <div class="form-group">
            <label>提示词模板</label>
            <textarea
              v-model="config.promptTemplate"
              class="form-textarea"
              rows="8"
              placeholder="自定义 AI 提示词模板，留空使用默认模板"
            />
            <span class="help-text">
              <span v-pre>可用变量: {{text}} - PDF 提取的文本内容</span>
              <button class="btn-link" @click="resetPromptTemplate">恢复默认</button>
            </span>
          </div>

          <div class="form-actions">
            <button class="btn-secondary" @click="testConnection" :disabled="isTesting">
              {{ isTesting ? '测试中...' : '测试连接' }}
            </button>
            <button class="btn-primary" @click="saveConfig" :disabled="isSaving">
              {{ isSaving ? '保存中...' : '保存配置' }}
            </button>
          </div>

          <!-- 测试结果 -->
          <div v-if="testResult" class="test-result" :class="testResult.success ? 'success' : 'error'">
            <svg v-if="testResult.success" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <span>{{ testResult.message }}</span>
          </div>
        </div>
      </section>

      <!-- 数据管理 -->
      <section class="setting-section">
        <div class="section-header">
          <h2>💾 数据管理</h2>
        </div>
        <div class="setting-actions">
          <div class="action-item">
            <div class="action-info">
              <h4>导出题库</h4>
              <p>将所有题目导出为 JSON 文件</p>
            </div>
            <button class="btn-secondary" @click="exportData">导出</button>
          </div>
          <div class="action-item">
            <div class="action-info">
              <h4>导入题库</h4>
              <p>从 JSON 文件导入题目</p>
            </div>
            <button class="btn-secondary" @click="importData">导入</button>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="setting-section">
        <div class="section-header">
          <h2>ℹ️ 关于</h2>
        </div>
        <div class="about-info">
          <div class="app-logo">📚</div>
          <h3>题库管理系统</h3>
          <p class="version">版本 v1.0.0</p>
          <p class="desc">基于 Electron + Vue 3 的桌面题库管理工具，支持 AI 识别 PDF 导入题目</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { AiServiceConfig } from '../types/ai'

const config = ref<AiServiceConfig>({
  provider: 'openai',
  apiKey: '',
  model: '',
  endpoint: '',
  temperature: 0.7,
  maxTokens: 2000,
  promptTemplate: ''
})

const isTesting = ref(false)
const isSaving = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const defaultPromptTemplate = `请从以下 PDF 文本中提取题目，并以 JSON 格式返回。

要求：
1. 识别单选题、多选题、填空题、简答题
2. 提取题目内容、选项、答案和解析
3. 识别题目分类

PDF 文本：
{{text}}

请返回以下格式的 JSON：
{
  "categories": [{"name": "分类名称"}],
  "questions": [{
    "title": "题目标题",
    "content": "题目内容",
    "type": "single|multiple|fill|essay",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "answer": "正确答案",
    "analysis": "解析",
    "categoryName": "分类名称",
    "difficulty": 1
  }]
}`

// 获取模型占位符
const getModelPlaceholder = () => {
  const placeholders: Record<string, string> = {
    openai: 'gpt-3.5-turbo',
    baidu: 'ernie-bot',
    aliyun: 'qwen-turbo',
    custom: 'model-name'
  }
  return placeholders[config.value.provider] || 'model-name'
}

// 获取模型帮助文本
const getModelHelp = () => {
  const helps: Record<string, string> = {
    openai: '推荐: gpt-3.5-turbo, gpt-4',
    baidu: '推荐: ernie-bot, ernie-bot-turbo',
    aliyun: '推荐: qwen-turbo, qwen-plus',
    custom: '请输入您的自定义模型名称'
  }
  return helps[config.value.provider] || ''
}

// 恢复默认提示词
const resetPromptTemplate = () => {
  config.value.promptTemplate = defaultPromptTemplate
}

// 监听提供商变化，自动更新模型默认值
watch(() => config.value.provider, (newProvider) => {
  const defaults: Record<string, string> = {
    openai: 'gpt-3.5-turbo',
    baidu: 'ernie-bot',
    aliyun: 'qwen-turbo',
    custom: ''
  }
  if (!config.value.model || config.value.model === defaults[config.value.provider]) {
    config.value.model = defaults[newProvider] || ''
  }
})

// 加载配置
onMounted(async () => {
  try {
    const savedConfig = await window.electronAPI.config.load()
    if (savedConfig) {
      config.value = { ...config.value, ...savedConfig }
    }
    if (!config.value.promptTemplate) {
      config.value.promptTemplate = defaultPromptTemplate
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
})

// 测试连接
const testConnection = async () => {
  if (!config.value.apiKey || !config.value.model) {
    testResult.value = { success: false, message: '请填写 API 密钥和模型名称' }
    return
  }
  if (config.value.provider === 'custom' && !config.value.endpoint) {
    testResult.value = { success: false, message: '自定义提供商请填写 API 端点' }
    return
  }

  isTesting.value = true
  testResult.value = null

  try {
    const result = await (window.electronAPI as any).config.test({ ...config.value })
    if (result.success) {
      testResult.value = { success: true, message: '连接成功！API 密钥和端点验证通过' }
    } else {
      const status = result.status
      let message = result.message || '连接失败'
      if (status === 401) message = 'API 密钥无效或已过期，请检查密钥是否正确'
      else if (status === 404) message = 'API 端点不存在，请检查端点地址或模型名称'
      else if (status === 429) message = '请求频率超限，请稍后重试'
      testResult.value = { success: false, message }
    }
  } catch (error) {
    const errorMessage = (error as Error).message
    console.error('测试连接失败:', error)
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      testResult.value = { success: false, message: '连接超时，请检查网络连接或稍后重试' }
    } else if (errorMessage.includes('Network Error') || errorMessage.includes('ECONNREFUSED')) {
      testResult.value = { success: false, message: '网络错误，请检查网络连接或 API 端点是否正确' }
    } else {
      testResult.value = { success: false, message: '连接失败: ' + errorMessage }
    }
  } finally {
    isTesting.value = false
  }
}

// 保存配置
const saveConfig = async () => {
  if (!config.value.apiKey || !config.value.model) {
    alert('请填写 API 密钥和模型名称')
    return
  }

  isSaving.value = true
  try {
    await window.electronAPI.config.save({ ...config.value })
    alert('配置保存成功！')
    testResult.value = null
  } catch (error) {
    alert('保存失败: ' + (error as Error).message)
  } finally {
    isSaving.value = false
  }
}

// 导出数据
const exportData = async () => {
  try {
    const questions = await window.electronAPI.db.getQuestions()
    const categories = await window.electronAPI.db.getCategories()
    const data = { questions, categories, exportDate: new Date().toISOString() }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `题库备份_${new Date().toLocaleDateString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    alert('导出失败: ' + (error as Error).message)
  }
}

// 导入数据
const importData = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (confirm(`确定要导入 ${data.questions?.length || 0} 道题目吗？`)) {
        for (const q of data.questions || []) {
          await window.electronAPI.db.addQuestion(q)
        }
        alert('导入成功！')
      }
    } catch (error) {
      alert('导入失败: ' + (error as Error).message)
    }
  }
  input.click()
}
</script>

<style scoped>
.settings-page {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.section-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}

.section-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.section-desc {
  font-size: 14px;
  color: #909399;
}

.setting-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
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
  font-family: monospace;
}

.input-with-help {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.help-text {
  font-size: 12px;
  color: #909399;
}

.help-text a {
  color: #409eff;
  text-decoration: none;
}

.help-text a:hover {
  text-decoration: underline;
}

.btn-link {
  background: none;
  border: none;
  color: #409eff;
  cursor: pointer;
  font-size: 12px;
  margin-left: 8px;
}

.btn-link:hover {
  text-decoration: underline;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-group.half {
  flex: 1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
  padding-top: 20px;
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

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.btn-secondary:hover:not(:disabled) {
  background: #e4e7ed;
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
}

.test-result.success {
  background: #f0f9eb;
  color: #67c23a;
}

.test-result.error {
  background: #fef0f0;
  color: #f56c6c;
}

.setting-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.action-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.action-info h4 {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.action-info p {
  font-size: 12px;
  color: #909399;
}

.about-info {
  text-align: center;
  padding: 20px;
}

.app-logo {
  font-size: 48px;
  margin-bottom: 12px;
}

.about-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.about-info .version {
  font-size: 14px;
  color: #909399;
  margin-bottom: 12px;
}

.about-info .desc {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}
</style>
