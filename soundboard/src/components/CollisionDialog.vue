<script setup>
import {
  store,
  keyLabel,
  actionLabel,
  confirmCollision,
  cancelCollision,
} from '../store.js'
import Modal from './Modal.vue'
</script>

<template>
  <Modal v-if="store.collision" title="MIDI key already used" @close="cancelCollision">
    <p>
      This key is already bound. Local and global bindings may not shadow each other. Replace the
      existing binding?
    </p>

    <dl class="collision-details">
      <div>
        <dt>Key</dt>
        <dd><span class="badge danger-badge">{{ keyLabel(store.collision.key) }}</span></dd>
      </div>
      <div>
        <dt>New binding</dt>
        <dd>{{ actionLabel(store.collision.action) }} ({{ store.collision.scope }})</dd>
      </div>
      <div v-if="store.collision.globalAction">
        <dt>Existing global</dt>
        <dd>{{ actionLabel(store.collision.globalAction) }}</dd>
      </div>
      <div v-if="store.collision.scenes?.length">
        <dt>Used by scenes</dt>
        <dd>
          <ul class="collision-scenes">
            <li v-for="scene in store.collision.scenes" :key="scene.sceneId">
              {{ scene.name }} — {{ actionLabel(scene.action) }}
            </li>
          </ul>
        </dd>
      </div>
    </dl>

    <template #actions>
      <button class="btn-sm" @click="cancelCollision">Cancel</button>
      <button class="btn-primary danger" @click="confirmCollision">Replace binding</button>
    </template>
  </Modal>
</template>
