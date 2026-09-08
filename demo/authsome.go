package main

import (
	"context"
	"fmt"
	"log"

	golog "github.com/xraph/go-utils/log"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	authsome "github.com/xraph/authsome"
	authcontract "github.com/xraph/authsome/extension/contract"
	"github.com/xraph/authsome/plugins/password"
	authmemory "github.com/xraph/authsome/store/memory"

	"github.com/xraph/warden"
	wardenmemory "github.com/xraph/warden/store/memory"
)

// ---------------------------------------------------------------------------
// Real authsome contributor.
//
// This does NOT go through github.com/xraph/authsome/extension (the full
// Forge-extension wrapper). That wrapper auto-discovers a grove.DB, a
// chronicle.Emitter, and -- critically -- a *warden.Engine from the app's DI
// container, and fails registration outright if warden isn't already there
// (see authsome/extension/extension.go's init(): "warden extension is
// required but not found in DI container"). Forge has no published
// extensions/warden wrapper to register for that, so satisfying it would
// mean either hand-rolling one or reaching into vessel manually.
//
// Rather than do either, this builds the engine directly with
// authsome.NewEngine, the same primitive authsome/testutil.NewTestServer
// uses for its own in-memory test server: an in-memory store
// (authsome/store/memory), an in-memory warden engine
// (warden.NewEngine(warden.WithStore(wardenmemory.New()))), and
// WithBootstrap() to seed a "Platform" app + default environments. No
// external infrastructure, no migrations (the memory store has none), no
// network calls. That sidesteps the DI auto-discovery path entirely and
// gives authcontract.Register (extension/contract/contract.go) the one
// thing it actually requires: Deps.Engine.
//
// It is built eagerly, before any app.RegisterExtension call, specifically
// so it does NOT depend on Forge's extension Register/Start ordering. The
// dashboard extension auto-discovers ContractContributorAware by scanning
// app.Extensions() during its own Start() -- if that scan reaches this
// extension before this extension's own Register() has run, and the engine
// were built lazily in Register(), RegisterContractContributor would be
// called with a nil engine and authcontract.Register would fail outright
// (unlike the real streaming extension, whose handlers are closures
// resolved at request time, authcontract.Register checks deps.Engine ==
// nil immediately). Building the engine up front removes that race
// entirely, the same way auth.go's synthetic demoAuthStore is seeded at
// package-init time rather than inside RegisterContractContributor.
// ---------------------------------------------------------------------------

// RealAuthsomeExtension wraps a real, in-memory authsome engine as a
// dashboard contract contributor.
type RealAuthsomeExtension struct {
	*forge.BaseExtension
	engine *authsome.Engine
}

// newRealAuthsomeExtension builds and starts a real authsome engine backed
// entirely by in-memory stores, then wraps it as a Forge extension. Returns
// an error instead of panicking so main() can fall back to the synthetic
// auth contributor when this doesn't work rather than refusing to boot the
// whole demo.
func newRealAuthsomeExtension() (*RealAuthsomeExtension, error) {
	store := authmemory.New()

	wardenEng, err := warden.NewEngine(warden.WithStore(wardenmemory.New()))
	if err != nil {
		return nil, fmt.Errorf("create warden engine: %w", err)
	}

	engine, err := authsome.NewEngine(
		authsome.WithStore(store),
		authsome.WithLogger(golog.NewNoopLogger()),
		authsome.WithWarden(wardenEng),
		authsome.WithDisableMigrate(), // memory store has no migrations to run
		authsome.WithBootstrap(),      // seeds a "Platform" app + dev/staging/prod envs
		authsome.WithPlugin(password.New()),
	)
	if err != nil {
		return nil, fmt.Errorf("create authsome engine: %w", err)
	}

	if err := engine.Start(context.Background()); err != nil {
		return nil, fmt.Errorf("start authsome engine: %w", err)
	}

	log.Printf("[demo] real authsome engine started (in-memory store, platform app id=%s)", engine.PlatformAppID())

	return &RealAuthsomeExtension{
		BaseExtension: forge.NewBaseExtension(
			"demo-authsome-real",
			"0.1.0",
			"Real authsome contract contributor backed by in-memory stores",
		),
		engine: engine,
	}, nil
}

// RegisterContractContributor implements dashboard.ContractContributorAware.
// Delegates straight to authsome's own contract package -- this is the same
// registration path a production authsome deployment uses, not a
// reimplementation of it.
func (e *RealAuthsomeExtension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
) error {
	return authcontract.Register(disp, reg, wreg, authcontract.Deps{
		Engine: e.engine,
	})
}
