package recordupdate

import (
	"errors"
	"fmt"
	"reflect"

	"olea/currency"

	"github.com/pocketbase/pocketbase/core"
)

var ErrConflict = errors.New("record changed elsewhere; refreshed values are available")

var allowedFields = map[string]map[string]bool{
	"combatants":      {"initiative": true, "initiative_known": true, "initiative_modifier": true, "initiative_modifier_override": true, "current_hp": true, "max_hp": true, "hp_known": true, "conditions": true, "notes": true, "dexterity_modifier": true, "dexterity_known": true},
	"combats":         {"active": true, "round": true, "turn": true, "active_participant": true, "tie_order": true, "visible": true, "show_initiative": true, "show_enemy_names": true, "show_hp": true, "show_conditions": true},
	"inventories":     {"balances": true, "capacity": true, "capacity_known": true},
	"inventory_items": {"quantity": true, "notes": true, "weight": true, "weight_known": true, "is_container": true, "container": true},
	"stashes":         {"balances": true, "name": true, "location": true, "notes": true},
	"games":           {"encounter_visible": true, "encounter_show_initiative": true, "encounter_show_enemy_names": true, "encounter_show_hp": true, "encounter_show_conditions": true},
}

var comparableFields = map[string]map[string]bool{
	"combatants":      allowedFields["combatants"],
	"combats":         allowedFields["combats"],
	"inventories":     {"balances": true, "capacity": true, "capacity_known": true},
	"inventory_items": {"quantity": true, "notes": true, "weight": true, "weight_known": true, "is_container": true, "container": true, "inventory": true, "stash": true},
	"stashes":         {"balances": true, "name": true, "location": true, "notes": true},
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
			if key == "balances" {
				actual, err := currency.Decode(record.Get(key))
				if err != nil {
					return err
				}
				expected, err := currency.Decode(expectedFields[key])
				if err != nil {
					return err
				}
				if !reflect.DeepEqual(actual, expected) {
					return ErrConflict
				}
				continue
			}
			if fmt.Sprint(record.Get(key)) != fmt.Sprint(expectedFields[key]) {
				return ErrConflict
			}
		}
		for key, value := range fields {
			if key == "balances" {
				previous, err := currency.Decode(record.Get(key))
				if err != nil {
					return err
				}
				next, err := currency.Decode(value)
				if err != nil {
					return err
				}
				for denomination, old := range previous {
					amount, exists := next[denomination]
					if !exists {
						return fmt.Errorf("currency denomination %q cannot be discarded", denomination)
					}
					if amount != old && !currency.Supported(tx, record.GetString("game"), denomination) {
						return fmt.Errorf("unsupported denomination %q", denomination)
					}
				}
				for denomination := range next {
					if _, exists := previous[denomination]; !exists && !currency.Supported(tx, record.GetString("game"), denomination) {
						return fmt.Errorf("unsupported denomination %q", denomination)
					}
				}
				value = next
			}
			record.Set(key, value)
		}
		return tx.Save(record)
	})
}
