package recordupdate

import (
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

var ErrConflict = errors.New("record changed elsewhere; refreshed values are available")

var allowedFields = map[string]map[string]bool{
	"combatants":      {"initiative": true, "initiative_known": true, "initiative_modifier": true, "initiative_modifier_override": true, "current_hp": true, "max_hp": true, "hp_known": true, "conditions": true, "notes": true, "dexterity_modifier": true, "dexterity_known": true},
	"combats":         {"active": true, "round": true, "turn": true, "active_participant": true, "tie_order": true, "visible": true, "show_initiative": true, "show_enemy_names": true, "show_hp": true, "show_conditions": true},
	"inventories":     {"cp": true, "sp": true, "ep": true, "gp": true, "pp": true, "capacity": true, "capacity_known": true},
	"inventory_items": {"quantity": true, "notes": true, "weight": true, "weight_known": true, "is_container": true, "container": true},
	"stashes":         {"cp": true, "sp": true, "ep": true, "gp": true, "pp": true, "name": true, "location": true, "notes": true},
	"games":           {"encounter_visible": true, "encounter_show_initiative": true, "encounter_show_enemy_names": true, "encounter_show_hp": true, "encounter_show_conditions": true},
}

var comparableFields = map[string]map[string]bool{
	"combatants":      allowedFields["combatants"],
	"combats":         allowedFields["combats"],
	"inventories":     {"cp": true, "sp": true, "ep": true, "gp": true, "pp": true, "capacity": true, "capacity_known": true},
	"inventory_items": {"quantity": true, "notes": true, "weight": true, "weight_known": true, "is_container": true, "container": true, "inventory": true, "stash": true},
	"stashes":         {"cp": true, "sp": true, "ep": true, "gp": true, "pp": true, "name": true, "location": true, "notes": true},
	"games":           allowedFields["games"],
}

func Update(app core.App, collection, id string, expectedFields, fields map[string]any) error {
	allowed, ok := allowedFields[collection]
	comparable := comparableFields[collection]
	if !ok || id == "" || len(expectedFields) == 0 || len(fields) == 0 {
		return fmt.Errorf("invalid guarded update request")
	}
	for key := range fields {
		if !allowed[key] {
			return fmt.Errorf("field %q cannot be updated through this route", key)
		}
		if _, exists := expectedFields[key]; !exists {
			return fmt.Errorf("missing expected value for field %q", key)
		}
	}
	for key := range expectedFields {
		if !comparable[key] {
			return fmt.Errorf("field %q cannot be compared through this route", key)
		}
	}
	return app.RunInTransaction(func(tx core.App) error {
		record, err := tx.FindRecordById(collection, id)
		if err != nil {
			return err
		}
		for key := range expectedFields {
			if fmt.Sprint(record.Get(key)) != fmt.Sprint(expectedFields[key]) {
				return ErrConflict
			}
		}
		for key, value := range fields {
			record.Set(key, value)
		}
		return tx.Save(record)
	})
}
