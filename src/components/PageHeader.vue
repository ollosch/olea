<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    eyebrow?: string
    description?: string
    headingId?: string
  }>(),
  {
    eyebrow: '',
    description: '',
    headingId: 'page-title',
  },
)
</script>

<template>
  <header class="page-header">
    <div class="page-header-copy">
      <p v-if="eyebrow" class="eyebrow"><span class="eyebrow-line" />{{ eyebrow }}</p>
      <h1 :id="headingId">{{ title }}</h1>
      <p v-if="description" class="screen-description">{{ description }}</p>
      <slot name="description" />
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
