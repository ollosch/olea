package world

import (
	"strings"
	"testing"
)

func TestPlainText(t *testing.T) {
	input := "# Heading\n\n" +
		"- item **bold** and *italic*\n" +
		"> quote\n\n" +
		"See [[Target|Label]] and [[Other]].\n\n" +
		"![Alt text](img.png) [link](https://example.com)\n\n" +
		"| a | b |\n|---|---|\n| c | d |\n\n" +
		"```go\nfunc main() {}\n```\n" +
		"<span>html</span>![[Ignored.png]]\n"
	text := PlainText(input)
	for _, expected := range []string{"Heading", "item bold and italic", "quote", "Label", "Other", "Alt text", "link", "https://example.com", "a b", "c d", "func main", "html"} {
		if !strings.Contains(text, expected) {
			t.Errorf("PlainText() = %q, missing %q", text, expected)
		}
	}
	for _, unexpected := range []string{"#", "**", "[[", "```", "<span>", "|", "Ignored.png"} {
		if strings.Contains(text, unexpected) {
			t.Errorf("PlainText() = %q, still contains %q", text, unexpected)
		}
	}
}
