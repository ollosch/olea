<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Character, CombatSetupDraft, PlannedCombatant } from '../../lib/encounterModel'
import type { CreatureHP, SystemCapabilities } from '../../lib/systems'
import { previewSetupHP } from '../../lib/combatSetup'

const props = defineProps<{
  planned: PlannedCombatant[]
  rules: SystemCapabilities['encounter']
  characters: Character[]
  hpSourceFor: (participant: PlannedCombatant) => CreatureHP
  modifierFor: (participant: PlannedCombatant) => number | null
  canStart: boolean
  starting: boolean
  recoveryRequired: boolean
}>()

const emit = defineEmits<{
  start: []
  'add-character': [id: string]
  'add-custom': [name: string]
  'remove-planned': [participant: PlannedCombatant]
}>()

const drafts = defineModel<Record<string, CombatSetupDraft>>('drafts', { required: true })
const selectedForGroup = defineModel<string[]>('selectedForGroup', { required: true })

const characterChoice = ref('')
const customName = ref('')
const localError = ref('')

const availableCharacters = computed(() => props.characters.filter((character) => !props.planned.some((participant) => participant.character === character.id)))
const unsetInitiative = computed(() => props.planned.filter((participant) => drafts.value[participant.key]?.initiative === '').length)
const unsetHP = computed(() => props.planned.filter((participant) => {
  const draft = drafts.value[participant.key]
  return !draft || draft.currentHp === '' || draft.maxHp === ''
}).length)

function labelFor(participant: PlannedCombatant) {
  if (participant.prepared) return 'Prepared creature'
  if (participant.character) return 'Game character'
  return 'Custom participant'
}

function addCharacter() {
  if (!characterChoice.value) return
  emit('add-character', characterChoice.value)
  characterChoice.value = ''
}

function addCustom() {
  const name = customName.value.trim()
  if (!name) return
  emit('add-custom', name)
  customName.value = ''
}

function effectiveModifier(participant: PlannedCombatant) {
  const draft = drafts.value[participant.key]
  const raw = draft?.initiativeModifier
  if (raw !== '' && raw !== undefined) return Number(raw)
  return props.modifierFor(participant) ?? 0
}

function hpPartial(participant: PlannedCombatant) {
  const draft = drafts.value[participant.key]
  return Boolean(draft) && ((draft!.currentHp === '') !== (draft!.maxHp === ''))
}

function hpFlag(participant: PlannedCombatant) {
  const draft = drafts.value[participant.key]
  if (!draft || (draft.currentHp === '' && draft.maxHp === '')) return { set: false, text: 'HP unset' }
  if (draft.currentHp === '' || draft.maxHp === '') return { set: false, text: 'HP partially set' }
  return { set: true, text: `HP ${draft.currentHp} / ${draft.maxHp}` }
}

function setHP(participant: PlannedCombatant, mode: 'average' | 'roll') {
  localError.value = ''
  const draft = drafts.value[participant.key]
  if (!draft) return
  const result = previewSetupHP(props.hpSourceFor(participant), mode, draft)
  if (!result.preview) {
    localError.value = result.error
    return
  }
  draft.currentHp = result.preview.current
  draft.maxHp = result.preview.max
}

function rollInitiative(participant: PlannedCombatant) {
  const initiative = props.rules.initiative
  if (!initiative) return
  const draft = drafts.value[participant.key]
  if (!draft) return
  localError.value = ''
  try {
    const modifier = effectiveModifier(participant)
    const result = initiative.roll(modifier)
    draft.initiative = result
    if (draft.initiativeModifier === '') draft.initiativeModifier = modifier
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : 'Initiative could not be rolled.'
  }
}

function rollGroup() {
  const initiative = props.rules.initiative
  if (!initiative) return
  const targets = props.planned.filter((participant) => selectedForGroup.value.includes(participant.key))
  if (!targets.length) {
    localError.value = 'Select one or more participants to roll.'
    return
  }
  localError.value = ''
  try {
    const modifiers = targets.map(effectiveModifier)
    const results = initiative.rollGroup(modifiers)
    for (const [index, participant] of targets.entries()) {
      const draft = drafts.value[participant.key]
      if (!draft) continue
      draft.initiative = results[index]
      if (draft.initiativeModifier === '') draft.initiativeModifier = modifiers[index]
    }
    selectedForGroup.value = []
  } catch (cause) {
    localError.value = cause instanceof Error ? cause.message : 'Selected initiative rolls could not be completed.'
  }
}
</script>

<template>
  <section class="encounter-live combat-setup" aria-labelledby="combat-setup-title">
    <div class="combat-panel">
      <div class="spellbook-heading">
        <div>
          <p class="eyebrow">COMBAT SETUP</p>
          <h2 id="combat-setup-title">Ready to start</h2>
          <p class="encounter-section-note">Set initiative and starting HP now, or leave them unset for manual entry during play. Starting writes the combat and its participants one at a time; if the connection fails, refresh to check for a partial combat before retrying.</p>
        </div>
        <div class="row-actions">
          <button class="primary-button" type="button" :disabled="!canStart || starting || recoveryRequired || !planned.length" @click="emit('start')">{{ starting ? 'Starting combat…' : 'Start combat' }}</button>
        </div>
      </div>
      <div class="setup-summary" role="status" aria-live="polite">
        <span>{{ planned.length }} {{ planned.length === 1 ? 'participant' : 'participants' }}</span>
        <span>{{ unsetInitiative }} initiative unset</span>
        <span>{{ unsetHP }} HP unset</span>
      </div>
      <p v-if="recoveryRequired" class="field-error" role="alert">Start is unavailable until this game’s authoritative combat state is reconciled. Refresh this game and check for an active or partial combat.</p>
      <p v-if="localError" class="field-error" role="alert">{{ localError }}</p>
      <p v-if="!rules.initiative" class="muted-hint">This system uses manual turn order. Enter initiative directly from physical dice if desired; automatic initiative rolls are unavailable. Arrange the order with the arrows in the live tracker.</p>
      <div v-else class="group-roll">
        <span>{{ rules.initiative?.groupLabel }}</span>
        <button class="secondary-button" type="button" :disabled="starting || !selectedForGroup.length" @click="rollGroup">Roll group initiative</button>
      </div>
      <div class="participant-add">
        <label class="filter-field">Add character
          <select v-model="characterChoice" class="select-input" :disabled="starting || !availableCharacters.length" @change="addCharacter">
            <option value="">Choose a character</option>
            <option v-for="character in availableCharacters" :key="character.id" :value="character.id">{{ character.name }}</option>
          </select>
        </label>
        <form class="custom-participant-form" @submit.prevent="addCustom">
          <label class="filter-field">Add custom participant<input v-model="customName" class="text-input" maxlength="255" placeholder="Name" :disabled="starting" /></label>
          <button class="secondary-button" type="submit" :disabled="starting || !customName.trim()">Add</button>
        </form>
      </div>
      <div v-if="planned.length" class="setup-list">
        <article v-for="participant in planned" :key="participant.key" class="setup-row">
          <div class="setup-row-head">
            <div>
              <strong>{{ participant.name }}</strong>
              <small>{{ labelFor(participant) }}</small>
            </div>
            <div class="row-actions">
              <label v-if="rules.initiative" class="select-combatant"><input v-model="selectedForGroup" type="checkbox" :value="participant.key" :disabled="starting" /> Select for group roll</label>
              <span class="setup-flag" :class="{ 'is-set': drafts[participant.key]?.initiative !== '' }">{{ drafts[participant.key]?.initiative !== '' ? `Init ${drafts[participant.key]?.initiative}` : 'Initiative unset' }}</span>
              <span class="setup-flag" :class="{ 'is-set': hpFlag(participant).set }">{{ hpFlag(participant).text }}</span>
              <button v-if="!participant.prepared" class="danger-button" type="button" :disabled="starting" @click="emit('remove-planned', participant)">Remove</button>
            </div>
          </div>
          <div class="setup-row-fields">
            <label class="filter-field">Initiative<input v-model.number="drafts[participant.key]!.initiative" class="text-input" type="number" step="any" placeholder="—" :disabled="starting" /></label>
            <template v-if="rules.initiative">
              <label class="filter-field">Initiative modifier<input v-model.number="drafts[participant.key]!.initiativeModifier" class="text-input" type="number" :min="rules.initiative?.modifierMin" :max="rules.initiative?.modifierMax" step="1" :placeholder="modifierFor(participant) === null ? 'Manual or unset' : String(modifierFor(participant))" :disabled="starting" /></label>
              <button class="secondary-button" type="button" :disabled="starting" @click="rollInitiative(participant)">Roll initiative</button>
            </template>
            <label class="filter-field">Current HP<input v-model.number="drafts[participant.key]!.currentHp" class="text-input" type="number" min="0" step="any" placeholder="—" :disabled="starting" /></label>
            <label class="filter-field">Max HP<input v-model.number="drafts[participant.key]!.maxHp" class="text-input" type="number" min="0" step="any" placeholder="—" :disabled="starting" /></label>
            <button v-if="hpSourceFor(participant).average !== null" class="secondary-button" type="button" :disabled="starting" @click="setHP(participant, 'average')">Use average</button>
            <button v-if="hpSourceFor(participant).formula" class="secondary-button" type="button" :disabled="starting" @click="setHP(participant, 'roll')">Roll HP</button>
            <span v-if="hpPartial(participant)" class="field-error setup-partial-hp">Enter both current and max HP, or leave both unset.</span>
            <span v-if="!hpSourceFor(participant).average && !hpSourceFor(participant).formula" class="muted-hint setup-manual-hint">{{ participant.enemy ? 'No imported HP average or formula; enter HP manually.' : 'HP is entered manually for this participant.' }}</span>
          </div>
        </article>
      </div>
      <p v-else class="muted-hint">No participants prepared. Add creatures above, or stage a game character or custom participant.</p>
    </div>
  </section>
</template>
