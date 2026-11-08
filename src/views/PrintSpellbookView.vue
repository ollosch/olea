<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { RouteLocationNamedRaw } from 'vue-router'
import CardPrintPreview, { type PrintCard } from '../components/CardPrintPreview.vue'
import PrintSelectionPanel, { type PrintSelectionOption } from '../components/PrintSelectionPanel.vue'
import { pb } from '../lib/pocketbase'
import type { CatalogRecord } from '../lib/catalog'
import { systemByKey } from '../lib/systems'
import { CARD_LAYOUTS } from '../lib/cardPrint'
import { spellPrintCard } from '../lib/printCards'

type Character = { id: string; name: string; game: string }
type Spellbook = { id: string; name: string; character: string }
type BookSpell = { id: string; spell: string; expand?: { spell?: CatalogRecord } }

const route = useRoute()
const character = ref<Character | null>(null)
const book = ref<Spellbook | null>(null)
const spells = ref<BookSpell[]>([])
const systemKey = ref('')
const selected = ref<string[]>([])
const loading = ref(true)
const error = ref('')
const system = computed(() => systemByKey(systemKey.value))
const cards = computed<PrintCard[]>(() => spells.value.flatMap((entry) => entry.expand?.spell ? [spellPrintCard(entry.expand.spell, system.value)] : []))
const selectedCards = computed(() => cards.value.filter((card) => selected.value.includes(card.id)))
const missingSpells = computed(() => spells.value.filter((entry) => !entry.expand?.spell).length)
const cardOptions = computed<PrintSelectionOption[]>(() => cards.value.map((card) => ({
  id: card.id,
  name: card.name,
  detail: card.front.fields?.map((field) => field.value).slice(0, 2).join(' · ') || 'Spell fields unavailable',
  warning: card.warnings?.length ? card.warnings.join(' ') : undefined,
})))
const returnTarget = computed<RouteLocationNamedRaw>(() => ({
  name: 'character-spellbooks',
  params: { characterId: character.value?.id ?? '' },
  query: book.value ? { book: book.value.id } : {},
  ...(book.value ? { state: { oleaSpellbookReturn: true } } : {}),
}))

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    character.value = await pb.collection('characters').getOne<Character>(String(route.params.characterId))
    book.value = await pb.collection('spellbooks').getOne<Spellbook>(String(route.params.spellbookId))
    if (book.value.character !== character.value.id) throw new Error('Book does not belong to character')
    const game = await pb.collection('games').getOne<{ system: string; expand?: { system?: { key: string } } }>(character.value.game, { expand: 'system' })
    systemKey.value = game.expand?.system?.key ?? ''
    spells.value = await pb.collection('spellbook_spells').getFullList<BookSpell>({ filter: pb.filter('spellbook = {:book}', { book: book.value.id }), sort: 'spell.name', expand: 'spell', requestKey: null })
    selected.value = spells.value.flatMap((entry) => entry.expand?.spell ? [entry.expand.spell.id] : [])
  } catch { error.value = 'This spellbook or its spells could not be loaded.' }
  finally { loading.value = false }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <div v-if="loading" class="loading-state" role="status">Loading spell cards…</div>
    <template v-else-if="character && book">
      <RouterLink class="text-link screen-only" :to="returnTarget">← {{ book.name }}</RouterLink>
      <PrintSelectionPanel
        class="screen-only"
        eyebrow="SPELLBOOK"
        :title="book.name"
        description="Select which cards to include. Card order follows the spellbook’s alphabetical list."
        legend="Spell cards"
        name="spells"
        noun="card"
        :options="cardOptions"
        :selected="selected"
        empty-text="This spellbook has no spells that can be printed."
        @update:selected="selected = $event"
      >
        <template #note>
          <p v-if="missingSpells" class="muted-hint" role="status">{{ missingSpells }} saved spell {{ missingSpells === 1 ? 'reference is' : 'references are' }} missing from the catalog and cannot be printed.</p>
        </template>
      </PrintSelectionPanel>
      <CardPrintPreview :title="`${character.name} · ${book.name}`" :cards="selectedCards" :layout="CARD_LAYOUTS.a6Four" :calibration-href="'/print/calibration'" />
    </template>
    <p v-else class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Retry</button></p>
  </section>
</template>
