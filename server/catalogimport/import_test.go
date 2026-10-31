package catalogimport

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	_ "olea/migrations"
)

func TestParseSyntheticRecords(t *testing.T) {
	input := `{"records":[{"type":"spell","source":"TEST","source_id":"spark","name":"Spark","level":"0","school":"V","original":{"entries":["A small flash."]}},{"type":"creature","source":"TEST","source_id":"moth-1","name":"Moth","creature_type":"fey","challenge_rating":"1/8","original":{"name":"Moth","unknownField":true}}]}`
	document, err := Parse(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Records) != 2 || document.Records[0].Name != "Spark" || document.Records[1].ChallengeRating != "1/8" {
		t.Fatalf("unexpected parsed records: %#v", document.Records)
	}
}

func TestImportRollsBackOnFailure(t *testing.T) {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	doc, err := Parse(strings.NewReader(`{"records":[{"type":"item","source":"TEST","source_id":"first","name":"First","original":{}},{"type":"item","source":"TEST","source_id":"second","name":"Second","original":{}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	doc.Records[1].Name = ""
	if _, err := Import(app, "dnd5e", doc); err == nil {
		t.Fatal("expected invalid record to fail")
	}
	if _, err := app.FindFirstRecordByData("catalog", "source_id", "first"); err == nil {
		t.Fatal("partial import was not rolled back")
	}
}

func TestParseRejectsInvalidAndDuplicateIdentity(t *testing.T) {
	for name, input := range map[string]string{
		"invalid type":       `{"records":[{"type":"monster","source":"TEST","source_id":"m1","name":"Moth","original":{}}]}`,
		"duplicate identity": `{"records":[{"type":"item","source":"TEST","source_id":"rope","name":"Rope","original":{}},{"type":"item","source":"TEST","source_id":"rope","name":"Rope copy","original":{}}]}`,
		"missing original":   `{"records":[{"type":"item","source":"TEST","source_id":"rope","name":"Rope"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(strings.NewReader(input)); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
