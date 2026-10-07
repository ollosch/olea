/// <reference path="../pb_data/types.d.ts" />

// Deterministic collection ids so relation fields can reference them.
const ID = {
  players: "w_players",
  games: "w_games",
  currencies: "w_currencies",
  memberships: "w_memberships",
  wallets: "w_wallets",
  items: "w_items",
  inventory: "w_inventory",
};

const ANY_AUTH = "@request.auth.id != ''";

migrate(
  (app) => {
    // ---------------------------------------------------------------- players (auth)
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
        fields: [{ type: "text", name: "name", required: true, min: 1, max: 100 }],
        indexes: ["CREATE UNIQUE INDEX idx_players_name ON players (name)"],
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
        deleteRule: "",
        fields: [
          { type: "text", name: "name", required: true, min: 1, max: 200 },
          { type: "text", name: "description", max: 2000 },
        ],
      })
    );

    // ---------------------------------------------------------------- currencies
    app.save(
      new Collection({
        id: ID.currencies,
        type: "base",
        name: "currencies",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
          { type: "relation", name: "game", collectionId: ID.games, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "text", name: "name", required: true, min: 1, max: 100 },
          { type: "text", name: "symbol", max: 20 },
          { type: "number", name: "base_value", required: true, onlyInt: true, min: 1 },
          { type: "number", name: "sort", onlyInt: true },
        ],
        indexes: ["CREATE INDEX idx_currencies_game ON currencies (game)"],
      })
    );

    // ---------------------------------------------------------------- memberships
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
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_memberships_game_player ON memberships (game, player)",
          "CREATE INDEX idx_memberships_player ON memberships (player)",
        ],
      })
    );

    // ---------------------------------------------------------------- wallets
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
          { type: "relation", name: "membership", collectionId: ID.memberships, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "relation", name: "currency", collectionId: ID.currencies, cascadeDelete: true, maxSelect: 1, required: true },
          { type: "number", name: "amount", onlyInt: true, min: 0 },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_wallets_membership_currency ON wallets (membership, currency)"],
      })
    );

    // ---------------------------------------------------------------- items (catalog)
    app.save(
      new Collection({
        id: ID.items,
        type: "base",
        name: "items",
        listRule: ANY_AUTH,
        viewRule: ANY_AUTH,
        createRule: ANY_AUTH, // GM check enforced in hook
        updateRule: ANY_AUTH, // GM check enforced in hook
        deleteRule: ANY_AUTH, // GM check + "not held" enforced in hook
        fields: [
          { type: "relation", name: "game", collectionId: ID.games, cascadeDelete: true, maxSelect: 1, required: true },
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
        ],
        indexes: ["CREATE INDEX idx_items_game ON items (game)"],
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
        ],
        indexes: [
          "CREATE INDEX idx_inventory_game ON inventory (game)",
          "CREATE INDEX idx_inventory_owner ON inventory (owner)",
          "CREATE INDEX idx_inventory_item ON inventory (item)",
        ],
      })
    );
  },
  (app) => {
    // down
    [ID.inventory, ID.items, ID.wallets, ID.memberships, ID.currencies, ID.games, ID.players].forEach((name) => {
      const col = app.findCollectionByNameOrId(name);
      if (col) app.delete(col);
    });
  }
);
