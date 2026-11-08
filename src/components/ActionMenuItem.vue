<script setup lang="ts">
import { DropdownMenuItem } from 'reka-ui'

withDefaults(
  defineProps<{
    danger?: boolean
    disabled?: boolean
  }>(),
  {
    danger: false,
    disabled: false,
  },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <DropdownMenuItem
    class="action-menu-item"
    :class="{ 'is-danger': danger }"
    :disabled="disabled"
    @select="$emit('select')"
  >
    <slot />
  </DropdownMenuItem>
</template>
