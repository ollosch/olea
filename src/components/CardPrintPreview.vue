<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { backSlotForFront, pageCards, sheetCount, type CardLayout, type DuplexFlip } from '../lib/cardPrint'
import CardFace from './PrintCardFace.vue'

export type PrintCardFace = {
  title?: string
  subtitle?: string
  fields?: Array<{ label: string; value: string }>
  content?: unknown
  note?: string
  nameOnly?: boolean
}
export type PrintCard = {
  id: string
  name: string
  front: PrintCardFace
  back: PrintCardFace
  warnings?: string[]
}

const props = defineProps<{ title: string; cards: PrintCard[]; layout: CardLayout; calibrationHref?: string }>()
const flip = ref<DuplexFlip>('long-edge')
const showCalibration = ref(false)
const measuredOverflow = ref<string[]>([])
const pages = computed(() => sheetCount(props.cards.length, props.layout))
const sheetNumbers = computed(() => Array.from({ length: pages.value }, (_, index) => index))
const warningNames = computed(() => [...new Set([...props.cards.filter((card) => card.warnings?.length).map((card) => card.name), ...measuredOverflow.value])])
const warningCount = computed(() => warningNames.value.length)
const pageStyle = computed(() => ({
  '--card-columns': props.layout.columns,
  '--card-rows': props.layout.rows,
  '--card-width-mm': `${props.layout.cardWidthMm}mm`,
  '--card-height-mm': `${props.layout.cardHeightMm}mm`,
  '--card-gap-mm': `${props.layout.gapMm}mm`,
}))

watch(() => [props.cards, props.layout], () => { void document.fonts?.ready.then(measureOverflow) }, { deep: true })
onMounted(measureOverflow)
onUpdated(measureOverflow)

let measureQueued = false
async function measureOverflow() {
  if (measureQueued) return
  measureQueued = true
  await nextTick()
  requestAnimationFrame(() => {
    const overflow = new Set<string>()
    for (const element of document.querySelectorAll<HTMLElement>('.card-print-workspace .print-sheet .print-card:not(.print-card-blank)')) {
      const face = element.querySelector<HTMLElement>('.card-face')
      if (face && face.scrollHeight > face.clientHeight + 1) {
        const name = face.querySelector('.card-name')?.textContent?.trim()
        if (name) overflow.add(name)
      }
    }
    const next = [...overflow].sort()
    if (next.join('\0') !== [...measuredOverflow.value].sort().join('\0')) measuredOverflow.value = next
    measureQueued = false
  })
}

function backCards(page: number): Array<PrintCard | null> {
  const fronts = pageCards(props.cards, props.layout, page)
  const backs: Array<PrintCard | null> = Array.from({ length: fronts.length }, () => null)
  fronts.forEach((card, frontSlot) => { backs[backSlotForFront(frontSlot, props.layout, flip.value)] = card })
  return backs
}

function print() {
  window.print()
}
</script>

<template>
  <section class="card-print-workspace" aria-labelledby="print-title">
    <header class="card-print-toolbar screen-only">
      <div><p class="eyebrow"><span class="eyebrow-line" /> PRINT PREVIEW</p><h1 id="print-title">{{ title }}</h1><p class="screen-description" role="status" aria-live="polite">{{ layout.label }} · {{ cards.length }} selected {{ cards.length === 1 ? 'card' : 'cards' }} · {{ pages }} {{ pages === 1 ? 'sheet' : 'sheets' }}</p></div>
      <div class="card-print-controls">
        <label class="filter-field">Duplex flip edge<select v-model="flip" class="select-input"><option value="long-edge">Long edge</option><option value="short-edge">Short edge</option></select></label>
        <label class="check-field"><input v-model="showCalibration" type="checkbox" /> Include calibration page</label>
        <button class="primary-button" type="button" :disabled="!cards.length" @click="print">Print / Save PDF</button>
        <RouterLink v-if="calibrationHref" class="secondary-link" :to="calibrationHref">Open calibration page</RouterLink>
      </div>
    </header>
    <p v-if="warningCount" class="print-warning screen-only" role="status">{{ warningCount }} card{{ warningCount === 1 ? '' : 's' }} may overflow its position: {{ warningNames.join(', ') }}. Edit the preferred description or use a larger card format; text is never automatically clipped or shrunk.</p>
    <p v-if="!cards.length" class="empty-state compact-empty screen-only">No cards are selected. Choose at least one card above to preview and print.</p>

    <template v-for="page in sheetNumbers" :key="`sheet-${page}`">
      <div class="print-sheet screen-only" :style="pageStyle" :aria-label="`Sheet ${page + 1} fronts`">
        <p class="print-side-label">Sheet {{ page + 1 }} · Fronts</p>
        <div class="print-sheet-grid">
          <article v-for="(card, slot) in pageCards(cards, layout, page)" :key="card?.id ?? `blank-front-${page}-${slot}`" class="print-card" :class="{ 'print-card-blank': !card, 'print-card-warning': card && warningNames.includes(card.name) }"><slot v-if="card" name="card" :card="card" side="front"><CardFace :card="card" side="front" /></slot></article>
        </div>
      </div>
      <div class="print-sheet screen-only" :style="pageStyle" :aria-label="`Sheet ${page + 1} backs`">
        <p class="print-side-label">Sheet {{ page + 1 }} · Backs ({{ flip }} flip)</p>
        <div class="print-sheet-grid">
          <article v-for="(card, slot) in backCards(page)" :key="card?.id ?? `blank-back-${page}-${slot}`" class="print-card" :class="{ 'print-card-blank': !card, 'print-card-warning': card && warningNames.includes(card.name) }"><slot v-if="card" name="card" :card="card" side="back"><CardFace :card="card" side="back" /></slot></article>
        </div>
      </div>
    </template>
    <div v-if="showCalibration" class="print-sheet calibration-sheet screen-only" :style="pageStyle" aria-label="Print calibration page">
      <p class="print-side-label">Calibration · measure the 50 mm square after printing at 100%</p>
      <div class="calibration-content"><div class="calibration-square"><span>50 mm</span></div><div class="calibration-ruler"><span v-for="mark in 11" :key="mark" :class="{ major: (mark - 1) % 5 === 0 }" /></div><p>Print at 100% / Actual size. Disable “Fit to page”. Confirm the square measures 50 × 50 mm and compare cut guides with card edges.</p></div>
      <div class="calibration-guides" aria-hidden="true"><i v-for="slot in layout.columns * layout.rows" :key="slot" /></div>
    </div>

    <div class="print-output" :style="pageStyle">
      <template v-for="page in sheetNumbers" :key="`output-${page}`">
      <section class="physical-page"><div class="physical-grid"><article v-for="(card, slot) in pageCards(cards, layout, page)" :key="card?.id ?? `out-front-${page}-${slot}`" class="physical-card"><slot v-if="card" name="card" :card="card" side="front"><CardFace :card="card" side="front" /></slot></article></div></section>
        <section class="physical-page"><div class="physical-grid"><article v-for="(card, slot) in backCards(page)" :key="card?.id ?? `out-back-${page}-${slot}`" class="physical-card"><slot v-if="card" name="card" :card="card" side="back"><CardFace :card="card" side="back" /></slot></article></div></section>
      </template>
      <section v-if="showCalibration" class="physical-page physical-calibration"><div class="calibration-square"><span>50 mm</span></div><div class="calibration-ruler"><span v-for="mark in 11" :key="mark" :class="{ major: (mark - 1) % 5 === 0 }" /></div><p>Print at 100% / Actual size. Confirm this square measures 50 × 50 mm.</p><div class="calibration-guides"><i v-for="slot in layout.columns * layout.rows" :key="slot" /></div></section>
    </div>
  </section>
</template>
