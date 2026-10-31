package adnd2eimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/net/html"
	"olea/catalogimport"
)

// ParseCreatures reads only appendix/<slug>/index.html, avoiding duplicate print pages.
func ParseCreatures(root string) (Result, error) {
	appendix := filepath.Join(root, "appendix")
	dirs, err := os.ReadDir(appendix)
	if err != nil {
		return Result{}, fmt.Errorf("read appendix: %w", err)
	}
	result := Result{}
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		path := filepath.Join(appendix, dir.Name(), "index.html")
		file, err := os.Open(path)
		if err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: index page unavailable", dir.Name()))
			continue
		}
		record, warnings, err := ParseCreature(file, dir.Name())
		file.Close()
		for _, warning := range warnings {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %s", dir.Name(), warning))
		}
		if err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", dir.Name(), err))
			continue
		}
		result.Document.Records = append(result.Document.Records, record)
	}
	sort.Slice(result.Document.Records, func(i, j int) bool { return result.Document.Records[i].SourceID < result.Document.Records[j].SourceID })
	return result, nil
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
func text(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			b.WriteString(node.Data)
		}
		if node.Type == html.ElementNode && node.Data == "br" {
			b.WriteString("\n")
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.TrimSpace(b.String())
}
func nodes(n *html.Node, pred func(*html.Node) bool) []*html.Node {
	var found []*html.Node
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if pred(node) {
			found = append(found, node)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(n)
	return found
}
func ParseCreature(input io.Reader, id string) (catalogimport.InputRecord, []string, error) {
	doc, err := html.Parse(input)
	if err != nil {
		return catalogimport.InputRecord{}, nil, err
	}
	content := nodes(doc, func(n *html.Node) bool {
		return n.Type == html.ElementNode && n.Data == "span" && strings.Contains(" "+attr(n, "class")+" ", " interweave ")
	})
	if len(content) != 1 {
		return catalogimport.InputRecord{}, nil, fmt.Errorf("missing or ambiguous creature content")
	}
	heads := nodes(doc, func(n *html.Node) bool {
		return n.Type == html.ElementNode && n.Data == "div" && strings.Contains(attr(n, "class"), "monsterpage-module--top-header--")
	})
	if len(heads) != 1 {
		return catalogimport.InputRecord{}, nil, fmt.Errorf("missing creature header")
	}
	names := nodes(heads[0], func(n *html.Node) bool { return n.Type == html.ElementNode && n.Data == "h1" })
	if len(names) != 1 || text(names[0]) == "" {
		return catalogimport.InputRecord{}, nil, fmt.Errorf("missing creature name")
	}
	var raw bytes.Buffer
	if err := html.Render(&raw, content[0]); err != nil {
		return catalogimport.InputRecord{}, nil, err
	}
	stats := map[string]string{}
	tables := nodes(content[0], func(n *html.Node) bool { return n.Type == html.ElementNode && n.Data == "table" })
	if len(tables) > 0 {
		for _, row := range nodes(tables[0], func(n *html.Node) bool { return n.Type == html.ElementNode && n.Data == "tr" }) {
			var heads, cells []*html.Node
			for child := row.FirstChild; child != nil; child = child.NextSibling {
				if child.Data == "th" {
					heads = append(heads, child)
				}
				if child.Data == "td" {
					cells = append(cells, child)
				}
			}
			if len(heads) == 1 && len(cells) == 1 {
				stats[strings.TrimSuffix(text(heads[0]), ":")] = text(cells[0])
			}
		}
	}
	warnings := []string{}
	if len(stats) == 0 {
		warnings = append(warnings, "no simple stat table; original content retained")
	}
	if stats["Hit Dice"] == "" {
		warnings = append(warnings, "missing or complex hit dice; manual HP only")
	}
	var sources []string
	for _, section := range nodes(doc, func(n *html.Node) bool {
		return n.Type == html.ElementNode && n.Data == "div" && strings.Contains(attr(n, "class"), "monsterpage-module--tsr--")
	}) {
		for _, a := range nodes(section, func(n *html.Node) bool { return n.Type == html.ElementNode && n.Data == "a" }) {
			if source := text(a); source != "" {
				sources = append(sources, source)
			}
		}
	}
	book := ""
	if len(sources) > 0 {
		book = sources[0]
	}
	if len(book) > 1000 {
		book = book[:1000]
	}
	original, err := json.Marshal(map[string]any{"format": "adnd2e-html", "html": raw.String(), "stats": stats, "sources": sources})
	if err != nil {
		return catalogimport.InputRecord{}, nil, err
	}
	return catalogimport.InputRecord{Type: "creature", Source: "ADND-COMPENDIUM", SourceID: id, Name: text(names[0]), BookSource: book, Original: original}, warnings, nil
}
