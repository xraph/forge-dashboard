package main

import (
	"fmt"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/streaming"
)

// checkRealStreamingManifest validates the compiled extension in a disposable
// registry. Manager access happens at request time, so no server is started.
func checkRealStreamingManifest() (bool, string) {
	ext := streaming.NewExtension()
	if err := ext.RegisterContractContributor(dispatcher.New(nil), contract.NewRegistry(), contract.NewWardenRegistry()); err != nil {
		return false, err.Error()
	}
	return true, ""
}

func warnRealStreamingManifestInvalid(detail string) {
	fmt.Printf("[demo] Installed streaming contract failed validation: %s\n", detail)
	fmt.Println("[demo] Falling back to the synthetic streaming-contract contributor.")
	fmt.Println("[demo] Set DEMO_STREAMING_FORCE_REAL=true to inspect registration failure.")
}
