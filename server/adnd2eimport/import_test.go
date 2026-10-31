package adnd2eimport

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	"olea/catalogimport"
	_ "olea/migrations"
)

func TestSpellPagesAndReimport(t *testing.T) {
	index := `[{"pageid":12,"title":"Invented Spark (Wizard Spell)"},{"pageid":12,"title":"Invented Spark (Wizard Spell)"},{"pageid":13,"title":"Missing (Priest Spell)"},{"pageid":14,"title":"Incomplete (Priest Spell)"}]`
	pages := `[{"pageid":12,"title":"Invented Spark (Wizard Spell)","wikitext":"{{Infobox Spells\n| name = Invented Spark\n| source = [[Some Index|Invented Book]] page 3{{br}}Extra\n| school = Illusion\n| sphere = Time\n| level = 2\n| range = 10 feet\n}}\nA [[target|spark]] appears."},{"pageid":14,"title":"Incomplete (Priest Spell)","wikitext":"A partial page."}]`
	result, err := ParseSpells(strings.NewReader(index), strings.NewReader(pages))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 2 || result.Skipped != 2 || len(result.Warnings) != 2 {
		t.Fatalf("unexpected summary: %+v", result)
	}
	spell := result.Document.Records[0]
	if spell.Name != "Invented Spark" || spell.School != "Illusion" || spell.Sphere != "Time" || spell.Level != "2" || spell.BookSource != "Invented Book" {
		t.Fatalf("incorrect metadata: %+v", spell)
	}
	var original map[string]any
	if err := json.Unmarshal(spell.Original, &original); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(original["wikitext"].(string), "[[target|spark]]") {
		t.Fatal("raw wikitext not preserved")
	}
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	if _, err := catalogimport.Import(app, "adnd2e", result.Document); err != nil {
		t.Fatal(err)
	}
	record, err := app.FindFirstRecordByData("catalog", "source_id", "12")
	if err != nil {
		t.Fatal(err)
	}
	record.Set("alternate_description", "Custom text")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	summary, err := catalogimport.Import(app, "adnd2e", result.Document)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Updated != 2 || summary.Created != 0 {
		t.Fatal(summary)
	}
	record, err = app.FindRecordById("catalog", record.Id)
	if err != nil || record.GetString("alternate_description") != "Custom text" {
		t.Fatal("alternate not preserved", err)
	}
	if record.GetString("book_source") != "Invented Book" || record.GetString("sphere") != "Time" {
		t.Fatal("metadata not saved")
	}
	_, err = app.FindFirstRecordByData("systems", "key", "adnd2e")
	if err != nil {
		t.Fatal(err)
	}
}

func TestCreatureSingleAndMultiColumn(t *testing.T) {
	page := `<html><div class="monsterpage-module--top-header--abc"><h1>Invented Ooze</h1></div><span class="interweave"><table><tr><th>Hit Dice:</th><td>4+2</td></tr><tr><th>Armor Class:</th><td>5</td></tr></table><p>Safe <b>text</b></p><script>bad()</script></span><div class="monsterpage-module--tsr--abc"><a>Invented Book</a></div></html>`
	record, warnings, err := ParseCreature(strings.NewReader(page), "ooze")
	if err != nil || len(warnings) != 0 {
		t.Fatalf("%v %v", err, warnings)
	}
	var original struct {
		HTML  string            `json:"html"`
		Stats map[string]string `json:"stats"`
	}
	if err := json.Unmarshal(record.Original, &original); err != nil {
		t.Fatal(err)
	}
	if record.SourceID != "ooze" || record.BookSource != "Invented Book" || original.Stats["Hit Dice"] != "4+2" || !strings.Contains(original.HTML, "<script>") {
		t.Fatal("creature source not preserved")
	}
	multi := strings.Replace(page, `<th>Hit Dice:</th><td>4+2</td>`, `<th>Hit Dice:</th><td>4</td><td>5</td>`, 1)
	record, warnings, err = ParseCreature(strings.NewReader(multi), "multi")
	if err != nil || len(warnings) == 0 {
		t.Fatal("ambiguous stats not reported")
	}
	original.Stats = nil
	if err := json.Unmarshal(record.Original, &original); err != nil {
		t.Fatal(err)
	}
	if original.Stats["Hit Dice"] != "" {
		t.Fatal("ambiguous hit dice should not be inferred")
	}
	if _, _, err := ParseCreature(strings.NewReader("<p>not a creature</p>"), "bad"); err == nil {
		t.Fatal("missing page structure accepted")
	}
}
