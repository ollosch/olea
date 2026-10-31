package transfers

import (
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	_ "olea/migrations"
)

func testApp(t *testing.T) core.App {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.ResetBootstrapState(); err != nil {
			t.Errorf("reset test app: %v", err)
		}
	})
	return app
}

func makeRecord(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
	t.Helper()
	model, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(model)
	for key, value := range fields {
		record.Set(key, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return record
}

func fixture(t *testing.T, app core.App, quantity int) (*core.Record, *core.Record, *core.Record) {
	t.Helper()
	system, err := app.FindFirstRecordByFilter("systems", "key = 'dnd5e'")
	if err != nil {
		t.Fatal(err)
	}
	game := makeRecord(t, app, "games", map[string]any{"name": "Test game", "system": system.Id})
	character := makeRecord(t, app, "characters", map[string]any{"name": "Test character", "game": game.Id})
	inventory := makeRecord(t, app, "inventories", map[string]any{"game": game.Id, "character": character.Id})
	stash := makeRecord(t, app, "stashes", map[string]any{"game": game.Id, "kind": "party", "name": "Party"})
	item := makeRecord(t, app, "inventory_items", map[string]any{"inventory": inventory.Id, "name": "Rope", "quantity": quantity, "weight": 1, "weight_known": true})
	return item, inventory, stash
}

func TestItemPartialMovePreservesTotal(t *testing.T) {
	app := testApp(t)
	item, inventory, stash := fixture(t, app, 5)
	if err := Item(app, ItemRequest{ItemID: item.Id, Quantity: 2, Destination: Endpoint{Stash: stash.Id}}); err != nil {
		t.Fatal(err)
	}
	remaining, err := app.FindRecordById("inventory_items", item.Id)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := app.FindFirstRecordByFilter("inventory_items", "stash = {:stash}", map[string]any{"stash": stash.Id})
	if err != nil {
		t.Fatal(err)
	}
	if remaining.GetInt("quantity") != 3 || moved.GetInt("quantity") != 2 || remaining.GetString("inventory") != inventory.Id {
		t.Fatalf("unexpected source/destination quantities: %d and %d", remaining.GetInt("quantity"), moved.GetInt("quantity"))
	}
}

func TestConcurrentMovesCannotDuplicateItem(t *testing.T) {
	app := testApp(t)
	item, inventory, stash := fixture(t, app, 1)
	var wait sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			errs <- Item(app, ItemRequest{ItemID: item.Id, Quantity: 1, Destination: Endpoint{Stash: stash.Id}})
		}()
	}
	wait.Wait()
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("expected exactly one successful transfer, got %d", successes)
	}
	items, err := app.FindRecordsByFilter("inventory_items", "inventory = {:inventory} || stash = {:stash}", "", 0, 0, map[string]any{"inventory": inventory.Id, "stash": stash.Id})
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, entry := range items {
		total += entry.GetInt("quantity")
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("transfer duplicated or lost the item: %d total over %d stacks", total, len(items))
	}
}

func TestCoinTransferRejectsInsufficientBalanceWithoutMutation(t *testing.T) {
	app := testApp(t)
	_, inventory, stash := fixture(t, app, 1)
	inventory.Set("gp", 2)
	if err := app.Save(inventory); err != nil {
		t.Fatal(err)
	}
	err := Coins(app, CoinRequest{Source: Endpoint{Inventory: inventory.Id}, Destination: Endpoint{Stash: stash.Id}, Denomination: "gp", Amount: 3})
	if err == nil {
		t.Fatal("expected insufficient balance error")
	}
	updated, err := app.FindRecordById("inventories", inventory.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.GetInt("gp") != 2 {
		t.Fatalf("failed transfer changed source balance: %d", updated.GetInt("gp"))
	}
}

func TestTransfersRejectCrossGameDestination(t *testing.T) {
	app := testApp(t)
	item, _, _ := fixture(t, app, 4)
	system, err := app.FindFirstRecordByFilter("systems", "key = 'dnd5e'")
	if err != nil {
		t.Fatal(err)
	}
	otherGame := makeRecord(t, app, "games", map[string]any{"name": "Other game", "system": system.Id})
	otherStash := makeRecord(t, app, "stashes", map[string]any{"game": otherGame.Id, "kind": "party", "name": "Other party"})
	if err := Item(app, ItemRequest{ItemID: item.Id, Quantity: 2, Destination: Endpoint{Stash: otherStash.Id}}); err == nil {
		t.Fatal("expected cross-game item transfer to fail")
	}
	unchanged, err := app.FindRecordById("inventory_items", item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.GetInt("quantity") != 4 {
		t.Fatalf("failed transfer changed item quantity: %d", unchanged.GetInt("quantity"))
	}
}

func TestCoinTransferMovesBalanceAtomically(t *testing.T) {
	app := testApp(t)
	_, inventory, stash := fixture(t, app, 1)
	inventory.Set("sp", 12)
	if err := app.Save(inventory); err != nil {
		t.Fatal(err)
	}
	if err := Coins(app, CoinRequest{Source: Endpoint{Inventory: inventory.Id}, Destination: Endpoint{Stash: stash.Id}, Denomination: "sp", Amount: 7}); err != nil {
		t.Fatal(err)
	}
	updatedInventory, err := app.FindRecordById("inventories", inventory.Id)
	if err != nil {
		t.Fatal(err)
	}
	updatedStash, err := app.FindRecordById("stashes", stash.Id)
	if err != nil {
		t.Fatal(err)
	}
	if updatedInventory.GetInt("sp") != 5 || updatedStash.GetInt("sp") != 7 {
		t.Fatalf("unexpected coin balances: source %d, destination %d", updatedInventory.GetInt("sp"), updatedStash.GetInt("sp"))
	}
}
