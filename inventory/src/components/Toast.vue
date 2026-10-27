<script setup>
import { useToast } from '../composables/useToast'
const { state } = useToast()
</script>

<template>
  <Transition name="toast">
    <div v-if="state.visible" class="toast">{{ state.message }}</div>
  </Transition>
</template>
