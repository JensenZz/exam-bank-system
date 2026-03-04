<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import TitleBar from './components/TitleBar.vue'
import { useQuestionStore } from './stores/questionStore'

const questionStore = useQuestionStore()
const route = useRoute()
const currentView = computed(() => route.path.replace(/^\//, '') || 'library')

onMounted(() => {
  // 异步加载分类，不阻塞页面显示
  questionStore.loadCategories().catch(err => {
    console.error('加载分类失败:', err)
  })
})
</script>

<template>
  <div class="app-container">
    <TitleBar />
    <div class="main-content">
      <Sidebar :currentView="currentView" />
      <main class="content-area">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f7fa;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.content-area {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}
</style>
