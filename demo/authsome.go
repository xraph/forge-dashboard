package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log"

	golog "github.com/xraph/go-utils/log"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	authsome "github.com/xraph/authsome"
	"github.com/xraph/authsome/bridge"
	authcontract "github.com/xraph/authsome/extension/contract"
	"github.com/xraph/authsome/plugins/password"
	authmemory "github.com/xraph/authsome/store/memory"

	"github.com/xraph/warden"
	wardenmemory "github.com/xraph/warden/store/memory"
)

// The standalone host constructs Authsome before dashboard discovery. Its
// identity, policy and audit stores are in memory, so no sibling checkout or
// external infrastructure is needed. Production hosts need persistent adapters.

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
	// The key and identity store share the lifetime of this demo process.
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("create authsome token key: %w", err)
	}
	encryptor, err := bridge.NewAESGCMEncryptor(key)
	if err != nil {
		return nil, fmt.Errorf("create authsome token encryptor: %w", err)
	}

	wardenEng, err := warden.NewEngine(warden.WithStore(wardenmemory.New()))
	if err != nil {
		return nil, fmt.Errorf("create warden engine: %w", err)
	}

	engine, err := authsome.NewEngine(
		authsome.WithStore(store),
		authsome.WithLogger(golog.NewNoopLogger()),
		authsome.WithWarden(wardenEng),
		authsome.WithChronicle(bridge.NewMemoryChronicle()),
		authsome.WithTokenEncryptor(encryptor),
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

// Stop drains the in-memory auth engine's background work on demo shutdown.
func (e *RealAuthsomeExtension) Stop(ctx context.Context) error {
	return errors.Join(e.engine.Stop(ctx), e.BaseExtension.Stop(ctx))
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
