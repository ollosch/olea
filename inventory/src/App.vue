<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from './stores/auth'
import Toast from './components/Toast.vue'

const auth = useAuthStore()
onMounted(() => auth.init())
</script>

<template>
  <router-view />
  <Toast />
</template>
