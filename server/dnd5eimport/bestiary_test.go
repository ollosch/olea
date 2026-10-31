package dnd5eimport

import (
	"strings"
	"testing"
)

func TestParseBestiaryNormalizesStringAndObjectFields(t *testing.T) {
	input := `{"monster":[{"name":"Tiny Beast","source":"TEST","type":"beast","cr":"1/8","hp":{"average":4,"formula":"1d6 + 1"},"dex":12,"action":[{"name":"Bite","entries":["A test bite."]}],"unknown":{"kept":true}},{"name":"Odd Beast","source":"TEST","type":{"type":"monstrosity","tags":["shapechanger"]},"cr":{"cr":"13","lair":"14"},"hp":{"average":180,"formula":"19d10 + 76"},"dex":16,"action":[]}]}`
	result, err := ParseBestiary(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 2 || result.Skipped != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	first, second := result.Document.Records[0], result.Document.Records[1]
	if first.CreatureType != "beast" || first.ChallengeRating != "1/8" || first.HPAverage == nil || *first.HPAverage != 4 || first.HPFormula != "1d6 + 1" || first.Dexterity == nil || *first.Dexterity != 12 || !strings.Contains(string(first.Actions), "Bite") || !strings.Contains(string(first.Original), `"unknown"`) {
		t.Fatalf("string-form fields were not preserved: %#v", first)
	}
	if second.CreatureType != "monstrosity" || second.ChallengeRating != "13" || !strings.Contains(string(second.Original), `"lair":"14"`) {
		t.Fatalf("object-form fields were not normalized/preserved: %#v", second)
	}
}

func TestParseBestiaryWarnsAndPreservesAbsentFields(t *testing.T) {
	result, err := ParseBestiary(strings.NewReader(`{"monster":[{"name":"Incomplete","source":"TEST","type":"beast","cr":"0","hp":{"formula":"1d4"},"action":[]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Document.Records) != 1 || result.Skipped != 0 || result.Document.Records[0].HPAverage != nil || result.Document.Records[0].Dexterity != nil || len(result.Warnings) != 2 {
		t.Fatalf("missing fields should warn and be retained: %#v", result)
	}
}
