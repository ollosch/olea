package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"olea/currency"
)

func TestCurrencyMigrationPopulatedStoresAndRestart(t *testing.T) {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"inventories", "stashes"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		collection.Fields.RemoveByName("balances")
		if err := app.Save(collection); err != nil {
			t.Fatal(err)
		}
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
	system, err := app.FindFirstRecordByFilter("systems", "key = 'dnd5e'")
	if err != nil {
		t.Fatal(err)
	}
	game := save("games", map[string]any{"name": "Test", "system": system.Id})
	character := save("characters", map[string]any{"name": "Test", "game": game.Id})
	inventory := save("inventories", map[string]any{"game": game.Id, "character": character.Id, "gp": 42, "cp": 3})
	stash := save("stashes", map[string]any{"game": game.Id, "kind": "party", "name": "Test", "pp": 7})
	if err := migrateCurrencyBalances(app); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		collection, id, key string
		amount              int64
	}{{"inventories", inventory.Id, "gp", 42}, {"stashes", stash.Id, "pp", 7}} {
		record, err := app.FindRecordById(check.collection, check.id)
		if err != nil {
			t.Fatal(err)
		}
		balances, err := currency.Decode(record.Get("balances"))
		if err != nil {
			t.Fatal(err)
		}
		if balances[check.key] != check.amount || len(balances) != 5 || balances["ep"] != 0 || record.GetString("game") != game.Id {
			t.Fatalf("migration lost balances or ownership: %v", balances)
		}
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	record, _ := app.FindRecordById("inventories", inventory.Id)
	balances, _ := currency.Decode(record.Get("balances"))
	if balances["gp"] != 42 {
		t.Fatal("restart changed balances")
	}
}
