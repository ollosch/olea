<script setup lang="ts">
import CardPrintPreview, { type PrintCard } from '../components/CardPrintPreview.vue'
import { CARD_LAYOUTS } from '../lib/cardPrint'

const samples: PrintCard[] = Array.from({ length: 5 }, (_, index) => ({
  id: `calibration-${index + 1}`,
  name: index === 4 ? 'Overflow example' : `Calibration card ${index + 1}`,
  front: { title: 'TEST FRONT', subtitle: 'A4 · four positions', fields: [{ label: 'Position', value: `${index + 1} of 5` }, { label: 'Scale', value: '100%' }], content: index === 4 ? 'This intentionally long calibration sample illustrates a warning. Real card content is not clipped or reduced to unreadable sizes.' : 'Cut along the outside guide marks. Keep printer scaling at Actual size.' },
  back: { title: 'TEST BACK', nameOnly: false, content: 'Back-face alignment test.' },
  warnings: index === 4 ? ['Sample long-text warning for calibration.'] : [],
}))
</script>

<template>
  <CardPrintPreview title="Print calibration" :cards="samples" :layout="CARD_LAYOUTS.a6Four" />
</template>
