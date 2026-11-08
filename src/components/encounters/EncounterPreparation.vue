<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import ActionMenu from '../ActionMenu.vue'
import ActionMenuItem from '../ActionMenuItem.vue'
import type { Entry, EntryDraft, Encounter } from '../../lib/encounterModel'
import type { SystemCapabilities } from '../../lib/systems'

const props = defineProps<{
  encounter: Encounter
  entries: Entry[]
  system: SystemCapabilities
  printTarget: RouteLocationRaw
  combatActive: boolean
}>()

const emit = defineEmits<{
  'add-catalog': []
  'add-custom': []
  'save-entry': [entry: Entry]
  'remove-entry': [entry: Entry]
  rename: []
  duplicate: []
  delete: []
  print: []
}>()

const drafts = defineModel<Record<string, EntryDraft>>('drafts', { required: true })
const customOpen = defineModel<boolean>('customOpen', { required: true })
const customName = defineModel<string>('customName', { required: true })
const customQuantity = defineModel<number>('customQuantity', { required: true })
const customNotes = defineModel<string>('customNotes', { required: true })

const customValid = computed(() => Boolean(customName.value.trim()) && Number.isInteger(customQuantity.value) && customQuantity.value >= 1 && customQuantity.value <= 100)

function entryLabel(entry: Entry) {
  if (entry.custom) return 'Custom participant'
  return entry.expand?.creature ? props.system.catalog.resultLabel(entry.expand.creature) : 'Catalog record missing'
}

function submitCustom() {
  if (!customValid.value) return
  emit('add-custom')
}
</script>

<template>
  <section class="encounter-preparation" aria-labelledby="encounter-preparation-title">
    <div class="spellbook-heading">
      <div>
        <p class="eyebrow">PREPARATION · REUSABLE</p>
        <h2 id="encounter-preparation-title">{{ encounter.name }}</h2>
        <p class="encounter-section-note">Changes here update the reusable encounter and future combats. They do not change an active combat.</p>
      </div>
      <div class="row-actions">
        <RouterLink class="secondary-link" :to="printTarget" @click="emit('print')">Print monster cards</RouterLink>
        <ActionMenu :label="`Encounter actions for ${encounter.name}`">
          <ActionMenuItem @select="emit('rename')">Rename encounter</ActionMenuItem>
          <ActionMenuItem @select="emit('duplicate')">Duplicate encounter</ActionMenuItem>
          <ActionMenuItem danger @select="emit('delete')">Delete encounter</ActionMenuItem>
        </ActionMenu>
      </div>
    </div>
    <p v-if="combatActive" class="preparation-active-note" role="note">An active combat has its own participants and values. Editing this preparation does not change that combat; live changes are made in the live-play section below.</p>
    <div class="heading-actions">
      <button class="primary-button" type="button" @click="emit('add-catalog')">＋ Add catalog creature</button>
      <button class="secondary-button" type="button" @click="customOpen = !customOpen">＋ Add custom participant</button>
    </div>
    <form v-if="customOpen" class="editor-panel" @submit.prevent="submitCustom">
      <h2>Custom participant</h2>
      <label class="field-label" for="custom-creature-name">Name</label>
      <input id="custom-creature-name" v-model="customName" class="text-input" maxlength="255" required />
      <label class="field-label" for="custom-creature-quantity">Quantity</label>
      <input id="custom-creature-quantity" v-model.number="customQuantity" class="text-input" type="number" min="1" max="100" step="1" required />
      <label class="field-label" for="custom-creature-notes">Notes</label>
      <textarea id="custom-creature-notes" v-model="customNotes" class="text-area" />
      <div class="form-actions">
        <button class="secondary-button" type="button" @click="customOpen = false">Cancel</button>
        <button class="primary-button" type="submit" :disabled="!customValid">Add participant</button>
      </div>
    </form>
    <div v-if="entries.length" class="encounter-entry-list">
      <article v-for="entry in entries" :key="entry.id" class="inventory-row">
        <div class="inventory-item-copy">
          <strong>{{ entry.name }}</strong>
          <small>{{ entryLabel(entry) }}</small>
        </div>
        <div class="encounter-entry-edit">
          <label class="filter-field">Quantity<input v-model.number="drafts[entry.id]!.quantity" class="text-input" type="number" min="1" max="100" step="1" /></label>
          <label class="filter-field">Notes<input v-model="drafts[entry.id]!.notes" class="text-input" maxlength="100000" /></label>
        </div>
        <div class="row-actions">
          <button class="secondary-button" type="button" @click="emit('save-entry', entry)">Save</button>
          <button class="danger-button" type="button" @click="emit('remove-entry', entry)">Remove</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state compact-empty">
      <div class="empty-state-icon" aria-hidden="true">⚔</div>
      <h2>No creatures prepared</h2>
      <p>Add catalog creatures or custom participants. This grouping can be kept for reuse or deleted after printing.</p>
      <button class="primary-button empty-action" type="button" @click="emit('add-catalog')">＋ Add catalog creature</button>
    </div>
  </section>
</template>
