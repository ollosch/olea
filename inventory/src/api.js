import { pb } from './pb'

async function post(path, data) {
  return pb.send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

async function del(path) {
  return pb.send(path, { method: 'DELETE' })
}

export const api = {
  login(name) {
    return post('/api/login', { name })
  },
  createGame(data) {
    return post('/api/games', data)
  },
  deleteGame(id) {
    return del(`/api/games/${id}`)
  },
  addMember(data) {
    return post('/api/members', data)
  },
  removeMember(id) {
    return del(`/api/members/${id}`)
  },
  setRole(id, role) {
    return post(`/api/members/${id}/role`, { role })
  },
  giveItem(data) {
    return post('/api/inventory/give', data)
  },
  useItem(inventoryId) {
    return post('/api/inventory/use', { inventoryId })
  },
  dropItem(inventoryId, quantity) {
    const data = { inventoryId }
    if (quantity != null) data.quantity = quantity
    return post('/api/inventory/drop', data)
  },
  moveItem(inventoryId, location, quantity) {
    const data = { inventoryId, location }
    if (quantity != null) data.quantity = quantity
    return post('/api/inventory/move', data)
  },
  giveMoney(data) {
    return post('/api/money/give', data)
  },
  gmMoney(data) {
    return post('/api/money/gm', data)
  },
  moveMoney(data) {
    return post('/api/money/move', data)
  },
  importSystem(systemId, data) {
    return post(`/api/systems/${systemId}/import`, data)
  },
}
