package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// ---------------------------------------------------------------------------
// Wire shapes.
//
// These mirror the TypeScript interfaces in
// forge-dashboard/packages/plugin-authsome/src/pages/{login,users,sessions}.tsx
// field for field, since that plugin is what this contributor exists to
// exercise end to end -- including its five commands.
// ---------------------------------------------------------------------------

// SocialProvider is one configured OAuth button surfaced by "auth.config".
type SocialProvider struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	AuthStartURL string `json:"authStartURL"`
}

// AuthConfig is the response payload for the "auth.config" query.
type AuthConfig struct {
	PasswordEnabled bool             `json:"passwordEnabled"`
	Brand           string           `json:"brand,omitempty"`
	SignupURL       string           `json:"signupURL,omitempty"`
	SignupLabel     string           `json:"signupLabel,omitempty"`
	TermsURL        string           `json:"termsURL,omitempty"`
	PrivacyURL      string           `json:"privacyURL,omitempty"`
	SocialProviders []SocialProvider `json:"socialProviders,omitempty"`
}

// LoginInput is the payload for the "auth.login" command.
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginResult is the response payload for the "auth.login" command.
type LoginResult struct {
	OK      bool   `json:"ok"`
	Subject string `json:"subject,omitempty"`
}

// LogoutResult is the response payload for the "auth.logout" command.
type LogoutResult struct {
	OK bool `json:"ok"`
}

// UserSummary is one row of the "users.list" query.
type UserSummary struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	Username      string `json:"username"`
	Banned        bool   `json:"banned"`
	CreatedAt     string `json:"createdAt"`
}

// UserRecord is the response payload for the "users.detail" query: the
// summary plus the fields the list omits.
type UserRecord struct {
	UserSummary
	DisplayName   string `json:"displayName,omitempty"`
	Phone         string `json:"phone,omitempty"`
	PhoneVerified bool   `json:"phoneVerified,omitempty"`
	BanReason     string `json:"banReason,omitempty"`
	BanExpiresAt  string `json:"banExpiresAt,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
}

// UsersList is the response payload for the "users.list" query.
type UsersList struct {
	Users []UserSummary `json:"users"`
	Total int           `json:"total"`
}

// IDInput is the shared payload shape for "users.detail", "users.ban",
// "users.unban", and "sessions.revoke" -- all of them take just an id.
type IDInput struct {
	ID string `json:"id"`
}

// BanResult is the response payload for "users.ban" / "users.unban".
type BanResult struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

// SessionSummary is one row of the "sessions.list" query.
type SessionSummary struct {
	ID             string `json:"id"`
	UserID         string `json:"userId"`
	IPAddress      string `json:"ipAddress"`
	UserAgent      string `json:"userAgent"`
	LastActivityAt string `json:"lastActivityAt"`
	ExpiresAt      string `json:"expiresAt"`
	CreatedAt      string `json:"createdAt"`
}

// SessionsList is the response payload for the "sessions.list" query.
type SessionsList struct {
	Sessions []SessionSummary `json:"sessions"`
}

// RevokeResult is the response payload for the "sessions.revoke" command.
type RevokeResult struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

// ---------------------------------------------------------------------------
// In-memory store. A demo server restarts often, so this is intentionally
// disposable: seeded fresh on boot, mutated in place by ban/unban/revoke.
// ---------------------------------------------------------------------------

type authStore struct {
	mu       sync.Mutex
	users    map[string]*UserRecord
	sessions map[string]*SessionSummary
}

func newAuthStore() *authStore {
	now := time.Now()
	s := &authStore{
		users:    map[string]*UserRecord{},
		sessions: map[string]*SessionSummary{},
	}
	s.users["user_1"] = &UserRecord{
		UserSummary: UserSummary{
			ID: "user_1", Email: "ada@example.com", EmailVerified: true,
			FirstName: "Ada", LastName: "Lovelace", Username: "ada",
			Banned: false, CreatedAt: now.Add(-90 * 24 * time.Hour).Format(time.RFC3339),
		},
		DisplayName: "Ada Lovelace",
		UpdatedAt:   now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	s.users["user_2"] = &UserRecord{
		UserSummary: UserSummary{
			ID: "user_2", Email: "grace@example.com", EmailVerified: true,
			FirstName: "Grace", LastName: "Hopper", Username: "grace",
			Banned: false, CreatedAt: now.Add(-60 * 24 * time.Hour).Format(time.RFC3339),
		},
		DisplayName: "Grace Hopper",
		UpdatedAt:   now.Add(-2 * time.Hour).Format(time.RFC3339),
	}
	s.users["user_3"] = &UserRecord{
		UserSummary: UserSummary{
			ID: "user_3", Email: "spammer@example.com", EmailVerified: false,
			FirstName: "", LastName: "", Username: "spam_bot_42",
			Banned: true, CreatedAt: now.Add(-3 * 24 * time.Hour).Format(time.RFC3339),
		},
		BanReason: "automated spam signup",
		UpdatedAt: now.Add(-3 * 24 * time.Hour).Format(time.RFC3339),
	}

	s.sessions["sess_1"] = &SessionSummary{
		ID: "sess_1", UserID: "user_1", IPAddress: "203.0.113.10",
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
		LastActivityAt: now.Add(-5 * time.Minute).Format(time.RFC3339),
		ExpiresAt:      now.Add(23 * time.Hour).Format(time.RFC3339),
		CreatedAt:      now.Add(-1 * time.Hour).Format(time.RFC3339),
	}
	s.sessions["sess_2"] = &SessionSummary{
		ID: "sess_2", UserID: "user_2", IPAddress: "198.51.100.24",
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
		LastActivityAt: now.Add(-2 * time.Hour).Format(time.RFC3339),
		ExpiresAt:      now.Add(22 * time.Hour).Format(time.RFC3339),
		CreatedAt:      now.Add(-2 * time.Hour).Format(time.RFC3339),
	}
	return s
}

var demoAuthStore = newAuthStore()

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

func authConfigHandler(_ context.Context, _ struct{}, _ contract.Principal) (AuthConfig, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return AuthConfig{}, err
	}
	return AuthConfig{
		PasswordEnabled: true,
		Brand:           "Forge Demo",
		SignupURL:       "",
		TermsURL:        "",
		PrivacyURL:      "",
		SocialProviders: []SocialProvider{
			{ID: "github", Label: "Continue with GitHub", AuthStartURL: "/dashboard/auth/oauth/github/start"},
		},
	}, nil
}

func authLoginHandler(_ context.Context, in LoginInput, _ contract.Principal) (LoginResult, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return LoginResult{}, err
	}
	if in.Email == "" {
		return LoginResult{}, &contract.Error{Code: contract.CodeBadRequest, Message: "email is required"}
	}
	// Demo login: any non-empty email/password combination succeeds. This is
	// a fixture for shell development, not an authentication system.
	return LoginResult{OK: true, Subject: in.Email}, nil
}

func authLogoutHandler(_ context.Context, _ struct{}, _ contract.Principal) (LogoutResult, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return LogoutResult{}, err
	}
	return LogoutResult{OK: true}, nil
}

func usersListHandler(_ context.Context, _ struct{}, _ contract.Principal) (UsersList, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return UsersList{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	out := UsersList{}
	for _, id := range []string{"user_1", "user_2", "user_3"} {
		if u, ok := demoAuthStore.users[id]; ok {
			out.Users = append(out.Users, u.UserSummary)
		}
	}
	out.Total = len(out.Users)
	return out, nil
}

func usersDetailHandler(_ context.Context, in IDInput, _ contract.Principal) (UserRecord, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return UserRecord{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	u, ok := demoAuthStore.users[in.ID]
	if !ok {
		return UserRecord{}, &contract.Error{Code: contract.CodeNotFound, Message: fmt.Sprintf("user %q not found", in.ID)}
	}
	return *u, nil
}

func usersBanHandler(_ context.Context, in IDInput, _ contract.Principal) (BanResult, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return BanResult{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	u, ok := demoAuthStore.users[in.ID]
	if !ok {
		return BanResult{}, &contract.Error{Code: contract.CodeNotFound, Message: fmt.Sprintf("user %q not found", in.ID)}
	}
	u.Banned = true
	u.BanReason = "banned via demo dashboard"
	u.UpdatedAt = time.Now().Format(time.RFC3339)
	return BanResult{OK: true, ID: in.ID}, nil
}

func usersUnbanHandler(_ context.Context, in IDInput, _ contract.Principal) (BanResult, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return BanResult{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	u, ok := demoAuthStore.users[in.ID]
	if !ok {
		return BanResult{}, &contract.Error{Code: contract.CodeNotFound, Message: fmt.Sprintf("user %q not found", in.ID)}
	}
	u.Banned = false
	u.BanReason = ""
	u.UpdatedAt = time.Now().Format(time.RFC3339)
	return BanResult{OK: true, ID: in.ID}, nil
}

func sessionsListHandler(_ context.Context, _ struct{}, _ contract.Principal) (SessionsList, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return SessionsList{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	out := SessionsList{}
	for _, id := range []string{"sess_1", "sess_2"} {
		if s, ok := demoAuthStore.sessions[id]; ok {
			out.Sessions = append(out.Sessions, *s)
		}
	}
	return out, nil
}

func sessionsRevokeHandler(_ context.Context, in IDInput, _ contract.Principal) (RevokeResult, error) {
	if err := demoUnavailable("AUTH"); err != nil {
		return RevokeResult{}, err
	}
	demoAuthStore.mu.Lock()
	defer demoAuthStore.mu.Unlock()
	if _, ok := demoAuthStore.sessions[in.ID]; !ok {
		return RevokeResult{}, &contract.Error{Code: contract.CodeNotFound, Message: fmt.Sprintf("session %q not found", in.ID)}
	}
	delete(demoAuthStore.sessions, in.ID)
	return RevokeResult{OK: true, ID: in.ID}, nil
}

// ---------------------------------------------------------------------------
// Manifest + wiring.
// ---------------------------------------------------------------------------

// authContributorName is the join key forge-dashboard/packages/plugin-authsome
// looks up in the capabilities response (see that package's src/index.tsx doc
// comment). It is the Go contributor name from authsome's own contract
// manifest ("auth"), not the "authsome" app slug or npm package name.
const authContributorName = "auth"

func buildAuthManifest() *contract.ContractManifest {
	return &contract.ContractManifest{
		SchemaVersion: 1,
		Contributor: contract.Contributor{
			Name:         authContributorName,
			Envelope:     contract.EnvelopeSupport{Supports: []string{"v1"}, Preferred: "v1"},
			Capabilities: []string{"dashboard.read", "dashboard.write"},
			App: &contract.AppInfo{
				DisplayName: "Authsome",
				Slug:        "authsome",
				Icon:        "shield",
				Priority:    11,
				Home:        "/users",
			},
		},
		Intents: []contract.Intent{
			{Name: "auth.config", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{Name: "auth.login", Kind: contract.IntentKindCommand, Version: 1, Capability: contract.CapWrite},
			{Name: "auth.logout", Kind: contract.IntentKindCommand, Version: 1, Capability: contract.CapWrite},
			{Name: "users.list", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{Name: "users.detail", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{
				Name: "users.ban", Kind: contract.IntentKindCommand, Version: 1, Capability: contract.CapWrite,
				Invalidates: []string{"users.list", "users.detail"},
			},
			{
				Name: "users.unban", Kind: contract.IntentKindCommand, Version: 1, Capability: contract.CapWrite,
				Invalidates: []string{"users.list", "users.detail"},
			},
			{Name: "sessions.list", Kind: contract.IntentKindQuery, Version: 1, Capability: contract.CapRead},
			{
				Name: "sessions.revoke", Kind: contract.IntentKindCommand, Version: 1, Capability: contract.CapWrite,
				Invalidates: []string{"sessions.list"},
			},
		},
		// No graph: packages/plugin-authsome defines its own routes
		// client-side and calls these intents directly via useQuery /
		// useCommand.
	}
}

// AuthContributorExtension is a synthetic Forge extension whose only job is
// to publish the "auth" contributor manifest and its handlers, giving
// forge-dashboard's React shell a second real, writable scope (on top of
// streaming-contract and core-contract) to exercise the command/CSRF/
// idempotency path end to end.
//
// Discovered automatically by the dashboard extension during Start() via
// dashboard.ContractContributorAware -- see extensions/dashboard/aware.go in
// the forge repo.
type AuthContributorExtension struct {
	*forge.BaseExtension
}

// NewAuthContributorExtension constructs the extension.
func NewAuthContributorExtension() *AuthContributorExtension {
	return &AuthContributorExtension{
		BaseExtension: forge.NewBaseExtension(
			"demo-auth-contract",
			"0.1.0",
			"Synthetic auth contributor for dashboard shell development",
		),
	}
}

// RegisterContractContributor implements dashboard.ContractContributorAware.
func (e *AuthContributorExtension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
) error {
	if demoOmit("AUTH") {
		log.Printf("[demo] %s: DEMO_AUTH_OMIT=true, not registering (capabilities will not mention it)", authContributorName)
		return nil
	}

	m := buildAuthManifest()
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("%s: validate manifest: %w", authContributorName, err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("%s: register manifest: %w", authContributorName, err)
	}

	type reg1 struct {
		intent string
		fn     func() error
	}
	regs := []reg1{
		{"auth.config", func() error { return dispatcher.RegisterQuery(disp, authContributorName, "auth.config", 1, authConfigHandler) }},
		{"auth.login", func() error { return dispatcher.RegisterCommand(disp, authContributorName, "auth.login", 1, authLoginHandler) }},
		{"auth.logout", func() error { return dispatcher.RegisterCommand(disp, authContributorName, "auth.logout", 1, authLogoutHandler) }},
		{"users.list", func() error { return dispatcher.RegisterQuery(disp, authContributorName, "users.list", 1, usersListHandler) }},
		{"users.detail", func() error { return dispatcher.RegisterQuery(disp, authContributorName, "users.detail", 1, usersDetailHandler) }},
		{"users.ban", func() error { return dispatcher.RegisterCommand(disp, authContributorName, "users.ban", 1, usersBanHandler) }},
		{"users.unban", func() error { return dispatcher.RegisterCommand(disp, authContributorName, "users.unban", 1, usersUnbanHandler) }},
		{"sessions.list", func() error { return dispatcher.RegisterQuery(disp, authContributorName, "sessions.list", 1, sessionsListHandler) }},
		{"sessions.revoke", func() error {
			return dispatcher.RegisterCommand(disp, authContributorName, "sessions.revoke", 1, sessionsRevokeHandler)
		}},
	}
	for _, r := range regs {
		if err := r.fn(); err != nil {
			return fmt.Errorf("%s: register %s: %w", authContributorName, r.intent, err)
		}
	}

	log.Printf("[demo] %s registered (unavailable=%v)", authContributorName, demoUnavailableFlag("AUTH"))
	return nil
}
