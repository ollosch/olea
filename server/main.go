package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/spf13/cobra"

	"olea/adnd2eimport"
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
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("Cannot determine the application data directory: %v", err)
	}
	defaultDataDir := filepath.Join(configDir, "Olea")

	if len(os.Args) == 1 {
		os.Args = append(os.Args, "serve", "--http=0.0.0.0:8090")
	}

	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: defaultDataDir})
	// Balance writes must use the guarded route or atomic transfer route.
	protectBalances := func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return err
		}
		for _, key := range []string{"balances", "cp", "sp", "ep", "gp", "pp"} {
			if _, present := info.Body[key]; present {
				return e.BadRequestError("Currency balances must be changed through the guarded currency routes.", nil)
			}
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("inventories", "stashes").BindFunc(protectBalances)
	app.OnRecordUpdateRequest("inventories", "stashes").BindFunc(protectBalances)
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{})
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "adnd2e-import <spells|bestiary> <index-or-directory> [pages-file]",
		Short: "Import local AD&D 2e reference material",
		Args:  cobra.RangeArgs(2, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAppMigrations(); err != nil {
				return err
			}
			var parsed adnd2eimport.Result
			var err error
			switch args[0] {
			case "spells":
				if len(args) != 3 {
					return fmt.Errorf("spells requires an index and pages file")
				}
				index, err := os.Open(args[1])
				if err != nil {
					return err
				}
				defer index.Close()
				pages, err := os.Open(args[2])
				if err != nil {
					return err
				}
				defer pages.Close()
				parsed, err = adnd2eimport.ParseSpells(index, pages)
			case "bestiary":
				if len(args) != 2 {
					return fmt.Errorf("bestiary requires the saved compendium directory")
				}
				parsed, err = adnd2eimport.ParseCreatures(args[1])
			default:
				return fmt.Errorf("unsupported AD&D 2e import kind %q", args[0])
			}
			if err != nil {
				return err
			}
			if len(parsed.Document.Records) == 0 {
				return fmt.Errorf("no valid records to import")
			}
			imported, err := catalogimport.Import(app, "adnd2e", parsed.Document)
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
		staticFiles := apis.Static(public, true)
		e.Router.GET("/{path...}", func(re *core.RequestEvent) error {
			if re.Request.URL.Path == "/" {
				return re.Redirect(http.StatusFound, "/games")
			}
			return staticFiles(re)
		})
		return e.Next()
	})
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Id:       "oleaStartupAddresses",
		Priority: -10000,
		Func: func(e *core.ServeEvent) error {
			address := e.Server.Addr
			if address == "" {
				address = ":http"
			}
			listener, err := net.Listen("tcp", address)
			if err != nil {
				return err
			}
			e.Listener = listener
			fmt.Fprintf(os.Stdout, "Olea data directory: %s\n", e.App.DataDir())
			printStartupAddresses(os.Stdout, address, listener.Addr())
			return e.Next()
		},
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func printStartupAddresses(out io.Writer, bindAddress string, listenerAddress net.Addr) {
	tcpAddress, ok := listenerAddress.(*net.TCPAddr)
	if !ok {
		fmt.Fprintf(out, "Olea is listening at %s\n", listenerAddress)
		return
	}
	port := strconv.Itoa(tcpAddress.Port)
	fmt.Fprintf(out, "Olea is ready. Open http://localhost:%s on this computer.\n", port)

	host, _, err := net.SplitHostPort(bindAddress)
	if err != nil {
		host = ""
	}
	addresses := make([]string, 0)
	switch {
	case host == "" || host == "0.0.0.0" || host == "::":
		interfaces, err := net.Interfaces()
		if err == nil {
			for _, networkInterface := range interfaces {
				if networkInterface.Flags&net.FlagUp == 0 || networkInterface.Flags&net.FlagLoopback != 0 {
					continue
				}
				interfaceAddresses, err := networkInterface.Addrs()
				if err != nil {
					continue
				}
				for _, address := range interfaceAddresses {
					ip, _, err := net.ParseCIDR(address.String())
					if err != nil || !ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
						continue
					}
					addresses = append(addresses, ip.String())
				}
			}
		}
	case net.ParseIP(host) != nil:
		if ip := net.ParseIP(host); ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() {
			addresses = append(addresses, ip.String())
		}
	default:
		if !strings.EqualFold(host, "localhost") {
			addresses = append(addresses, host)
		}
	}

	sort.Strings(addresses)
	addresses = uniqueStrings(addresses)
	if len(addresses) == 0 {
		fmt.Fprintln(out, "No LAN address was detected. Check that this computer is connected to Wi-Fi or Ethernet.")
		return
	}
	fmt.Fprintln(out, "On the same Wi-Fi or local network, open one of these addresses:")
	for _, address := range addresses {
		fmt.Fprintf(out, "  http://%s\n", net.JoinHostPort(address, port))
	}
	fmt.Fprintln(out, "If another device cannot connect, allow Olea through the host firewall on your private network.")
}

func uniqueStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	unique := values[:1]
	for _, value := range values[1:] {
		if value != unique[len(unique)-1] {
			unique = append(unique, value)
		}
	}
	return unique
}
