package vaultimport

import (
	"strings"
	"testing"
)

func TestParseFrontmatter(t *testing.T) {
	content := []byte("---\r\ntype: actor\r\ncampaigns:\r\n  - Almost Titans\r\n---\r\n\r\n# Body\r\n")
	frontmatter, body, err := ParseFrontmatter(content)
	if err != nil {
		t.Fatal(err)
	}
	if frontmatter["type"] != "actor" {
		t.Fatalf("type = %#v", frontmatter["type"])
	}
	if body != "\n# Body\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestParseFrontmatterWithoutBlock(t *testing.T) {
	frontmatter, body, err := ParseFrontmatter([]byte("# Just markdown\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(frontmatter) != 0 {
		t.Fatalf("frontmatter = %#v", frontmatter)
	}
	if !strings.Contains(body, "Just markdown") {
		t.Fatalf("body = %q", body)
	}
}

func TestParseFrontmatterMalformedYAML(t *testing.T) {
	if _, _, err := ParseFrontmatter([]byte("---\nkey: [\n---\nbody\n")); err == nil {
		t.Fatal("expected malformed YAML error")
	}
}
