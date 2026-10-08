# Dispatch Slice 3j: artifact contract implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Inspect retained artifact metadata, follow job links and request fresh download URLs from the configured artifact service.

**Architecture:** A new optional RecordReader preserves GetArtifact's live-only behavior while exposing deleted metadata. Every built-in store implements it. Contract queries use the actual artifact service store, which can differ from the job store. The presign query sets HTTP no-store and invokes the backend for every request.

**Tech Stack:** Go, Forge contract transport, five built-in stores, existing artifact and Trove APIs.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Constraints and rulings

- Primary main checkouts only; preserve concurrent module and dashboard changes. Commit owned paths after checks. The user's October 8 update authorizes pushing verified work.
- The artifact service is optional. Disabled is explicit and differs from enabled with an empty list.
- RecordReader is optional for custom artifact stores. Existing Store and GetArtifact signatures remain unchanged. A configured custom store missing paging or metadata inspection returns UNAVAILABLE, not a healthy empty response.
- All five built-in stores implement RecordReader. Direct metadata reads include soft deletion; serving reads and downloads still reject deleted records.
- Artifact pages, details and links use service.Store(). The owning job is verified in the engine store before reading links from the artifact store.
- Redis direct and paged reads validate record identity against the requested key. Missing index members remain skippable; corruption must not become another artifact.
- Trove implements Presigner even when its current driver cannot sign. The new optional PresignSupport reports capability for each artifact reference without generating a URL.
- Backend names must match the artifact's stored backend before a download is offered. No default-backend substitution.
- Expiry metadata describes the artifact lifecycle. GetArtifact's existing live-record rules remain authoritative; the dashboard does not add a new lifecycle expiry policy.
- Each presign call requests a five-minute URL and records a conservative expiry from the call start. URLs must be absolute HTTP or HTTPS without userinfo. Signing failures use the shared safe error mapping.
- Presign sets Cache-Control: no-store through Forge's HTTP context on both success and handler errors. The dispatcher has no query-result cache. The later React download action must call client.query imperatively, outside the query store, and must not retain or persist signed URLs.
- Manifest cache declarations currently have no runtime consumer and cannot satisfy the no-cache requirement.
- Queries remain operator-wide, with explicit scope filters. No new write intents or invalidation policy.
- Preserve cursor, complete and asOf semantics, including empty incomplete pages.
- Apply rex-voice then humanizer to shipped prose. No em dashes, attribution or co-author trailers.
- Real object-storage credentials, browser downloads, the React plugin and templ retirement remain later verification gates.

## Review focus

1. Deleted metadata must be inspectable without reviving download access.
2. Service-store separation must hold for every artifact operation.
3. Optional signing support must reflect the current backend, including Trove.
4. Signed URLs must never be reused by the server or cached by HTTP; the later UI must use imperative reads.
5. Identity errors and outages must remain errors, and incomplete pages must preserve continuation.
6. Built-in record reads and artifact domain queries must pass on all five stores.

## Task 1: Add metadata inspection and accurate signing capabilities

**Files:** `extension/contract/artifact_record_test.go`, `extension/contract/artifact_record_integration_test.go`, `artifact/trove/presign_test.go`, `store/redis/artifact_identity_test.go`, `artifact/inspection.go`, `store/memory/artifact_record.go`, `store/sqlite/artifact_record.go`, `store/postgres/artifact_record.go`, `store/mongo/artifact_record.go`, `store/redis/artifact_record.go`, `artifact/trove/backend.go`, `store/redis/artifact.go`, `store/redis/list.go`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [x] Add these tests:

`extension/contract/artifact_record_test.go`

```go
package contract

import (
 "context"
 "errors"
 "testing"
 "time"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
)

func runArtifactRecordReads(t *testing.T,s store.Store){
 t.Helper();ctx:=context.Background();if err:=s.Migrate(ctx);err!=nil{t.Fatal(err)}
 reader,ok:=s.(interface{GetArtifactRecord(context.Context,id.ArtifactID)(*artifact.Artifact,error)})
 if !ok{t.Fatal("store does not inspect deleted artifact metadata")}
 expires:=time.Now().UTC().Add(time.Hour)
 a:=&artifact.Artifact{ID:id.NewArtifactID(),Backend:"memory",Bucket:"inputs",Key:"retained",Size:42,Lifecycle:artifact.Ephemeral,CreatedAt:time.Now().Add(-time.Hour),ExpiresAt:&expires}
 if err:=s.CreateArtifact(ctx,a,nil);err!=nil{t.Fatal(err)}
 first,err:=reader.GetArtifactRecord(ctx,a.ID);if err!=nil||first.ID!=a.ID||first.Size!=42{t.Fatalf("live=%+v, %v",first,err)}
 first.Size=999;*first.ExpiresAt=expires.Add(time.Hour)
 again,err:=reader.GetArtifactRecord(ctx,a.ID)
 if err!=nil||again.Size!=42||again.ExpiresAt==nil||again.ExpiresAt.Sub(expires).Abs()>time.Millisecond{t.Fatalf("aliased metadata=%+v, %v",again,err)}
 swept,err:=s.SweepOrphans(ctx,time.Now(),10);if err!=nil||len(swept)!=1{t.Fatalf("sweep=%v, %v",swept,err)}
 deleted,err:=reader.GetArtifactRecord(ctx,a.ID);if err!=nil||deleted.DeletedAt==nil{t.Fatalf("deleted=%+v, %v",deleted,err)}
 if _,readErr:=s.GetArtifact(ctx,a.ID);!errors.Is(readErr,artifact.ErrNotFound){t.Fatalf("deleted artifact served: %v",readErr)}
 if err:=s.PurgeArtifact(ctx,a.ID);err!=nil{t.Fatal(err)}
 if _,readErr:=reader.GetArtifactRecord(ctx,a.ID);!errors.Is(readErr,artifact.ErrNotFound){t.Fatalf("purged metadata=%v",readErr)}
 if _,readErr:=reader.GetArtifactRecord(ctx,id.NewArtifactID());!errors.Is(readErr,artifact.ErrNotFound){t.Fatalf("missing metadata=%v",readErr)}
}
func TestArtifactRecordReadsMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runArtifactRecordReads(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runArtifactRecordReads(t,sqliteContractStore(t))})
}
```

`extension/contract/artifact_record_integration_test.go`

```go
//go:build integration

package contract

import "testing"

func TestArtifactRecordReadsOtherBackends(t *testing.T){
 t.Run("postgres",func(t *testing.T){runArtifactRecordReads(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runArtifactRecordReads(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runArtifactRecordReads(t,mongoContractStore(t))})
}
```

`artifact/trove/presign_test.go`

```go
package trove_test

import (
 "testing"
 "github.com/xraph/dispatch/artifact"
)
func TestTroveReportsCurrentPresignCapability(t *testing.T){
 backend:=newBackend(t)
 support,ok:=backend.(interface{SupportsPresign()bool})
 if !ok{t.Fatal("adapter does not expose the driver's signing capability")}
 if support.SupportsPresign(){t.Fatal("memory driver cannot sign URLs")}
 if _,ok:=backend.(artifact.Presigner);!ok{t.Fatal("existing Presigner contract removed")}
}
```

`store/redis/artifact_identity_test.go`

```go
//go:build integration

package redis_test

import (
 "context"
 "encoding/json"
 "testing"
 "time"
 "github.com/xraph/grove/kv/drivers/redisdriver"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
 redisstore "github.com/xraph/dispatch/store/redis"
)
func TestArtifactReadsRejectMismatchedIdentity(t *testing.T){
 ctx:=context.Background();kvStore:=setupTestKV(t);s:=redisstore.New(kvStore);client:=redisdriver.UnwrapClient(kvStore)
 a:=&artifact.Artifact{ID:id.NewArtifactID(),Backend:"memory",Bucket:"inputs",Key:"owned",Lifecycle:artifact.Durable,CreatedAt:time.Now()}
 if err:=s.CreateArtifact(ctx,a,nil);err!=nil{t.Fatal(err)}
 key:="dispatch:artifact:"+a.ID.String();raw,err:=client.Get(ctx,key).Bytes();if err!=nil{t.Fatal(err)}
 var record map[string]json.RawMessage;if err:=json.Unmarshal(raw,&record);err!=nil{t.Fatal(err)}
 record["id"],err=json.Marshal(id.NewArtifactID().String());if err!=nil{t.Fatal(err)}
 corrupt,err:=json.Marshal(record);if err!=nil{t.Fatal(err)}
 if err:=client.Set(ctx,key,corrupt,0).Err();err!=nil{t.Fatal(err)}
 for name,read:=range map[string]func()error{
  "get":func()error{_,err:=s.GetArtifact(ctx,a.ID);return err},
  "list":func()error{_,err:=s.ListArtifacts(ctx,artifact.ListOpts{});return err},
  "page":func()error{_,err:=s.ListArtifactsPage(ctx,artifact.PageOpts{});return err},
 }{t.Run(name,func(t *testing.T){if err:=read();err==nil{t.Fatal("mismatched record was returned")}})}
}
```

- [x] Run the relevant test commands before implementation. Expected FAIL: record inspection and driver capability are missing; Redis returns mismatched records.

- [x] Implement the following:

`artifact/inspection.go`

```go
package artifact

import (
 "context"
 "github.com/xraph/dispatch/id"
)

// RecordReader inspects metadata, including soft-deleted records. It never serves bytes.
type RecordReader interface{
 GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*Artifact,error)
}

// PresignSupport lets an adapter report whether its current driver can sign URLs.
type PresignSupport interface{SupportsPresign()bool}

// SupportsPresign reports the backend's current signing capability.
func SupportsPresign(backend Backend)bool{
 if _,ok:=backend.(Presigner);!ok{return false}
 if support,ok:=backend.(PresignSupport);ok{return support.SupportsPresign()}
 return true
}
```

`store/memory/artifact_record.go`

```go
package memory

import (
 "context"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

var _ artifact.RecordReader=(*Store)(nil)

// GetArtifactRecord returns detached metadata even after soft deletion.
func(s *Store)GetArtifactRecord(_ context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 s.mu.RLock();defer s.mu.RUnlock()
 a,ok:=s.artifacts[artifactID.String()];if !ok{return nil,artifact.ErrNotFound}
 return a.Clone(),nil
}
```

`store/sqlite/artifact_record.go`

```go
package sqlite

import (
 "context"
 "fmt"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

var _ artifact.RecordReader=(*Store)(nil)

// GetArtifactRecord returns metadata even after soft deletion.
func(s *Store)GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 m:=new(artifactModel)
 err:=s.sdb.NewSelect(m).Where("id = ?",artifactID.String()).Limit(1).Scan(ctx)
 if err!=nil{if isNoRows(err){return nil,artifact.ErrNotFound};return nil,fmt.Errorf("dispatch/sqlite: get artifact record: %w",err)}
 return fromArtifactModel(m)
}
```

`store/postgres/artifact_record.go`

```go
package postgres

import (
 "context"
 "fmt"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

var _ artifact.RecordReader=(*Store)(nil)

// GetArtifactRecord returns metadata even after soft deletion.
func(s *Store)GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 m:=new(artifactModel)
 err:=s.pgdb.NewSelect(m).Where("id = ?",artifactID.String()).Limit(1).Scan(ctx)
 if err!=nil{if isNoRows(err){return nil,artifact.ErrNotFound};return nil,fmt.Errorf("dispatch/postgres: get artifact record: %w",err)}
 return fromArtifactModel(m)
}
```

`store/mongo/artifact_record.go`

```go
package mongo

import (
 "context"
 "fmt"
 "go.mongodb.org/mongo-driver/v2/bson"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

var _ artifact.RecordReader=(*Store)(nil)

// GetArtifactRecord returns metadata even after soft deletion.
func(s *Store)GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 var m artifactModel
 err:=s.mdb.Collection(colArtifacts).FindOne(ctx,bson.M{"_id":artifactID.String()}).Decode(&m)
 if err!=nil{if isNoDocuments(err){return nil,artifact.ErrNotFound};return nil,fmt.Errorf("dispatch/mongo: get artifact record: %w",err)}
 return fromArtifactModel(&m)
}
```

`store/redis/artifact_record.go`

```go
package redis

import (
 "context"
 "fmt"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

var _ artifact.RecordReader=(*Store)(nil)

// GetArtifactRecord returns metadata even after soft deletion.
func(s *Store)GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 return s.loadArtifact(ctx,artifactID.String())
}
func validateArtifactIdentity(a *artifact.Artifact,keyID string)error{
 if a.ID.IsNil()||a.ID.String()!=keyID{return fmt.Errorf("dispatch/redis: artifact key and record identity differ")}
 return nil
}
```

```diff
--- a/artifact/trove/backend.go
+++ b/artifact/trove/backend.go
@@
-func (b *Backend) Name() string { return b.name }
+func (b *Backend) Name() string { return b.name }
+
+// SupportsPresign reports the current underlying driver's signing capability.
+func (b *Backend) SupportsPresign() bool {
+ _,ok:=b.trove.Driver().(trovedriver.PresignDriver)
+ return ok
+}
```

```diff
--- a/store/redis/artifact.go
+++ b/store/redis/artifact.go
@@
-	return fromArtifactEntity(&e)
-}
-
-// FindArtifactByKey retrieves a live artifact by its storage coordinates.
+	a, err := fromArtifactEntity(&e)
+	if err != nil { return nil, err }
+	if err := validateArtifactIdentity(a, artifactID); err != nil { return nil, err }
+	return a, nil
+}
+
+// FindArtifactByKey retrieves a live artifact by its storage coordinates.
```

```diff
--- a/store/redis/list.go
+++ b/store/redis/list.go
@@
-		decode: decodeArtifact,
-		match:  opts.Match,
+		decode: decodeArtifact,
+		validate: validateArtifactIdentity,
+		match:  opts.Match,
```

- [x] Format owned Go files with goimports and run these commands individually, preserving every exit status: `go test -race ./extension/contract -run TestArtifactRecordReads -count=1; go test -race ./artifact/trove -run TestTroveReportsCurrentPresignCapability -count=1; go test -race -tags=integration ./extension/contract -run TestArtifactRecordReadsOtherBackends -count=1 -v; go test -race -tags=integration ./store/redis -run TestArtifactReadsRejectMismatchedIdentity -count=1 -v`. Expected PASS; inspect any skips.
- [x] Run affected ordinary lint and integration contract lint. The known integration Redis store_test.go:54 shadow is not owned by this slice.
- [x] Inspect branch, staged scope and concurrent changes. Stage only owned paths and commit: `feat(artifact): expose retained metadata and signing capability`.

## Task 2: Serve artifact metadata, job links and bounded downloads

**Files:** `extension/contract/artifacts_test.go`, `extension/contract/artifacts_errors_test.go`, `extension/contract/artifacts.go`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [x] Add these tests:

`extension/contract/artifacts_test.go`

```go
package contract

import (
 "context"
 "errors"
 "fmt"
 "reflect"
 "slices"
 "strings"
 "testing"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/artifact/artifacttest"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
)

type contractSigner struct{
 *artifacttest.Backend
 supported bool
 calls int
 last artifact.Ref
 ttl time.Duration
 failure error
 rawURL string
 deadline bool
}
func(s *contractSigner)SupportsPresign()bool{return s.supported}
func(s *contractSigner)PresignGet(ctx context.Context,ref artifact.Ref,ttl time.Duration)(string,error){
 s.calls++;s.last=ref;s.ttl=ttl;_,s.deadline=ctx.Deadline()
 if s.failure!=nil{return "",s.failure}
 if s.rawURL!=""{return s.rawURL,nil}
 return fmt.Sprintf("https://objects.example/download/%s?signature=%d",ref.ID,s.calls),nil
}
func newContractSigner()*contractSigner{return &contractSigner{Backend:artifacttest.NewBackend(),supported:true}}
func seedArtifact(t *testing.T,s artifact.Store,key string,lc artifact.Lifecycle,app,org string)*artifact.Artifact{
 t.Helper()
 expires:=time.Now().UTC().Add(time.Hour)
 a:=&artifact.Artifact{ID:id.NewArtifactID(),Backend:"memory",Bucket:"models",Key:key,Size:12345,ContentHash:"sha256:abc",ContentType:"model/gltf-binary",
  Lifecycle:lc,ScopeAppID:app,ScopeOrgID:org,CreatedAt:time.Now().Add(-time.Hour),ExpiresAt:&expires}
 if err:=s.CreateArtifact(context.Background(),a,nil);err!=nil{t.Fatal(err)}
 return a
}
func runArtifactDomain(t *testing.T,s store.Store){
 t.Helper();ctx:=context.Background();signer:=newContractSigner()
 d:=contractDeps(t,s,engine.WithArtifacts(artifact.NewService(s,signer),nil))
 rows:=[]*artifact.Artifact{
  seedArtifact(t,s,"a",artifact.Durable,"app-a","org-a"),
  seedArtifact(t,s,"b",artifact.Durable,"app-b","org-b"),
  seedArtifact(t,s,"deleted",artifact.Ephemeral,"app-a","org-a"),
  seedArtifact(t,s,"unscoped",artifact.Durable,"",""),
 }
 if swept,err:=s.SweepOrphans(ctx,time.Now(),10);err!=nil||len(swept)!=1{t.Fatalf("sweep=%v, %v",swept,err)}
 p:=fc.Principal{Claims:map[string]any{"scope_app_id":"app-a","scope_org_id":"org-a"}}
 cursor:="";got:=[]string{}
 for pages:=0;;pages++{
  if pages>len(rows){t.Fatal("cursor loop")}
  page,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{Limit:2,Cursor:cursor,IncludeDeleted:true},p)
  if err!=nil||!page.Enabled||!page.PresignSupported||page.Items==nil||page.AsOf==""{t.Fatalf("page=%+v, %v",page,err)}
  for _,a:=range page.Items{got=append(got,a.ID)}
  if page.NextCursor==nil{break};cursor=*page.NextCursor
 }
 want:=make([]string,0,len(rows));for _,a:=range rows{want=append(want,a.ID.String())};slices.Sort(want);slices.Reverse(want)
 if !reflect.DeepEqual(got,want){t.Fatalf("operator-wide order=%v want=%v",got,want)}
 page,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{Lifecycle:artifact.Durable,ScopeAppID:"app-b",ScopeOrgID:"org-b"},p)
 if err!=nil||len(page.Items)!=1||page.Items[0].ID!=rows[1].ID.String(){t.Fatalf("filtered=%+v, %v",page,err)}
 live,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{},p)
 if err!=nil||len(live.Items)!=3{t.Fatalf("live=%+v, %v",live,err)}
 detail,err:=artifactsGetHandler(d)(ctx,IDInput{ID:rows[0].ID.String()},p)
 if err!=nil||detail.Artifact==nil||detail.Artifact.ContentHash==nil||*detail.Artifact.ContentHash!="sha256:abc"||!detail.Artifact.DownloadAvailable{t.Fatalf("detail=%+v, %v",detail,err)}
 deleted,err:=artifactsGetHandler(d)(ctx,IDInput{ID:rows[2].ID.String()},p)
 if err!=nil||deleted.Artifact==nil||deleted.Artifact.DeletedAt==nil||deleted.Artifact.DownloadAvailable{t.Fatalf("deleted=%+v, %v",deleted,err)}
 if _,readErr:=artifactsPresignHandler(d)(ctx,IDInput{ID:rows[2].ID.String()},p);!errors.Is(readErr,fc.ErrNotFound){t.Fatalf("deleted download=%v",readErr)}
 j:=seedJob(t,d,"artifact-owner",job.StateCompleted,"app-b","org-b","default")
 for i,role:=range []artifact.Role{artifact.RoleInput,artifact.RoleOutput}{
  if linkErr:=s.LinkArtifact(ctx,&artifact.Link{ArtifactID:rows[i].ID,OwnerKind:artifact.OwnerJob,OwnerID:j.ID.String(),Role:role,Name:string(role),Attempt:i,CreatedAt:time.Now()});linkErr!=nil{t.Fatal(linkErr)}
 }
 links,err:=artifactsForJobHandler(d)(ctx,IDInput{ID:j.ID.String()},p)
 if err!=nil||!links.Enabled||len(links.Links)!=2||links.JobID!=j.ID.String()||links.AsOf==""{t.Fatalf("links=%+v, %v",links,err)}
 for _,input:=range []ArtifactsListInput{{Lifecycle:"other"},{Limit:-1},{Cursor:"broken"}}{
  if _,readErr:=artifactsListHandler(d)(ctx,input,p);!errors.Is(readErr,fc.ErrBadRequest){t.Fatalf("invalid list=%v",readErr)}
 }
 if _,readErr:=artifactsGetHandler(d)(ctx,IDInput{ID:id.NewJobID().String()},p);!errors.Is(readErr,fc.ErrBadRequest){t.Fatalf("bad ID=%v",readErr)}
 if _,readErr:=artifactsGetHandler(d)(ctx,IDInput{ID:id.NewArtifactID().String()},p);!errors.Is(readErr,fc.ErrNotFound){t.Fatalf("missing=%v",readErr)}
 if _,readErr:=artifactsForJobHandler(d)(ctx,IDInput{ID:id.NewJobID().String()},p);!errors.Is(readErr,fc.ErrNotFound){t.Fatalf("missing owner=%v",readErr)}
}
func TestArtifactDomainMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runArtifactDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runArtifactDomain(t,sqliteContractStore(t))})
}
func TestArtifactContractUsesConfiguredServiceStore(t *testing.T){
 engineStore,artifactStore:=memory.New(),memory.New();signer:=newContractSigner()
 d:=contractDeps(t,engineStore,engine.WithArtifacts(artifact.NewService(artifactStore,signer),nil))
 a:=seedArtifact(t,artifactStore,"separate",artifact.Durable,"","")
 seedArtifact(t,engineStore,"wrong-store",artifact.Durable,"","")
 page,err:=artifactsListHandler(d)(context.Background(),ArtifactsListInput{},fc.Principal{})
 if err!=nil||len(page.Items)!=1||page.Items[0].ID!=a.ID.String(){t.Fatalf("configured store=%+v, %v",page,err)}
 detail,err:=artifactsGetHandler(d)(context.Background(),IDInput{ID:a.ID.String()},fc.Principal{})
 if err!=nil||detail.Artifact==nil||detail.Artifact.ScopeAppID!=nil{t.Fatalf("configured detail=%+v, %v",detail,err)}
 j:=seedJob(t,d,"owner",job.StateCompleted,"","","default")
 if err:=artifactStore.LinkArtifact(context.Background(),&artifact.Link{ArtifactID:a.ID,OwnerKind:artifact.OwnerJob,OwnerID:j.ID.String(),Role:artifact.RoleInput,Name:"input",CreatedAt:time.Now()});err!=nil{t.Fatal(err)}
 links,err:=artifactsForJobHandler(d)(context.Background(),IDInput{ID:j.ID.String()},fc.Principal{})
 if err!=nil||len(links.Links)!=1||links.Links[0].ArtifactID!=a.ID.String(){t.Fatalf("configured links=%+v, %v",links,err)}
 download,err:=artifactsPresignHandler(d)(context.Background(),IDInput{ID:a.ID.String()},fc.Principal{})
 if err!=nil||download.URL==nil||signer.last.ID!=a.ID{t.Fatalf("configured download=%+v, %v",download,err)}
}
func TestArtifactPresignCapabilityFailuresAndTTL(t *testing.T){
 s:=memory.New();signer:=newContractSigner();d:=contractDeps(t,s,engine.WithArtifacts(artifact.NewService(s,signer),nil))
 a:=seedArtifact(t,s,"signed",artifact.Durable,"","");input:=IDInput{ID:a.ID.String()};ctx:=context.Background();p:=fc.Principal{}
 first,err:=artifactsPresignHandler(d)(ctx,input,p);if err!=nil||!first.Enabled||!first.Supported||first.URL==nil||first.ExpiresAt==nil{t.Fatalf("first=%+v, %v",first,err)}
 second,err:=artifactsPresignHandler(d)(ctx,input,p)
 if err!=nil||second.URL==nil||*second.URL==*first.URL||signer.calls!=2||signer.ttl!=5*time.Minute||!signer.deadline{t.Fatalf("fresh=%+v calls=%d ttl=%v, %v",second,signer.calls,signer.ttl,err)}
 expires,err:=time.Parse(time.RFC3339Nano,*second.ExpiresAt);if err!=nil||time.Until(expires)>5*time.Minute||time.Until(expires)<4*time.Minute{t.Fatalf("expires=%v, %v",expires,err)}
 signer.supported=false
 unsupported,err:=artifactsPresignHandler(d)(ctx,input,p)
 if err!=nil||unsupported.Supported||unsupported.URL!=nil||unsupported.ExpiresAt!=nil||signer.calls!=2{t.Fatalf("unsupported=%+v, %v",unsupported,err)}
 signer.supported=true
 foreign:=seedArtifact(t,s,"foreign",artifact.Durable,"","")
 // Backend is immutable through UpdateArtifact, so create a separate foreign record.
 foreign.ID=id.NewArtifactID();foreign.Key="foreign-backend";foreign.Backend="other"
 if err:=s.CreateArtifact(ctx,foreign,nil);err!=nil{t.Fatal(err)}
 mismatch,err:=artifactsPresignHandler(d)(ctx,IDInput{ID:foreign.ID.String()},p)
 if err!=nil||mismatch.Supported||mismatch.URL!=nil||signer.calls!=2{t.Fatalf("foreign backend=%+v, %v",mismatch,err)}
 signer.failure=artifact.ErrPermissionDenied
 if _,readErr:=artifactsPresignHandler(d)(ctx,input,p);!errors.Is(readErr,fc.ErrPermissionDenied){t.Fatalf("denied=%v",readErr)}
 signer.failure=errors.New("credential in backend error")
 if _,readErr:=artifactsPresignHandler(d)(ctx,input,p);!errors.Is(readErr,fc.ErrInternal)||strings.Contains(readErr.Error(),"credential"){t.Fatalf("unsafe error=%v",readErr)}
 signer.failure=nil
 for _,unsafe:=range []string{"javascript:alert(1)","/relative","https://user:password@objects.example/key"}{
  signer.rawURL=unsafe
  if _,readErr:=artifactsPresignHandler(d)(ctx,input,p);!errors.Is(readErr,fc.ErrInternal){t.Fatalf("unsafe URL=%v",readErr)}
 }
}
type artifactBaseOnly struct{artifact.Store}
func TestArtifactDisabledAndMissingInspectionCapabilities(t *testing.T){
 ctx:=context.Background();p:=fc.Principal{};d:=contractDeps(t,memory.New());input:=IDInput{ID:id.NewArtifactID().String()}
 page,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{},p)
 if err!=nil||page.Enabled||page.Items==nil||page.PresignSupported{t.Fatalf("disabled list=%+v, %v",page,err)}
 detail,err:=artifactsGetHandler(d)(ctx,input,p)
 if err!=nil||detail.Enabled||detail.Artifact!=nil{t.Fatalf("disabled detail=%+v, %v",detail,err)}
 download,err:=artifactsPresignHandler(d)(ctx,input,p)
 if err!=nil||download.Enabled||download.URL!=nil||download.Supported{t.Fatalf("disabled download=%+v, %v",download,err)}
 custom:=artifactBaseOnly{Store:memory.New()}
 other:=contractDeps(t,memory.New(),engine.WithArtifacts(artifact.NewService(custom,artifacttest.NewBackend()),nil))
 if _,readErr:=artifactsListHandler(other)(ctx,ArtifactsListInput{},p);!errors.Is(readErr,fc.ErrUnavailable){t.Fatalf("missing paging=%v",readErr)}
 if _,readErr:=artifactsGetHandler(other)(ctx,input,p);!errors.Is(readErr,fc.ErrUnavailable){t.Fatalf("missing inspection=%v",readErr)}
}
```

`extension/contract/artifacts_errors_test.go`

```go
package contract

import (
 "context"
 "errors"
 "strings"
 "testing"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/artifact/artifacttest"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store/memory"
)

type artifactReadFailure struct{
 artifact.Store
 artifact.RecordReader
 artifact.PageLister
 fail bool
 deadline bool
}
func(s *artifactReadFailure)readError(ctx context.Context)error{
 _,s.deadline=ctx.Deadline();if s.fail{return errors.New("private artifact store credentials")};return nil
}
func(s *artifactReadFailure)ListArtifactsPage(ctx context.Context,opts artifact.PageOpts)(artifact.Page,error){
 if err:=s.readError(ctx);err!=nil{return artifact.Page{},err}
 return artifact.Page{Artifacts:[]*artifact.Artifact{},NextCursor:"scan-next",Complete:false},nil
}
func(s *artifactReadFailure)GetArtifactRecord(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 if err:=s.readError(ctx);err!=nil{return nil,err};return s.RecordReader.GetArtifactRecord(ctx,artifactID)
}
func(s *artifactReadFailure)GetArtifact(ctx context.Context,artifactID id.ArtifactID)(*artifact.Artifact,error){
 if err:=s.readError(ctx);err!=nil{return nil,err};return s.Store.GetArtifact(ctx,artifactID)
}
func(s *artifactReadFailure)ListLinks(ctx context.Context,owner artifact.OwnerRef)([]*artifact.Link,error){
 if err:=s.readError(ctx);err!=nil{return nil,err};return s.Store.ListLinks(ctx,owner)
}
func TestArtifactReadsPropagateFailureAndIncompletePages(t *testing.T){
 base:=memory.New();custom:=&artifactReadFailure{Store:base,RecordReader:base,PageLister:base,fail:true}
 d:=contractDeps(t,memory.New(),engine.WithArtifacts(artifact.NewService(custom,artifacttest.NewBackend()),nil))
 owner:=seedJob(t,d,"owner",job.StateCompleted,"","","default");input:=IDInput{ID:id.NewArtifactID().String()};ctx:=context.Background();p:=fc.Principal{}
 reads:=map[string]func()error{
  "list":func()error{_,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{},p);return err},
  "get":func()error{_,err:=artifactsGetHandler(d)(ctx,input,p);return err},
  "links":func()error{_,err:=artifactsForJobHandler(d)(ctx,IDInput{ID:owner.ID.String()},p);return err},
  "presign":func()error{_,err:=artifactsPresignHandler(d)(ctx,input,p);return err},
 }
 for name,read:=range reads{t.Run(name,func(t *testing.T){
  err:=read();if !errors.Is(err,fc.ErrInternal)||strings.Contains(err.Error(),"credentials")||!custom.deadline{t.Fatalf("error=%v deadline=%v",err,custom.deadline)}
 })}
 custom.fail=false
 page,err:=artifactsListHandler(d)(ctx,ArtifactsListInput{},p)
 if err!=nil||page.Complete||page.NextCursor==nil||*page.NextCursor!="scan-next"||page.Items==nil{t.Fatalf("incomplete=%+v, %v",page,err)}
}
```

- [x] Run the relevant test commands before implementation. Expected FAIL: artifact handlers do not exist.

- [x] Implement the following:

`extension/contract/artifacts.go`

```go
package contract

import (
 "context"
 "fmt"
 "net/url"
 "time"

 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
)

const artifactDownloadTTL=5*time.Minute

type ArtifactsListInput struct{
 Lifecycle artifact.Lifecycle `json:"lifecycle"`
 ScopeAppID string `json:"scopeAppId"`
 ScopeOrgID string `json:"scopeOrgId"`
 IncludeDeleted bool `json:"includeDeleted"`
 Cursor string `json:"cursor"`
 Limit int `json:"limit"`
}
type ArtifactRow struct{
 ID string `json:"id"`
 Backend string `json:"backend"`
 Bucket string `json:"bucket"`
 Key string `json:"key"`
 Size int64 `json:"size"`
 ContentHash *string `json:"contentHash"`
 ContentType *string `json:"contentType"`
 Lifecycle artifact.Lifecycle `json:"lifecycle"`
 ScopeAppID *string `json:"scopeAppId"`
 ScopeOrgID *string `json:"scopeOrgId"`
 ExpiresAt *string `json:"expiresAt"`
 CreatedAt *string `json:"createdAt"`
 DeletedAt *string `json:"deletedAt"`
 DownloadAvailable bool `json:"downloadAvailable"`
}
type ArtifactsPage struct{Page[ArtifactRow];Enabled bool `json:"enabled"`;PresignSupported bool `json:"presignSupported"`}
type ArtifactDetail struct{Enabled bool `json:"enabled"`;Artifact *ArtifactRow `json:"artifact"`;AsOf string `json:"asOf"`}
type ArtifactJobLinks struct{JobArtifactLinks;JobID string `json:"jobId"`;AsOf string `json:"asOf"`}
type ArtifactDownload struct{
 Enabled bool `json:"enabled"`
 Supported bool `json:"supported"`
 URL *string `json:"url"`
 ExpiresAt *string `json:"expiresAt"`
 AsOf string `json:"asOf"`
}
func projectArtifact(a *artifact.Artifact,service *artifact.Service)ArtifactRow{
 return ArtifactRow{ID:a.ID.String(),Backend:a.Backend,Bucket:a.Bucket,Key:a.Key,Size:a.Size,ContentHash:nullable(a.ContentHash),ContentType:nullable(a.ContentType),
 Lifecycle:a.Lifecycle,ScopeAppID:nullable(a.ScopeAppID),ScopeOrgID:nullable(a.ScopeOrgID),ExpiresAt:timestampPtr(a.ExpiresAt),CreatedAt:timestamp(a.CreatedAt),DeletedAt:timestampPtr(a.DeletedAt),
 DownloadAvailable:service.Enabled()&&!a.IsDeleted()&&a.Backend==service.Backend().Name()&&artifact.SupportsPresign(service.Backend())}
}
func parseArtifactID(raw string)(id.ArtifactID,error){
 parsed,err:=id.ParseArtifactID(raw);if err!=nil||parsed.IsNil(){return id.ArtifactID{},badRequest("id must be an artifact ID")};return parsed,nil
}
func artifactInspectionUnavailable(message string)error{return &fc.Error{Code:fc.CodeUnavailable,Message:message}}
func artifactsListHandler(deps Deps)func(context.Context,ArtifactsListInput,fc.Principal)(ArtifactsPage,error){
 return handle(deps,"artifacts.list",false,func(ctx context.Context,input ArtifactsListInput,_ fc.Principal)(ArtifactsPage,error){
  limit,err:=pageLimit(input.Limit);if err!=nil{return ArtifactsPage{},err}
  if input.Lifecycle!=""&&!input.Lifecycle.Valid(){return ArtifactsPage{},badRequest("unknown artifact lifecycle")}
  service:=deps.Engine.Artifacts();out:=ArtifactsPage{Page:newPage([]ArtifactRow{},"",true,time.Now()),Enabled:service.Enabled()}
  if !out.Enabled{return out,nil}
  reader,ok:=service.Store().(artifact.PageLister);if !ok{return ArtifactsPage{},artifactInspectionUnavailable("the configured artifact store does not support cursor inspection")}
  page,err:=reader.ListArtifactsPage(ctx,artifact.PageOpts{Lifecycle:input.Lifecycle,ScopeAppID:input.ScopeAppID,ScopeOrgID:input.ScopeOrgID,IncludeDeleted:input.IncludeDeleted,Cursor:input.Cursor,Limit:limit})
  if err!=nil{return ArtifactsPage{},err}
  rows:=make([]ArtifactRow,0,len(page.Artifacts));for _,a:=range page.Artifacts{rows=append(rows,projectArtifact(a,service))}
  out.Page=newPage(rows,page.NextCursor,page.Complete,time.Now());out.PresignSupported=artifact.SupportsPresign(service.Backend());return out,nil
 })
}
func artifactsGetHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(ArtifactDetail,error){
 return handle(deps,"artifacts.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(ArtifactDetail,error){
  artifactID,err:=parseArtifactID(input.ID);if err!=nil{return ArtifactDetail{},err}
  service:=deps.Engine.Artifacts();out:=ArtifactDetail{Enabled:service.Enabled(),AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  if !out.Enabled{return out,nil}
  reader,ok:=service.Store().(artifact.RecordReader);if !ok{return ArtifactDetail{},artifactInspectionUnavailable("the configured artifact store does not support deleted-record inspection")}
  a,err:=reader.GetArtifactRecord(ctx,artifactID);if err!=nil{return ArtifactDetail{},err}
  row:=projectArtifact(a,service);out.Artifact=&row;out.AsOf=time.Now().UTC().Format(time.RFC3339Nano);return out,nil
 })
}
func artifactsForJobHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(ArtifactJobLinks,error){
 return handle(deps,"artifacts.forJob",false,func(ctx context.Context,input IDInput,_ fc.Principal)(ArtifactJobLinks,error){
  jobID,err:=parseJobID(input.ID);if err!=nil{return ArtifactJobLinks{},err}
  if _,err:=deps.Store.GetJob(ctx,jobID);err!=nil{return ArtifactJobLinks{},err}
  links,err:=jobLinks(ctx,deps,jobID);if err!=nil{return ArtifactJobLinks{},err}
  return ArtifactJobLinks{JobArtifactLinks:links,JobID:jobID.String(),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func artifactsPresignHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(ArtifactDownload,error){
 return handle(deps,"artifacts.presign",false,func(ctx context.Context,input IDInput,_ fc.Principal)(ArtifactDownload,error){
  if writer:=dashauth.ResponseWriterFromContext(ctx);writer!=nil{writer.Header().Set("Cache-Control","no-store")}
  artifactID,err:=parseArtifactID(input.ID);if err!=nil{return ArtifactDownload{},err}
  service:=deps.Engine.Artifacts();out:=ArtifactDownload{Enabled:service.Enabled(),AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  if !out.Enabled{return out,nil}
  a,err:=service.Store().GetArtifact(ctx,artifactID);if err!=nil{return ArtifactDownload{},err}
  out.Supported=a.Backend==service.Backend().Name()&&artifact.SupportsPresign(service.Backend());if !out.Supported{return out,nil}
  started:=time.Now()
  signed,err:=service.Backend().(artifact.Presigner).PresignGet(ctx,a.Ref(),artifactDownloadTTL);if err!=nil{return ArtifactDownload{},err}
  parsed,err:=url.Parse(signed)
  if err!=nil||parsed.Host==""||parsed.User!=nil||(parsed.Scheme!="http"&&parsed.Scheme!="https"){return ArtifactDownload{},fmt.Errorf("artifact backend returned an invalid download URL")}
  expires:=started.Add(artifactDownloadTTL);out.URL=&signed;out.ExpiresAt=timestamp(expires);out.AsOf=time.Now().UTC().Format(time.RFC3339Nano);return out,nil
 })
}
```

- [x] Format owned Go files with goimports and run these commands individually, preserving every exit status: `go test -race ./extension/contract -run 'TestArtifactDomainMemoryAndSQLite|TestArtifactContract|TestArtifactPresign|TestArtifactDisabled|TestArtifactReadsPropagate' -count=1`. Expected PASS; inspect any skips.
- [x] Run affected ordinary lint and integration contract lint. The known integration Redis store_test.go:54 shadow is not owned by this slice.
- [x] Inspect branch, staged scope and concurrent changes. Stage only owned paths and commit: `feat(contract): expose artifact inspection and downloads`.

## Task 3: Register the artifact queries and verify transport and durable stores

**Files:** `extension/contract/artifacts_integration_test.go`, `extension/contract/artifacts_transport_test.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [x] Add these tests:

`extension/contract/artifacts_integration_test.go`

```go
//go:build integration

package contract

import "testing"

func TestArtifactDomainOtherBackends(t *testing.T){
 t.Run("postgres",func(t *testing.T){runArtifactDomain(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runArtifactDomain(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runArtifactDomain(t,mongoContractStore(t))})
}
```

`extension/contract/artifacts_transport_test.go`

```go
package contract

import (
 "bytes"
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "testing"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 "github.com/xraph/forge/extensions/dashboard/contract/transport"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store/memory"
)

func TestArtifactTransportQueriesAndUncachedDownloads(t *testing.T){
 s:=memory.New();signer:=newContractSigner();d:=contractDeps(t,s,engine.WithArtifacts(artifact.NewService(s,signer),nil))
 a:=seedArtifact(t,s,"transport",artifact.Durable,"","");j:=seedJob(t,d,"owner",job.StateCompleted,"","","default")
 callContract(t,d,"query","artifacts.list",ArtifactsListInput{})
 callContract(t,d,"query","artifacts.get",IDInput{ID:a.ID.String()})
 callContract(t,d,"query","artifacts.forJob",IDInput{ID:j.ID.String()})
 reg,wreg:=fc.NewRegistry(),fc.NewWardenRegistry();disp:=dispatcher.New(nil)
 if err:=Register(disp,reg,wreg,d);err!=nil{t.Fatal(err)}
 handler:=transport.NewHandler(reg,wreg,disp,nil)
 var urls []string
 for _,artifactID:=range []string{a.ID.String(),a.ID.String(),id.NewArtifactID().String(),"broken"}{
  raw,err:=json.Marshal(map[string]any{"envelope":"v1","kind":"query","contributor":"dispatch","intent":"artifacts.presign","payload":IDInput{ID:artifactID}})
  if err!=nil{t.Fatal(err)}
  response:=httptest.NewRecorder();handler.ServeHTTP(response,httptest.NewRequestWithContext(context.Background(),http.MethodPost,"/api/dashboard/v1",bytes.NewReader(raw)))
  if response.Header().Get("Cache-Control")!="no-store"{t.Fatalf("download response can be cached: %v",response.Header())}
  var envelope fc.Response;if err:=json.Unmarshal(response.Body.Bytes(),&envelope);err!=nil{t.Fatal(err)}
  if artifactID!=a.ID.String(){if envelope.OK{t.Fatal("invalid artifact succeeded")};continue}
  if !envelope.OK{t.Fatalf("download failed: %s",response.Body)}
  var download ArtifactDownload
  if err:=json.Unmarshal(envelope.Data,&download);err!=nil||download.URL==nil{t.Fatalf("download=%+v, %v",download,err)}
  urls=append(urls,*download.URL)
 }
 if len(urls)!=2||urls[0]==urls[1]||signer.calls!=2{t.Fatalf("cached URLs=%v calls=%d",urls,signer.calls)}
}
```

- [x] Run the relevant test commands before implementation. Expected FAIL: artifact intents are not registered.

- [x] Implement the following:

Add these bindings and matching read intents:

```go
query("artifacts.list", artifactsListHandler(deps)),
query("artifacts.get", artifactsGetHandler(deps)),
query("artifacts.forJob", artifactsForJobHandler(deps)),
query("artifacts.presign", artifactsPresignHandler(deps)),
```

```yaml
  - { name: artifacts.list, kind: query, version: 1, capability: read }
  - { name: artifacts.get, kind: query, version: 1, capability: read }
  - { name: artifacts.forJob, kind: query, version: 1, capability: read }
  - { name: artifacts.presign, kind: query, version: 1, capability: read }
```

- [x] Format owned Go files with goimports and run these commands individually, preserving every exit status: `go test -race ./extension/contract -count=1; go test -race -tags=integration ./extension/contract -run TestArtifactDomainOtherBackends -count=1 -v`. Expected PASS; inspect any skips.
- [x] Run affected ordinary lint and integration contract lint. The known integration Redis store_test.go:54 shadow is not owned by this slice.
- [x] Inspect branch, staged scope and concurrent changes. Stage only owned paths and commit: `feat(contract): register artifact queries`.

## Final verification and review

- [x] Run go build ./..., go test ./..., go test -race ./engine ./extension/... and full ordinary lint with --allow-serial-runners.
- [x] Generate one complete review package and request one fresh read-only gpt-6-astra final review. No implementation delegation or nested agents.
- [x] Resolve consequential findings in one regression-tested pass without a second review.
- [x] Record implementation, test results and remaining browser/dependency/retirement gates in this plan, its ledger and MIGRATION.md.

## Execution and final review

- Task 1: native regressions failed before the optional reader and signing support existed. Memory, SQLite, PostgreSQL, MongoDB and Redis record reads then passed under race. Redis direct and paged identity regressions failed before validation and passed afterward. Committed in `935bb1c`.
- Task 2: artifact handlers passed domain, outage, disabled-capability, separate-store, empty-incomplete-page and signing tests. Committed in `081cb92`.
- Task 3: the four artifact intents passed HTTP registration and repeated fresh-URL tests, including no-store headers on handler failures. Committed in `b47c958`.
- Final review: one fresh read-only review identified a P2 Trove routing mismatch. We treated it as consequential because a signed URL could point to a different object at the same bucket/key.
- Final fix: `TestTrovePresignUsesReadRoute` failed for both signing drivers, only the routed driver signing, only the default driver signing, and default-bucket resolution. All four pass after resolving the same route as a read. Contract list, detail and download tests also verify per-record availability. Committed in `fda4783`. No second review.
- Ruling: `SupportsPresign` takes the artifact reference, and the global page-level signing flag was removed. Routes can have different capabilities. Consumers use each row's `downloadAvailable`. The planned code above records the original implementation; the checked-in code includes this review correction.
- Ruling: the new global lint rule supersedes the earlier no-push and unrelated-lint boundaries. The Redis test shadow is fixed, and Makefile lint commands wait for the shared linter lock. Committed in `0844707`.
- `make f` and `make l` pass. Affected Redis and contract integration-tag lint reports zero issues. Redis artifact checks pass under race: 20 tests/subtests, no skips. The PostgreSQL, Redis and MongoDB artifact domains pass under race, no skips.
- Dependency verification: a temporary alternate module file reproduced the committed baseline without changing the concurrent upgrades. It needed Trove v1.7.0 for routing and the telemetry indirect dependencies required by the existing dashboard registration test. Only those requirements/checksums were staged; the concurrent Forge/Grove/Relay/telemetry upgrade remains unstaged.
- The resulting committed dependency baseline passes `go build ./...`, all 45 test packages (2,080 tests/subtests), engine/extension/Trove race checks and `make l`. One existing unsupported Trove range-read test skips; two packages have no tests. Earlier MongoDB container-startup skips passed on serial retry.
- Backend migration status is updated in `8ef70d4`. React pages, browser downloads, real SQLite browser parity and templ retirement remain pending. No browser or production-object-store qualification is claimed.
