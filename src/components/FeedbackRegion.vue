<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'status' | 'error'
    actionLabel?: string
  }>(),
  {
    tone: 'status',
    actionLabel: '',
  },
)

defineEmits<{ action: [] }>()
</script>

<template>
  <div
    class="feedback-region"
    :class="{ 'feedback-error': tone === 'error' }"
    :role="tone === 'error' ? 'alert' : 'status'"
    :aria-live="tone === 'error' ? 'assertive' : 'polite'"
    aria-atomic="true"
  >
    <span class="feedback-mark" aria-hidden="true" />
    <div class="feedback-copy"><slot /></div>
    <button v-if="actionLabel" class="inline-button feedback-action" type="button" @click="$emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>
