package adnd2eimport

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"olea/catalogimport"
)

type Result struct {
	Document catalogimport.Document
	Skipped  int
	Warnings []string
}
type spellPage struct {
	PageID   int    `json:"pageid"`
	Title    string `json:"title"`
	WikiText string `json:"wikitext"`
}

func ParseSpells(indexReader, pageReader io.Reader) (Result, error) {
	var index, pages []spellPage
	if err := json.NewDecoder(indexReader).Decode(&index); err != nil {
		return Result{}, fmt.Errorf("decode spell index: %w", err)
	}
	if err := json.NewDecoder(pageReader).Decode(&pages); err != nil {
		return Result{}, fmt.Errorf("decode spell pages: %w", err)
	}
	if len(index) == 0 {
		return Result{}, fmt.Errorf("spell index is empty")
	}
	result := Result{}
	byID := map[int]spellPage{}
	for _, page := range pages {
		if page.PageID <= 0 {
			result.Skipped++
			result.Warnings = append(result.Warnings, "spell page missing pageid")
			continue
		}
		if previous, exists := byID[page.PageID]; exists {
			result.Skipped++
			if previous.Title != page.Title || previous.WikiText != page.WikiText {
				result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: conflicting duplicate page; first retained", page.PageID))
			}
			continue
		}
		byID[page.PageID] = page
	}
	seen := map[int]bool{}
	for _, entry := range index {
		if entry.PageID <= 0 || strings.TrimSpace(entry.Title) == "" {
			result.Skipped++
			result.Warnings = append(result.Warnings, "index entry missing pageid or title")
			continue
		}
		if seen[entry.PageID] {
			result.Skipped++
			continue
		}
		seen[entry.PageID] = true
		page, ok := byID[entry.PageID]
		if !ok || strings.TrimSpace(page.WikiText) == "" {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: indexed spell page missing or empty", entry.PageID))
			continue
		}
		if page.Title != entry.Title {
			result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: index and page titles differ", entry.PageID))
		}
		fields, body, ok := spellInfobox(page.WikiText)
		if !ok {
			result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: missing or malformed spell infobox; raw page retained", entry.PageID))
			body = page.WikiText
		}
		unsupported := map[string]bool{}
		for _, match := range wikiTemplate.FindAllStringSubmatch(body, -1) {
			kind := strings.ToLower(strings.TrimSpace(strings.Split(match[1], "|")[0]))
			if kind != "br" && kind != "frac" { unsupported[kind] = true }
		}
		if len(unsupported) > 0 {
			kinds := make([]string, 0, len(unsupported)); for kind := range unsupported { kinds = append(kinds, kind) }; sort.Strings(kinds)
			result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: unsupported wiki templates retained as text: %s", entry.PageID, strings.Join(kinds, ", ")))
		}
		name := cleanWiki(fields["name"])
		if name == "" {
			name = regexp.MustCompile(`\s*\([^()]*Spell\)$`).ReplaceAllString(entry.Title, "")
		}
		if p := strings.Index(name, "\n"); p >= 0 {
			name = name[:p]
		}
		book := cleanWiki(fields["source"])
		if link := wikiLink.FindStringSubmatch(fields["source"]); len(link) > 1 {
			parts := strings.Split(link[1], "|")
			book = parts[len(parts)-1]
		}
		if p := strings.Index(book, "\n"); p >= 0 {
			book = book[:p]
		}
		if len(book) > 1000 {
			book = book[:1000]
		}
		original, err := json.Marshal(map[string]any{"format": "adnd2e-wikitext", "pageid": page.PageID, "title": page.Title, "wikitext": page.WikiText, "fields": fields, "body": body})
		if err != nil {
			return result, err
		}
		result.Document.Records = append(result.Document.Records, catalogimport.InputRecord{Type: "spell", Source: "ADND-WIKI", SourceID: strconv.Itoa(page.PageID), Name: name, Level: cleanWiki(fields["level"]), School: cleanWiki(fields["school"]), Sphere: cleanWiki(fields["sphere"]), BookSource: book, Original: original})
	}
	ids := make([]int, 0)
	for id := range byID {
		if !seen[id] {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	for _, id := range ids {
		result.Skipped++
		result.Warnings = append(result.Warnings, fmt.Sprintf("page %d: not present in index", id))
	}
	return result, nil
}

// Infobox values may themselves contain nested wiki templates and piped links.
func spellInfobox(wiki string) (map[string]string, string, bool) {
	start := strings.Index(strings.ToLower(wiki), "{{infobox spells")
	if start < 0 {
		return nil, "", false
	}
	depth, end := 0, -1
	for i := start; i+1 < len(wiki); i++ {
		switch wiki[i : i+2] {
		case "{{":
			depth++
			i++
		case "}}":
			depth--
			i++
			if depth == 0 {
				end = i + 1
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		return nil, "", false
	}
	fields := map[string]string{}
	for _, line := range strings.Split(wiki[start:end], "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			continue
		}
		parts := strings.SplitN(strings.TrimPrefix(line, "|"), "=", 2)
		if len(parts) != 2 {
			continue
		}
		fields[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
	}
	return fields, wiki[end:], true
}

var wikiLink = regexp.MustCompile(`\[\[([^\[\]]+)\]\]`)
var wikiTemplate = regexp.MustCompile(`\{\{([^{}]+)\}\}`)
var htmlTags = regexp.MustCompile(`<[^>]*>`)

func cleanWiki(s string) string {
	s = strings.ReplaceAll(s, "{{br}}", "\n")
	s = strings.ReplaceAll(s, "<br>", "\n")
	s = strings.ReplaceAll(s, "<br/>", "\n")
	s = wikiLink.ReplaceAllStringFunc(s, func(v string) string { parts := strings.Split(v[2:len(v)-2], "|"); return parts[len(parts)-1] })
	s = wikiTemplate.ReplaceAllStringFunc(s, func(v string) string {
		parts := strings.Split(v[2:len(v)-2], "|")
		if len(parts) > 1 {
			return strings.Join(parts[1:], "/")
		}
		return parts[0]
	})
	s = htmlTags.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "''", "")
	return strings.TrimSpace(html.UnescapeString(s))
}
