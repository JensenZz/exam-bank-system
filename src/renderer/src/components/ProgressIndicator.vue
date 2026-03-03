<script setup lang="ts">
withDefaults(defineProps<{
  progress: number
  size?: 'small' | 'medium' | 'large'
  showText?: boolean
}>(), {
  size: 'medium',
  showText: true
})
</script>

<template>
  <div class="progress-indicator" :class="size">
    <div class="progress-track">
      <div
        class="progress-fill"
        :style="{ width: `${Math.min(100, Math.max(0, progress))}%` }"
      >
        <div class="progress-shine"></div>
      </div>
    </div>
    <span v-if="showText" class="progress-text">{{ Math.round(progress) }}%</span>
  </div>
</template>

<style scoped>
.progress-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-track {
  flex: 1;
  background: #e4e7ed;
  border-radius: 100px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  border-radius: 100px;
  transition: width 0.3s ease;
  position: relative;
  overflow: hidden;
}

.progress-shine {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.3),
    transparent
  );
  animation: shine 2s infinite;
}

@keyframes shine {
  0% {
    left: -100%;
  }
  100% {
    left: 100%;
  }
}

.progress-text {
  font-size: 14px;
  font-weight: 600;
  color: #606266;
  min-width: 45px;
}

/* 尺寸变体 */
.progress-indicator.small .progress-track {
  height: 4px;
}

.progress-indicator.small .progress-text {
  font-size: 12px;
}

.progress-indicator.medium .progress-track {
  height: 8px;
}

.progress-indicator.large .progress-track {
  height: 12px;
}

.progress-indicator.large .progress-text {
  font-size: 16px;
}
</style>
