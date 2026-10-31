package catalogimport

import (
	"strings"
	"testing"
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
