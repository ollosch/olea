package dnd5eimport

import (
	"strings"
	"testing"
)

func TestParseSpellsPreservesRawAndNormalizesSchool(t *testing.T) {
	input := `{"spell":[{"name":"Tiny Light","source":"TEST","level":0,"school":"V","entries":["A spark."],"extraField":{"kept":true}},{"name":"Larger Light","source":"TEST","level":3,"school":"E","entries":["A glow."],"entriesHigherLevel":[{"type":"entries","name":"At Higher Levels","entries":["Brighter."]}]}]}`
	result, err := ParseSpells(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 2 || result.Skipped != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	cantrip, higher := result.Document.Records[0], result.Document.Records[1]
	if cantrip.Level != "0" || cantrip.School != "Evocation" || !strings.Contains(string(cantrip.Original), `"extraField"`) {
		t.Fatalf("cantrip fields not normalized/preserved: %#v", cantrip)
	}
	if higher.School != "Enchantment" || !strings.Contains(string(higher.Original), `"entriesHigherLevel"`) {
		t.Fatalf("higher-level entries not preserved: %#v", higher)
	}
}

func TestParseSpellsReportsSkippedAndUnknownSchool(t *testing.T) {
	input := `{"spell":[{"name":"Odd Spell","source":"TEST","level":1,"school":"Z","future":1},{"name":"No School","source":"TEST","level":1}]}`
	result, err := ParseSpells(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 1 || result.Skipped != 1 || result.Document.Records[0].School != "Z" || len(result.Warnings) != 2 {
		t.Fatalf("unexpected skip/warnings: %#v", result)
	}
}
