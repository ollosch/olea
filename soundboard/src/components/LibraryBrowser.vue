<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  store,
  addGroupsToScene,
  addToPalette,
  deleteGroup,
  createGroup,
  openGroupEditor,
  refreshLibraryPage,
} from '../store.js'

const query = ref(store.libraryFilters.query)
const categoryFilter = ref(store.libraryFilters.category)
const tagFilter = ref(store.libraryFilters.tag)
const kindFilter = ref(store.libraryFilters.kind)
const newGroupName = ref('')
const creating = ref(false)
let filterTimer = null

const categories = computed(() =>
  (store.libraryFacets.categories || []).map((name) => ({
    name,
    depth: name.split('/').length - 1,
  }))
)

const tags = computed(() => store.libraryFacets.tags || [])

const filteredGroups = computed(() => store.libraryPage)
const pageStart = computed(() => (store.libraryTotal ? store.libraryOffset + 1 : 0))
const pageEnd = computed(() =>
  Math.min(store.libraryTotal, store.libraryOffset + store.libraryPage.length)
)
const canPrev = computed(() => store.libraryOffset > 0)
const canNext = computed(() => store.libraryOffset + store.libraryLimit < store.libraryTotal)

function applyFilters(offset = 0) {
  refreshLibraryPage({
    query: query.value,
    category: categoryFilter.value,
    tag: tagFilter.value,
    kind: kindFilter.value,
    offset,
  })
}

watch([query, categoryFilter, tagFilter, kindFilter], () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => applyFilters(0), 250)
})

function prevPage() {
  applyFilters(Math.max(0, store.libraryOffset - store.libraryLimit))
}

function nextPage() {
  applyFilters(store.libraryOffset + store.libraryLimit)
}

onMounted(() => {
  if (!store.libraryPage.length) applyFilters(0)
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

    <div class="library-pager row gap-sm wrap">
      <button class="btn-xs" :disabled="!canPrev || store.libraryLoading" @click="prevPage">
        ← Previous
      </button>
      <span class="small muted">
        Showing {{ pageStart }}–{{ pageEnd }} of {{ store.libraryTotal }}
        · max {{ store.libraryLimit }} per page
      </span>
      <button class="btn-xs" :disabled="!canNext || store.libraryLoading" @click="nextPage">
        Next →
      </button>
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
