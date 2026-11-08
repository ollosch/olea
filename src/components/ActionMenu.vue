<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'

withDefaults(
  defineProps<{
    label: string
    align?: 'start' | 'center' | 'end'
    disabled?: boolean
  }>(),
  {
    align: 'end',
    disabled: false,
  },
)
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <button class="icon-button action-menu-trigger" type="button" :aria-label="label" :title="label" :disabled="disabled">
        <span aria-hidden="true">⋯</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="action-menu-content" :align="align" :side-offset="6">
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
