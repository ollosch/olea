<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import ActionMenu from '../ActionMenu.vue'
import ActionMenuItem from '../ActionMenuItem.vue'
import type { CreatureHP, SystemCapabilities } from '../../lib/systems'
import type {
  Character,
  Combat,
  Combatant,
  CombatDraft,
  DisplaySettingField,
  Game,
  HPPreview,
  HPMode,
} from '../../lib/encounterModel'

const props = defineProps<{
  game: Game
  combat: Combat | null
  rules: SystemCapabilities['encounter']
  gameCharacters: Character[]
  combatants: Combatant[]
  activeCombatant: Combatant | null
  hpPreview: Record<string, HPPreview>
  diceError: string
  canStart: boolean
  hpSourceFor: (participant: Combatant) => CreatureHP
  pending: Record<string, boolean>
  uncertain: Record<string, boolean>
  participantErrors: Record<string, string>
  participantConflicts: Record<string, Combatant | null>
  groupError: string
  trackerError: string
  addError: string
  trackerPending: boolean
  trackerUncertain: boolean
  refreshRequired: boolean
  addPending: boolean
  addUncertain: boolean
}>()

const emit = defineEmits<{
  start: []
  reset: []
  end: []
  previous: []
  next: []
  'roll-group': []
  'add-character': [id: string]
  'add-custom': []
  'save-combatant': [participant: Combatant]
  'adjust-hp': [participant: Combatant, amount: number]
  'preview-hp': [participant: Combatant, mode: HPMode]
  'confirm-hp': [participant: Combatant]
  'remove-combatant': [participant: Combatant]
  'roll-one': [participant: Combatant]
  'set-tie-order': [participant: Combatant, direction: number]
  'save-display-setting': [field: DisplaySettingField, value: boolean]
  'refresh-live': []
  'resolve-conflict': [participant: Combatant, mode: 'keep' | 'discard']
}>()

const drafts = defineModel<Record<string, CombatDraft>>('drafts', { required: true })
const selectedForGroup = defineModel<string[]>('selectedForGroup', { required: true })
const initiativeModifiers = defineModel<Record<string, number | ''>>('initiativeModifiers', { required: true })
const customParticipantName = defineModel<string>('customParticipantName', { required: true })

const baseId = useId()
const selectedId = ref('')
const adjustAmounts = ref<Record<string, number | ''>>({})
const adjustError = ref('')

const activeIndex = computed(() => props.combatants.findIndex((participant) => participant.id === props.activeCombatant?.id))
const nextParticipant = computed(() => activeIndex.value >= 0 ? props.combatants[(activeIndex.value + 1) % props.combatants.length] ?? null : null)

watch(() => props.combat?.id, () => {
  selectedId.value = props.activeCombatant?.id ?? ''
  adjustAmounts.value = {}
  adjustError.value = ''
})
watch(() => props.activeCombatant?.id, (id, previous) => {
  if (!id) return
  if (!selectedId.value || selectedId.value === previous) selectedId.value = id
}, { immediate: true })
watch(() => props.combatants.map((participant) => participant.id).join('|'), () => {
  if (selectedId.value && !props.combatants.some((participant) => participant.id === selectedId.value)) {
    selectedId.value = props.activeCombatant?.id ?? ''
  }
})

function detailsId(participant: Combatant) {
  return `${baseId}-details-${participant.id}`
}

function typeLabel(participant: Combatant) {
  if (participant.enemy) return 'Enemy'
  if (participant.character) return 'Character'
  return 'Participant'
}

function sourceLabel(participant: Combatant) {
  const creature = participant.prepared && participant.expand?.prepared?.expand?.creature
  return creature ? `${typeLabel(participant)} · ${creature.source}` : typeLabel(participant)
}

function initiativeText(participant: Combatant) {
  return participant.initiative_known ? `Init ${participant.initiative}` : 'No initiative'
}

function hpText(participant: Combatant) {
  return participant.hp_known ? `HP ${participant.current_hp}/${participant.max_hp}` : 'HP unknown'
}

function hpClass(participant: Combatant) {
  if (!participant.hp_known) return 'is-unknown'
  return participant.current_hp <= 0 ? 'is-zero' : ''
}

function hasConflict(participant: Combatant) {
  return Object.prototype.hasOwnProperty.call(props.participantConflicts, participant.id)
}

function conflictRecord(participant: Combatant) {
  return props.participantConflicts[participant.id] ?? null
}

function isBusy(participant: Combatant) {
  return Boolean(props.pending[participant.id] || props.uncertain[participant.id] || props.refreshRequired || hasConflict(participant))
}

function isTrackerBlocked() {
  return props.trackerPending || props.trackerUncertain || props.refreshRequired
}

function participantError(participant: Combatant) {
  return props.participantErrors[participant.id] ?? ''
}

function toggleParticipant(participant: Combatant) {
  selectedId.value = participant.id
  adjustError.value = ''
}

function applyHP(participant: Combatant, direction: -1 | 1) {
  const raw = adjustAmounts.value[participant.id]
  const amount = Number(raw)
  adjustError.value = ''
  if (raw === '' || raw === undefined || !Number.isFinite(amount) || amount <= 0) {
    adjustError.value = 'Enter an amount greater than zero.'
    return
  }
  emit('adjust-hp', participant, direction * amount)
}

function saveParticipant(participant: Combatant) {
  emit('save-combatant', participant)
}

function addCharacter(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) emit('add-character', select.value)
  select.value = ''
}

function saveDisplaySetting(field: DisplaySettingField, event: Event) {
  emit('save-display-setting', field, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <section class="encounter-live" :class="{ 'is-active': combat?.active }" aria-labelledby="encounter-live-title">
    <div class="combat-panel">
      <div class="spellbook-heading">
        <div>
          <p class="eyebrow">LIVE PLAY · ACTIVE COMBAT</p>
          <h2 id="encounter-live-title">{{ combat?.active ? 'Combat in progress' : 'Ready to start' }}</h2>
          <p v-if="combat?.active" class="encounter-section-note">Changes here affect this combat only. The reusable preparation above stays unchanged.</p>
          <p v-else class="encounter-section-note">Starting combat copies the prepared creature quantities into a separate live tracker; later preparation edits do not change it.</p>
        </div>
        <div class="row-actions">
          <RouterLink v-if="combat?.active && game.encounter_visible" class="secondary-link" :to="{ name: 'player-encounter', params: { gameId: game.id } }">Player view</RouterLink>
          <button v-if="!combat?.active" class="primary-button" type="button" :disabled="!canStart" @click="emit('start')">Start combat</button>
          <template v-else>
            <span class="round-pill">Round {{ combat.round }}</span>
            <button class="secondary-button" type="button" :disabled="isTrackerBlocked()" @click="emit('reset')">Reset</button>
            <button class="danger-button" type="button" :disabled="isTrackerBlocked()" @click="emit('end')">End combat</button>
          </template>
        </div>
      </div>
      <template v-if="combat?.active">
        <details class="player-display-settings">
          <summary>Player display settings</summary>
          <p>These settings hide details in the player-facing UI only; they are not access controls on this trusted LAN.</p>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_visible" @change="saveDisplaySetting('encounter_visible', $event)" /> Show active encounter</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_initiative" @change="saveDisplaySetting('encounter_show_initiative', $event)" /> Show initiative</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_enemy_names" @change="saveDisplaySetting('encounter_show_enemy_names', $event)" /> Show enemy names</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_hp" @change="saveDisplaySetting('encounter_show_hp', $event)" /> Show enemy HP</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_conditions" @change="saveDisplaySetting('encounter_show_conditions', $event)" /> Show conditions</label>
        </details>
        <p v-if="diceError" class="field-error" role="alert">{{ diceError }}</p>
        <div class="turn-controls">
          <button class="secondary-button" type="button" :disabled="!combatants.length || isTrackerBlocked()" @click="emit('previous')">← Previous</button>
          <div class="turn-summary">
            <p v-if="activeCombatant"><strong>Active:</strong> {{ activeCombatant.name }}</p>
            <p v-else>No participants yet</p>
            <small v-if="nextParticipant && combatants.length > 1">Next: {{ nextParticipant.name }}</small>
          </div>
          <button class="secondary-button" type="button" :disabled="!combatants.length || isTrackerBlocked()" @click="emit('next')">Next →</button>
        </div>
        <p v-if="trackerError" class="field-error live-action-error" role="alert">{{ trackerError }} <button class="inline-button" type="button" @click="emit('refresh-live')">Refresh live state</button></p>
        <div v-if="rules.initiative" class="group-roll live-group-roll">
          <span>{{ rules.initiative.groupLabel }}. Tick participants in the roster to include them.</span>
          <button class="secondary-button" type="button" :disabled="!selectedForGroup.length || refreshRequired" @click="emit('roll-group')">Roll group</button>
        </div>
        <p v-if="groupError" class="field-error live-action-error" role="alert">{{ groupError }} <button class="inline-button" type="button" @click="emit('refresh-live')">Refresh live state</button></p>
        <p v-else class="muted-hint">Initiative and turn order are manual. Use the arrows to arrange participants.</p>
        <details class="live-tools">
          <summary>Add participant</summary>
          <div class="live-tools-body participant-add">
            <p v-if="addError" class="field-error live-action-error" role="alert">{{ addError }} <button class="inline-button" type="button" @click="emit('refresh-live')">Refresh live state</button></p>
            <label class="filter-field">Add character
              <select class="select-input" :disabled="addPending || addUncertain || refreshRequired || gameCharacters.every((character) => combatants.some((entry) => entry.character === character.id))" @change="addCharacter">
                <option value="">Choose a character</option>
                <option v-for="character in gameCharacters.filter((entry) => !combatants.some((participant) => participant.character === entry.id))" :key="character.id" :value="character.id">{{ character.name }}</option>
              </select>
            </label>
            <form class="custom-participant-form" @submit.prevent="emit('add-custom')">
              <label class="filter-field">Add custom participant<input v-model="customParticipantName" class="text-input" maxlength="255" placeholder="Name" :disabled="addPending || addUncertain || refreshRequired" /></label>
              <button class="secondary-button" type="submit" :disabled="addPending || addUncertain || refreshRequired || !customParticipantName.trim()">Add</button>
            </form>
          </div>
        </details>
        <div v-if="combatants.length" class="combatant-list" aria-label="Combat order">
          <article v-for="participant in combatants" :key="participant.id" class="combatant-card" :class="{ active: activeCombatant?.id === participant.id }">
            <div class="combatant-roster-row">
              <label v-if="rules.initiative" class="select-combatant" @click.stop>
                <input v-model="selectedForGroup" type="checkbox" :value="participant.id" :aria-label="`Select ${participant.name} for group initiative`" /> Select
              </label>
              <button
                class="combatant-summary"
                type="button"
                :aria-expanded="selectedId === participant.id"
                :aria-controls="detailsId(participant)"
                @click="toggleParticipant(participant)"
              >
                <span class="combatant-active-marker" aria-hidden="true" />
                <span class="combatant-copy">
                  <strong>{{ participant.name }}</strong>
                  <small>{{ sourceLabel(participant) }}<template v-if="activeCombatant?.id === participant.id"> · Active turn</template></small>
                </span>
                <span class="combatant-badges">
                  <span class="initiative-pill">{{ initiativeText(participant) }}</span>
                  <span class="hp-pill" :class="hpClass(participant)">{{ hpText(participant) }}</span>
                  <span v-if="participant.conditions" class="condition-pill" :title="participant.conditions">{{ participant.conditions }}</span>
                  <span v-else class="condition-pill is-empty">No conditions</span>
                  <span v-if="hasConflict(participant)" class="condition-pill is-error">Conflict — review</span>
                  <span v-else-if="participantError(participant)" class="condition-pill is-error" :title="participantError(participant)">Action needs review</span>
                </span>
                <span class="combatant-chevron" aria-hidden="true">{{ selectedId === participant.id ? '▾' : '▸' }}</span>
              </button>
            </div>
            <div v-if="selectedId === participant.id" :id="detailsId(participant)" class="combatant-details" role="region" :aria-label="`Details for ${participant.name}`">
              <p v-if="participantError(participant)" class="field-error" role="alert">{{ participantError(participant) }} <button class="inline-button" type="button" @click="emit('refresh-live')">Refresh live state</button></p>
              <p v-else-if="uncertain[participant.id]" class="field-error" role="alert">The last change could not be confirmed. Refresh live state before another change so a delayed write is not repeated.</p>
              <div v-if="hasConflict(participant)" class="conflict-actions" role="group" aria-label="Conflict resolution">
                <button v-if="conflictRecord(participant)" class="secondary-button" type="button" @click="emit('resolve-conflict', participant, 'keep')">Keep my draft and retry</button>
                <button v-if="conflictRecord(participant)" class="secondary-button" type="button" @click="emit('resolve-conflict', participant, 'discard')">Use server values</button>
              </div>
              <form class="hp-adjust" @submit.prevent>
                <label class="filter-field">Damage or healing amount
                  <input v-model.number="adjustAmounts[participant.id]" class="text-input" type="number" min="0" step="any" placeholder="Amount" :disabled="isBusy(participant)" />
                </label>
                <button class="secondary-button" type="button" :disabled="isBusy(participant)" @click="applyHP(participant, -1)">Apply damage</button>
                <button class="secondary-button" type="button" :disabled="isBusy(participant)" @click="applyHP(participant, 1)">Apply healing</button>
              </form>
              <p v-if="adjustError" class="field-error" role="alert">{{ adjustError }}</p>
              <p v-if="!participant.hp_known" class="muted-hint">HP is unknown. Use Set HP below or enter both current and max HP before applying an amount.</p>
              <div class="combatant-fields">
                <label class="filter-field">Initiative<input v-model.number="drafts[participant.id]!.initiative" class="text-input" type="number" step="any" placeholder="—" :disabled="isBusy(participant)" /></label>
                <label v-if="rules.initiative" class="filter-field">Initiative modifier<input v-model.number="initiativeModifiers[participant.id]" class="text-input" type="number" min="-20" max="20" step="1" :placeholder="participant.dexterity_known ? String(participant.dexterity_modifier) : 'Manual or unset'" :disabled="isBusy(participant)" /></label>
                <label class="filter-field">Current HP<input v-model.number="drafts[participant.id]!.current_hp" class="text-input" type="number" min="0" step="any" placeholder="—" :disabled="isBusy(participant)" /></label>
                <label class="filter-field">Max HP<input v-model.number="drafts[participant.id]!.max_hp" class="text-input" type="number" min="0" step="any" placeholder="—" :disabled="isBusy(participant)" /></label>
                <label class="filter-field">Conditions<input v-model="drafts[participant.id]!.conditions" class="text-input" placeholder="e.g. prone" :disabled="isBusy(participant)" /></label>
                <label class="filter-field">Notes<input v-model="drafts[participant.id]!.notes" class="text-input" placeholder="Notes" :disabled="isBusy(participant)" /></label>
                <button class="secondary-button" type="button" :disabled="isBusy(participant)" @click="saveParticipant(participant)">Save participant</button>
              </div>
              <div v-if="participant.enemy" class="hp-roll-controls">
                <span>HP source actions</span>
                <button v-if="hpSourceFor(participant).average !== null" class="inline-button" type="button" :disabled="isBusy(participant)" @click="emit('preview-hp', participant, 'average')">Use average</button>
                <button v-if="hpSourceFor(participant).formula" class="inline-button" type="button" :disabled="isBusy(participant)" @click="emit('preview-hp', participant, 'roll')">Roll HP</button>
                <button class="inline-button" type="button" :disabled="isBusy(participant)" @click="emit('preview-hp', participant, 'manual')">Preview manual</button>
                <span v-if="hpPreview[participant.id]" class="preview-confirm">Preview: {{ hpPreview[participant.id]!.current }}/{{ hpPreview[participant.id]!.max }} <button class="secondary-button" type="button" :disabled="isBusy(participant)" @click="emit('confirm-hp', participant)">Confirm HP</button></span>
              </div>
              <div class="participant-secondary">
                <ActionMenu :label="`Participant actions for ${participant.name}`" :disabled="isBusy(participant)">
                  <ActionMenuItem v-if="rules.initiative" @select="emit('roll-one', participant)">Roll initiative</ActionMenuItem>
                  <ActionMenuItem @select="emit('set-tie-order', participant, -1)">Move up in tie order</ActionMenuItem>
                  <ActionMenuItem @select="emit('set-tie-order', participant, 1)">Move down in tie order</ActionMenuItem>
                  <ActionMenuItem danger @select="emit('remove-combatant', participant)">Remove participant</ActionMenuItem>
                </ActionMenu>
                <small>Initiative rolls, manual order changes and removal are grouped here.</small>
              </div>
            </div>
          </article>
        </div>
        <p v-else class="muted-hint">No live participants. Add game characters or custom participants.</p>
      </template>
    </div>
  </section>
</template>
