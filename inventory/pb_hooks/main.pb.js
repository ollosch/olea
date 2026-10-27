/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// Olea — routes and record hooks.
// Collections: players, systems, games, currencies, memberships, wallets,
//              items, inventory
// Identity: name-only auth via POST /api/login (returns a standard PB auth token).
// Roles are per game: a GM in one game may be a player in another, but a GM
// membership never gets a wallet or inventory.
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

    let gameId = null;
    app.runInTransaction((tx) => {
      let system = null;
      if (body.systemId) {
        system = tx.findRecordById("systems", body.systemId);
      } else if (body.newSystem) {
        if (!Array.isArray(body.newSystem.currencies) || !body.newSystem.currencies.length) {
          u.bad("At least one currency is required");
        }
        system = u.createSystem(tx, body.newSystem);
      } else {
        u.bad("A system is required");
      }

      const games = tx.findCollectionByNameOrId("games");
      const game = new Record(games);
      game.set("system", system.get("id"));
      game.set("name", name);
      if (body.description) game.set("description", body.description);
      tx.save(game);
      gameId = game.get("id");

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

routerAdd(
  "DELETE",
  "/api/games/{id}",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const game = app.findRecordById("games", e.request.pathValue("id"));

    u.requireGM(app, game.get("id"), me.get("id"));

    // Memberships, wallets and inventory cascade from the game relation.
    app.delete(game);
    return e.json(200, { ok: true });
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

    if (membership.get("role") === "gm") {
      const gms = app.findRecordsByFilter(
        "memberships",
        "game = {:game} && role = 'gm'",
        "",
        0,
        0,
        { game: gameId }
      );
      if (gms.length <= 1) u.bad("A game needs at least one GM");
    }

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
    const gameId = membership.get("game");

    u.requireGM(app, gameId, me.get("id"));

    const role = body.role === "gm" ? "gm" : "player";
    if (membership.get("role") === role) return e.json(200, membership);

    if (role === "gm") {
      const held = app.findRecordsByFilter(
        "inventory",
        "game = {:game} && owner = {:owner}",
        "",
        1,
        0,
        { game: gameId, owner: membership.get("player") }
      );
      const money = app.findRecordsByFilter(
        "wallets",
        "game = {:game} && membership = {:membership}",
        "",
        1,
        0,
        { game: gameId, membership: membership.get("id") }
      );
      if (held.length || money.length) {
        u.bad("Take their items and money before making them a GM");
      }
    } else if (membership.get("role") === "gm") {
      const gms = app.findRecordsByFilter(
        "memberships",
        "game = {:game} && role = 'gm'",
        "",
        0,
        0,
        { game: gameId }
      );
      if (gms.length <= 1) u.bad("A game needs at least one GM");
    }

    membership.set("role", role);
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

    const game = app.findRecordById("games", gameId);
    u.requireMember(app, gameId, me.get("id"));
    const target = u.membershipOf(app, gameId, toPlayerId);
    if (!target) u.bad("Recipient is not a member of this game");
    if (target.get("role") !== "player") u.bad("Items can only be given to players");

    // --- GM grants a catalog item ---
    if (body.itemId) {
      u.requireGM(app, gameId, me.get("id"));
      const item = app.findRecordById("items", body.itemId);
      if (item.get("system") !== game.get("system")) u.bad("Item is not part of this game's system");
      const kind = item.get("kind") || "single";
      if (kind === "stack") {
        const qty = Math.max(1, parseInt(body.quantity, 10) || 1);
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, qty, null, "person");
      } else if (kind === "charges") {
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, null, item.get("max_charges") || 0, "person");
      } else {
        u.createInventoryEntry(app, gameId, item.get("id"), toPlayerId, null, null, "person");
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
            u.createInventoryEntry(tx, gameId, item.get("id"), toPlayerId, giveQty, null, "person");
          });
        } else {
          entry.set("owner", toPlayerId);
          entry.set("location", "person");
          app.save(entry);
        }
      } else {
        entry.set("owner", toPlayerId);
        entry.set("location", "person");
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

    if (entry.get("owner") !== me.get("id")) u.forbidden("You cannot use someone else's item");

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
    if (!isOwner && !isGM) u.forbidden("You cannot remove someone else's item");

    app.delete(entry);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/inventory/move",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;
    const entry = app.findRecordById("inventory", body.inventoryId);
    const location = body.location === "stash" ? "stash" : "person";

    if (entry.get("owner") !== me.get("id")) u.forbidden("You can only move your own items");

    entry.set("location", location);
    app.save(entry);
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
    const from = body.location === "stash" ? "stash" : "person";
    if (!gameId || !toPlayerId || !currencyId) u.bad("Missing fields");
    if (amount <= 0) u.bad("Amount must be positive");
    if (toPlayerId === me.get("id")) u.bad("You cannot give money to yourself");

    const game = app.findRecordById("games", gameId);
    const fromMembership = u.requirePlayer(app, gameId, me.get("id"));
    const toMembership = u.requirePlayer(app, gameId, toPlayerId);
    const currency = app.findRecordById("currencies", currencyId);
    if (currency.get("system") !== game.get("system")) u.bad("Currency is not part of this game's system");

    app.runInTransaction((tx) => {
      u.adjustWallet(tx, fromMembership.get("id"), currencyId, -amount, from);
      u.adjustWallet(tx, toMembership.get("id"), currencyId, amount, "person");
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
    const location = body.location === "stash" ? "stash" : "person";
    if (!gameId || !playerId || !currencyId) u.bad("Missing fields");
    if (amount === 0) u.bad("Amount cannot be zero");

    u.requireGM(app, gameId, me.get("id"));
    const game = app.findRecordById("games", gameId);
    const membership = u.requirePlayer(app, gameId, playerId);
    const currency = app.findRecordById("currencies", currencyId);
    if (currency.get("system") !== game.get("system")) u.bad("Currency is not part of this game's system");

    u.adjustWallet(app, membership.get("id"), currencyId, amount, location);

    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

routerAdd(
  "POST",
  "/api/money/move",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    const body = e.requestInfo().body;

    const gameId = body.game;
    const currencyId = body.currencyId;
    const amount = parseInt(body.amount, 10) || 0;
    const from = body.from === "stash" ? "stash" : "person";
    const to = body.to === "stash" ? "stash" : "person";
    if (!gameId || !currencyId) u.bad("Missing fields");
    if (amount <= 0) u.bad("Amount must be positive");
    if (from === to) u.bad("Choose two different locations");

    const membership = u.requirePlayer(app, gameId, me.get("id"));
    const game = app.findRecordById("games", gameId);
    const currency = app.findRecordById("currencies", currencyId);
    if (currency.get("system") !== game.get("system")) u.bad("Currency is not part of this game's system");

    app.runInTransaction((tx) => {
      u.adjustWallet(tx, membership.get("id"), currencyId, -amount, from);
      u.adjustWallet(tx, membership.get("id"), currencyId, amount, to);
    });

    return e.json(200, { ok: true });
  },
  $apis.requireAuth("players")
);

// ---------------------------------------------------------------------------
// Systems (shared catalogs — editable by any GM)
// ---------------------------------------------------------------------------

routerAdd(
  "POST",
  "/api/systems/{id}/import",
  (e) => {
    const u = require(__hooks + "/utils.js");
    const app = e.app;
    const me = e.auth;
    u.requireGlobalGM(app, me.get("id"));

    const system = app.findRecordById("systems", e.request.pathValue("id"));
    const body = e.requestInfo().body;

    let result = null;
    app.runInTransaction((tx) => {
      result = u.importSystemData(tx, system.get("id"), body);
    });

    return e.json(200, { ok: true, ...result });
  },
  $apis.requireAuth("players")
);

onRecordCreateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    if (!e.record.get("weight_unit")) e.record.set("weight_unit", "lb");
    e.next();
  },
  "systems"
);

onRecordUpdateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    e.next();
  },
  "systems"
);

onRecordDeleteRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    const games = e.app.findRecordsByFilter("games", "system = {:system}", "", 1, 0, {
      system: e.record.get("id"),
    });
    if (games.length) u.bad("This system is used by a game; delete the game first");
    e.next();
  },
  "systems"
);

// ---------------------------------------------------------------------------
// Currencies (system catalog — global GM)
// ---------------------------------------------------------------------------

onRecordCreateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    e.next();
  },
  "currencies"
);

onRecordUpdateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    e.next();
  },
  "currencies"
);

onRecordDeleteRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    const currencyId = e.record.get("id");
    const wallets = e.app.findRecordsByFilter("wallets", "currency = {:currency}", "", 1, 0, {
      currency: currencyId,
    });
    if (wallets.length) u.bad("Currency is in a player's wallet; empty it before deleting");
    const items = e.app.findRecordsByFilter("items", "value_currency = {:currency}", "", 1, 0, {
      currency: currencyId,
    });
    if (items.length) u.bad("Currency is used by catalog items; change those items first");
    e.next();
  },
  "currencies"
);

// ---------------------------------------------------------------------------
// Items (system catalog — global GM, delete guard)
// ---------------------------------------------------------------------------

onRecordCreateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    if (!e.record.get("kind")) e.record.set("kind", "single");
    u.validateItemCurrency(e.app, e.record);
    e.next();
  },
  "items"
);

onRecordUpdateRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    u.validateItemCurrency(e.app, e.record);
    e.next();
  },
  "items"
);

onRecordDeleteRequest(
  (e) => {
    const u = require(__hooks + "/utils.js");
    u.requireGlobalGM(e.app, e.auth.get("id"));
    const held = e.app.findRecordsByFilter("inventory", "item = {:item}", "", 1, 0, {
      item: e.record.get("id"),
    });
    if (held.length) u.bad("Item is held by players; take it away first");
    e.next();
  },
  "items"
);
