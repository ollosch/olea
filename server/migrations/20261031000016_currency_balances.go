package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

var legacyDenominations = []string{"cp", "sp", "ep", "gp", "pp"}

func init() { m.Register(migrateCurrencyBalances, nil) }

// Retain the old columns as a read-only historical backup; balances is authoritative.
func migrateCurrencyBalances(app core.App) error {
	for _, name := range []string{"inventories", "stashes"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.JSONField{Name: "balances"})
		if err := app.Save(collection); err != nil {
			return err
		}
		records, err := app.FindRecordsByFilter(name, "", "", 0, 0)
		if err != nil {
			return err
		}
		for _, record := range records {
			balances := map[string]int{}
			for _, key := range legacyDenominations {
				balances[key] = record.GetInt(key)
			}
			record.Set("balances", balances)
			if err := app.Save(record); err != nil {
				return err
			}
		}
	}
	return nil
}
