# 01 — Go for experienced programmers

## Learning goals

Read the Go in Olea without translating every line mentally into Java or C++; understand packages, types, pointers, errors, interfaces, JSON and transactions. You already know control flow and data structures, so the emphasis is on Go's different conventions.

## The short version

Go is compiled, statically typed and garbage-collected. It has structs and methods, but no class inheritance; behavior is composed using interfaces. Functions can return multiple values, and failures are commonly returned as `error` values rather than thrown as exceptions. Names beginning with an uppercase letter are exported from their package. Go's syntax is intentionally small; the real work is following explicit data and error flow.

## Packages, modules and commands

`server/go.mod` says `module olea` and declares Go and dependency versions. Each directory is generally one package; all non-test `.go` files in a directory with the same package name compile together. A directory can have additional `_test.go` files. `package main` plus `func main()` creates an executable; `server/main.go` is the entry point.

```go
import (
    "fmt"                 // standard library
    "olea/catalogimport"   // package in this module
    _ "olea/migrations"    // import for initialization side effects
)
```

The blank import means “initialize this package but do not bind its name.” The `init()` functions in `server/migrations/` register migration callbacks before `main` runs. `go.mod` and `go.sum` are not databases; the latter records dependency hashes. `go -C server test ./...` changes to the module directory and tests its packages. `go -C server run . ...` builds and runs the main package. `go -C server build` compiles it.

## Variables, control flow and zero values

```go
var count int          // 0, the zero value
name := "Olea"         // declaration and inferred type inside a function
count = 3              // assignment
for i, item := range items { /* index and value */ }
if count > 0 { /* no parentheses required */ }
```

`:=` declares at least one new variable in the current scope; it can also reassign others. Inside an `if` initializer, the declared variables exist only in that `if`/`else` scope: `if err := doWork(); err != nil { return err }`. Be alert to shadowing: an inner `err :=` can be a different variable from an outer `err`. Go has `for`, not separate `while` and `for` keywords. `switch` cases do not fall through automatically. `_` discards a value; use it only when ignoring it is deliberate.

The zero value is usable for many things: `0`, `false`, `""`, `nil` pointers/slices/maps/interfaces, and a struct whose fields are zeroed. A nil map can be read but cannot be assigned into until initialized. A nil slice can be appended to. Nil and empty are not always interchangeable at serialization or API boundaries.

## Structs, values and pointers

From `server/catalogimport/import.go`:

```go
type Summary struct {
    Created int `json:"created"`
    Updated int `json:"updated"`
}
```

`Summary{Created: 1}` makes a value; omitted fields have zero values. Backtick tags are metadata read by packages such as `encoding/json`. Exported field names are necessary for the JSON encoder; the tag supplies the lowercase JSON key. `&value` takes an address, `*T` is a pointer type, and `*p` dereferences it. Go automatically dereferences for field access, so `p.Created` works when `p` is `*Summary`. Go pointers are garbage-collected and do not support C-style pointer arithmetic.

Go passes arguments by value, **including** pointers, slice headers and maps. A copied pointer still points to the same object; copying a slice does not necessarily copy its underlying array; copying a map still refers to its map data. This matters when editing drafts or shared slices.

## Functions, methods and interfaces

```go
func Parse(input io.Reader) (Document, error) { /* ... */ }
func (entry *Entry) UnmarshalJSON(data []byte) error { /* ... */ }
```

The second function is a method with an explicit receiver. A pointer receiver can modify the pointed-to value, as `randomtables.Entry.UnmarshalJSON` does with `*entry = Entry{...}`. A value receiver operates on a copy of the receiver, although fields such as maps or slices can still refer to shared data.

An interface specifies methods, not an inheritance hierarchy. A type satisfies an interface implicitly when its method set matches; there is no `implements` clause. `io.Reader` is an interface with `Read`, so `Parse` can consume a file or another reader. `core.App` is PocketBase's application interface, passed explicitly to functions; the concrete implementation is a framework concern. `any` is an alias for `interface{}`: a value of arbitrary type, not a TypeScript compile-time generic.

Type assertions ask what concrete value is inside an interface:

```go
field, ok := items.Fields.GetByName("inventory").(*core.RelationField)
if !ok { return fmt.Errorf("inventory relation field is missing") }
```

The two-result form is safe if the type is different. The single-result form panics on mismatch. See `server/migrations/20261031000008_stashes.go`.

## Errors and cleanup

```go
file, err := os.Open(path)
if err != nil { return err }
defer file.Close()
```

The caller receives both a result and an `error`; `nil` means no error. `defer` schedules the call for function return, including early returns, in last-in-first-out order; arguments are evaluated when deferred. This example does not inspect a close error. For writing critical data, decide explicitly whether that error matters.

`fmt.Errorf("find system: %w", err)` wraps an error so `errors.Is(err, sql.ErrNoRows)` can inspect its chain. `errors.New(...)` makes an error value. `panic` is not the normal validation mechanism; ordinary failure paths return errors. `log.Fatal` logs and exits the process, so deferred calls in that goroutine do not run. The server uses it for unrecoverable startup failures in `main.go`.

## Slices, arrays and maps

`[3]int` is a fixed-size array; `[]int` is a slice describing a window into an underlying array. `append` returns a new slice header and may allocate another array, so assign its result. `map[string]int` is a hash map. `value, ok := m[key]` distinguishes a missing key from a present zero value. Map iteration order is unspecified; sort when output must be deterministic.

`for _, entry := range entries` copies each entry value into the loop variable. `append([]Entry(nil), entries...)` in `randomtables.Validate` copies the slice's elements before sorting; it is a shallow copy, not a recursive clone. The `...` expands a slice as variadic arguments. `make([]string, 0)` constructs a slice; `make(map[string]bool)` constructs a writable map.

## JSON, optional values and explicit absence

Look at `server/randomtables/tables.go`. `Entry.UnmarshalJSON` decodes `Min` and `Max` as `*int`: `nil` distinguishes missing or JSON `null` from a provided numeric zero. It rejects either missing endpoint, then dereferences the pointers. A plain `int` alone would conflate omission with `0`.

`json.RawMessage` holds raw JSON bytes for deferred interpretation. `dnd5eimport.ParseSpells` extracts useful fields but keeps each raw source record in `Original`; `catalogimport.Import` later unmarshals it before storing. `json.NewDecoder(reader)` reads from an `io.Reader`; `json.Marshal` produces bytes, and struct tags control keys. `DisallowUnknownFields` is used by the neutral importer to reject unexpected input fields.

## Closures and transactions

Functions are values and may capture surrounding variables. In `randomtables.Save`:

```go
var result string
err := app.RunInTransaction(func(tx core.App) error {
    // look up and validate using tx
    // save record using tx
    result = record.Id
    return nil
})
return result, err
```

The closure captures `result`; the transaction callback receives `tx` and returns an error. Success commits; an error rolls back. The `result` must not be interpreted as a committed record when `err != nil`. Do all related database reads/writes through `tx` in the callback. A transaction makes that operation atomic; it does not automatically make unrelated browser requests atomic.

## Concurrency and tests

`go f()` starts a goroutine; channels can communicate and synchronize. A Go HTTP server can handle overlapping requests, so shared mutable state needs synchronization. Most Olea domain code relies on database transactions rather than launching its own goroutines. `currency.SetDenominationsForTest` modifies a package-level map and explicitly warns it must be installed before concurrent requests. Do not copy that testing helper into a runtime configuration mechanism without synchronization.

Go tests live in `_test.go`; functions named `TestXxx(t *testing.T)` are run by `go test`. Run one package with `go -C server test ./transfers`, or select a test with `go -C server test ./transfers -run TestName -v`. Read the test name and setup before assuming what it proves. `go test ./...` does not run Playwright; browser tests are separate.

## Read the code and checkpoint

1. Read `server/dnd5eimport/spells.go` and identify the reader interface, the optional integer, error wrapping, loop, and result struct.
2. Read `server/randomtables/tables.go` from `Entry` through `Save`. Why is the sorted list copied? Why must `tx` be used inside the transaction?
3. Read `server/migrations/20261031000008_stashes.go`. What do the `field, ok` assertion and `*core.RelationField` mean?

**Suggested answer:** Sorting the copy avoids changing the original table-entry slice; the transaction-bound `tx` keeps validation and writes in the same transaction. The assertion checks that the generic field is a pointer to a relation field; if not, the migration returns an error rather than panicking.

Official references: [Go tour](https://go.dev/tour/), [Effective Go](https://go.dev/doc/effective_go), [language specification](https://go.dev/ref/spec), and [standard library](https://pkg.go.dev/std). Next: [02 — Domain and storage](02-domain-and-storage.md).
