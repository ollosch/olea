<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { pb } from '../lib/pocketbase'

type ProfileRecord = { id: string; name: string }
type CharacterRecord = { id: string; name: string; game: string; owner: string; expand?: { owner?: ProfileRecord } }
type GameRecord = { id: string; name: string; system: string; gm_profile: string; expand?: { system?: { name: string }; gm_profile?: ProfileRecord } }

const route = useRoute()
const router = useRouter()
const gameId = computed(() => String(route.params.gameId))
const game = ref<GameRecord | null>(null)
const characters = ref<CharacterRecord[]>([])
const loading = ref(true)
const error = ref('')
const formOpen = ref(false)
const editingId = ref('')
const name = ref('')
const saving = ref(false)
const formError = ref('')
const canDeleteGame = ref(false)
const profiles = ref<ProfileRecord[]>([])
const profileFormOpen = ref(false)
const profileName = ref('')
const profileFormError = ref('')
const profileSaving = ref(false)
const updatingOwner = ref('')
const updatingGm = ref(false)

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [gameRecord, characterRecords, profileRecords] = await Promise.all([
      pb.collection('games').getOne<GameRecord>(gameId.value, { expand: 'system,gm_profile' }),
      pb.collection('characters').getFullList<CharacterRecord>({ filter: pb.filter('game = {:gameId}', { gameId: gameId.value }), sort: 'name', expand: 'owner' }),
      pb.collection('profiles').getFullList<ProfileRecord>({ sort: 'name' }),
    ])
    game.value = gameRecord
    characters.value = characterRecords
    profiles.value = profileRecords
  } catch {
    error.value = 'This game or its characters could not be loaded.'
  } finally {
    loading.value = false
  }
}

async function createProfile() {
  const cleanName = profileName.value.trim()
  if (!cleanName) {
    profileFormError.value = 'Enter a profile name.'
    return
  }
  profileSaving.value = true
  profileFormError.value = ''
  try {
    const profile = await pb.collection('profiles').create<ProfileRecord>({ name: cleanName })
    profiles.value = [...profiles.value, profile].sort((a, b) => a.name.localeCompare(b.name))
    profileName.value = ''
    profileFormOpen.value = false
  } catch {
    profileFormError.value = 'The profile could not be created. Check the connection and try again.'
  } finally {
    profileSaving.value = false
  }
}

async function assignOwner(character: CharacterRecord, owner: string) {
  updatingOwner.value = character.id
  try {
    await pb.collection('characters').update(character.id, { owner })
    await load()
    window.dispatchEvent(new Event('olea-profile-changed'))
  } catch {
    await load()
    error.value = 'The character owner could not be updated. Check the connection and try again.'
  } finally {
    updatingOwner.value = ''
  }
}

async function assignGameMaster(profileId: string) {
  if (!game.value) return
  updatingGm.value = true
  try {
    await pb.collection('games').update(game.value.id, { gm_profile: profileId })
    await load()
    window.dispatchEvent(new Event('olea-profile-changed'))
  } catch {
    error.value = 'The Game Master profile could not be updated. Check the connection and try again.'
  } finally {
    updatingGm.value = false
  }
}

function beginCreate() {
  editingId.value = ''
  name.value = ''
  formError.value = ''
  formOpen.value = true
}

function beginEdit(character: CharacterRecord) {
  editingId.value = character.id
  name.value = character.name
  formError.value = ''
  formOpen.value = true
}

async function saveCharacter() {
  const cleanName = name.value.trim()
  if (!cleanName) {
    formError.value = 'Enter a character name.'
    return
  }
  saving.value = true
  try {
    if (editingId.value) await pb.collection('characters').update(editingId.value, { name: cleanName })
    else await pb.collection('characters').create({ name: cleanName, game: gameId.value })
    formOpen.value = false
    await load()
  } catch {
    formError.value = 'The character could not be saved. Check the connection and try again.'
  } finally {
    saving.value = false
  }
}

async function deleteCharacter(character: CharacterRecord) {
  if (!window.confirm(`Delete “${character.name}” and its inventory, personal stashes and spellbooks? This cannot be undone.`)) return
  try {
    await pb.collection('characters').delete(character.id)
    await load()
  } catch {
    error.value = 'The character could not be deleted. Check the connection and try again.'
  }
}

async function deleteEmptyGame() {
  if (!game.value || characters.value.length) return
  if (!window.confirm(`Delete “${game.value.name}” and its stashes? This cannot be undone.`)) return
  try {
    await pb.collection('games').delete(game.value.id)
    await router.push({ name: 'games' })
  } catch {
    error.value = 'The game could not be deleted. Check the connection and try again.'
  }
}
</script>

<template>
  <section class="screen" aria-labelledby="page-title">
    <p v-if="error" class="alert-message" role="alert">{{ error }} <button class="inline-button" type="button" @click="load">Try again</button></p>
    <div v-if="loading" class="loading-state" role="status">Loading game…</div>
    <template v-else-if="game">
      <div class="screen-heading">
        <div>
          <p class="eyebrow"><span class="eyebrow-line" /> {{ game.expand?.system?.name ?? 'GAME' }}</p>
          <h1 id="page-title">{{ game.name }}</h1>
          <p class="screen-description">Create and manage the characters in this game.</p>
        </div>
        <div class="heading-actions">
          <RouterLink class="secondary-link" to="/games">All games</RouterLink>
          <RouterLink class="secondary-link" :to="{ name: 'game-encounters', params: { gameId: game.id } }">Encounters</RouterLink>
          <RouterLink class="secondary-link" :to="{ name: 'game-tables', params: { gameId: game.id } }">Random tables</RouterLink>
          <button class="primary-button" type="button" @click="beginCreate"><span aria-hidden="true">＋</span> Add character</button>
        </div>
      </div>

      <section class="gm-settings" aria-labelledby="gm-title">
        <div class="gm-copy"><p class="eyebrow">GAME MASTER</p><h2 id="gm-title">{{ game.expand?.gm_profile?.name ?? 'Not assigned' }}</h2><p class="muted-hint">Profiles organize ownership and preferences; they are not accounts or access controls.</p></div>
        <label class="field-label gm-select-label" for="gm-profile">Assign GM
          <select id="gm-profile" class="select-input" :value="game.gm_profile" :disabled="updatingGm" @change="assignGameMaster(($event.target as HTMLSelectElement).value)">
            <option value="">Not assigned</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <DialogRoot v-model:open="profileFormOpen">
          <DialogTrigger class="secondary-button" @click="profileFormError = ''">New profile</DialogTrigger>
          <DialogPortal>
            <DialogOverlay class="dialog-overlay" />
            <DialogContent class="dialog-content">
              <div class="dialog-heading"><div><p class="eyebrow">LOCAL PROFILE</p><DialogTitle class="dialog-title">Create a profile</DialogTitle></div><DialogClose class="icon-button" aria-label="Close profile form">×</DialogClose></div>
              <DialogDescription class="dialog-description">Profiles are names used to assign character ownership and a game's GM. They do not create login accounts or restrict access.</DialogDescription>
              <form @submit.prevent="createProfile">
                <label class="field-label" for="profile-name">Name</label>
                <input id="profile-name" v-model="profileName" class="text-input" maxlength="120" required autocomplete="off" placeholder="e.g. Alex" />
                <p v-if="profileFormError" class="field-error" role="alert">{{ profileFormError }}</p>
                <div class="form-actions"><DialogClose class="secondary-button">Cancel</DialogClose><button class="primary-button" type="submit" :disabled="profileSaving">{{ profileSaving ? 'Saving…' : 'Create profile' }}</button></div>
              </form>
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
      </section>

      <form v-if="formOpen" class="editor-panel" @submit.prevent="saveCharacter">
        <h2>{{ editingId ? 'Rename character' : 'Add a character' }}</h2>
        <label class="field-label" for="character-name">Character name</label>
        <input id="character-name" v-model="name" class="text-input" maxlength="160" required autocomplete="off" placeholder="e.g. Rowan Ashford" />
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="form-actions"><button class="secondary-button" type="button" @click="formOpen = false">Cancel</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save character' }}</button></div>
      </form>

      <div v-if="characters.length" class="character-list" aria-label="Game characters">
        <article v-for="character in characters" :key="character.id" class="character-management-row">
          <div class="game-icon" aria-hidden="true">✧</div>
          <div class="game-copy"><h2>{{ character.name }}</h2><p>{{ character.expand?.owner?.name ? `Owned by ${character.expand.owner.name}` : 'No owner assigned' }}</p></div>
          <label class="owner-field" :for="`owner-${character.id}`">Owner
            <select :id="`owner-${character.id}`" class="select-input" :value="character.owner" :disabled="updatingOwner === character.id" @change="assignOwner(character, ($event.target as HTMLSelectElement).value)">
              <option value="">Unassigned</option>
              <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
            </select>
          </label>
          <div class="row-actions"><RouterLink class="secondary-link" :to="{ name: 'character-overview', params: { characterId: character.id } }">Overview</RouterLink><button class="secondary-button" type="button" @click="beginEdit(character)">Rename</button><button class="danger-button" type="button" @click="deleteCharacter(character)">Delete</button></div>
        </article>
      </div>
      <div v-else class="empty-state compact-empty"><div class="empty-state-icon" aria-hidden="true">✧</div><h2>No characters yet</h2><p>Add the characters who will play in {{ game.name }}.</p><button class="primary-button empty-action" type="button" @click="beginCreate">Add the first character</button></div>

      <div class="management-footer"><button class="danger-button" type="button" :disabled="characters.length > 0" :title="characters.length ? 'Delete the characters first' : 'Delete this empty game'" @click="deleteEmptyGame">Delete empty game</button><span v-if="characters.length" class="muted-hint">Delete characters before deleting this game.</span></div>
    </template>
  </section>
</template>
