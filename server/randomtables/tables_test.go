package randomtables

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	_ "olea/migrations"
)

func testApp(t *testing.T) core.App {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.ResetBootstrapState(); err != nil {
			t.Error(err)
		}
	})
	return app
}
func saveRecord(t *testing.T, app core.App, name string, fields map[string]any) *core.Record {
	t.Helper()
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

func TestRangesAndDice(t *testing.T) {
	table := Table{Name: "Test", Dice: "2d6 + 1", Entries: []Entry{{Min: -1, Max: 0, Text: "a"}, {Min: 1, Max: 4, Text: "b"}}}
	if err := Validate(table); err != nil {
		t.Fatal(err)
	}
	table.Entries[1].Min = 0
	if Validate(table) == nil {
		t.Fatal("touching ranges overlap")
	}
	table.Entries[1].Min = 5
	if Validate(table) == nil {
		t.Fatal("reversed range accepted")
	}
	table.Entries[1].Min = 1
	table.Dice = "2d6+2d4"
	if Validate(table) == nil {
		t.Fatal("unsupported dice accepted")
	}
	for _, text := range []string{`{"max":0,"text":"a"}`, `{"min":null,"max":1,"text":"a"}`, `{"min":0.5,"max":1,"text":"a"}`} {
		var entry Entry
		if json.Unmarshal([]byte(text), &entry) == nil {
			t.Fatalf("invalid range accepted: %s", text)
		}
	}
}

func TestReferencesTemplatesAndIndependentCopies(t *testing.T) {
	app := testApp(t)
	system, err := app.FindFirstRecordByData("systems", "key", "dnd5e")
	if err != nil {
		t.Fatal(err)
	}
	otherSystem := saveRecord(t, app, "systems", map[string]any{"key": "other", "name": "Other"})
	g1 := saveRecord(t, app, "games", map[string]any{"name": "One", "system": system.Id})
	g2 := saveRecord(t, app, "games", map[string]any{"name": "Two", "system": system.Id})
	g3 := saveRecord(t, app, "games", map[string]any{"name": "Three", "system": otherSystem.Id})
	creature := saveRecord(t, app, "catalog", map[string]any{"system": system.Id, "type": "creature", "source": "TEST", "source_id": "goo", "name": "Goo", "original_json": map[string]any{"name": "Goo"}})
	item := saveRecord(t, app, "catalog", map[string]any{"system": system.Id, "type": "item", "source": "TEST", "source_id": "key", "name": "Key", "original_json": map[string]any{"name": "Key"}})
	spell := saveRecord(t, app, "catalog", map[string]any{"system": system.Id, "type": "spell", "source": "TEST", "source_id": "spark", "name": "Spark", "original_json": map[string]any{"name": "Spark"}})
	encounter := saveRecord(t, app, "encounters", map[string]any{"game": g2.Id, "name": "Other encounter"})
	if err := AddCreature(app, g1.Id, encounter.Id, creature.Id); err == nil {
		t.Fatal("creature added to foreign encounter")
	}
	if err := AddCreature(app, g2.Id, encounter.Id, creature.Id); err != nil {
		t.Fatal(err)
	}
	prepared, err := app.FindFirstRecordByData("encounter_creatures", "encounter", encounter.Id)
	if err != nil || prepared.GetString("creature") != creature.Id {
		t.Fatal("creature not added to encounter", err)
	}
	table := Table{Name: "Refs", Entries: []Entry{{Min: 1, Max: 1, Type: "creature", Ref: creature.Id}}}
	if _, err := Save(app, g1.Id, "", table); err != nil {
		t.Fatal(err)
	}
	for kind, ref := range map[string]string{"item": item.Id, "spell": spell.Id, "encounter": encounter.Id} {
		valid := Table{Name: "Other kind", Entries: []Entry{{Min: 1, Max: 1, Type: kind, Ref: ref}}}
		if _, err := Save(app, g2.Id, "", valid); err != nil {
			t.Fatalf("valid %s reference: %v", kind, err)
		}
	}
	if _, err := Save(app, g3.Id, "", table); err == nil {
		t.Fatal("foreign system accepted")
	}
	table.Entries[0] = Entry{Min: 1, Max: 1, Type: "encounter", Ref: encounter.Id}
	if _, err := Save(app, g1.Id, "", table); err == nil {
		t.Fatal("foreign encounter accepted")
	}
	table.Entries[0] = Entry{Min: 1, Max: 1, Type: "spell", Ref: creature.Id}
	if _, err := Save(app, g1.Id, "", table); err == nil {
		t.Fatal("incorrect catalog type accepted")
	}
	table.Entries[0].Ref = "missing"
	if _, err := Save(app, g1.Id, "", table); err == nil {
		t.Fatal("missing reference accepted")
	}
	doc, err := Parse(strings.NewReader(`{"templates":[{"source":"SYN","source_id":"t1","name":"Goo table","dice":"1d6","entries":[{"min":1,"max":6,"text":"A goo","type":"creature","source":"TEST","source_id":"goo"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Import(app, "dnd5e", doc); err != nil {
		t.Fatal(err)
	}
	bad, err := Parse(strings.NewReader(`{"templates":[{"source":"SYN","source_id":"would-create","name":"Valid","entries":[{"min":1,"max":1,"text":"ok"}]},{"source":"SYN","source_id":"bad","name":"Missing","entries":[{"min":1,"max":1,"type":"spell","source":"TEST","source_id":"missing"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Import(app, "dnd5e", bad); err == nil {
		t.Fatal("missing import reference accepted")
	}
	if _, err := app.FindFirstRecordByData("table_templates", "source_id", "would-create"); err == nil {
		t.Fatal("failed import was not rolled back")
	}
	template, err := app.FindFirstRecordByData("table_templates", "source_id", "t1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Copy(app, g3.Id, template.Id); err == nil {
		t.Fatal("foreign template accepted")
	}
	first, err := Copy(app, g1.Id, template.Id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Copy(app, g2.Id, template.Id)
	if err != nil {
		t.Fatal(err)
	}
	changed := Table{Name: "Edited", Entries: []Entry{{Min: 0, Max: 0, Text: "Changed"}}}
	if _, err := Save(app, g1.Id, first, changed); err != nil {
		t.Fatal(err)
	}
	if _, err := Save(app, g2.Id, first, changed); err == nil {
		t.Fatal("foreign table update accepted")
	}
	secondRecord, err := app.FindRecordById("random_tables", second)
	if err != nil {
		t.Fatal(err)
	}
	if secondRecord.GetString("name") != "Goo table" || !strings.Contains(secondRecord.GetString("entries"), "A goo") {
		t.Fatal("copy changed with another game")
	}
	if _, err := Import(app, "dnd5e", doc); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("table_templates", template.Id); err != nil {
		t.Fatal("reimport changed template identity")
	}
	if err := app.Delete(creature); err != nil {
		t.Fatal(err)
	}
	if _, err := Copy(app, g2.Id, template.Id); err == nil {
		t.Fatal("missing template reference accepted")
	}
	if err := app.Delete(g1); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("random_tables", first); err == nil {
		t.Fatal("game deletion did not remove table")
	}
}
