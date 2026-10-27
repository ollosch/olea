/// <reference path="../pb_data/types.d.ts" />

// Deterministic collection ids so relation fields can reference them.
const ID = {
  players: "w_players",
  systems: "w_systems",
  games: "w_games",
  currencies: "w_currencies",
  memberships: "w_memberships",
  wallets: "w_wallets",
  items: "w_items",
  inventory: "w_inventory",
};

const ANY_AUTH = "@request.auth.id != ''";

function timestamps() {
  return [
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ];
}

migrate(
  (app) => {
    // ---------------------------------------------------------------- players (auth accounts)
    app.save(
      new Collection({
        id: ID.players,
        type: "auth",
        name: "players",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "", // only via /api/login
        updateRule: "",
        deleteRule: "",
        authRule: "", // allow any player to authenticate
        oauth2: { enabled: false },
        fields: [
          { type: "text", name: "name", required: true, min: 1, max: 100 },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_players_name ON players (name)"],
      })
    );

    // ---------------------------------------------------------------- systems (shared catalogs)
    app.save(
      new Collection({
        id: ID.systems,
        type: "base",
        name: "systems",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: ANY_AUTH, // global GM enforced in hooks
        updateRule: ANY_AUTH,
        deleteRule: ANY_AUTH,
        fields: [
          { type: "text", name: "name", required: true, min: 1, max: 200 },
          { type: "text", name: "description", max: 2000 },
          { type: "select", name: "weight_unit", values: ["lb", "kg"], maxSelect: 1 },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_systems_name ON systems (name)"],
      })
    );

    // ---------------------------------------------------------------- games
    app.save(
      new Collection({
        id: ID.games,
        type: "base",
        name: "games",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "", // only via /api/games
        updateRule: "",
        deleteRule: "", // only via /api/games/{id}
        fields: [
          { type: "relation", name: "system", collectionId: ID.systems, cascadeDelete: false, maxSelect: 1, required: true },
          { type: "text", name: "name", required: true, min: 1, max: 200 },
          { type: "text", name: "description", max: 2000 },
          ...timestamps(),
        ],
        indexes: ["CREATE INDEX idx_games_system ON games (system)"],
      })
    );

    // ---------------------------------------------------------------- currencies (belong to a system)
    app.save(
      new Collection({
        id: ID.currencies,
        type: "base",
        name: "currencies",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: ANY_AUTH, // global GM enforced in hooks
        updateRule: ANY_AUTH,
        deleteRule: ANY_AUTH,
        fields: [
          { type: "relation", name: "system", collectionId: ID.systems, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "text", name: "name", required: true, min: 1, max: 100 },
          { type: "text", name: "symbol", max: 20 },
          { type: "number", name: "base_value", required: true, onlyInt: true, min: 1 },
          { type: "number", name: "sort", onlyInt: true },
          ...timestamps(),
        ],
        indexes: [
          "CREATE INDEX idx_currencies_system ON currencies (system)",
          "CREATE UNIQUE INDEX idx_currencies_system_name ON currencies (system, name)",
        ],
      })
    );

    // ---------------------------------------------------------------- memberships (GM or player per game)
    app.save(
      new Collection({
        id: ID.memberships,
        type: "base",
        name: "memberships",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
          { type: "relation", name: "game", collectionId: ID.games, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "relation", name: "player", collectionId: ID.players, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "select", name: "role", values: ["gm", "player"], maxSelect: 1, required: true },
          ...timestamps(),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_memberships_game_player ON memberships (game, player)",
          "CREATE INDEX idx_memberships_player ON memberships (player)",
          "CREATE INDEX idx_memberships_game_role ON memberships (game, role)",
        ],
      })
    );

    // ---------------------------------------------------------------- wallets (person or stash)
    app.save(
      new Collection({
        id: ID.wallets,
        type: "base",
        name: "wallets",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
          { type: "relation", name: "game", collectionId: ID.games, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "relation", name: "membership", collectionId: ID.memberships, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "relation", name: "currency", collectionId: ID.currencies, cascadeDelete: false, maxSelect: 1, required: true },
          { type: "number", name: "amount", onlyInt: true, min: 0 },
          { type: "select", name: "location", values: ["person", "stash"], maxSelect: 1, required: true },
          ...timestamps(),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_wallets_membership_currency_location ON wallets (membership, currency, location)",
          "CREATE INDEX idx_wallets_game ON wallets (game)",
          "CREATE INDEX idx_wallets_membership ON wallets (membership)",
        ],
      })
    );

    // ---------------------------------------------------------------- items (system catalog)
    app.save(
      new Collection({
        id: ID.items,
        type: "base",
        name: "items",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: ANY_AUTH, // global GM enforced in hooks
        updateRule: ANY_AUTH,
        deleteRule: ANY_AUTH,
        fields: [
          { type: "relation", name: "system", collectionId: ID.systems, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "text", name: "name", required: true, min: 1, max: 200 },
          { type: "text", name: "category", max: 100 },
          { type: "select", name: "kind", values: ["single", "stack", "charges"], maxSelect: 1, required: true },
          { type: "number", name: "max_charges", onlyInt: true, min: 0 },
          { type: "number", name: "weight", min: 0 },
          { type: "number", name: "value", onlyInt: true, min: 0 },
          { type: "relation", name: "value_currency", collectionId: ID.currencies, cascadeDelete: false, maxSelect: 1 },
          { type: "text", name: "description", max: 5000 },
          {
            type: "file",
            name: "image",
            maxSelect: 1,
            maxSize: 5 * 1024 * 1024,
            mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
          },
          ...timestamps(),
        ],
        indexes: ["CREATE INDEX idx_items_system ON items (system)"],
      })
    );

    // ---------------------------------------------------------------- inventory (owned instances)
    app.save(
      new Collection({
        id: ID.inventory,
        type: "base",
        name: "inventory",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
          { type: "relation", name: "game", collectionId: ID.games, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "relation", name: "item", collectionId: ID.items, cascadeDelete: false, maxSelect: 1, required: true },
          { type: "relation", name: "owner", collectionId: ID.players, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "number", name: "quantity", onlyInt: true, min: 0 },
          { type: "number", name: "charges_current", onlyInt: true, min: 0 },
          { type: "select", name: "location", values: ["person", "stash"], maxSelect: 1, required: true },
          ...timestamps(),
        ],
        indexes: [
          "CREATE INDEX idx_inventory_game ON inventory (game)",
          "CREATE INDEX idx_inventory_owner ON inventory (owner)",
          "CREATE INDEX idx_inventory_item ON inventory (item)",
          "CREATE INDEX idx_inventory_game_owner_location ON inventory (game, owner, location)",
        ],
      })
    );
  },
  (app) => {
    // down
    [ID.inventory, ID.items, ID.wallets, ID.memberships, ID.currencies, ID.games, ID.systems, ID.players].forEach((name) => {
      const col = app.findCollectionByNameOrId(name);
      if (col) app.delete(col);
    });
  }
);
