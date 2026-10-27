# Olea inventory

PocketBase + Vue 3 inventory and money manager (port 8090).

The built frontend is served from `pb_public/` by PocketBase. See the repository root
`README.md` for running both apps, and `CONTRACT.md` for the frontend data/store contract.

```bash
npm install
npm run dev     # Vite dev server, proxies /api to 127.0.0.1:8090
npm run build   # rebuild into pb_public/
```
