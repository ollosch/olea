<script setup lang="ts">
import EntryContent from './EntryContent.vue'
import type { PrintCard } from './CardPrintPreview.vue'

const props = defineProps<{ card: PrintCard; side: 'front' | 'back' }>()
</script>

<template>
  <div class="card-face" :class="[`card-face-${side}`, { 'card-name-only': card[side].nameOnly }]">
    <p v-if="card[side].title" class="card-eyebrow">{{ card[side].title }}</p>
    <h2 class="card-name">{{ card.name }}</h2>
    <p v-if="card[side].subtitle" class="card-subtitle">{{ card[side].subtitle }}</p>
    <dl v-if="card[side].fields?.length" class="card-fields"><div v-for="field in card[side].fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
    <EntryContent v-if="card[side].content" :value="card[side].content" />
    <p v-if="card[side].note" class="card-note">{{ card[side].note }}</p>
  </div>
</template>
