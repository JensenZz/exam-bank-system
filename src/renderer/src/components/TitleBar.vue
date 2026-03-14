<script setup lang="ts">
import { computed, ref } from 'vue'

const isMaximized = ref(false)
const isMac = computed(() => window.electronAPI.platform === 'darwin')

const handleMinimize = () => {
  window.electronAPI.window.minimize()
}

const handleMaximize = async () => {
  isMaximized.value = await window.electronAPI.window.maximize()
}

const handleClose = () => {
  window.electronAPI.window.close()
}
</script>

<template>
  <div class="title-bar" :class="{ 'title-bar--mac': isMac }">
    <div class="title-bar-drag" :class="{ 'title-bar-drag--mac': isMac }">
      <div class="app-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
      </div>
      <span class="app-title">题库管理系统</span>
    </div>
    <div v-if="isMac" class="title-bar-spacer" aria-hidden="true"></div>
    <div v-if="!isMac" class="window-controls">
      <button class="control-btn minimize" @click="handleMinimize" title="最小化">
        <svg viewBox="0 0 12 12" width="12" height="12">
          <rect y="5" width="12" height="2" fill="currentColor"/>
        </svg>
      </button>
      <button class="control-btn maximize" @click="handleMaximize" title="最大化">
        <svg v-if="!isMaximized" viewBox="0 0 12 12" width="12" height="12">
          <rect x="1" y="1" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
        <svg v-else viewBox="0 0 12 12" width="12" height="12">
          <rect x="3" y="0" width="9" height="9" stroke="currentColor" stroke-width="2" fill="none"/>
          <rect x="0" y="3" width="9" height="9" stroke="currentColor" stroke-width="2" fill="var(--bg-color, #f5f7fa)"/>
        </svg>
      </button>
      <button class="control-btn close" @click="handleClose" title="关闭">
        <svg viewBox="0 0 12 12" width="12" height="12">
          <path d="M1 1l10 10M11 1l-10 10" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 36px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.title-bar--mac {
  height: 44px;
  background: linear-gradient(180deg, rgba(248, 249, 251, 0.96) 0%, rgba(241, 243, 246, 0.92) 100%);
  color: #2c3440;
  border-bottom: 1px solid rgba(31, 35, 40, 0.08);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.title-bar-drag {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 12px;
  flex: 1;
  -webkit-app-region: drag;
}

.title-bar-drag--mac {
  justify-content: center;
  padding: 0 88px;
}

.app-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.title-bar--mac .app-icon {
  display: none;
}

.app-title {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.5px;
}

.title-bar--mac .app-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgba(44, 52, 64, 0.82);
}

.title-bar-spacer {
  width: 88px;
  flex-shrink: 0;
}

.window-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.control-btn {
  width: 46px;
  height: 36px;
  border: none;
  background: transparent;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.control-btn.close:hover {
  background: #e81123;
}
</style>
