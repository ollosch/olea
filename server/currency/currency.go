package currency

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/pocketbase/pocketbase/core"
)

const MaxBalance = 9007199254740991 // Largest integer exactly representable by browser JSON.

// Currency keys are stable per system. Unknown systems have no automated denominations.
var denominations = map[string][]string{"dnd5e": {"cp", "sp", "ep", "gp", "pp"}, "adnd2e": {}}

func Supported(app core.App, gameID, denomination string) bool {
	game, err := app.FindRecordById("games", gameID)
	if err != nil {
		return false
	}
	system, err := app.FindRecordById("systems", game.GetString("system"))
	if err != nil {
		return false
	}
	for _, key := range denominations[system.GetString("key")] {
		if key == denomination {
			return true
		}
	}
	return false
}

// SetDenominationsForTest installs an invented built-in system for isolated tests.
// It must only be used before tests start concurrent requests.
func SetDenominationsForTest(key string, keys []string) func() {
	previous, exists := denominations[key]
	denominations[key] = append([]string(nil), keys...)
	return func() {
		if exists {
			denominations[key] = previous
		} else {
			delete(denominations, key)
		}
	}
}

func Decode(value any) (map[string]int64, error) {
	if value == nil {
		return map[string]int64{}, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if string(data) == "null" {
		return map[string]int64{}, nil
	}
	var result map[string]int64
	if err := json.Unmarshal(data, &result); err != nil || result == nil {
		return nil, fmt.Errorf("invalid currency balances")
	}
	for key, amount := range result {
		if key == "" || amount < 0 || amount > MaxBalance {
			return nil, fmt.Errorf("invalid currency balance for %q", key)
		}
	}
	return result, nil
}

func Add(left, right int64) (int64, error) {
	if left < 0 || right < 0 || left > math.MaxInt64-right || left+right > MaxBalance {
		return 0, fmt.Errorf("balance exceeds supported range")
	}
	return left + right, nil
}
