package vaultimport

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseFrontmatter splits an optional leading YAML frontmatter block from the markdown body.
func ParseFrontmatter(content []byte) (map[string]any, string, error) {
	normalized := strings.ReplaceAll(string(content), "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return map[string]any{}, normalized, nil
	}

	closing := -1
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) == "---" {
			closing = index
			break
		}
	}
	if closing == -1 {
		return map[string]any{}, normalized, nil
	}

	body := strings.Join(lines[closing+1:], "\n")

	frontmatter := map[string]any{}
	yamlText := strings.Join(lines[1:closing], "\n")
	if strings.TrimSpace(yamlText) != "" {
		if err := yaml.Unmarshal([]byte(yamlText), &frontmatter); err != nil {
			return nil, body, fmt.Errorf("parse frontmatter: %w", err)
		}
		if frontmatter == nil {
			frontmatter = map[string]any{}
		}
	}

	return frontmatter, body, nil
}
