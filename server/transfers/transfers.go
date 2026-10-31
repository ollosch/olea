package transfers

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var ErrInvalid = errors.New("invalid transfer")

type Endpoint struct {
	Inventory string `json:"inventory"`
	Stash     string `json:"stash"`
}

type ItemRequest struct {
	ItemID      string   `json:"itemId"`
	Quantity    int      `json:"quantity"`
	Destination Endpoint `json:"destination"`
	ContainerID string   `json:"containerId"`
}

type CoinRequest struct {
	Denomination string   `json:"denomination"`
	Amount       int      `json:"amount"`
	Source       Endpoint `json:"source"`
	Destination  Endpoint `json:"destination"`
}

type resolvedStore struct {
	record      *core.Record
	game        string
	containerID string
	itemIDs     map[string]bool
}

func Item(app core.App, request ItemRequest) error {
	if request.ItemID == "" || request.Quantity <= 0 {
		return fmt.Errorf("%w: item and a positive quantity are required", ErrInvalid)
	}
	return app.RunInTransaction(func(tx core.App) error {
		item, err := tx.FindRecordById("inventory_items", request.ItemID)
		if err != nil {
			return fmt.Errorf("find item: %w", err)
		}
		source, err := itemStore(tx, item)
		if err != nil {
			return err
		}
		destination, err := resolveStore(tx, request.Destination)
		if err != nil {
			return err
		}
		if source.game != destination.game {
			return fmt.Errorf("%w: source and destination must belong to the same game", ErrInvalid)
		}
		if request.Quantity > item.GetInt("quantity") {
			return fmt.Errorf("%w: requested quantity exceeds the available stack", ErrInvalid)
		}
		if item.GetBool("is_container") && request.Quantity != 1 {
			return fmt.Errorf("%w: containers cannot be split", ErrInvalid)
		}
		if request.ContainerID != "" {
			_, ok := destination.itemIDs[request.ContainerID]
			if !ok || !containerRecord(tx, request.ContainerID) {
				return fmt.Errorf("%w: destination container must be in the destination store", ErrInvalid)
			}
			if request.ContainerID == item.Id || isDescendant(tx, request.ContainerID, item.Id) {
				return fmt.Errorf("%w: containers cannot be moved into themselves or their descendants", ErrInvalid)
			}
		}

		if source.record.Id == destination.record.Id && request.ContainerID == item.GetString("container") {
			return fmt.Errorf("%w: source and destination are identical", ErrInvalid)
		}
		remaining := item.GetInt("quantity") - request.Quantity
		if item.GetBool("is_container") && remaining != 0 {
			return fmt.Errorf("%w: containers cannot be split", ErrInvalid)
		}
		if request.Quantity == item.GetInt("quantity") {
			item.Set("inventory", destinationEndpoint(request.Destination, "inventory"))
			item.Set("stash", destinationEndpoint(request.Destination, "stash"))
			item.Set("container", request.ContainerID)
			if err := tx.Save(item); err != nil {
				return err
			}
			if item.GetBool("is_container") {
				return moveContents(tx, item.Id, request.Destination)
			}
			return nil
		}
		item.Set("quantity", remaining)
		if err := tx.Save(item); err != nil {
			return err
		}
		copy := core.NewRecord(item.Collection())
		copy.Set("inventory", destinationEndpoint(request.Destination, "inventory"))
		copy.Set("stash", destinationEndpoint(request.Destination, "stash"))
		copy.Set("catalog_item", item.GetString("catalog_item"))
		copy.Set("name", item.GetString("name"))
		copy.Set("quantity", request.Quantity)
		copy.Set("weight", item.GetFloat("weight"))
		copy.Set("weight_known", item.GetBool("weight_known"))
		copy.Set("notes", item.GetString("notes"))
		copy.Set("is_container", false)
		copy.Set("container", request.ContainerID)
		return tx.Save(copy)
	})
}

func Coins(app core.App, request CoinRequest) error {
	if !validDenomination(request.Denomination) || request.Amount <= 0 {
		return fmt.Errorf("%w: use CP, SP, EP, GP, or PP and a positive whole amount", ErrInvalid)
	}
	request.Denomination = strings.ToLower(request.Denomination)
	return app.RunInTransaction(func(tx core.App) error {
		source, err := resolveStore(tx, request.Source)
		if err != nil {
			return err
		}
		destination, err := resolveStore(tx, request.Destination)
		if err != nil {
			return err
		}
		if source.game != destination.game {
			return fmt.Errorf("%w: source and destination must belong to the same game", ErrInvalid)
		}
		if source.record.Id == destination.record.Id {
			return fmt.Errorf("%w: source and destination are identical", ErrInvalid)
		}
		field := request.Denomination
		if source.record.GetInt(field) < request.Amount {
			return fmt.Errorf("%w: insufficient %s balance", ErrInvalid, field)
		}
		newBalance, err := safeAdd(destination.record.GetInt(field), request.Amount)
		if err != nil {
			return fmt.Errorf("%w: destination balance would overflow", ErrInvalid)
		}
		source.record.Set(field, source.record.GetInt(field)-request.Amount)
		destination.record.Set(field, newBalance)
		if err := tx.Save(source.record); err != nil {
			return err
		}
		return tx.Save(destination.record)
	})
}

func moveContents(app core.App, containerID string, destination Endpoint) error {
	items, err := app.FindRecordsByFilter("inventory_items", "container = {:id}", "", 0, 0, dbx.Params{"id": containerID})
	if err != nil {
		return err
	}
	for _, child := range items {
		child.Set("inventory", destinationEndpoint(destination, "inventory"))
		child.Set("stash", destinationEndpoint(destination, "stash"))
		if err := app.Save(child); err != nil {
			return err
		}
		if child.GetBool("is_container") {
			if err := moveContents(app, child.Id, destination); err != nil {
				return err
			}
		}
	}
	return nil
}

func resolveStore(app core.App, endpoint Endpoint) (*resolvedStore, error) {
	if (endpoint.Inventory == "") == (endpoint.Stash == "") {
		return nil, fmt.Errorf("%w: specify exactly one inventory or stash", ErrInvalid)
	}
	collection := "inventories"
	id := endpoint.Inventory
	if endpoint.Stash != "" {
		collection, id = "stashes", endpoint.Stash
	}
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		return nil, fmt.Errorf("%w: store not found", ErrInvalid)
	}
	store := &resolvedStore{record: record}
	store.game = record.GetString("game")
	items, err := app.FindRecordsByFilter("inventory_items", "inventory = {:id} || stash = {:id}", "", 0, 0, dbx.Params{"id": record.Id})
	if err != nil {
		return nil, err
	}
	store.itemIDs = make(map[string]bool, len(items))
	for _, item := range items {
		store.itemIDs[item.Id] = true
	}
	return store, nil
}

func itemStore(app core.App, item *core.Record) (*resolvedStore, error) {
	if item.GetString("inventory") != "" {
		return resolveStore(app, Endpoint{Inventory: item.GetString("inventory")})
	}
	if item.GetString("stash") != "" {
		return resolveStore(app, Endpoint{Stash: item.GetString("stash")})
	}
	return nil, fmt.Errorf("%w: item has no source store", ErrInvalid)
}

func destinationEndpoint(endpoint Endpoint, field string) string {
	if field == "inventory" {
		return endpoint.Inventory
	}
	return endpoint.Stash
}

func containerRecord(app core.App, id string) bool {
	item, err := app.FindRecordById("inventory_items", id)
	return err == nil && item.GetBool("is_container")
}

func isDescendant(app core.App, candidate, ancestor string) bool {
	current := candidate
	visited := map[string]bool{}
	for current != "" && !visited[current] {
		visited[current] = true
		item, err := app.FindRecordById("inventory_items", current)
		if err != nil {
			return false
		}
		current = item.GetString("container")
		if current == ancestor {
			return true
		}
	}
	return false
}

func validDenomination(value string) bool {
	value = strings.ToLower(value)
	switch value {
	case "cp", "sp", "ep", "gp", "pp":
		return true
	default:
		return false
	}
}

func safeAdd(left, right int) (int, error) {
	if left < 0 || right < 0 || left > math.MaxInt-right {
		return 0, ErrInvalid
	}
	return left + right, nil
}
