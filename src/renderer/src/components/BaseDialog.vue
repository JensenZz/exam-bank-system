<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    message: string
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    tone?: 'default' | 'success' | 'danger'
    closeOnMask?: boolean
    enableEsc?: boolean
    enableEnter?: boolean
  }>(),
  {
    title: '提示',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: false,
    tone: 'default',
    closeOnMask: true,
    enableEsc: true,
    enableEnter: true
  }
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const handleMaskClick = (event: MouseEvent, closeOnMask: boolean) => {
  if (!closeOnMask) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target?.classList.contains('base-dialog-mask')) {
    emit('cancel')
  }
}

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (!props.visible) {
    return
  }

  if (props.enableEsc && event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }

  if (props.enableEnter && event.key === 'Enter') {
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return
    }

    event.preventDefault()
    emit('confirm')
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleDocumentKeydown)
      return
    }
    document.removeEventListener('keydown', handleDocumentKeydown)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div
    v-if="visible"
    class="base-dialog-mask"
    @click="(event) => handleMaskClick(event, closeOnMask)"
  >
    <div class="base-dialog" :class="`tone-${tone}`">
      <header class="base-dialog-header">
        <h3>{{ title }}</h3>
      </header>
      <div class="base-dialog-body">
        <p>{{ message }}</p>
      </div>
      <footer class="base-dialog-footer">
        <button
          v-if="showCancel"
          class="dialog-btn dialog-btn-cancel"
          @click="emit('cancel')"
        >
          {{ cancelText }}
        </button>
        <button
          class="dialog-btn"
          :class="tone === 'danger' ? 'dialog-btn-danger' : tone === 'success' ? 'dialog-btn-success' : 'dialog-btn-primary'"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.base-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  backdrop-filter: blur(2px);
}

.base-dialog {
  width: min(460px, calc(100vw - 32px));
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;
}

.base-dialog-header {
  padding: 16px 20px 10px;
}

.base-dialog-header h3 {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.base-dialog-body {
  padding: 0 20px 18px;
}

.base-dialog-body p {
  margin: 0;
  color: #606266;
  line-height: 1.6;
  white-space: pre-wrap;
}

.base-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 18px;
}

.dialog-btn {
  min-width: 92px;
  height: 36px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.dialog-btn-cancel {
  background: #f5f7fa;
  color: #606266;
  border: 1px solid #dcdfe6;
}

.dialog-btn-primary {
  background: #409eff;
  color: #fff;
}

.dialog-btn-success {
  background: #67c23a;
  color: #fff;
}

.dialog-btn-danger {
  background: #f56c6c;
  color: #fff;
}

.dialog-btn:hover {
  opacity: 0.9;
}
</style>
