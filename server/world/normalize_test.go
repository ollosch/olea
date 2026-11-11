package world

import (
	"reflect"
	"testing"

	"github.com/pocketbase/pocketbase/tools/types"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Almost Titans":           "almost-titans",
		"Fate's Children":         "fates-children",
		"  Multiple --- spaces  ": "multiple-spaces",
		"Root":                    "root",
	}
	for input, expected := range cases {
		if actual := Slugify(input); actual != expected {
			t.Errorf("Slugify(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestNormalizeTypeClass(t *testing.T) {
	cases := []struct {
		raw   string
		class string
		known bool
	}{
		{"location", "location", true},
		{"plot", "thread", true},
		{"creature", "concept", true},
		{"", "", false},
		{"mystery", "", false},
	}
	for _, test := range cases {
		class, known := NormalizeTypeClass(test.raw)
		if class != test.class || known != test.known {
			t.Errorf("NormalizeTypeClass(%q) = (%q, %v), want (%q, %v)", test.raw, class, known, test.class, test.known)
		}
	}
}

func TestFolderInference(t *testing.T) {
	for _, test := range []struct {
		folder string
		class  string
		scope  string
	}{
		{"World/Locations/City", "location", "world"},
		{"World/Actors", "actor", "world"},
		{"World/Items/Sword", "concept", "world"},
		{"Timeline/Events", "event", "world"},
		{"Rules/Dnd", "concept", "rules"},
		{"Campaigns/Almost Titans", "note", "notes"},
		{"", "note", "notes"},
	} {
		if class := InferTypeClassFromFolder(test.folder); class != test.class {
			t.Errorf("InferTypeClassFromFolder(%q) = %q, want %q", test.folder, class, test.class)
		}
		if scope := InferScope(test.folder); scope != test.scope {
			t.Errorf("InferScope(%q) = %q, want %q", test.folder, scope, test.scope)
		}
	}

	key, name, ok := InferCampaignFromFolder("Campaigns/Almost Titans/Notes")
	if !ok || key != "almost-titans" || name != "Almost Titans" {
		t.Fatalf("InferCampaignFromFolder = (%q, %q, %v)", key, name, ok)
	}
	if _, _, ok := InferCampaignFromFolder("Campaigns"); ok {
		t.Fatal("Campaigns root must not infer a campaign")
	}
}

func TestNormalizeRelationKey(t *testing.T) {
	for _, test := range []struct {
		input    string
		expected string
		renamed  bool
	}{
		{"in", "In", true},
		{"Quest", "Quests", true},
		{"Quests", "Quests", false},
		{"group", "Gruppen", true},
		{"Freunde", "Freunde", false},
		{" Quests ", "Quests", false},
	} {
		actual, renamed := NormalizeRelationKey(test.input)
		if actual != test.expected || renamed != test.renamed {
			t.Errorf("NormalizeRelationKey(%q) = (%q, %v), want (%q, %v)", test.input, actual, renamed, test.expected, test.renamed)
		}
	}
}

func TestFlattenLinkTargets(t *testing.T) {
	targets, warnings := FlattenLinkTargets([]any{"a", []any{"b", nil}, "c"})
	if !reflect.DeepEqual(targets, []string{"a", "b", "c"}) {
		t.Fatalf("targets = %#v", targets)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %#v", warnings)
	}

	targets, warnings = FlattenLinkTargets(map[string]any{"name": "a"})
	if len(targets) != 0 || len(warnings) != 1 {
		t.Fatalf("map target = (%#v, %#v)", targets, warnings)
	}
}

func TestDecodeJSON(t *testing.T) {
	var value any
	if err := DecodeJSON(types.JSONRaw(`{"a":1}`), &value); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(value, map[string]any{"a": float64(1)}) {
		t.Fatalf("value = %#v", value)
	}
}
