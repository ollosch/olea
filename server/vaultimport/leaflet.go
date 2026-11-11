package vaultimport

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"gopkg.in/yaml.v3"

	"olea/world"
)

var (
	leafletBlockPattern = regexp.MustCompile("(?m)^```leaflet[ \t]*\n([\\s\\S]*?)^```[ \t]*")
	leafletImagePattern = regexp.MustCompile(`(?m)^[ \t]*image[ \t]*:[ \t]*(.+?)[ \t]*$`)
)

type leafletMapResult struct {
	Body     string
	Maps     int
	Copied   int
	Missing  []string
	Warnings []string
}

func extractLeafletMaps(app core.App, file *vaultFile, assets *assetIndex) (leafletMapResult, error) {
	result := leafletMapResult{Body: file.body}
	blocks := leafletBlockPattern.FindAllStringSubmatchIndex(file.body, -1)
	if len(blocks) == 0 {
		return result, nil
	}

	var builder strings.Builder
	last := 0
	mapIndex := 0
	for _, indexes := range blocks {
		start, end := indexes[0], indexes[1]
		contentStart, contentEnd := indexes[2], indexes[3]
		content := file.body[contentStart:contentEnd]
		builder.WriteString(file.body[last:start])

		var config map[string]any
		if err := yaml.Unmarshal([]byte(content), &config); err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: invalid leaflet YAML: %v", file.relPath, err))
			builder.WriteString(file.body[start:end])
			last = end
			continue
		}
		if config == nil {
			config = map[string]any{}
		}

		imagePath := ""
		imageTarget := extractLeafletImageTarget(content)
		delete(config, "image")
		if imageTarget != "" {
			filename, found, copied, err := assets.copyTarget(imageTarget)
			if err != nil {
				return result, err
			}
			if found {
				imagePath = world.AssetsURLPrefix + filename
				if copied {
					result.Copied++
				}
			} else {
				result.Missing = append(result.Missing, fmt.Sprintf("%s: %s", file.relPath, imageTarget))
			}
		}

		mapName := file.name
		if mapIndex > 0 {
			mapName = fmt.Sprintf("%s %d", file.name, mapIndex+1)
		}
		mapIndex++
		campaign := ""
		if len(file.campaignIDs) > 0 {
			campaign = file.campaignIDs[0]
		}
		record, err := upsertMap(app, mapName, campaign, imagePath, config)
		if err != nil {
			return result, err
		}
		result.Maps++
		builder.WriteString(fmt.Sprintf(":::map{mapId=%s}", record.Id))
		last = end
	}
	builder.WriteString(file.body[last:])
	result.Body = builder.String()
	return result, nil
}

func extractLeafletImageTarget(content string) string {
	matches := leafletImagePattern.FindStringSubmatch(content)
	if matches == nil {
		return ""
	}
	value := strings.TrimSpace(matches[1])
	value = strings.Trim(value, `"'`)
	if strings.HasPrefix(value, "[[") && strings.HasSuffix(value, "]]") {
		value = value[2 : len(value)-2]
	}
	if index := strings.Index(value, "|"); index >= 0 {
		value = value[:index]
	}
	if index := strings.IndexAny(value, "#^"); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

func upsertMap(app core.App, name, campaign, image string, config map[string]any) (*core.Record, error) {
	records, err := app.FindRecordsByFilter("maps", "name = {:name}", "", 0, 0, dbx.Params{"name": name})
	if err != nil {
		return nil, err
	}
	var record *core.Record
	for _, candidate := range records {
		if candidate.GetString("campaign") == campaign {
			record = candidate
			break
		}
	}
	if record == nil {
		collection, err := app.FindCachedCollectionByNameOrId("maps")
		if err != nil {
			return nil, err
		}
		record = core.NewRecord(collection)
		record.Id = core.GenerateDefaultRandomId()
	}
	record.Set("name", name)
	record.Set("campaign", campaign)
	record.Set("image", image)
	record.Set("config", config)
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}
