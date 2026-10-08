package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard"
	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	"github.com/xraph/shield/admin"
	"github.com/xraph/shield/compliance"
	"github.com/xraph/shield/engine"
	shieldext "github.com/xraph/shield/extension"
	"github.com/xraph/shield/id"
	"github.com/xraph/shield/pii"
	"github.com/xraph/shield/scan"
	"github.com/xraph/shield/store"
	shieldsqlite "github.com/xraph/shield/store/sqlite"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

func shieldDemoScope() store.Scope {
	return store.Scope{TenantID: "shield-demo", AppID: "shield-console"}
}
func newRealShieldExtension(ctx context.Context) (*shieldext.Extension, func() error, error) {
	file := os.Getenv("DEMO_SHIELD_DB")
	if file == "" {
		file = filepath.Join(os.TempDir(), "forge-dashboard-shield.db")
	}
	auditFile := os.Getenv("DEMO_SHIELD_AUDIT")
	if auditFile == "" {
		auditFile = file + ".audit.jsonl"
	}
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return nil, nil, err
	}
	d := sqlitedriver.New()
	if err := d.Open(ctx, file); err != nil {
		return nil, nil, err
	}
	db, err := grove.Open(d)
	if err != nil {
		_ = d.Close()
		return nil, nil, err
	}
	audit, err := os.OpenFile(auditFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		_ = db.Close()
		return nil, nil, err
	}
	var once sync.Once
	var closeErr error
	close := func() error { once.Do(func() { closeErr = errors.Join(audit.Close(), db.Close()) }); return closeErr }
	st := shieldsqlite.New(db)
	if err = st.Migrate(ctx); err != nil {
		_ = close()
		return nil, nil, err
	}
	eng, _ := engine.New(engine.WithStore(st))
	if err = seedShieldDemo(ctx, st, eng); err != nil {
		_ = close()
		return nil, nil, err
	}
	var auditMu sync.Mutex
	auditSink := func(_ context.Context, event admin.AuditEvent) error {
		auditMu.Lock()
		defer auditMu.Unlock()
		entry := struct {
			Timestamp time.Time `json:"timestamp"`
			admin.AuditEvent
		}{Timestamp: time.Now().UTC(), AuditEvent: event}
		if err := json.NewEncoder(audit).Encode(entry); err != nil {
			return err
		}
		return audit.Sync()
	}
	role := os.Getenv("DEMO_SHIELD_ROLE")
	if role == "" {
		role = "admin"
	}
	if role != "admin" && role != "reader" && role != "denied" {
		_ = close()
		return nil, nil, fmt.Errorf("invalid DEMO_SHIELD_ROLE %q", role)
	}
	resolve := func(_ context.Context, p dashcontract.Principal) (admin.Actor, error) {
		if p.User == nil || !p.User.Authenticated() {
			return admin.Actor{}, &dashcontract.Error{Code: dashcontract.CodeUnauthenticated, Message: "Development identity required"}
		}
		if p.Claims["shield_demo_authenticated"] != true {
			return admin.Actor{}, &dashcontract.Error{Code: dashcontract.CodePermissionDenied, Message: "Shield demo identity is not configured"}
		}
		return admin.Actor{Subject: p.User.Subject, Scope: shieldDemoScope(), Read: role != "denied", Manage: role == "admin", Sensitive: role == "admin"}, nil
	}
	ext := shieldext.New(shieldext.WithStore(st), shieldext.WithDashboardActorResolver(resolve), shieldext.WithDashboardAudit(auditSink))
	return ext, close, nil
}

type shieldDemoExtension struct {
	*shieldext.Extension
	close func() error
}

func (e *shieldDemoExtension) Stop(ctx context.Context) error {
	return errors.Join(e.Extension.Stop(ctx), e.close())
}
func registerShieldDemo(app forge.App, dash *dashboard.Extension) error {
	if !envBool("DEMO_SHIELD", false) {
		return nil
	}
	ext, close, err := newRealShieldExtension(context.Background())
	if err != nil {
		return err
	}
	// Register with the actual host rather than the seed-only application.
	if err = app.RegisterExtension(&shieldDemoExtension{Extension: ext, close: close}); err != nil {
		_ = close()
		return err
	}
	previous := dash.AuthChecker()
	role := os.Getenv("DEMO_SHIELD_ROLE")
	if role == "" {
		role = "admin"
	}
	dash.SetAuthChecker(dashauth.AuthCheckerFunc(func(ctx context.Context, r *http.Request) (*dashauth.UserInfo, error) {
		var user *dashauth.UserInfo
		var err error
		if previous != nil {
			user, err = previous.CheckAuth(ctx, r)
			if err != nil || user == nil {
				return user, err
			}
		} else {
			user = &dashauth.UserInfo{Subject: "shield-demo-" + role, DisplayName: "Shield demo " + role, ProviderName: "local-development"}
		}
		copy := *user
		copy.Claims = map[string]any{}
		for k, v := range user.Claims {
			copy.Claims[k] = v
		}
		copy.Claims["shield_demo_authenticated"] = true
		return &copy, nil
	}))
	dash.EnableAuth()
	return nil
}
func seedShieldDemo(ctx context.Context, st *shieldsqlite.Store, eng *engine.Engine) error {
	scope := shieldDemoScope()
	actor := admin.Actor{Subject: "shield-demo-seed", Scope: scope, Read: true, Manage: true}
	svc := admin.New(st, eng, nil)
	rows := []struct{ kind, raw string }{
		{"instincts", `{"name":"injection-review","description":"Example configuration for injection review","category":"injection","sensitivity":"balanced","action":"block","enabled":true,"strategies":[{"name":"classifier","weight":0.7,"config":{"model":"unconfigured"}},{"name":"canary","weight":0.3,"config":{}}]}`},
		{"awareness", `{"name":"contact-metadata","focus":"pii","action":"redact","enabled":true,"detectors":[{"name":"email-pattern","focus":"pii","patterns":["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+"],"config":{}}]}`},
		{"boundaries", `{"name":"restricted-topics","description":"Disabled example boundary","enabled":false,"limits":[{"scope":"topic","deny":["internal credentials"],"allow":[],"use_allow":false}],"response":"This topic needs an authorized reviewer."}`},
		{"values", `{"name":"honest-answers","severity":"warning","action":"flag","enabled":true,"rules":[{"principle":"honesty","threshold":0.75,"categories":["unsupported claim"],"guidelines":["Cite the source"],"config":{}}]}`},
		{"judgments", `{"name":"grounded-review","domain":"grounding","threshold":0.8,"action":"flag","enabled":true,"assessors":[{"name":"context-review","domain":"grounding","weight":1,"requires_context":true,"config":{}}]}`},
		{"reflexes", `{"name":"escalate-critical","priority":10,"enabled":true,"triggers":[{"type":"on_score","threshold":0.9,"window":"1m"}],"actions":[{"type":"escalate","target":"reviewer","value":{"queue":"safety-review"},"fallback":"Flag for manual review"}]}`},
		{"profiles", `{"name":"review-baseline","description":"Example composition. Evaluation unavailable.","enabled":true,"instincts":[{"instinct_name":"injection-review","sensitivity":"cautious"}],"awareness":[{"awareness_name":"contact-metadata"}],"boundaries":["restricted-topics"],"values":["honest-answers"],"judgments":[{"judgment_name":"grounded-review","threshold":0}],"reflexes":["escalate-critical"]}`},
		{"policies", `{"name":"manual-review","description":"Stored assignment example. Enforcement unavailable.","enabled":true,"rules":[{"check_type":"instinct","condition":"score > 0.8","action":"flag","error_message":"Manual review required","priority":10}]}`},
	}
	for _, seed := range rows {
		var fields map[string]any
		if err := json.Unmarshal([]byte(seed.raw), &fields); err != nil {
			return err
		}
		fields["metadata"] = map[string]any{"source": "demo-example", "evaluation_available": false}
		page, err := st.DashboardList(ctx, scope, seed.kind, store.Filter{Name: fields["name"].(string), Limit: 1})
		if err != nil {
			return err
		}
		if page.Total == 0 {
			raw, _ := json.Marshal(fields)
			if _, err = svc.Create(ctx, actor, seed.kind, raw); err != nil {
				return fmt.Errorf("seed %s: %w", seed.kind, err)
			}
		}
	}
	scans, err := st.DashboardList(ctx, scope, "scans", store.Filter{Limit: 1})
	if err != nil {
		return err
	}
	if scans.Total == 0 {
		for i, decision := range []scan.Decision{scan.DecisionFlag, scan.DecisionRedact, scan.DecisionAllow} {
			r := &scan.Result{ID: id.NewScanID(), Direction: scan.DirectionInput, Decision: decision, AppID: scope.AppID, TenantID: scope.TenantID, Duration: time.Duration(i+1) * 12 * time.Millisecond, ProfileUsed: "review-baseline", PoliciesUsed: []string{"manual-review"}, Metadata: map[string]any{"source": "historical-example", "evaluation_available": false}}
			if i == 0 {
				r.Findings = []*scan.Finding{{ID: id.NewFindingID(), Layer: "instinct", Source: "injection-review", Severity: "warning", Message: "Illustrative finding for dashboard review; no evaluator produced this record", Score: 0.85, Action: "flag", Details: map[string]any{"example": true}}}
			}
			if i == 1 {
				r.PIICount = 1
				r.Redacted = "Contact [EMAIL_1] for the example."
			}
			if err = st.CreateScan(ctx, r); err != nil {
				return err
			}
			if i == 1 {
				expiry := time.Now().UTC().Add(-time.Hour)
				if err = st.StorePIITokens(ctx, []*pii.Token{{ID: id.NewPIITokenID(), ScanID: r.ID, TenantID: scope.TenantID, PIIType: "email", Placeholder: "[EMAIL_1]", EncryptedValue: []byte("demo-placeholder-not-production-ciphertext"), ExpiresAt: &expiry}}); err != nil {
					return err
				}
			}
		}
	}
	reports, err := st.DashboardList(ctx, scope, "compliance", store.Filter{Limit: 1})
	if err != nil {
		return err
	}
	if reports.Total == 0 {
		now := time.Now().UTC()
		r := &compliance.Report{ID: id.NewComplianceReportID(), Framework: compliance.FrameworkNIST, ScopeKey: scope.AppID, ScopeLevel: "app", PeriodStart: now.Add(-24 * time.Hour), PeriodEnd: now, GeneratedAt: now, Summary: map[string]any{"source": "historical-example", "certification": false, "evaluation_available": false}, Details: map[string]any{"note": "Illustrative stored report. Report generation is unavailable."}}
		if err = st.CreateReport(ctx, r); err != nil {
			return err
		}
	}
	return nil
}
