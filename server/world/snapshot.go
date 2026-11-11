package world

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// WorldSnapshot is the bulk hydration payload for the client cache.
type WorldSnapshot struct {
	Campaigns     []map[string]any `json:"campaigns"`
	Entities      []map[string]any `json:"entities"`
	RelationTypes []map[string]any `json:"relation_types"`
	Relations     []map[string]any `json:"relations"`
	Mentions      []map[string]any `json:"mentions"`
	Maps          []map[string]any `json:"maps"`
	MapMarkers    []map[string]any `json:"map_markers"`
	Revision      string           `json:"revision"`
}

// Snapshot loads the complete campaign-manager world in a stable order.
func Snapshot(app core.App) (WorldSnapshot, error) {
	snapshot := WorldSnapshot{
		Campaigns:     make([]map[string]any, 0),
		Entities:      make([]map[string]any, 0),
		RelationTypes: make([]map[string]any, 0),
		Relations:     make([]map[string]any, 0),
		Mentions:      make([]map[string]any, 0),
		Maps:          make([]map[string]any, 0),
		MapMarkers:    make([]map[string]any, 0),
	}

	load := func(collection string) ([]*core.Record, error) {
		return app.FindAllRecords(collection)
	}

	campaigns, err := load("campaigns")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(campaigns, func(i, j int) bool {
		return lessText(campaigns[i].GetString("name"), campaigns[j].GetString("name"))
	})
	for _, record := range campaigns {
		snapshot.Campaigns = append(snapshot.Campaigns, record.PublicExport())
	}

	entities, err := load("entities")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(entities, func(i, j int) bool {
		return lessText(entities[i].GetString("name"), entities[j].GetString("name"))
	})
	for _, record := range entities {
		snapshot.Entities = append(snapshot.Entities, record.PublicExport())
	}

	relationTypes, err := load("relation_types")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(relationTypes, func(i, j int) bool {
		return lessText(relationTypes[i].GetString("key"), relationTypes[j].GetString("key"))
	})
	for _, record := range relationTypes {
		snapshot.RelationTypes = append(snapshot.RelationTypes, record.PublicExport())
	}

	relations, err := load("relations")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(relations, func(i, j int) bool {
		left, right := relations[i], relations[j]
		if left.GetString("from") != right.GetString("from") {
			return lessText(left.GetString("from"), right.GetString("from"))
		}
		if left.GetString("type") != right.GetString("type") {
			return lessText(left.GetString("type"), right.GetString("type"))
		}
		return lessText(left.GetString("to"), right.GetString("to"))
	})
	for _, record := range relations {
		snapshot.Relations = append(snapshot.Relations, record.PublicExport())
	}

	mentions, err := load("mentions")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(mentions, func(i, j int) bool {
		left, right := mentions[i], mentions[j]
		if left.GetString("source") != right.GetString("source") {
			return lessText(left.GetString("source"), right.GetString("source"))
		}
		return lessText(left.GetString("target_name"), right.GetString("target_name"))
	})
	for _, record := range mentions {
		snapshot.Mentions = append(snapshot.Mentions, record.PublicExport())
	}

	maps, err := load("maps")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(maps, func(i, j int) bool {
		return lessText(maps[i].GetString("name"), maps[j].GetString("name"))
	})
	for _, record := range maps {
		snapshot.Maps = append(snapshot.Maps, record.PublicExport())
	}

	mapMarkers, err := load("map_markers")
	if err != nil {
		return snapshot, err
	}
	sort.SliceStable(mapMarkers, func(i, j int) bool {
		left, right := mapMarkers[i], mapMarkers[j]
		if left.GetString("map") != right.GetString("map") {
			return lessText(left.GetString("map"), right.GetString("map"))
		}
		return lessText(left.GetString("label"), right.GetString("label"))
	})
	for _, record := range mapMarkers {
		snapshot.MapMarkers = append(snapshot.MapMarkers, record.PublicExport())
	}

	digest, err := snapshotDigest(snapshot)
	if err != nil {
		return snapshot, err
	}
	snapshot.Revision = digest
	return snapshot, nil
}

func snapshotDigest(snapshot WorldSnapshot) (string, error) {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func lessText(left, right string) bool {
	leftFolded, rightFolded := strings.ToLower(left), strings.ToLower(right)
	if leftFolded == rightFolded {
		return left < right
	}
	return leftFolded < rightFolded
}
