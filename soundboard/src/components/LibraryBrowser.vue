<script setup>
import { computed, ref } from 'vue'
import {
  store,
  addGroupsToScene,
  addToPalette,
  deleteGroup,
  createGroup,
  openGroupEditor,
} from '../store.js'

const query = ref('')
const categoryFilter = ref('')
const tagFilter = ref('')
const kindFilter = ref('')
const newGroupName = ref('')
const creating = ref(false)

const categories = computed(() => {
  const names = new Set()
  for (const group of store.library.groups) {
    if (group.category) names.add(group.category)
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    depth: name.split('/').length - 1,
  }))
})

const tags = computed(() => {
  const set = new Set()
  for (const group of store.library.groups) {
    for (const tag of group.tags || []) set.add(tag)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.library.groups
    .filter((group) => {
      if (kindFilter.value && group.defaultKind !== kindFilter.value) return false
      if (categoryFilter.value) {
        if (
          group.category !== categoryFilter.value &&
          !group.category.startsWith(`${categoryFilter.value}/`)
        ) {
          return false
        }
      }
      if (tagFilter.value) {
        const wanted = tagFilter.value.toLowerCase()
        if (!group.tags.some((tag) => tag.toLowerCase() === wanted)) return false
      }
      if (!q) return true
      const haystack = [group.name, group.category, ...(group.tags || [])]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})

const selectedGroups = computed(() =>
  store.library.groups.filter((group) => store.librarySelection.includes(group.id))
)

function setSelection(id, event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    const index = store.librarySelection.indexOf(id)
    if (index >= 0) store.librarySelection.splice(index, 1)
    else store.librarySelection.push(id)
  } else {
    store.librarySelection = [id]
  }
}

function selectAllVisible() {
  store.librarySelection = filteredGroups.value.map((group) => group.id)
}

function addScene() {
  if (!store.librarySelection.length) return
  addGroupsToScene([...store.librarySelection])
}

function addPalette() {
  for (const group of selectedGroups.value) addToPalette(group.id)
}

function removeGroup(group) {
  if (!window.confirm(`Delete group "${group.name}" from the library?`)) return
  deleteGroup(group.id)
}

function startDrag(group, event) {
  if (!store.librarySelection.includes(group.id)) store.librarySelection = [group.id]
  event.dataTransfer.setData(
    'application/x-olea-groups',
    JSON.stringify([...store.librarySelection])
  )
  event.dataTransfer.effectAllowed = 'copy'
}

async function createBlankGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  creating.value = true
  const group = await createGroup({ name, sounds: [], selection: 'random' })
  creating.value = false
  if (group) {
    newGroupName.value = ''
    openGroupEditor(group.id)
  }
}
</script>

<template>
  <div class="browser-pane library-browser">
    <div class="stack">
      <input v-model="query" type="search" class="search-input" placeholder="Search groups, tags…" />

      <div class="filter-grid">
        <label class="field">
          <span>Category</span>
          <select v-model="categoryFilter" @change="categoryFilter = $event.target.value">
            <option value="">All categories</option>
            <option v-for="cat in categories" :key="cat.name" :value="cat.name">
              {{ '— '.repeat(cat.depth) }}{{ cat.name }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Tag</span>
          <select v-model="tagFilter">
            <option value="">All tags</option>
            <option v-for="tag in tags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </label>
        <label class="field">
          <span>Hint</span>
          <select v-model="kindFilter">
            <option value="">Any kind</option>
            <option value="loop">Loop</option>
            <option value="random">Random</option>
            <option value="oneshot">One-shot</option>
          </select>
        </label>
      </div>

      <div class="row wrap gap-sm">
        <button class="btn-sm" :disabled="!filteredGroups.length" @click="selectAllVisible">
          Select visible
        </button>
        <button class="btn-sm" :disabled="!selectedGroups.length" @click="addScene">
          Add {{ selectedGroups.length || '' }} to scene
        </button>
        <button class="btn-sm" :disabled="!selectedGroups.length" @click="addPalette">
          Add to palette
        </button>
      </div>

      <form class="row gap-sm" @submit.prevent="createBlankGroup">
        <input v-model="newGroupName" class="text-input grow" placeholder="New blank group" />
        <button class="btn-sm" type="submit" :disabled="creating || !newGroupName.trim()">
          Create
        </button>
      </form>
    </div>

    <ul class="group-list">
      <li
        v-for="group in filteredGroups"
        :key="group.id"
        class="group-item"
        :class="{ selected: store.librarySelection.includes(group.id) }"
        draggable="true"
        @dragstart="startDrag(group, $event)"
        @click="setSelection(group.id, $event)"
      >
        <div class="group-main">
          <span class="group-name">{{ group.name }}</span>
          <span class="small muted">
            {{ group.sounds.length }} sound{{ group.sounds.length === 1 ? '' : 's' }}
            <template v-if="group.category"> · {{ group.category }}</template>
          </span>
          <span v-if="group.defaultKind" class="badge" :class="`kind-${group.defaultKind}`">
            {{ group.defaultKind }}
          </span>
          <div v-if="group.tags.length" class="tag-row">
            <span v-for="tag in group.tags.slice(0, 4)" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="group-actions">
          <button class="btn-xs" title="Edit group" @click.stop="openGroupEditor(group.id)">
            Edit
          </button>
          <button class="btn-xs danger" title="Delete group" @click.stop="removeGroup(group)">
            ×
          </button>
        </div>
      </li>
      <li v-if="!filteredGroups.length" class="empty-mini">
        No matching groups. Import sounds to build the library.
      </li>
    </ul>
  </div>
</template>
