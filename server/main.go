package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/spf13/cobra"

	"olea/catalogimport"
	"olea/dnd5eimport"
	_ "olea/migrations"
	"olea/randomtables"
	"olea/recordupdate"
	"olea/transfers"
)

// The placeholder keeps Go builds valid before the frontend is built.
//
//go:embed all:ui
var frontend embed.FS

func main() {
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "serve", "--http=0.0.0.0:8090")
	}

	app := pocketbase.New()
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{})
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "table-template-import <system-key> <json-file>",
		Short: "Import local system random table templates",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAppMigrations(); err != nil {
				return err
			}
			file, err := os.Open(args[1])
			if err != nil {
				return err
			}
			defer file.Close()
			doc, err := randomtables.Parse(file)
			if err != nil {
				return err
			}
			count, err := randomtables.Import(app, args[0], doc)
			if err != nil {
				return err
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]int{"imported": count})
		},
	})
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "catalog-import <system-key> <json-file>",
		Short: "Import a local catalog JSON document",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAppMigrations(); err != nil {
				return err
			}
			path, err := filepath.Abs(args[1])
			if err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()
			document, err := catalogimport.Parse(file)
			if err != nil {
				return err
			}
			summary, err := catalogimport.Import(app, args[0], document)
			if err != nil {
				return err
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(summary)
		},
	})
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "dnd5e-import <spells|bestiary|items> <json-file>",
		Short: "Import a local D&D 5e source file",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAppMigrations(); err != nil {
				return err
			}
			path, err := filepath.Abs(args[1])
			if err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()
			var parsed dnd5eimport.Result
			switch args[0] {
			case "spells":
				parsed, err = dnd5eimport.ParseSpells(file)
			case "bestiary":
				parsed, err = dnd5eimport.ParseBestiary(file)
			case "items":
				parsed, err = dnd5eimport.ParseItems(file)
			default:
				return fmt.Errorf("unsupported D&D 5e import kind %q", args[0])
			}
			if err != nil {
				return err
			}
			imported, err := catalogimport.Import(app, "dnd5e", parsed.Document)
			if err != nil {
				return err
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(struct {
				Created  int      `json:"created"`
				Updated  int      `json:"updated"`
				Skipped  int      `json:"skipped"`
				Warnings []string `json:"warnings"`
			}{imported.Created, imported.Updated, parsed.Skipped, parsed.Warnings})
		},
	})
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/olea/tables/add-creature", func(re *core.RequestEvent) error {
			var request struct {
				Game      string `json:"game"`
				Encounter string `json:"encounter"`
				Creature  string `json:"creature"`
			}
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid creature request.", err)
			}
			if err := randomtables.AddCreature(re.App, request.Game, request.Encounter, request.Creature); err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.NoContent(204)
		})
		e.Router.POST("/api/olea/tables/save", func(re *core.RequestEvent) error {
			var request struct {
				Game  string             `json:"game"`
				ID    string             `json:"id"`
				Table randomtables.Table `json:"table"`
			}
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid table request.", err)
			}
			id, err := randomtables.Save(re.App, request.Game, request.ID, request.Table)
			if err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.JSON(200, map[string]string{"id": id})
		})
		e.Router.POST("/api/olea/tables/copy", func(re *core.RequestEvent) error {
			var request struct {
				Game     string `json:"game"`
				Template string `json:"template"`
			}
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid copy request.", err)
			}
			id, err := randomtables.Copy(re.App, request.Game, request.Template)
			if err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.JSON(200, map[string]string{"id": id})
		})
		e.Router.POST("/api/olea/tables/delete", func(re *core.RequestEvent) error {
			var request struct {
				Game string `json:"game"`
				ID   string `json:"id"`
			}
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid delete request.", err)
			}
			record, err := re.App.FindRecordById("random_tables", request.ID)
			if err != nil || record.GetString("game") != request.Game {
				return re.BadRequestError("Table not found in this game.", nil)
			}
			if err := re.App.Delete(record); err != nil {
				return re.BadRequestError("Table could not be deleted.", err)
			}
			return re.NoContent(204)
		})
		e.Router.POST("/api/olea/transfers/item", func(re *core.RequestEvent) error {
			var request transfers.ItemRequest
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid transfer request.", err)
			}
			if err := transfers.Item(re.App, request); err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.NoContent(204)
		})
		e.Router.POST("/api/olea/transfers/coins", func(re *core.RequestEvent) error {
			var request transfers.CoinRequest
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid transfer request.", err)
			}
			if err := transfers.Coins(re.App, request); err != nil {
				return re.BadRequestError(err.Error(), nil)
			}
			return re.NoContent(204)
		})
		e.Router.POST("/api/olea/records/{collection}/{id}/update", func(re *core.RequestEvent) error {
			var request struct {
				Expected map[string]any `json:"expected"`
				Fields   map[string]any `json:"fields"`
			}
			if err := re.BindBody(&request); err != nil {
				return re.BadRequestError("Invalid update request.", err)
			}
			if err := recordupdate.Update(re.App, re.Request.PathValue("collection"), re.Request.PathValue("id"), request.Expected, request.Fields); err != nil {
				if errors.Is(err, recordupdate.ErrConflict) {
					return re.JSON(409, map[string]string{"message": err.Error()})
				}
				return re.BadRequestError(err.Error(), nil)
			}
			return re.NoContent(204)
		})
		public, err := fs.Sub(frontend, "ui/dist")
		if err != nil {
			return err
		}
		if _, err := fs.Stat(public, "index.html"); err != nil {
			log.Fatal("Frontend not built: run npm install and npm run build before building the server")
		}
		e.Router.GET("/{path...}", apis.Static(public, true))
		return e.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
