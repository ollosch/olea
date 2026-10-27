import { reactive } from 'vue'

const state = reactive({ message: '', visible: false })
let timer = null

export function useToast() {
  function show(message, ms = 2600) {
    state.message = message
    state.visible = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      state.visible = false
    }, ms)
  }
  function hide() {
    state.visible = false
    clearTimeout(timer)
  }
  return { state, show, hide }
}
