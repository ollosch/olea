/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Olea — routes and record hooks.
// Collections: players, games, currencies, memberships, wallets, items, inventory
// Identity: name-only auth via POST /api/login (returns a standard PB auth token).
// Shared logic lives in ./utils.js (loaded with require() inside each handler,
// because PB runs every handler in its own isolated context).
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Auth — name-only login
// ---------------------------------------------------------------------------

routerAdd("POST", "/api/login", (e) => {
  const u = require(__hooks + "/utils.js");
  const body = e.requestInfo().body;
  const player = u.playerByName(e.app, body.name);
  return $apis.recordAuthResponse(e, player, "", {});
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

routerAdd(
  "POST",
  "/api/games",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;

    const name = (body.name || "").trim();
    if (!name) u.bad("Game name is required");
    const currencies = Array.isArray(body.currencies) ? body.currencies : [];
    if (!currencies.length) u.bad("At least one currency is required");

    let gameId = null;
    app.runInTransaction((tx) => {
      const games = tx.findCollectionByNameOrId("games");
      const game = new Record(games);
      game.set("name", name);
      if (body.description) game.set("description", body.description);
      tx.save(game);
      gameId = game.get("id");

      const currenciesCol = tx.findCollectionByNameOrId("currencies");
      currencies.forEach((c, i) => {
        const rec = new Record(currenciesCol);
        rec.set("game", gameId);
        rec.set("name", (c.name || "").trim() || "currency");
        rec.set("symbol", (c.symbol || "").trim());
        rec.set("base_value", parseInt(c.base_value, 10) || 1);
        rec.set("sort", c.sort != null ? parseInt(c.sort, 10) : i);
        tx.save(rec);
      });

      const membershipsCol = tx.findCollectionByNameOrId("memberships");
      const m = new Record(membershipsCol);
      m.set("game", gameId);
      m.set("player", me.get("id"));
      m.set("role", "gm");
      tx.save(m);
    });

    return e.json(200, app.findRecordById("games", gameId));
  },
  $apis.requireAuth("players")
);

// ---------------------------------------------------------------------------
// Member management (GM)
// ---------------------------------------------------------------------------

routerAdd(
  "POST",
  "/api/members",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;
    const gameId = body.game;
    if (!gameId) u.bad("Game is required");

    u.requireGM(app, gameId, me.get("id"));

    const player = u.playerByName(app, body.playerName);
    const role = body.role === "gm" ? "gm" : "player";

    if (u.membershipOf(app, gameId, player.get("id"))) u.bad("Already a member");

    const membershipsCol = app.findCollectionByNameOrId("memberships");
    const m = new Record(membershipsCol);
    m.set("game", gameId);
    m.set("player", player.get("id"));
    m.set("role", role);
    app.save(m);
    return e.json(200, m);
  },
  $apis.requireAuth("players")
);

routerAdd(
  "DELETE",
  "/api/members/{id}",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const membership = app.findRecordById("memberships", e.request.pathValue("id"));
    const gameId = membership.get("game");

    u.requireGM(app, gameId, me.get("id"));

    const playerId = membership.get("player");

    app.runInTransaction((tx) => {
      const entries = tx.findRecordsByFilter(
        "inventory",
        "game = {:game} && owner = {:owner}",
        "",
        0,
        0,
        { game: gameId, owner: playerId }
      );
      entries.forEach((r) => {
        if (r) tx.delete(r);
      });
      tx.delete(membership);
    });

    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/members/{id}/role",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;
    const membership = app.findRecordById("memberships", e.request.pathValue("id"));

    u.requireGM(app, membership.get("game"), me.get("id"));

    membership.set("role", body.role === "gm" ? "gm" : "player");
    app.save(membership);
    return e.json(200, membership);
  },
  $apis.requireAuth("players")
);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

routerAdd(
  "POST",
  "/api/inventory/give",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;

    const gameId = body.game;
    const toPlayerId = body.toPlayerId;
    if (!gameId) u.bad("Game is required");
    if (!toPlayerId) u.bad("Recipient is required");

    u.requireMember(app, gameId, me.get("id"));
    u.requireMember(app, gameId, toPlayerId);

    // --- GM grants a catalog item ---
    if (body.itemId) {
      u.requireGM(app, gameId, me.get("id"));
      const item = app.findRecordById("items", body.itemId);
      const kind = item.get("kind") || "single";
      if (kind === "stack") {
        const qty = Math.max(1, parseInt(body.quantity, 10) || 1);
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, qty, null);
      } else if (kind === "charges") {
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, null, item.get("max_charges") || 0);
      } else {
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, null, null);
      }
      return e.json(200, { ok: true });
    }

    // --- transfer an existing entry ---
    if (body.inventoryId) {
      const entry = app.findRecordById("inventory", body.inventoryId);
      if (entry.get("game") !== gameId) u.bad("Inventory entry does not belong to this game");

      const isOwner = entry.get("owner") === me.get("id");
      const isGM = u.roleOf(app, gameId, me.get("id")) === "gm";
      if (!isOwner && !isGM) u.forbidden("You cannot give away someone else's item");
      if (entry.get("owner") === toPlayerId) u.bad("Item already belongs to that player");

      const item = app.findRecordById("items", entry.get("item"));
      const kind = item.get("kind") || "single";

      if (kind === "stack") {
        const current = entry.get("quantity") || 0;
        const giveQty = body.quantity != null ? parseInt(body.quantity, 10) : null;
        if (giveQty != null && giveQty > 0 && giveQty < current) {
          app.runInTransaction((tx) => {
            const source = tx.findRecordById("inventory", entry.get("id"));
            source.set("quantity", current - giveQty);
            tx.save(source);
            u.createInventoryEntry(tx, gameId, item.get("id"), toPlayerId, giveQty, null);
          });
        } else {
          entry.set("owner", toPlayerId);
          app.save(entry);
        }
      } else {
        entry.set("owner", toPlayerId);
        app.save(entry);
      }
      return e.json(200, { ok: true });
    }

    u.bad("Provide either itemId (GM) or inventoryId (transfer)");
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/inventory/use",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;
    const entry = app.findRecordById("inventory", body.inventoryId);

    const isOwner = entry.get("owner") === me.get("id");
    const isGM = u.roleOf(app, entry.get("game"), me.get("id")) === "gm";
    if (!isOwner && !isGM) u.forbidden("You cannot use someone else's item");

    const item = app.findRecordById("items", entry.get("item"));
    if ((item.get("kind") || "single") !== "charges") u.bad("This item is not charge-based");

    const current = entry.get("charges_current") || 0;
    if (current <= 0) u.bad("No charges left");
    entry.set("charges_current", current - 1);
    app.save(entry);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/inventory/drop",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;
    const entry = app.findRecordById("inventory", body.inventoryId);

    const isOwner = entry.get("owner") === me.get("id");
    const isGM = u.roleOf(app, entry.get("game"), me.get("id")) === "gm";
    if (!isOwner && !isGM) u.forbidden("You cannot drop someone else's item");

    app.delete(entry);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

routerAdd(
  "POST",
  "/api/money/give",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;

    const gameId = body.game;
    const toPlayerId = body.toPlayerId;
    const currencyId = body.currencyId;
    const amount = parseInt(body.amount, 10) || 0;
    if (!gameId || !toPlayerId || !currencyId) u.bad("Missing fields");
    if (amount <= 0) u.bad("Amount must be positive");
    if (toPlayerId === me.get("id")) u.bad("You cannot give money to yourself");

    u.requireMember(app, gameId, me.get("id"));
    u.requireMember(app, gameId, toPlayerId);

    app.runInTransaction((tx) => {
      const fromMembership = u.membershipOf(tx, gameId, me.get("id"));
      const toMembership = u.membershipOf(tx, gameId, toPlayerId);
      u.adjustWallet(tx, fromMembership.get("id"), currencyId, -amount);
      u.adjustWallet(tx, toMembership.get("id"), currencyId, amount);
    });

    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/money/gm",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;

    const gameId = body.game;
    const playerId = body.playerId;
    const currencyId = body.currencyId;
    const amount = parseInt(body.amount, 10) || 0;
    if (!gameId || !playerId || !currencyId) u.bad("Missing fields");
    if (amount === 0) u.bad("Amount cannot be zero");

    u.requireGM(app, gameId, me.get("id"));
    u.requireMember(app, gameId, playerId);

    const membership = u.membershipOf(app, gameId, playerId);
    u.adjustWallet(app, membership.get("id"), currencyId, amount);

    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

// ---------------------------------------------------------------------------
// Items (catalog) record hooks — GM enforcement + delete guard
// ---------------------------------------------------------------------------

onRecordCreateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    const gameId = e.record.get("game");
    if (!gameId) u.bad("Game is required");
    u.requireGM(e.app, gameId, e.auth.get("id"));
    if (!e.record.get("kind")) e.record.set("kind", "single");
    e.next();
  },
  "items"
);

onRecordUpdateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGM(e.app, e.record.get("game"), e.auth.get("id"));
    e.next();
  },
  "items"
);

onRecordDeleteRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGM(e.app, e.record.get("game"), e.auth.get("id"));
    const held = e.app.findRecordsByFilter("inventory", "item = {:item}", "", 1, 0, {
      item: e.record.get("id"),
    });
    if (held && held.length) u.bad("Item is held by players; take it away first");
    e.next();
  },
  "items"
);
