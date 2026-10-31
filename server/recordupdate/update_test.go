package recordupdate

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
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
