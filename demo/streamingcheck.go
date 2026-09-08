package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// realStreamingManifestPath is where the real streaming extension's
// embedded contract manifest lives on disk, relative to this demo's working
// directory (matching startupcheck.go's own assumption that this binary is
// run from demo/, with forge checked out as a sibling of forge-dashboard --
// see currentForgeBranch's "-C ../../forge" git invocation).
//
// The extension embeds this file at compile time (go:embed) and does not
// export it, so there is no way to ask the compiled extension "would your
// manifest validate" without either registering it for real or reading the
// same source file ourselves. Reading it here is not a modification of the
// forge checkout, just a second, independent read of a file this binary
// already depends on at build time.
const realStreamingManifestPath = "../../forge/extensions/streaming/contract/manifest.yaml"

// checkRealStreamingManifest best-effort pre-validates the real streaming
// extension's own bundled contract manifest against the exact loader and
// validator the dashboard extension will run it through during Start().
//
// This exists because of a genuine, longstanding defect found while wiring
// this demo up to the real extension (see README.md "A defect in the real
// streaming extension's manifest"): manifest.yaml's "/playground" route
// nests five `form.edit` widgets inside a `dashboard.grid` node's "widgets"
// slot, but extensions/dashboard/contract/slots.go has never allowed
// `form.edit` there -- checked across its entire git history, back to the
// commit that introduced the slot catalog. `loader.Validate` fails fast
// on the first bad node, so the dashboard's real
// `streamingcontract.Register` call fails outright and the whole
// "streaming-contract" contributor silently never registers: the dashboard
// extension only logs the failure and carries on (see
// extensions/dashboard/extension.go's ContractContributorAware loop), so
// nothing in this demo's own exit code or logs would otherwise say so.
//
// Running the exact same Load+Validate call here, before deciding whether
// to hand the real streaming.NewExtension() to app.RegisterExtension,
// means the demo can print a specific, loud warning and fall back to the
// synthetic streaming-contract contributor automatically, instead of
// silently ending up with no streaming scope in /capabilities at all.
// Returns true (valid) if the file can't even be found or read, since a
// missing/unreadable file says nothing about whether the manifest embedded
// in the actual compiled binary is valid -- this check is advisory, not a
// substitute for the real registration attempt.
func checkRealStreamingManifest() (ok bool, detail string) {
	f, err := os.Open(realStreamingManifestPath)
	if err != nil {
		return true, fmt.Sprintf("could not open %s to pre-check it: %v", realStreamingManifestPath, err)
	}
	defer f.Close()

	m, err := loader.Load(f, realStreamingManifestPath)
	if err != nil {
		return false, fmt.Sprintf("load: %v", err)
	}

	wreg := contract.NewWardenRegistry()
	if err := loader.Validate(m, wreg); err != nil {
		return false, fmt.Sprintf("validate: %v", err)
	}

	// loader.Validate checks intents, capabilities, and warden references,
	// but the slot-composition check (which graph node kinds may nest inside
	// which other kinds' slots) lives in the registry's own Register, not
	// the loader -- see extensions/dashboard/contract/slots.go and
	// registry.go. A throwaway registry, used only for this check and
	// discarded, reproduces that pass without touching the dashboard's real
	// one.
	if err := contract.NewRegistry().Register(m); err != nil {
		return false, fmt.Sprintf("register: %v", err)
	}

	return true, ""
}

// warnRealStreamingManifestInvalid prints the same loud, hard-to-miss
// banner style startupcheck.go uses for the "configured" field check.
func warnRealStreamingManifestInvalid(detail string) {
	fmt.Println()
	fmt.Println(strings.Repeat("!", 78))
	fmt.Println("[demo] REAL STREAMING MANIFEST CHECK FAILED: the streaming-contract")
	fmt.Println("[demo] contributor's own bundled manifest.yaml does not pass the real")
	fmt.Println("[demo] dashboard contract validator:")
	fmt.Printf("[demo]   %s\n", detail)
	fmt.Println("[demo]")
	fmt.Println("[demo] This is not a version-skew artifact of this demo's forge checkout:")
	fmt.Println("[demo] extensions/dashboard/contract/slots.go has never allowed `form.edit`")
	fmt.Println("[demo] inside a `dashboard.grid` node's \"widgets\" slot, on any commit back")
	fmt.Println("[demo] to the one that introduced the slot catalog, and manifest.yaml's")
	fmt.Println("[demo] \"/playground\" route does exactly that. Registering the real")
	fmt.Println("[demo] streaming extension would still start it (WebSocket/SSE, rooms,")
	fmt.Println("[demo] presence all work), but its RegisterContractContributor call fails")
	fmt.Println("[demo] and the dashboard extension only logs that -- streaming-contract")
	fmt.Println("[demo] would silently be missing from /capabilities with no other signal.")
	fmt.Println("[demo]")
	fmt.Println("[demo] Falling back to the synthetic streaming-contract contributor")
	fmt.Println("[demo] (streaming.go) instead, so /capabilities and the shell still get a")
	fmt.Println("[demo] working streaming scope. Set DEMO_STREAMING_FORCE_REAL=true to")
	fmt.Println("[demo] register the real extension anyway and see the dashboard's own")
	fmt.Println("[demo] error log line for yourself.")
	fmt.Println(strings.Repeat("!", 78))
	fmt.Println()
}
