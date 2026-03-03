<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'

defineProps<{
  currentView: string
}>()

const emit = defineEmits<{
  navigate: [view: string]
}>()

const menuItems = [
  { id: 'library', icon: 'book', label: '题库管理' },
  { id: 'import', icon: 'upload', label: 'AI导入' },
  { id: 'practice', icon: 'pencil', label: '做题练习' },
  { id: 'settings', icon: 'cog', label: '设置' }
]

const icons: Record<string, string> = {
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  pencil: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  cog: 'M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'
}
</script>

<template>
  <aside class="sidebar">
    <nav class="sidebar-nav">
      <router-link
        v-for="item in menuItems"
        :key="item.id"
        :to="'/' + item.id"
        class="nav-item"
        :class="{ active: currentView === item.id }"
        @click="emit('navigate', item.id)"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path :d="icons[item.icon]" />
        </svg>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="sidebar-footer">
      <div class="version">v1.0.0</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: 8px;
  color: #606266;
  text-decoration: none;
  transition: all 0.2s;
}

.nav-item:hover {
  background: #f5f7fa;
  color: #409eff;
}

.nav-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #e4e7ed;
  text-align: center;
}

.version {
  font-size: 12px;
  color: #909399;
}
</style>