package encounters

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	_ "olea/migrations"
)

func TestEncounterPreparationIsIndependentAndCascadesWithGame(t *testing.T) {
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
	game := save(t, app, "games", map[string]any{"name": "Encounter test", "system": system.Id})
	creature := save(t, app, "catalog", map[string]any{"system": system.Id, "type": "creature", "source": "SYNTHETIC", "source_id": "test-ooze", "name": "Test Ooze", "original_json": map[string]any{"name": "Test Ooze"}})
	first := save(t, app, "encounters", map[string]any{"game": game.Id, "name": "Cellar"})
	second := save(t, app, "encounters", map[string]any{"game": game.Id, "name": "Tower"})
	entry := save(t, app, "encounter_creatures", map[string]any{"encounter": first.Id, "creature": creature.Id, "name": "Test Ooze", "quantity": 3})
	items, err := app.FindRecordsByFilter("encounter_creatures", "encounter = {:id}", "", 0, 0, map[string]any{"id": second.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatal("encounters share prepared entries")
	}
	if err := app.Delete(game); err != nil {
		t.Fatal(err)
	}
	for collection, id := range map[string]string{"encounters": first.Id, "encounter_creatures": entry.Id} {
		if _, err := app.FindRecordById(collection, id); err == nil {
			t.Errorf("%s %s survived game deletion", collection, id)
		}
	}
	if _, err := app.FindRecordById("catalog", creature.Id); err != nil {
		t.Fatal("catalog creature should survive game deletion:", err)
	}
}

func save(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
	t.Helper()
	model, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(model)
	for key, value := range fields {
		record.Set(key, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return record
}
