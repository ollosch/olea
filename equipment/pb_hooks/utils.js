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
  if (!membershipOf(app, gameId, playerId)) forbidden("Not a member of this game");
}

function requireGM(app, gameId, playerId) {
  if (roleOf(app, gameId, playerId) !== "gm") forbidden("GM access required");
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

function findWallet(app, membershipId, currencyId) {
  return firstOrNull(app, "wallets", "membership = {:m} && currency = {:c}", {
    m: membershipId,
    c: currencyId,
  });
}

function ensureWallet(app, membershipId, currencyId) {
  const w = findWallet(app, membershipId, currencyId);
  if (w) return w;
  const wallets = app.findCollectionByNameOrId("wallets");
  const rec = new Record(wallets);
  rec.set("membership", membershipId);
  rec.set("currency", currencyId);
  rec.set("amount", 0);
  app.save(rec);
  return rec;
}

function adjustWallet(app, membershipId, currencyId, delta) {
  const w = ensureWallet(app, membershipId, currencyId);
  const amount = (w.get("amount") || 0) + delta;
  if (amount < 0) bad("Not enough money");
  w.set("amount", amount);
  app.save(w);
  return w;
}

function createInventoryEntry(app, gameId, itemId, ownerId, quantity, chargesCurrent) {
  const inventoryCol = app.findCollectionByNameOrId("inventory");
  const rec = new Record(inventoryCol);
  rec.set("game", gameId);
  rec.set("item", itemId);
  rec.set("owner", ownerId);
  if (quantity != null) rec.set("quantity", quantity);
  if (chargesCurrent != null) rec.set("charges_current", chargesCurrent);
  app.save(rec);
  return rec;
}

module.exports = {
  bad,
  forbidden,
  membershipOf,
  roleOf,
  requireMember,
  requireGM,
  playerByName,
  findWallet,
  ensureWallet,
  adjustWallet,
  createInventoryEntry,
};
