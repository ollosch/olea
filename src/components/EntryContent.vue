<script setup lang="ts">
import { renderInlineText } from '../lib/content'

defineOptions({ name: 'EntryContent' })

const props = defineProps<{ value: unknown }>()

function display(value: unknown): string {
  if (typeof value === 'string') return renderInlineText(value)
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function linkify(value: string) {
  const escaped = escapeHTML(value)
  return escaped.replace(/\b(https?:\/\/[^\s<]+)/g, (url) => {
    const safeURL = url.replace(/[),.;]+$/, '')
    const suffix = url.slice(safeURL.length)
    return `<a href="${safeURL}" target="_blank" rel="noreferrer">${safeURL}</a>${suffix}`
  })
}
</script>

<template>
  <template v-if="typeof value === 'string'">
    <p class="entry-text" v-html="linkify(display(value))" />
  </template>
  <template v-else-if="Array.isArray(value)">
    <div class="entry-stack">
      <EntryContent v-for="(entry, index) in value" :key="index" :value="entry" />
    </div>
  </template>
  <template v-else-if="value && typeof value === 'object'">
    <section v-if="(value as Record<string, unknown>).type === 'table'" class="entry-table-wrap">
      <h3 v-if="(value as Record<string, unknown>).caption">{{ display((value as Record<string, unknown>).caption) }}</h3>
      <table class="entry-table">
        <thead v-if="Array.isArray((value as Record<string, unknown>).colLabels)"><tr><th v-for="(label, index) in (value as Record<string, unknown>).colLabels as unknown[]" :key="index">{{ display(label) }}</th></tr></thead>
        <tbody><tr v-for="(row, rowIndex) in ((value as Record<string, unknown>).rows as unknown[] || [])" :key="rowIndex"><td v-for="(cell, index) in (row as unknown[])" :key="index"><EntryContent :value="cell" /></td></tr></tbody>
      </table>
    </section>
    <ul v-else-if="(value as Record<string, unknown>).type === 'list' && Array.isArray((value as Record<string, unknown>).items)" class="entry-list">
      <li v-for="(entry, index) in (value as Record<string, unknown>).items as unknown[]" :key="index"><EntryContent :value="entry" /></li>
    </ul>
    <section v-else-if="Array.isArray((value as Record<string, unknown>).entries)" class="entry-section">
      <h3 v-if="(value as Record<string, unknown>).name">{{ display((value as Record<string, unknown>).name) }}</h3>
      <EntryContent :value="(value as Record<string, unknown>).entries" />
    </section>
    <section v-else-if="Array.isArray((value as Record<string, unknown>).items)" class="entry-section">
      <h3 v-if="(value as Record<string, unknown>).name">{{ display((value as Record<string, unknown>).name) }}</h3>
      <EntryContent :value="(value as Record<string, unknown>).items" />
    </section>
    <p v-else class="entry-unknown">{{ display(value) }}</p>
  </template>
  <p v-else-if="value !== null && value !== undefined">{{ display(value) }}</p>
</template>
