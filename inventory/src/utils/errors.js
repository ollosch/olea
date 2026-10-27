export function errorMessage(err) {
  const d = err?.data
  if (d?.data && typeof d.data === 'object' && Object.keys(d.data).length) {
    const first = Object.values(d.data)[0]
    if (first && first.message) return first.message
  }
  return d?.message || err?.message || 'Something went wrong'
}
