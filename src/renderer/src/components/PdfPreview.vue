<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  files: string[]
  extractResults?: Array<{
    filePath: string
    text: string
    numpages: number
  }>
}>()

const emit = defineEmits<{
  'remove': [index: number]
  'reorder': [files: string[]]
}>()

const expandedIndex = ref<number | null>(null)

const fileInfos = computed(() => {
  return props.files.map((filePath, index) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const result = props.extractResults?.find(r => r.filePath === filePath)
    return {
      index,
      filePath,
      fileName,
      isExtracted: !!result,
      pageCount: result?.numpages || 0,
      previewText: result?.text?.slice(0, 500) || ''
    }
  })
})

const totalFiles = computed(() => props.files.length)
const extractedCount = computed(() => props.extractResults?.length || 0)

const toggleExpand = (index: number) => {
  expandedIndex.value = expandedIndex.value === index ? null : index
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>

<template>
  <div class="pdf-preview">
    <div class="preview-header">
      <div class="file-stats">
        <span class="file-count">📄 {{ totalFiles }} 个文件</span>
        <span v-if="extractResults" class="extract-status">
          ✅ 已提取 {{ extractedCount }}/{{ totalFiles }}
        </span>
      </div>
    </div>

    <div class="file-list">
      <div
        v-for="info in fileInfos"
        :key="info.filePath"
        class="file-item"
        :class="{ expanded: expandedIndex === info.index, extracted: info.isExtracted }"
      >
        <div class="file-summary" @click="toggleExpand(info.index)">
          <div class="file-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="#f56c6c">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </div>

          <div class="file-info">
            <div class="file-name">{{ info.fileName }}</div>
            <div class="file-meta">
              <span v-if="info.isExtracted" class="page-count">{{ info.pageCount }} 页</span>
              <span v-else class="pending">等待处理</span>
            </div>
          </div>

          <div class="file-actions">
            <button
              class="btn-icon"
              :class="{ expanded: expandedIndex === info.index }"
              title="展开预览"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </button>
            <button
              class="btn-icon danger"
              title="移除"
              @click.stop="$emit('remove', info.index)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>

        <div v-if="expandedIndex === info.index && info.isExtracted" class="file-detail">
          <div class="preview-section">
            <h4>文本预览</h4>
            <pre class="text-preview">{{ info.previewText }}{{ info.previewText.length >= 500 ? '...' : '' }}</pre>
          </div>
        </div>
      </div>
    </div>

    <div v-if="files.length === 0" class="empty-state">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="#c0c4cc">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
      </svg>
      <p>暂无 PDF 文件</p>
    </div>
  </div>
</template>

<style scoped>
.pdf-preview {
  background: #f5f7fa;
  border-radius: 12px;
  padding: 20px;
}

.preview-header {
  margin-bottom: 16px;
}

.file-stats {
  display: flex;
  gap: 16px;
  align-items: center;
}

.file-count {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
}

.extract-status {
  font-size: 14px;
  color: #67c23a;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  background: white;
  border-radius: 8px;
  border: 2px solid transparent;
  transition: all 0.2s;
  overflow: hidden;
}

.file-item:hover {
  border-color: #dcdfe6;
}

.file-item.extracted {
  border-left: 4px solid #67c23a;
}

.file-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
}

.file-icon {
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.page-count {
  color: #67c23a;
}

.pending {
  color: #e6a23c;
}

.file-actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #909399;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #f5f7fa;
  color: #606266;
}

.btn-icon.expanded {
  transform: rotate(180deg);
}

.btn-icon.danger:hover {
  color: #f56c6c;
  background: #fef0f0;
}

.file-detail {
  padding: 0 16px 16px;
  border-top: 1px solid #ebeef5;
}

.preview-section {
  margin-top: 16px;
}

.preview-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.text-preview {
  margin: 0;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
  color: #909399;
}

.empty-state p {
  margin-top: 12px;
  font-size: 14px;
}
</style>
