package dnd5eimport

import (
	"strings"
	"testing"
)

func TestParseItemsResolvesInheritanceAndModifications(t *testing.T) {
	input := `{"item":[{"name":"Base Ring","source":"TEST","type":"RG","weight":1,"value":100,"rarity":"uncommon","entries":["A +1 ring.","Second entry."]},{"name":"Greater Ring","source":"TEST","_copy":{"name":"Base Ring","source":"TEST","_mod":{"entries":{"mode":"replaceTxt","replace":"\\+1","with":"+2","flags":"i"}}},"weight":2}],"itemGroup":[{"name":"Ring Set","source":"TEST","items":["Greater Ring|TEST"]}]}`
	result, err := ParseItems(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 2 || result.Skipped != 0 || result.Groups != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	derived := result.Document.Records[1]
	if derived.Name != "Greater Ring" || string(derived.ItemType) != `"RG"` || string(derived.ItemWeight) != "2" || string(derived.ItemValue) != "100" || derived.Rarity != "uncommon" {
		t.Fatalf("inherited fields not normalized: %#v", derived)
	}
	if !strings.Contains(string(derived.Original), `A +2 ring.`) || !strings.Contains(string(derived.Original), `"_copy"`) {
		t.Fatalf("resolved entries or source _copy object were not preserved: %s", derived.Original)
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "itemGroup") {
		t.Fatalf("item groups should be explicitly reported: %#v", result.Warnings)
	}
}

func TestParseItemsReportsMissingAndUnsupportedCopy(t *testing.T) {
	input := `{"item":[{"name":"Base","source":"TEST","entries":[]},{"name":"Missing Base","source":"TEST","_copy":{"name":"No Such Base","source":"TEST"}},{"name":"Unsupported","source":"TEST","_copy":{"name":"Base","source":"TEST","_mod":{"weight":{"mode":"addProp","props":{"weight":1}}}}},{"name":"Plain","source":"TEST","type":"G","weight":null,"value":null,"rarity":"common","entries":[]}]}`
	result, err := ParseItems(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 2 || result.Skipped != 2 || len(result.Warnings) != 2 {
		t.Fatalf("missing/unsupported copies should be skipped with warnings: %#v", result)
	}
	if !strings.Contains(result.Warnings[0], "missing") || !strings.Contains(result.Warnings[1], "unsupported") {
		t.Fatalf("warnings should explain each skipped copy: %#v", result.Warnings)
	}
}

func TestParseItemsSupportsAppendAndInsertModes(t *testing.T) {
	input := `{"item":[{"name":"Base","source":"TEST","entries":["first","last"]},{"name":"Append","source":"TEST","_copy":{"name":"Base","source":"TEST","_mod":{"entries":{"mode":"appendArr","items":"appended"}}}},{"name":"Insert","source":"TEST","_copy":{"name":"Base","source":"TEST","_mod":{"entries":{"mode":"insertArr","index":1,"items":"middle"}}}}]}`
	result, err := ParseItems(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(result.Document.Records[1].Original), `"last","appended"`) || !strings.Contains(string(result.Document.Records[2].Original), `"first","middle","last"`) {
		t.Fatalf("array mods not applied: append=%s insert=%s", result.Document.Records[1].Original, result.Document.Records[2].Original)
	}
}

func TestParseItemsReportsInvalidModificationDefinition(t *testing.T) {
	input := `{"item":[{"name":"Base","source":"TEST","entries":["text"]},{"name":"Bad copy","source":"TEST","_copy":{"name":"Base","source":"TEST","_mod":"unknown"}}]}`
	result, err := ParseItems(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 1 || result.Skipped != 1 || !strings.Contains(result.Warnings[0], "_mod must be an object") {
		t.Fatalf("invalid modification was not reported: %#v", result)
	}
}
