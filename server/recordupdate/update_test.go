package recordupdate

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"olea/currency"
	_ "olea/migrations"
)

func TestGuardedUpdateRejectsStaleWriteAndUnexpectedFields(t *testing.T) {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.ResetBootstrapState(); err != nil {
			t.Errorf("reset test app: %v", err)
		}
	})
	system, err := app.FindFirstRecordByFilter("systems", "key = 'dnd5e'")
	if err != nil {
		t.Fatal(err)
	}
	gameModel, err := app.FindCollectionByNameOrId("games")
	if err != nil {
		t.Fatal(err)
	}
	game := core.NewRecord(gameModel)
	game.Set("name", "Guard test")
	game.Set("system", system.Id)
	if err := app.Save(game); err != nil {
		t.Fatal(err)
	}
	if err := Update(app, "games", game.Id, map[string]any{"encounter_visible": false, "encounter_show_hp": false}, map[string]any{"encounter_visible": true}); err != nil {
		t.Fatal(err)
	}
	if err := Update(app, "games", game.Id, map[string]any{"encounter_visible": false}, map[string]any{"encounter_visible": false}); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	latest, err := app.FindRecordById("games", game.Id)
	if err != nil {
		t.Fatal(err)
	}
	if latest.GetBool("encounter_visible") != true || latest.GetBool("encounter_show_hp") {
		t.Fatal("stale update changed data")
	}
	if err := Update(app, "games", game.Id, map[string]any{"name": "Guard test"}, map[string]any{"name": "unauthorized field"}); err == nil {
		t.Fatal("unexpected field was allowed")
	}
}

func TestCurrencyGuardRejectsStaleAndUnsupportedChanges(t *testing.T) {
	cleanup := currency.SetDenominationsForTest("invented", []string{"shell"})
	defer cleanup()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
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
	system := save("systems", map[string]any{"key": "invented", "name": "Invented"})
	game := save("games", map[string]any{"name": "Test", "system": system.Id})
	stash := save("stashes", map[string]any{"game": game.Id, "kind": "party", "name": "Test", "balances": map[string]int{"shell": 5, "old": 9}})
	expected := map[string]any{"balances": map[string]any{"shell": 5, "old": 9}}
	if err := Update(app, "stashes", stash.Id, expected, map[string]any{"balances": map[string]any{"shell": 3, "old": 9}}); err != nil {
		t.Fatal(err)
	}
	if err := Update(app, "stashes", stash.Id, expected, map[string]any{"balances": map[string]any{"shell": 4, "old": 9}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict: %v", err)
	}
	current := map[string]any{"balances": map[string]any{"shell": 3, "old": 9}}
	for _, value := range []any{map[string]any{"shell": 3}, map[string]any{"shell": 3, "old": 0}, map[string]any{"shell": -1, "old": 9}, map[string]any{"shell": 3.5, "old": 9}} {
		if err := Update(app, "stashes", stash.Id, current, map[string]any{"balances": value}); err == nil {
			t.Fatalf("invalid balance accepted: %v", value)
		}
	}
}
