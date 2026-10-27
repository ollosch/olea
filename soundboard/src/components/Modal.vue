<script setup>
defineProps({
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal" :class="{ 'modal-wide': wide }" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2>{{ title }}</h2>
        <button class="icon-btn" title="Close" @click="$emit('close')">×</button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.actions" class="modal-actions">
        <slot name="actions" />
      </footer>
    </div>
  </div>
</template>
