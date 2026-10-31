package spellbooks

import (
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	_ "olea/migrations"
)

func TestSpellCollectionsAreIndependentPerCharacter(t *testing.T) {
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
	game := saveRecord(t, app, "games", map[string]any{"name": "Spellbook test", "system": system.Id})
	firstCharacter := saveRecord(t, app, "characters", map[string]any{"name": "First", "game": game.Id})
	secondCharacter := saveRecord(t, app, "characters", map[string]any{"name": "Second", "game": game.Id})
	firstBook := saveRecord(t, app, "spellbooks", map[string]any{"character": firstCharacter.Id, "name": "Known"})
	secondBook := saveRecord(t, app, "spellbooks", map[string]any{"character": secondCharacter.Id, "name": "Known"})
	catalog := saveRecord(t, app, "catalog", map[string]any{
		"system": system.Id, "type": "spell", "source": "SYNTHETIC", "source_id": "test-spell",
		"name": "Test Spell", "original_json": map[string]any{"entries": []string{"An invented spell."}},
	})
	saveRecord(t, app, "spellbook_spells", map[string]any{"spellbook": firstBook.Id, "spell": catalog.Id})

	firstEntries, err := app.FindRecordsByFilter("spellbook_spells", "spellbook = {:book}", "", 0, 0, map[string]any{"book": firstBook.Id})
	if err != nil {
		t.Fatal(err)
	}
	secondEntries, err := app.FindRecordsByFilter("spellbook_spells", "spellbook = {:book}", "", 0, 0, map[string]any{"book": secondBook.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(firstEntries) != 1 || len(secondEntries) != 0 {
		t.Fatalf("spellbook contents were not independent: first=%d second=%d", len(firstEntries), len(secondEntries))
	}
}

func saveRecord(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
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
