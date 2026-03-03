<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { AiServiceConfig, AiProvider } from '../types/ai'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'config-ready': [config: AiServiceConfig]
}>()

const show = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const providers = [
  { value: 'openai' as AiProvider, label: 'OpenAI', icon: '🤖' },
  { value: 'baidu' as AiProvider, label: '百度文心', icon: '🔍' },
  { value: 'aliyun' as AiProvider, label: '阿里云灵积', icon: '☁️' },
  { value: 'custom' as AiProvider, label: '自定义 API', icon: '⚙️' }
]

const models: Record<AiProvider, string[]> = {
  openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo-preview'],
  baidu: ['ernie-bot', 'ernie-bot-turbo', 'ernie-bot-4'],
  aliyun: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  custom: ['自定义模型']
}

const config = ref<AiServiceConfig>({
  provider: 'openai',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  endpoint: '',
  temperature: 0.3,
  maxTokens: 4000
})

const errors = ref<Record<string, string>>({})

const validate = (): boolean => {
  errors.value = {}

  if (!config.value.apiKey.trim()) {
    errors.value.apiKey = '请输入 API Key'
  }

  if (config.value.provider === 'custom' && !config.value.endpoint?.trim()) {
    errors.value.endpoint = '自定义 API 需要设置端点 URL'
  }

  return Object.keys(errors.value).length === 0
}

const handleSubmit = async () => {
  if (!validate()) return

  // 如果是默认端点，清除它
  const finalConfig = { ...config.value }
  if (!finalConfig.endpoint?.trim()) {
    delete finalConfig.endpoint
  }

  // 保存配置
  try {
    await window.electronAPI.config.save(finalConfig)
  } catch (err) {
    console.error('保存配置失败:', err)
  }

  emit('config-ready', finalConfig)
  show.value = false
}

const handleProviderChange = (provider: AiProvider) => {
  config.value.provider = provider
  config.value.model = models[provider][0]
}

// 加载保存的配置
onMounted(async () => {
  try {
    const savedConfig = await window.electronAPI.config.load()
    if (savedConfig) {
      config.value = { ...config.value, ...savedConfig }
    }
  } catch (err) {
    console.error('加载配置失败:', err)
  }
})
</script>

<template>
  <div v-if="show" class="ai-config-modal" @click.self="show = false">
    <div class="ai-config-content">
      <div class="modal-header">
        <h3>🤖 AI 服务配置</h3>
        <button class="btn-close" @click="show = false">×</button>
      </div>

      <div class="config-form">
        <!-- 服务提供商选择 -->
        <div class="form-group">
          <label>AI 服务提供商</label>
          <div class="provider-grid">
            <button
              v-for="p in providers"
              :key="p.value"
              class="provider-btn"
              :class="{ active: config.provider === p.value }"
              @click="handleProviderChange(p.value)"
            >
              <span class="icon">{{ p.icon }}</span>
              <span class="label">{{ p.label }}</span>
            </button>
          </div>
        </div>

        <!-- API Key -->
        <div class="form-group">
          <label for="apiKey">API Key</label>
          <input
            id="apiKey"
            v-model="config.apiKey"
            type="password"
            placeholder="请输入您的 API Key"
            :class="{ error: errors.apiKey }"
          />
          <span v-if="errors.apiKey" class="error-text">{{ errors.apiKey }}</span>
          <p class="hint">
            <template v-if="config.provider === 'openai'">
              在 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI 平台</a> 获取 API Key
            </template>
            <template v-else-if="config.provider === 'baidu'">
              在百度智能云获取 Access Token
            </template>
            <template v-else-if="config.provider === 'aliyun'">
              在阿里云 DashScope 获取 API Key
            </template>
            <template v-else>
              输入您的自定义 API Key
            </template>
          </p>
        </div>

        <!-- 模型选择 -->
        <div class="form-group">
          <label for="model">模型</label>
          <select id="model" v-model="config.model">
            <option v-for="m in models[config.provider]" :key="m" :value="m">
              {{ m }}
            </option>
          </select>
        </div>

        <!-- 自定义端点（仅自定义 API 显示） -->
        <div v-if="config.provider === 'custom'" class="form-group">
          <label for="endpoint">API 端点</label>
          <input
            id="endpoint"
            v-model="config.endpoint"
            type="url"
            placeholder="https://api.example.com/v1/chat/completions"
            :class="{ error: errors.endpoint }"
          />
          <span v-if="errors.endpoint" class="error-text">{{ errors.endpoint }}</span>
        </div>

        <!-- 高级设置 -->
        <div class="form-group advanced">
          <details>
            <summary>高级设置</summary>
            <div class="advanced-content">
              <div class="form-row">
                <div class="form-group">
                  <label for="temperature">温度 ({{ config.temperature }})</label>
                  <input
                    id="temperature"
                    v-model.number="config.temperature"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                  />
                  <p class="hint">较低的值使输出更确定，较高的值使输出更多样</p>
                </div>

                <div class="form-group">
                  <label for="maxTokens">最大 Token 数</label>
                  <input
                    id="maxTokens"
                    v-model.number="config.maxTokens"
                    type="number"
                    min="100"
                    max="8000"
                    step="100"
                  />
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="show = false">取消</button>
        <button class="btn-primary" @click="handleSubmit">确认配置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-config-modal {
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

.ai-config-content {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e4e7ed;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.btn-close {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  font-size: 24px;
  color: #909399;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-close:hover {
  background: #f5f7fa;
  color: #606266;
}

.config-form {
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  transition: all 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #409eff;
}

.form-group input.error {
  border-color: #f56c6c;
}

.error-text {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #f56c6c;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}

.hint a {
  color: #409eff;
  text-decoration: none;
}

.hint a:hover {
  text-decoration: underline;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.provider-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 2px solid #e4e7ed;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
}

.provider-btn:hover {
  border-color: #c0c4cc;
}

.provider-btn.active {
  border-color: #409eff;
  background: #f0f9ff;
}

.provider-btn .icon {
  font-size: 20px;
}

.provider-btn .label {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
}

.provider-btn.active .label {
  color: #409eff;
}

.advanced {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e4e7ed;
}

.advanced summary {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  cursor: pointer;
  user-select: none;
}

.advanced-content {
  margin-top: 16px;
  padding-top: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-row .form-group {
  margin-bottom: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #e4e7ed;
}

.btn-secondary {
  padding: 10px 20px;
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

.btn-primary {
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
</style>
