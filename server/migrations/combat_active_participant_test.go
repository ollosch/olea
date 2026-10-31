package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func TestActiveParticipantMigrationPreservesLegacyTurn(t *testing.T) {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	combats, err := app.FindCollectionByNameOrId("combats")
	if err != nil {
		t.Fatal(err)
	}
	combats.Fields.RemoveByName("active_participant")
	if err := app.Save(combats); err != nil {
		t.Fatal(err)
	}
	save := func(collection string, fields map[string]any) *core.Record {
		model, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatal(err)
		}
		record := core.NewRecord(model)
		for key, value := range fields {
			record.Set(key, value)
		}
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
		return record
	}
	system, err := app.FindFirstRecordByFilter("systems", "key = 'adnd2e'")
	if err != nil {
		t.Fatal(err)
	}
	game := save("games", map[string]any{"name": "Test", "system": system.Id})
	encounter := save("encounters", map[string]any{"name": "Test", "game": game.Id})
	combat := save("combats", map[string]any{"encounter": encounter.Id, "active": true, "round": 1, "turn": 1})
	first := save("combatants", map[string]any{"combat": combat.Id, "name": "First", "initiative_known": true, "initiative": 20})
	second := save("combatants", map[string]any{"combat": combat.Id, "name": "Second", "initiative_known": true, "initiative": 10})
	if err := migrateActiveParticipants(app); err != nil {
		t.Fatal(err)
	}
	result, err := app.FindRecordById("combats", combat.Id)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetString("active_participant") != second.Id {
		t.Fatalf("got %s, expected %s (first %s)", result.GetString("active_participant"), second.Id, first.Id)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	result, err = app.FindRecordById("combats", combat.Id)
	if err != nil || result.GetString("active_participant") != second.Id {
		t.Fatal("active participant changed on restart", err)
	}
}
