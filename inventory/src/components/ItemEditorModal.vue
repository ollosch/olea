<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useGameStore } from '../stores/game'
import { errorMessage } from '../utils/errors'
import { pb } from '../pb'

const props = defineProps({
  item: { type: Object, default: null },
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'saved'])

const game = useGameStore()

const form = reactive({
  name: '',
  category: '',
  kind: 'single',
  max_charges: '',
  weight: '',
  value: '',
  value_currency: '',
  description: '',
})

const imageFile = ref(null)
const error = ref('')
const busy = ref(false)

const isEdit = computed(() => !!props.item)

const previewUrl = computed(() => {
  if (imageFile.value) return URL.createObjectURL(imageFile.value)
  if (props.item?.image) return pb.files.getURL(props.item, props.item.image)
  return ''
})

function reset() {
  const it = props.item
  form.name = it?.name || ''
  form.category = it?.category || ''
  form.kind = it?.kind || 'single'
  form.max_charges = it?.max_charges || ''
  form.weight = it?.weight || ''
  form.value = it?.value || ''
  form.value_currency = it?.value_currency || ''
  form.description = it?.description || ''
  imageFile.value = null
  error.value = ''
}

watch(
  () => props.open,
  (v) => {
    if (v) reset()
  }
)

function onImage(e) {
  imageFile.value = e.target.files?.[0] || null
}

async function save() {
  if (!form.name.trim()) {
    error.value = 'Name is required'
    return
  }

  const fields = {
    name: form.name.trim(),
    category: form.category.trim(),
    kind: form.kind,
    value_currency: form.value_currency,
    description: form.description,
  }
  if (form.weight !== '') fields.weight = Number(form.weight)
  if (form.value !== '') fields.value = Number(form.value)
  if (form.kind === 'charges' && form.max_charges !== '') {
    fields.max_charges = Number(form.max_charges)
  }

  let payload = fields
  if (imageFile.value) {
    payload = new FormData()
    payload.append('image', imageFile.value)
    for (const [k, v] of Object.entries(fields)) payload.append(k, v)
  }

  busy.value = true
  error.value = ''
  try {
    if (isEdit.value) {
      await game.updateItem(props.item.id, payload)
    } else {
      await game.createItem(payload)
    }
    emit('saved')
    emit('close')
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="!busy && emit('close')">
    <div class="modal">
      <h3>{{ isEdit ? 'Edit item' : 'New item' }}</h3>

      <div class="field">
        <label for="item-name">Name</label>
        <input id="item-name" v-model="form.name" type="text" />
      </div>

      <div class="field">
        <label for="item-category">Category</label>
        <input id="item-category" v-model="form.category" type="text" list="item-categories" />
        <datalist id="item-categories">
          <option v-for="c in game.categories" :key="c" :value="c"></option>
        </datalist>
      </div>

      <div class="field">
        <label for="item-kind">Kind</label>
        <select id="item-kind" v-model="form.kind">
          <option value="single">single</option>
          <option value="stack">stack</option>
          <option value="charges">charges</option>
        </select>
      </div>

      <div v-if="form.kind === 'charges'" class="field">
        <label for="item-max-charges">Max charges</label>
        <input id="item-max-charges" v-model="form.max_charges" type="number" min="0" />
      </div>

      <div class="row">
        <div class="field grow">
          <label for="item-weight">Weight ({{ game.system?.weight_unit || 'lb' }})</label>
          <input id="item-weight" v-model="form.weight" type="number" min="0" />
        </div>
        <div class="field grow">
          <label for="item-value">Value</label>
          <input id="item-value" v-model="form.value" type="number" min="0" />
        </div>
      </div>

      <div class="field">
        <label for="item-value-currency">Value currency</label>
        <select id="item-value-currency" v-model="form.value_currency">
          <option value="">None</option>
          <option v-for="c in game.currencies" :key="c.id" :value="c.id">
            {{ c.symbol || c.name }}
          </option>
        </select>
      </div>

      <div class="field">
        <label for="item-description">Description</label>
        <textarea id="item-description" v-model="form.description" rows="3"></textarea>
      </div>

      <div class="field">
        <label for="item-image">Image</label>
        <input id="item-image" type="file" accept="image/*" @change="onImage" />
        <img v-if="previewUrl" :src="previewUrl" class="preview" alt="" />
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="row" style="margin-top: 1rem">
        <button class="primary grow" :disabled="busy" @click="save">Save</button>
        <button :disabled="busy" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview {
  margin-top: 0.5rem;
  max-width: 120px;
  max-height: 120px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
</style>
