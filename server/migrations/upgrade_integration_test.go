package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"olea/currency"
)

func TestPopulatedPreMilestoneUpgradeAndRestart(t *testing.T) {
	dir := t.TempDir()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	var old core.MigrationsList
	for _, migration := range core.AppMigrations.Items() {
		if migration.File < "20261031000015" {
			old.Add(migration)
		}
	}
	if _, err := core.NewMigrationsRunner(app, old).Up(); err != nil {
		t.Fatal(err)
	}
	save := func(name string, fields map[string]any) *core.Record {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		for k, v := range fields {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	system, err := app.FindFirstRecordByFilter("systems", "key = 'adnd2e'")
	if err != nil {
		t.Fatal(err)
	}
	game := save("games", map[string]any{"name": "Upgrade", "system": system.Id})
	character := save("characters", map[string]any{"name": "Test", "game": game.Id})
	inventory := save("inventories", map[string]any{"game": game.Id, "character": character.Id, "cp": 12, "gp": 5})
	stash := save("stashes", map[string]any{"game": game.Id, "name": "Party", "kind": "party", "pp": 8})
	encounter := save("encounters", map[string]any{"game": game.Id, "name": "Legacy"})
	combat := save("combats", map[string]any{"encounter": encounter.Id, "active": true, "round": 2, "turn": 1})
	save("combatants", map[string]any{"combat": combat.Id, "name": "First", "initiative_known": true, "initiative": 20})
	active := save("combatants", map[string]any{"combat": combat.Id, "name": "Second", "initiative_known": true, "initiative": 10})
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	if err := app.ResetBootstrapState(); err != nil {
		t.Fatal(err)
	}
	restarted := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dir, HideStartBanner: true})
	if err := restarted.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer restarted.ResetBootstrapState()
	if err := restarted.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		collection, id, key string
		expected            int64
	}{{"inventories", inventory.Id, "cp", 12}, {"inventories", inventory.Id, "gp", 5}, {"stashes", stash.Id, "pp", 8}} {
		record, err := restarted.FindRecordById(check.collection, check.id)
		if err != nil {
			t.Fatal(err)
		}
		balances, err := currency.Decode(record.Get("balances"))
		if err != nil || balances[check.key] != check.expected || len(balances) != 5 {
			t.Fatalf("upgrade balance %s: %v %v", check.key, balances, err)
		}
	}
	updated, err := restarted.FindRecordById("combats", combat.Id)
	if err != nil || updated.GetString("active_participant") != active.Id || updated.GetInt("round") != 2 {
		t.Fatalf("legacy active participant lost: %v", err)
	}
}
