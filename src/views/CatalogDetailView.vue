<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import EntryContent from '../components/EntryContent.vue'
import { pb } from '../lib/pocketbase'
import { itemTypeLabel, recordDescription, sourceLabel, type CatalogRecord } from '../lib/catalog'

const route = useRoute()
const record = ref<CatalogRecord | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    record.value = await pb.collection('catalog').getOne<CatalogRecord>(String(route.params.recordId), { expand: 'system' })
  } catch {
    error.value = 'This catalog entry could not be loaded. It may have been removed or the local server is unavailable.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <RouterLink class="text-link" to="/catalog">← Back to catalog</RouterLink>
    <div v-if="loading" class="loading-state" role="status">Loading catalog entry…</div>
    <p v-else-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <template v-else-if="record">
      <header class="catalog-detail-heading">
        <p class="eyebrow"><span class="eyebrow-line" /> {{ record.type.toUpperCase() }}</p>
        <h1 id="page-title">{{ record.name }}</h1>
        <p class="catalog-source">{{ sourceLabel(record) }}<template v-if="record.expand?.system"> · {{ record.expand.system.name }}</template></p>
      </header>
      <dl class="catalog-stats">
        <template v-if="record.type === 'spell'"><div><dt>Level</dt><dd>{{ record.level === '0' ? 'Cantrip' : record.level }}</dd></div><div><dt>School</dt><dd>{{ record.school || '—' }}</dd></div></template>
        <template v-else-if="record.type === 'creature'"><div><dt>Type</dt><dd>{{ record.creature_type || '—' }}</dd></div><div><dt>Challenge rating</dt><dd>{{ record.challenge_rating || '—' }}</dd></div><div v-if="record.hp_average !== undefined"><dt>Hit points</dt><dd>{{ record.hp_average }}<template v-if="record.hp_formula"> ({{ record.hp_formula }})</template></dd></div><div v-if="record.dexterity !== undefined"><dt>Dexterity</dt><dd>{{ record.dexterity }}</dd></div></template>
        <template v-else><div v-if="record.item_type !== undefined"><dt>Type</dt><dd>{{ itemTypeLabel(record.item_type) || String(record.item_type) }}</dd></div><div v-if="record.item_weight !== undefined"><dt>Weight</dt><dd>{{ record.item_weight }} lb.</dd></div><div v-if="record.item_value !== undefined"><dt>Value</dt><dd>{{ record.item_value }} cp</dd></div><div v-if="record.rarity"><dt>Rarity</dt><dd>{{ record.rarity }}</dd></div></template>
      </dl>
      <section class="catalog-content-panel"><div class="catalog-panel-heading"><h2>Description</h2><span class="content-label">Source text</span></div><EntryContent :value="recordDescription(record)" /></section>
      <details class="catalog-source-data"><summary>View original source data</summary><pre>{{ JSON.stringify(record.original_json, null, 2) }}</pre></details>
    </template>
  </section>
</template>
