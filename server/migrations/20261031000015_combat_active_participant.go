package migrations

import (
	"encoding/json"
	"sort"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Capture the legacy sorted turn before manual-order systems change policy.
func init() {
	m.Register(migrateActiveParticipants, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("combats")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("active_participant")
		return app.Save(collection)
	})
}

func migrateActiveParticipants(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("combats")
	if err != nil {
		return err
	}
	collection.Fields.Add(&core.TextField{Name: "active_participant", Max: 15})
	if err := app.Save(collection); err != nil {
		return err
	}
	combats, err := app.FindRecordsByFilter("combats", "active = true", "", 0, 0)
	if err != nil {
		return err
	}
	for _, combat := range combats {
		participants, err := app.FindRecordsByFilter("combatants", "combat = {:id}", "", 0, 0, map[string]any{"id": combat.Id})
		if err != nil {
			return err
		}
		var ids []string
		_ = json.Unmarshal([]byte(combat.GetString("tie_order")), &ids)
		positions := map[string]int{}
		for i, id := range ids {
			if _, ok := positions[id]; !ok {
				positions[id] = i
			}
		}
		sort.SliceStable(participants, func(i, j int) bool {
			a, b := participants[i], participants[j]
			if a.GetBool("initiative_known") != b.GetBool("initiative_known") {
				return a.GetBool("initiative_known")
			}
			if a.GetBool("initiative_known") && a.GetFloat("initiative") != b.GetFloat("initiative") {
				return a.GetFloat("initiative") > b.GetFloat("initiative")
			}
			ai, aok := positions[a.Id]
			bi, bok := positions[b.Id]
			if aok != bok {
				return aok
			}
			if aok && ai != bi {
				return ai < bi
			}
			if a.GetInt("sort_order") != b.GetInt("sort_order") {
				return a.GetInt("sort_order") < b.GetInt("sort_order")
			}
			if a.GetString("name") != b.GetString("name") {
				return a.GetString("name") < b.GetString("name")
			}
			return a.Id < b.Id
		})
		turn := combat.GetInt("turn")
		if turn >= 0 && turn < len(participants) {
			combat.Set("active_participant", participants[turn].Id)
			if err := app.Save(combat); err != nil {
				return err
			}
		}
	}
	return nil
}
