// ---------------------------------------------------------------------------
// Olea — shared helper functions (CommonJS module loaded via require()).
// NOTE: PB executes each handler in an isolated context, so this module is the
// single source of reusable logic. Keep it stateless (no shared mutable data).
// ---------------------------------------------------------------------------

function bad(msg) {
  throw new BadRequestError(msg, {});
}

function forbidden(msg) {
  throw new ForbiddenError(msg, {});
}

// findFirstRecordByFilter throws "sql: no rows" when nothing matches, so wrap it.
function firstOrNull(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params);
  } catch (err) {
    return null;
  }
}

function membershipOf(app, gameId, playerId) {
  return firstOrNull(app, "memberships", "game = {:game} && player = {:player}", {
    game: gameId,
    player: playerId,
  });
}

function roleOf(app, gameId, playerId) {
  const m = membershipOf(app, gameId, playerId);
  return m ? m.get("role") : null;
}

function requireMember(app, gameId, playerId) {
  const m = membershipOf(app, gameId, playerId);
  if (!m) forbidden("Not a member of this game");
  return m;
}

function requireGM(app, gameId, playerId) {
  if (roleOf(app, gameId, playerId) !== "gm") forbidden("GM access required");
}

function requirePlayer(app, gameId, playerId) {
  const m = membershipOf(app, gameId, playerId);
  if (!m || m.get("role") !== "player") forbidden("Player access required");
  return m;
}

// A global GM is anyone who is a GM in at least one game. Systems are shared
// between all GMs, independently of any single game.
function isGlobalGM(app, playerId) {
  return !!firstOrNull(app, "memberships", "role = 'gm' && player = {:player}", {
    player: playerId,
  });
}

function requireGlobalGM(app, playerId) {
  if (!isGlobalGM(app, playerId)) forbidden("GM access required");
}

function slugify(name) {
  const s = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "player";
}

function playerByName(app, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) bad("Player name is required");

  let p = firstOrNull(app, "players", "name = {:name}", { name: trimmed });
  if (p) return p;

  const players = app.findCollectionByNameOrId("players");
  const rec = new Record(players);
  rec.set("name", trimmed);
  rec.setEmail(slugify(trimmed) + "-" + $security.randomString(8) + "@local.test");
  rec.setPassword($security.randomString(20));
  try {
    app.save(rec);
  } catch (err) {
    p = firstOrNull(app, "players", "name = {:name}", { name: trimmed });
    if (p) return p;
    throw err;
  }
  return rec;
}

function findWallet(app, membershipId, currencyId, location) {
  return firstOrNull(app, "wallets", "membership = {:m} && currency = {:c} && location = {:l}", {
    m: membershipId,
    c: currencyId,
    l: location,
  });
}

function ensureWallet(app, membershipId, currencyId, location) {
  const loc = location === "stash" ? "stash" : "person";
  const w = findWallet(app, membershipId, currencyId, loc);
  if (w) return w;
  const membership = app.findRecordById("memberships", membershipId);
  const wallets = app.findCollectionByNameOrId("wallets");
  const rec = new Record(wallets);
  rec.set("game", membership.get("game"));
  rec.set("membership", membershipId);
  rec.set("currency", currencyId);
  rec.set("amount", 0);
  rec.set("location", loc);
  app.save(rec);
  return rec;
}

function adjustWallet(app, membershipId, currencyId, delta, location) {
  const loc = location === "stash" ? "stash" : "person";
  const w = ensureWallet(app, membershipId, currencyId, loc);
  const amount = (w.get("amount") || 0) + delta;
  if (amount < 0) bad("Not enough money");
  w.set("amount", amount);
  app.save(w);
  return w;
}

function createInventoryEntry(app, gameId, itemId, ownerId, quantity, chargesCurrent, location) {
  const inventoryCol = app.findCollectionByNameOrId("inventory");
  const rec = new Record(inventoryCol);
  rec.set("game", gameId);
  rec.set("item", itemId);
  rec.set("owner", ownerId);
  rec.set("location", location === "stash" ? "stash" : "person");
  if (quantity != null) rec.set("quantity", quantity);
  if (chargesCurrent != null) rec.set("charges_current", chargesCurrent);
  app.save(rec);
  return rec;
}

function currencyLookup(app, systemId) {
  const map = {};
  app.findRecordsByFilter("currencies", "system = {:system}", "sort", 0, 0, { system: systemId }).forEach((c) => {
    map[String(c.get("id")).toLowerCase()] = c;
    map[String(c.get("name")).trim().toLowerCase()] = c;
    const symbol = String(c.get("symbol") || "").trim().toLowerCase();
    if (symbol) map[symbol] = c;
  });
  return map;
}

function upsertCurrency(app, systemId, data, index) {
  const name = String(data.name || "").trim();
  if (!name) return null;
  const collection = app.findCollectionByNameOrId("currencies");
  let rec = firstOrNull(app, "currencies", "system = {:system} && name = {:name}", {
    system: systemId,
    name,
  });
  if (!rec) rec = new Record(collection);
  rec.set("system", systemId);
  rec.set("name", name);
  rec.set("symbol", String(data.symbol || "").trim());
  rec.set("base_value", parseInt(data.base_value, 10) || 1);
  rec.set("sort", data.sort != null ? parseInt(data.sort, 10) : index);
  app.save(rec);
  return rec;
}

function importSystemData(app, systemId, payload) {
  const body = payload || {};
  const currencies = Array.isArray(body.currencies) ? body.currencies : [];
  const items = Array.isArray(body.items) ? body.items : [];

  currencies.forEach((c, i) => upsertCurrency(app, systemId, c, i));

  const lookup = currencyLookup(app, systemId);
  const itemCollection = app.findCollectionByNameOrId("items");
  let itemCount = 0;

  items.forEach((data) => {
    const name = String(data.name || "").trim();
    if (!name) return;

    let rec = firstOrNull(app, "items", "system = {:system} && name = {:name}", {
      system: systemId,
      name,
    });
    if (!rec) rec = new Record(itemCollection);

    const kind = ["single", "stack", "charges"].includes(data.kind) ? data.kind : "single";
    rec.set("system", systemId);
    rec.set("name", name);
    rec.set("category", String(data.category || "").trim());
    rec.set("kind", kind);
    rec.set("weight", Number(data.weight) || 0);
    rec.set("value", parseInt(data.value, 10) || 0);
    rec.set("description", String(data.description || ""));

    if (kind === "charges") {
      rec.set("max_charges", parseInt(data.max_charges, 10) || 0);
    }

    const key = String(data.value_currency || data.currency || "").trim().toLowerCase();
    rec.set("value_currency", key && lookup[key] ? lookup[key].get("id") : "");

    app.save(rec);
    itemCount++;
  });

  return { currencies: currencies.length, items: itemCount };
}

function createSystem(app, data) {
  const body = data || {};
  const name = String(body.name || "").trim();
  if (!name) bad("System name is required");
  if (firstOrNull(app, "systems", "name = {:name}", { name })) bad("A system with that name already exists");

  const collection = app.findCollectionByNameOrId("systems");
  const rec = new Record(collection);
  rec.set("name", name);
  rec.set("description", String(body.description || ""));
  rec.set("weight_unit", body.weight_unit === "kg" ? "kg" : "lb");
  app.save(rec);
  importSystemData(app, rec.get("id"), body);
  return rec;
}

module.exports = {
  bad,
  forbidden,
  membershipOf,
  roleOf,
  requireMember,
  requireGM,
  requirePlayer,
  isGlobalGM,
  requireGlobalGM,
  playerByName,
  findWallet,
  ensureWallet,
  adjustWallet,
  createInventoryEntry,
  currencyLookup,
  importSystemData,
  createSystem,
};
