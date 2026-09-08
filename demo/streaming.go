package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// ---------------------------------------------------------------------------
// Wire shapes.
//
// These mirror the TypeScript interfaces declared alongside
// forge-dashboard/packages/plugin-streaming/src/pages/*.tsx (StreamingStats,
// RoomInfo/RoomsList, ConnectionInfo/ConnectionsList) field for field, since
// that plugin is what this contributor exists to exercise.
// ---------------------------------------------------------------------------

// StreamingStats is the response payload for the "stats" query.
type StreamingStats struct {
	TotalConnections int     `json:"totalConnections"`
	TotalRooms       int     `json:"totalRooms"`
	TotalChannels    int     `json:"totalChannels"`
	TotalMessages    int     `json:"totalMessages"`
	OnlineUsers      int     `json:"onlineUsers"`
	MessagesPerSec   float64 `json:"messagesPerSec"`
	UptimeSeconds    int64   `json:"uptimeSeconds"`
	MemoryBytes      int64   `json:"memoryBytes"`
}

// RoomInfo is one row of the "rooms.list" query.
type RoomInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Owner       string `json:"owner"`
	Members     int    `json:"members"`
	Private     bool   `json:"private"`
	Archived    bool   `json:"archived"`
	Created     string `json:"created"`
	Updated     string `json:"updated"`
}

// RoomsList is the response payload for the "rooms.list" query.
type RoomsList struct {
	Rooms []RoomInfo `json:"rooms"`
}

// ConnectionInfo is one row of the "connections.list" query.
type ConnectionInfo struct {
	ConnID        string   `json:"connID"`
	UserID        string   `json:"userID"`
	Transport     string   `json:"transport"`
	JoinedRooms   []string `json:"joinedRooms"`
	Subscriptions []string `json:"subscriptions"`
	LastActivity  string   `json:"lastActivity"`
	Status        string   `json:"status"`
}

// ConnectionsList is the response payload for the "connections.list" query.
type ConnectionsList struct {
	Connections []ConnectionInfo `json:"connections"`
}

// ---------------------------------------------------------------------------
// Synthetic data.
// ---------------------------------------------------------------------------

var streamingStart = time.Now()

func streamingStatsHandler(_ context.Context, _ struct{}, _ contract.Principal) (StreamingStats, error) {
	if err := demoUnavailable("STREAMING"); err != nil {
		return StreamingStats{}, err
	}
	return StreamingStats{
		TotalConnections: 42,
		TotalRooms:       3,
		TotalChannels:    7,
		TotalMessages:    18204,
		OnlineUsers:      31,
		MessagesPerSec:   4.7,
		UptimeSeconds:    int64(time.Since(streamingStart).Seconds()),
		MemoryBytes:      86 * 1024 * 1024,
	}, nil
}

func streamingRoomsHandler(_ context.Context, _ struct{}, _ contract.Principal) (RoomsList, error) {
	if err := demoUnavailable("STREAMING"); err != nil {
		return RoomsList{}, err
	}
	return RoomsList{
		Rooms: []RoomInfo{
			{
				ID: "room_1", Name: "General", Description: "Default room for everyone",
				Owner: "user_1", Members: 24, Private: false, Archived: false,
				Created: "2026-08-01T10:00:00Z", Updated: "2026-09-06T14:22:00Z",
			},
			{
				ID: "room_2", Name: "Incident Response", Description: "War room for live incidents",
				Owner: "user_2", Members: 6, Private: true, Archived: false,
				Created: "2026-08-15T09:00:00Z", Updated: "2026-09-05T11:00:00Z",
			},
			{
				ID: "room_3", Name: "Q2 Retro", Description: "Archived planning thread",
				Owner: "user_1", Members: 12, Private: false, Archived: true,
				Created: "2026-04-01T10:00:00Z", Updated: "2026-04-30T18:00:00Z",
			},
		},
	}, nil
}

func streamingConnectionsHandler(_ context.Context, _ struct{}, _ contract.Principal) (ConnectionsList, error) {
	if err := demoUnavailable("STREAMING"); err != nil {
		return ConnectionsList{}, err
	}
	return ConnectionsList{
		Connections: []ConnectionInfo{
			{
				ConnID: "conn_1", UserID: "user_1", Transport: "websocket",
				JoinedRooms: []string{"room_1", "room_2"}, Subscriptions: []string{"presence"},
				LastActivity: time.Now().Add(-2 * time.Second).Format(time.RFC3339), Status: "active",
			},
			{
				ConnID: "conn_2", UserID: "user_2", Transport: "websocket",
				JoinedRooms: []string{"room_1"}, Subscriptions: nil,
				LastActivity: time.Now().Add(-90 * time.Second).Format(time.RFC3339), Status: "idle",
			},
			{
				ConnID: "conn_3", UserID: "user_3", Transport: "sse",
				JoinedRooms: nil, Subscriptions: []string{"rooms.room_2"},
				LastActivity: time.Now().Add(-3 * time.Second).Format(time.RFC3339), Status: "active",
			},
		},
	}, nil
}

// ---------------------------------------------------------------------------
// Manifest + wiring.
// ---------------------------------------------------------------------------

// streamingContributorName is the join key
// forge-dashboard/packages/plugin-streaming looks up in the capabilities
// response (see that package's src/index.tsx doc comment). It is the Go
// contributor name from the real streaming extension's contract manifest,
// not the npm package name.
const streamingContributorName = "streaming-contract"

func buildStreamingManifest() *contract.ContractManifest {
	return &contract.ContractManifest{
		SchemaVersion: 1,
		Contributor: contract.Contributor{
			Name:         streamingContributorName,
			Envelope:     contract.EnvelopeSupport{Supports: []string{"v1"}, Preferred: "v1"},
			Capabilities: []string{"dashboard.read"},
			App: &contract.AppInfo{
				DisplayName: "Streaming",
				Slug:        "streaming",
				Icon:        "radio",
				Priority:    10,
				Home:        "/",
			},
		},
		Intents: []contract.Intent{
			{Name: "stats", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{Name: "rooms.list", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{Name: "connections.list", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
		},
		// No graph: the React plugin (packages/plugin-streaming) defines its
		// own routes client-side and calls these intents directly via
		// useQuery, the way every contract-driven plugin in this wave does.
		// A graph is only needed for the older server-driven page.shell path.
	}
}

// StreamingContributorExtension is a synthetic Forge extension whose only
// job is to publish the "streaming-contract" contributor manifest and its
// handlers, so forge-dashboard's React shell has a second, real scope to
// exercise besides "core-contract".
//
// It is discovered automatically by the dashboard extension during Start()
// because it implements dashboard.ContractContributorAware -- see
// extensions/dashboard/aware.go in the forge repo. No manual wiring beyond
// app.RegisterExtension is required.
type StreamingContributorExtension struct {
	*forge.BaseExtension
}

// NewStreamingContributorExtension constructs the extension.
func NewStreamingContributorExtension() *StreamingContributorExtension {
	return &StreamingContributorExtension{
		BaseExtension: forge.NewBaseExtension(
			"demo-streaming-contract",
			"0.1.0",
			"Synthetic streaming-contract contributor for dashboard shell development",
		),
	}
}

// RegisterContractContributor implements dashboard.ContractContributorAware.
func (e *StreamingContributorExtension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
) error {
	if demoOmit("STREAMING") {
		log.Printf("[demo] %s: DEMO_STREAMING_OMIT=true, not registering (capabilities will not mention it)", streamingContributorName)
		return nil
	}

	m := buildStreamingManifest()
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("%s: validate manifest: %w", streamingContributorName, err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("%s: register manifest: %w", streamingContributorName, err)
	}

	if err := dispatcher.RegisterQuery(disp, streamingContributorName, "stats", 1, streamingStatsHandler); err != nil {
		return fmt.Errorf("%s: register stats: %w", streamingContributorName, err)
	}
	if err := dispatcher.RegisterQuery(disp, streamingContributorName, "rooms.list", 1, streamingRoomsHandler); err != nil {
		return fmt.Errorf("%s: register rooms.list: %w", streamingContributorName, err)
	}
	if err := dispatcher.RegisterQuery(disp, streamingContributorName, "connections.list", 1, streamingConnectionsHandler); err != nil {
		return fmt.Errorf("%s: register connections.list: %w", streamingContributorName, err)
	}

	log.Printf("[demo] %s registered (unavailable=%v)", streamingContributorName, demoUnavailableFlag("STREAMING"))
	return nil
}
