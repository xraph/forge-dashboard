# Trove slice 1: core browser-path fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Trove driver page correctly and report folders (common prefixes), and add the small read-only CAS and stream accessors the dashboard contract needs.

**Architecture:** `driver.ObjectIterator` gains a list of common prefixes and the cursor contract becomes explicitly opaque. The three in-process drivers (mem, local, sftp) share one pure paging helper, `driver.PageKeys`. The three cloud drivers map their backend's native delimiter results and continuation tokens, pinned by `httptest` fake servers so the fixes run in plain CI. VFS learns to read prefixes so it keeps its folders.

**Tech Stack:** Go 1.25 (root module), aws-sdk-go-v2 s3, cloud.google.com/go/storage with google.golang.org/api/iterator, azure-sdk-for-go azblob v1.6.1, testify.

**Spec:** `docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md` (in forge-dashboard), section "Trove core".

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forgery/trove`, branch `main`. Work on `main` directly. No worktrees, even if a skill asks for one.
- Modules: the root module `github.com/xraph/trove` contains `driver/`, `drivers/localdriver`, `drivers/memdriver`, `trovetest/`, `cas/`, `stream/`, `vfs/`. `drivers/s3driver`, `drivers/gcsdriver`, `drivers/azuredriver`, `drivers/sftpdriver` are separate modules with `replace github.com/xraph/trove => ../..`. Run their commands from inside their own directory.
- Commit only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD` to check. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo a change, back up and restore the single file.
- Commit messages carry NO `Co-Authored-By` trailer and no Claude attribution. Subject in conventional form (`fix(s3driver): ...`). No em dashes anywhere, in code comments or commit text.
- Lint with a fresh cache every time: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.
- Everything here is additive. Do not change the signature of any existing exported function. `driver.NewObjectIterator` keeps its current signature and behaviour.
- The paging contract, stated once and used everywhere: `NextToken` is opaque; the caller passes it back unchanged as `Cursor`; an empty `NextToken` means the listing is complete. With a `Delimiter`, keys under a common prefix fold into that prefix, objects and prefixes form one lexicographic sequence, and `MaxKeys` counts both.

## Review Focus

1. A page boundary that falls inside a folder: with `MaxKeys: 1` and keys `a/1`, `a/2`, `b`, page two must start at `b`, not repeat `a/`. Pinned in Task 1 (`TestPageKeys_CursorAfterPrefixSkipsItsKeys`) and Task 2 (suite `ListDelimiterPagination`).
2. A listing whose size is an exact multiple of `MaxKeys` must end with an empty `NextToken`, or a UI shows a Load more that loads nothing. Pinned in Task 1 (`TestPageKeys_ExactFitHasNoNextToken`) and Task 2 (suite `ListLastPageHasNoToken`).
3. A VFS directory that holds only subdirectories: `Stat("a")` with only `a/b/c.txt` stored must still be a directory once mem folds keys. Pinned in Task 2 (`TestVFS_Stat_DirectoryWithOnlySubdirectories`).
4. `WithMaxKeys(0)` on S3 must not ask S3 for zero keys. Pinned in Task 3 (`TestList_MaxKeysZeroUsesDefault`).
5. The S3 and Azure second page must send the token they were given, not a key. Pinned in Tasks 3 and 5 by asserting the fake server's recorded query.

---

### Task 1: Prefixes on the iterator and the shared paging helper

**Files:**
- Modify: `driver/driver.go` (the `ObjectIterator` type and its constructor, around lines 102-125)
- Modify: `driver/options.go` (doc comment on `ListConfig.Cursor`, around line 186)
- Create: `driver/page.go`
- Test: `driver/page_test.go`

**Interfaces:**
- Produces:
  - `func NewObjectIteratorWithPrefixes(objects []ObjectInfo, prefixes []string, nextToken string) *ObjectIterator`
  - `func (it *ObjectIterator) CommonPrefixes() []string`
  - `type KeyPage struct { Keys []string; Prefixes []string; NextToken string }`
  - `func PageKeys(sorted []string, cfg ListConfig) KeyPage`

- [ ] **Step 1: Write the failing tests**

Create `driver/page_test.go`:

```go
package driver

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPageKeys_FlatPagesByLastKey(t *testing.T) {
	keys := []string{"a.txt", "b.txt", "c.txt"}

	p1 := PageKeys(keys, ListConfig{MaxKeys: 2})
	assert.Equal(t, []string{"a.txt", "b.txt"}, p1.Keys)
	assert.Empty(t, p1.Prefixes)
	assert.Equal(t, "b.txt", p1.NextToken)

	p2 := PageKeys(keys, ListConfig{MaxKeys: 2, Cursor: p1.NextToken})
	assert.Equal(t, []string{"c.txt"}, p2.Keys)
	assert.Empty(t, p2.NextToken)
}

func TestPageKeys_ExactFitHasNoNextToken(t *testing.T) {
	p := PageKeys([]string{"a", "b"}, ListConfig{MaxKeys: 2})
	assert.Equal(t, []string{"a", "b"}, p.Keys)
	assert.Empty(t, p.NextToken)
}

func TestPageKeys_DelimiterFoldsKeysIntoPrefixes(t *testing.T) {
	keys := []string{"a/1", "a/2", "b/c/d", "top.txt"}

	p := PageKeys(keys, ListConfig{Delimiter: "/", MaxKeys: 100})
	assert.Equal(t, []string{"a/", "b/"}, p.Prefixes)
	assert.Equal(t, []string{"top.txt"}, p.Keys)
	assert.Empty(t, p.NextToken)
}

func TestPageKeys_PrefixAndDelimiterFoldBelowThePrefix(t *testing.T) {
	keys := []string{"logs/2026/a", "logs/2026/b", "logs/x", "other"}

	p := PageKeys(keys, ListConfig{Prefix: "logs/", Delimiter: "/", MaxKeys: 100})
	assert.Equal(t, []string{"logs/2026/"}, p.Prefixes)
	assert.Equal(t, []string{"logs/x"}, p.Keys)
}

func TestPageKeys_CursorAfterPrefixSkipsItsKeys(t *testing.T) {
	keys := []string{"a/1", "a/2", "b"}

	p1 := PageKeys(keys, ListConfig{Delimiter: "/", MaxKeys: 1})
	assert.Equal(t, []string{"a/"}, p1.Prefixes)
	assert.Empty(t, p1.Keys)
	assert.Equal(t, "a/", p1.NextToken)

	p2 := PageKeys(keys, ListConfig{Delimiter: "/", MaxKeys: 1, Cursor: p1.NextToken})
	assert.Empty(t, p2.Prefixes)
	assert.Equal(t, []string{"b"}, p2.Keys)
	assert.Empty(t, p2.NextToken)
}

func TestPageKeys_MultiCharacterDelimiter(t *testing.T) {
	p := PageKeys([]string{"a::1", "a::2", "b"}, ListConfig{Delimiter: "::", MaxKeys: 10})
	assert.Equal(t, []string{"a::"}, p.Prefixes)
	assert.Equal(t, []string{"b"}, p.Keys)
}

func TestPageKeys_ZeroMaxKeysUsesDefault(t *testing.T) {
	keys := make([]string, 1001)
	for i := range keys {
		keys[i] = string(rune('a'+i/676)) + string(rune('a'+(i/26)%26)) + string(rune('a'+i%26))
	}
	p := PageKeys(keys, ListConfig{MaxKeys: 0})
	assert.Len(t, p.Keys, 1000)
	assert.Equal(t, keys[999], p.NextToken)
}

func TestObjectIterator_CommonPrefixes(t *testing.T) {
	it := NewObjectIteratorWithPrefixes([]ObjectInfo{{Key: "top.txt"}}, []string{"a/"}, "tok")
	assert.Equal(t, []string{"a/"}, it.CommonPrefixes())
	assert.Equal(t, "tok", it.NextToken())

	plain := NewObjectIterator([]ObjectInfo{{Key: "x"}}, "")
	assert.Empty(t, plain.CommonPrefixes())
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && go test ./driver/ -run 'TestPageKeys|TestObjectIterator_CommonPrefixes' -v`
Expected: FAIL to compile with `undefined: PageKeys` and `undefined: NewObjectIteratorWithPrefixes`.

- [ ] **Step 3: Add prefixes to the iterator**

In `driver/driver.go`, replace the `ObjectIterator` struct and `NewObjectIterator` with:

```go
// ObjectIterator provides cursor-based listing of objects.
//
// NextToken is opaque. Pass it back unchanged as the Cursor of the next
// List call; an empty NextToken means the listing is complete. When the
// List call set a Delimiter, CommonPrefixes holds the prefixes that keys
// below them were folded into, and MaxKeys counted them alongside objects.
type ObjectIterator struct {
	objects  []ObjectInfo
	prefixes []string
	cursor   int
	token    string
	done     bool
}

// NewObjectIterator creates an iterator from a slice of objects and an optional
// continuation token for the next page.
func NewObjectIterator(objects []ObjectInfo, nextToken string) *ObjectIterator {
	return &ObjectIterator{
		objects: objects,
		token:   nextToken,
	}
}

// NewObjectIteratorWithPrefixes creates an iterator that also reports the
// common prefixes a delimiter listing folded keys into.
func NewObjectIteratorWithPrefixes(objects []ObjectInfo, prefixes []string, nextToken string) *ObjectIterator {
	return &ObjectIterator{
		objects:  objects,
		prefixes: prefixes,
		token:    nextToken,
	}
}

// CommonPrefixes returns the prefixes this page folded keys into. It is
// empty when the List call set no Delimiter.
func (it *ObjectIterator) CommonPrefixes() []string {
	return it.prefixes
}
```

- [ ] **Step 4: Document the cursor contract**

In `driver/options.go`, replace the comment on `ListConfig.Cursor`:

```go
	// Cursor is the NextToken from a previous List call, passed back
	// unchanged. It is opaque: drivers may use a key, a backend
	// continuation token or anything else, so never construct one.
	Cursor string
```

- [ ] **Step 5: Write the paging helper**

Create `driver/page.go`:

```go
package driver

import "strings"

// KeyPage is one page of a listing, computed from a full sorted key set.
type KeyPage struct {
	// Keys are the object keys on this page, in order.
	Keys []string
	// Prefixes are the common prefixes on this page, in order.
	Prefixes []string
	// NextToken is the last item on this page when more items follow,
	// and empty when the listing is complete.
	NextToken string
}

// PageKeys computes one page of a listing for drivers that hold, or can
// walk, their whole key set. The keys must be sorted lexicographically and
// free of duplicates.
//
// It applies cfg.Prefix, folds keys into common prefixes when cfg.Delimiter
// is set, skips every item at or before cfg.Cursor, and stops after
// cfg.MaxKeys items, counting prefixes and keys together. A MaxKeys of zero
// or less means 1000. The returned NextToken is the last item emitted, key
// or prefix, which is what the next call's Cursor must be.
func PageKeys(sorted []string, cfg ListConfig) KeyPage {
	maxKeys := cfg.MaxKeys
	if maxKeys <= 0 {
		maxKeys = 1000
	}

	var page KeyPage
	emitted := 0
	last := ""

	for _, key := range sorted {
		if !strings.HasPrefix(key, cfg.Prefix) {
			continue
		}

		item, isPrefix := key, false
		if cfg.Delimiter != "" {
			rest := key[len(cfg.Prefix):]
			if i := strings.Index(rest, cfg.Delimiter); i >= 0 {
				item = cfg.Prefix + rest[:i+len(cfg.Delimiter)]
				isPrefix = true
			}
		}

		if cfg.Cursor != "" && item <= cfg.Cursor {
			continue
		}
		// Keys sharing a prefix are contiguous in sorted order, so a
		// repeated prefix is always the one just emitted.
		if isPrefix && emitted > 0 && item == last {
			continue
		}

		if emitted == maxKeys {
			page.NextToken = last
			return page
		}

		if isPrefix {
			page.Prefixes = append(page.Prefixes, item)
		} else {
			page.Keys = append(page.Keys, key)
		}
		last = item
		emitted++
	}

	return page
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && go test ./driver/ -v -run 'TestPageKeys|TestObjectIterator_CommonPrefixes' && go test ./...`
Expected: PASS, and the whole root module still passes (nothing calls the new code yet).

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git add driver/page.go driver/page_test.go
git commit --only -m "feat(driver): report common prefixes and share one paging helper" -- driver/driver.go driver/options.go driver/page.go driver/page_test.go
git show --stat HEAD
```

The body, written in Rex's voice with no trailer, says: the iterator can now carry the prefixes a delimiter listing folded keys into, the cursor is documented as opaque, and `PageKeys` is the one implementation of that contract for drivers that walk their whole key set.

---

### Task 2: mem, local and sftp fold by delimiter; VFS reads prefixes; conformance cases

**Files:**
- Modify: `drivers/memdriver/mem.go` (`List`, around lines 201-248)
- Modify: `drivers/localdriver/local.go` (`List`, around lines 470-538)
- Modify: `drivers/sftpdriver/sftp.go` (`List`, around lines 422-473)
- Modify: `vfs/vfs.go` (`Stat` around lines 58-80, `ReadDir` around lines 83-155)
- Test: `trovetest/suite.go` (inside the `t.Run("List", ...)` group, after `ListPagination`)
- Test: `vfs/vfs_test.go`

**Interfaces:**
- Consumes: `driver.PageKeys`, `driver.KeyPage`, `driver.NewObjectIteratorWithPrefixes`, `(*driver.ObjectIterator).CommonPrefixes` from Task 1.

- [ ] **Step 1: Write the failing conformance cases**

In `trovetest/suite.go`, add a helper at the bottom of the file:

```go
// listItems walks every page of a listing and returns its items in order,
// prefixes and keys merged, plus the number of pages it took.
func listItems(t *testing.T, drv driver.Driver, bucket string, opts ...driver.ListOption) ([]string, int) {
	t.Helper()
	ctx := context.Background()

	var items []string
	cursor := ""
	pages := 0
	for {
		pageOpts := append([]driver.ListOption{}, opts...)
		if cursor != "" {
			pageOpts = append(pageOpts, driver.WithCursor(cursor))
		}
		iter, err := drv.List(ctx, bucket, pageOpts...)
		require.NoError(t, err)
		objects, err := iter.All(ctx)
		require.NoError(t, err)

		page := append([]string{}, iter.CommonPrefixes()...)
		for _, o := range objects {
			page = append(page, o.Key)
		}
		sort.Strings(page)
		items = append(items, page...)
		pages++

		cursor = iter.NextToken()
		if cursor == "" {
			return items, pages
		}
		require.Less(t, pages, 100, "listing never finished")
	}
}
```

Add `"sort"` to the suite's imports. Then, inside the `t.Run("List", ...)` group after `ListPagination`, add:

```go
		t.Run("ListDelimiter", func(t *testing.T) {
			drv := factory(t)
			ctx := context.Background()
			require.NoError(t, drv.CreateBucket(ctx, "data"))
			for _, key := range []string{"a/1", "a/2", "b/c/d", "top.txt"} {
				_, err := drv.Put(ctx, "data", key, strings.NewReader("x"))
				require.NoError(t, err)
			}

			iter, err := drv.List(ctx, "data", driver.WithDelimiter("/"))
			require.NoError(t, err)
			objects, err := iter.All(ctx)
			require.NoError(t, err)

			assert.Equal(t, []string{"a/", "b/"}, iter.CommonPrefixes())
			require.Len(t, objects, 1)
			assert.Equal(t, "top.txt", objects[0].Key)
			assert.Empty(t, iter.NextToken())
		})

		t.Run("ListDelimiterWithPrefix", func(t *testing.T) {
			drv := factory(t)
			ctx := context.Background()
			require.NoError(t, drv.CreateBucket(ctx, "data"))
			for _, key := range []string{"b/c/d", "b/e", "z"} {
				_, err := drv.Put(ctx, "data", key, strings.NewReader("x"))
				require.NoError(t, err)
			}

			iter, err := drv.List(ctx, "data", driver.WithPrefix("b/"), driver.WithDelimiter("/"))
			require.NoError(t, err)
			objects, err := iter.All(ctx)
			require.NoError(t, err)

			assert.Equal(t, []string{"b/c/"}, iter.CommonPrefixes())
			require.Len(t, objects, 1)
			assert.Equal(t, "b/e", objects[0].Key)
		})

		t.Run("ListDelimiterPagination", func(t *testing.T) {
			drv := factory(t)
			ctx := context.Background()
			require.NoError(t, drv.CreateBucket(ctx, "data"))
			for _, key := range []string{"a/1", "a/2", "b/1", "top.txt"} {
				_, err := drv.Put(ctx, "data", key, strings.NewReader("x"))
				require.NoError(t, err)
			}

			items, pages := listItems(t, drv, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(1))
			assert.Equal(t, []string{"a/", "b/", "top.txt"}, items)
			assert.Equal(t, 3, pages)
		})

		t.Run("ListLastPageHasNoToken", func(t *testing.T) {
			drv := factory(t)
			ctx := context.Background()
			require.NoError(t, drv.CreateBucket(ctx, "data"))
			for _, key := range []string{"a", "b", "c"} {
				_, err := drv.Put(ctx, "data", key, strings.NewReader("x"))
				require.NoError(t, err)
			}

			iter, err := drv.List(ctx, "data", driver.WithMaxKeys(3))
			require.NoError(t, err)
			objects, err := iter.All(ctx)
			require.NoError(t, err)
			assert.Len(t, objects, 3)
			assert.Empty(t, iter.NextToken())
		})
```

- [ ] **Step 2: Write the failing VFS test**

Append to `vfs/vfs_test.go`:

```go
func TestVFS_Stat_DirectoryWithOnlySubdirectories(t *testing.T) {
	v, store := setup(t)
	ctx := context.Background()
	putFile(t, store, "a/b/c.txt", "c")

	info, err := v.Stat(ctx, "a")
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestVFS_ReadDir_ShowsNestedDirectoryOnce(t *testing.T) {
	v, store := setup(t)
	ctx := context.Background()
	putFile(t, store, "sub/deeper/x.txt", "x")
	putFile(t, store, "sub/deeper/y.txt", "y")
	putFile(t, store, "sub/z.txt", "z")

	entries, err := v.ReadDir(ctx, "sub")
	require.NoError(t, err)

	got := map[string]bool{}
	for _, e := range entries {
		got[e.Name()] = e.IsDir()
	}
	assert.Equal(t, map[string]bool{"deeper": true, "z.txt": false}, got)
}
```

- [ ] **Step 3: Run the tests to verify the conformance cases fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && go test ./drivers/memdriver/ ./drivers/localdriver/ ./vfs/ 2>&1 | tail -30`
Expected: FAIL on `ListDelimiter`, `ListDelimiterWithPrefix` and `ListDelimiterPagination` for both drivers (no prefixes reported). The two VFS tests pass today, because VFS still infers folders from unfolded keys. They must keep passing after Step 4.

- [ ] **Step 4: Switch memdriver to `PageKeys`**

In `drivers/memdriver/mem.go` `List`, replace everything from `// Collect keys sorted alphabetically.` to the end of the function with:

```go
	keys := make([]string, 0, len(objects))
	for k := range objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	page := driver.PageKeys(keys, cfg)

	infos := make([]driver.ObjectInfo, 0, len(page.Keys))
	for _, k := range page.Keys {
		infos = append(infos, objects[k].info)
	}

	return driver.NewObjectIteratorWithPrefixes(infos, page.Prefixes, page.NextToken), nil
}
```

If `strings` is no longer used in `mem.go` after this, remove it from the imports.

- [ ] **Step 5: Switch localdriver to `PageKeys`**

In `drivers/localdriver/local.go` `List`, inside the `filepath.Walk` callback delete the two blocks that filter by `cfg.Prefix` and `cfg.Cursor` (the walk keeps skipping directories, `.meta.json` and `.trove-tmp-` files). Then replace everything from `sort.Strings(keys)` to the end of the function with:

```go
	sort.Strings(keys)

	page := driver.PageKeys(keys, cfg)

	infos := make([]driver.ObjectInfo, 0, len(page.Keys))
	for _, key := range page.Keys {
		objPath := filepath.Join(bucketDir, key)
		stat, err := os.Stat(objPath)
		if err != nil {
			continue
		}
		meta := d.readMeta(objPath)
		infos = append(infos, driver.ObjectInfo{
			Key:          key,
			Size:         stat.Size(),
			ContentType:  meta.ContentType,
			ETag:         fmt.Sprintf("%x-%x", stat.Size(), stat.ModTime().UnixNano()),
			LastModified: stat.ModTime(),
			Metadata:     meta.Metadata,
		})
	}

	return driver.NewObjectIteratorWithPrefixes(infos, page.Prefixes, page.NextToken), nil
}
```

Keeping the prefix filter out of the walk costs nothing extra (the walk already visited every file) and leaves `PageKeys` as the single place the rule lives.

- [ ] **Step 6: Switch sftpdriver to `PageKeys`**

In `drivers/sftpdriver/sftp.go` `List`, replace everything from `// Filter by prefix and cursor.` to the end of the function with:

```go
	sort.Strings(keys)

	page := driver.PageKeys(keys, cfg)

	infos := make([]driver.ObjectInfo, 0, len(page.Keys))
	for _, key := range page.Keys {
		objPath := path.Join(bucketDir, key)
		stat, err := client.Stat(objPath)
		if err != nil {
			continue
		}
		meta := d.readMeta(client, objPath)
		infos = append(infos, driver.ObjectInfo{
			Key:          key,
			Size:         stat.Size(),
			ContentType:  meta.ContentType,
			ETag:         fmt.Sprintf("%x-%x", stat.Size(), stat.ModTime().UnixNano()),
			LastModified: stat.ModTime(),
			Metadata:     meta.Metadata,
		})
	}

	return driver.NewObjectIteratorWithPrefixes(infos, page.Prefixes, page.NextToken), nil
}
```

If `strings` is no longer used in `sftp.go`, leave it: `walkDir` still uses it.

- [ ] **Step 7: Teach VFS to read prefixes**

In `vfs/vfs.go` `Stat`, replace the block from `_, nextErr := iter.Next(ctx)` to the end of the function with:

```go
	_, nextErr := iter.Next(ctx)
	if nextErr != nil && !errors.Is(nextErr, io.EOF) {
		return nil, fmt.Errorf("vfs: stat %q: %w", name, nextErr)
	}
	// A directory holding only subdirectories has no objects on this page,
	// only common prefixes.
	if errors.Is(nextErr, io.EOF) && len(iter.CommonPrefixes()) == 0 {
		return nil, &fs.PathError{Op: "stat", Path: name, Err: fs.ErrNotExist}
	}

	return &FileInfo{
		name:  path.Base(name),
		isDir: true,
	}, nil
}
```

In `ReadDir`, just before the final `return entries, nil`, add:

```go
	// Subdirectories the driver folded into common prefixes.
	for _, p := range iter.CommonPrefixes() {
		dirName := strings.TrimSuffix(strings.TrimPrefix(p, prefix), "/")
		if dirName == "" || seen[dirName] {
			continue
		}
		seen[dirName] = true
		entries = append(entries, DirEntry{
			info: FileInfo{name: dirName, isDir: true},
		})
	}
```

The existing key-based inference stays as a fallback for any driver that ignores the delimiter.

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
cd /Users/rexraphael/Work/xraph/forgery/trove && go test ./... 2>&1 | tail -20
cd drivers/sftpdriver && go build ./... && go vet ./...
```
Expected: the root module passes, including every existing VFS test and the four new suite cases on mem and local. sftp builds and vets clean. Its suite runs only under the `integration` tag, which CI does not set.

- [ ] **Step 9: Lint**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: no new issues in the files this task touched.

- [ ] **Step 10: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git commit --only -m "fix(drivers): fold keys into common prefixes on mem, local and sftp" -- drivers/memdriver/mem.go drivers/localdriver/local.go drivers/sftpdriver/sftp.go vfs/vfs.go vfs/vfs_test.go trovetest/suite.go
git show --stat HEAD
```

The body says the three drivers used to ignore `Delimiter`, now fold through `PageKeys`, VFS reads the prefixes so its folders survive, and the suite pins delimiter listing and paging on mem and local (sftp only under the integration tag).

---

### Task 3: S3 pages with its continuation token and reports common prefixes

**Files:**
- Modify: `drivers/s3driver/s3.go` (`List`, around lines 363-432)
- Test: `drivers/s3driver/list_test.go` (create)

**Interfaces:**
- Consumes: `driver.NewObjectIteratorWithPrefixes` from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `drivers/s3driver/list_test.go`:

```go
package s3driver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xraph/trove/driver"
)

const s3PageOne = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>data</Name><Prefix></Prefix><KeyCount>2</KeyCount><MaxKeys>2</MaxKeys><Delimiter>/</Delimiter><IsTruncated>true</IsTruncated><NextContinuationToken>opaque-token-2</NextContinuationToken><Contents><Key>a.txt</Key><LastModified>2026-09-30T00:00:00.000Z</LastModified><ETag>&quot;e1&quot;</ETag><Size>3</Size><StorageClass>STANDARD</StorageClass></Contents><CommonPrefixes><Prefix>logs/</Prefix></CommonPrefixes></ListBucketResult>`

const s3PageTwo = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>data</Name><Prefix></Prefix><KeyCount>1</KeyCount><MaxKeys>2</MaxKeys><Delimiter>/</Delimiter><IsTruncated>false</IsTruncated><Contents><Key>z.txt</Key><LastModified>2026-09-30T00:00:00.000Z</LastModified><ETag>&quot;e2&quot;</ETag><Size>5</Size><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>`

// fakeS3 answers ListObjectsV2 with page one, then page two once the
// request carries page one's continuation token, and records every query.
func fakeS3(t *testing.T) (*S3Driver, func() []url.Values) {
	t.Helper()
	var mu sync.Mutex
	var queries []url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		queries = append(queries, r.URL.Query())
		mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		if r.URL.Query().Get("continuation-token") == "opaque-token-2" {
			fmt.Fprint(w, s3PageTwo)
			return
		}
		fmt.Fprint(w, s3PageOne)
	}))
	t.Cleanup(srv.Close)

	drv := New()
	dsn := "s3://AKIDTEST:SECRETTEST@us-east-1/data?endpoint=" + url.QueryEscape(srv.URL) + "&path_style=true"
	require.NoError(t, drv.Open(context.Background(), dsn))

	return drv, func() []url.Values {
		mu.Lock()
		defer mu.Unlock()
		return append([]url.Values{}, queries...)
	}
}

func TestList_PagesWithContinuationTokenAndReportsPrefixes(t *testing.T) {
	drv, queries := fakeS3(t)
	ctx := context.Background()

	it, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2))
	require.NoError(t, err)
	objects, err := it.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects, 1)
	assert.Equal(t, "a.txt", objects[0].Key)
	assert.Equal(t, []string{"logs/"}, it.CommonPrefixes())
	assert.Equal(t, "opaque-token-2", it.NextToken())

	it2, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2), driver.WithCursor(it.NextToken()))
	require.NoError(t, err)
	objects2, err := it2.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects2, 1)
	assert.Equal(t, "z.txt", objects2[0].Key)
	assert.Empty(t, it2.NextToken())

	q := queries()
	require.Len(t, q, 2)
	assert.Equal(t, "/", q[0].Get("delimiter"))
	assert.Equal(t, "opaque-token-2", q[1].Get("continuation-token"))
	assert.Empty(t, q[1].Get("start-after"), "the cursor is a token, never a key")
}

func TestList_MaxKeysZeroUsesDefault(t *testing.T) {
	drv, queries := fakeS3(t)

	_, err := drv.List(context.Background(), "data", driver.WithMaxKeys(0))
	require.NoError(t, err)

	q := queries()
	require.Len(t, q, 1)
	assert.Equal(t, "1000", q[0].Get("max-keys"))
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/s3driver && go test -run 'TestList_' -v ./...`
Expected: FAIL. `CommonPrefixes()` is empty, the second request carries `start-after` and no `continuation-token`, and `max-keys` is `0`. If the SDK rejects the fake response for a reason unrelated to the listing (for example a missing header), fix the fake server, not the assertions: the assertions are the contract.

- [ ] **Step 3: Fix the S3 `List`**

In `drivers/s3driver/s3.go`, replace the body of `List` from the `input := ...` line to the end with:

```go
	maxKeys := cfg.MaxKeys
	if maxKeys <= 0 {
		maxKeys = 1000
	}

	input := &s3.ListObjectsV2Input{
		Bucket:  aws.String(bucket),
		MaxKeys: aws.Int32(int32(maxKeys)),
	}
	if cfg.Prefix != "" {
		input.Prefix = aws.String(cfg.Prefix)
	}
	if cfg.Delimiter != "" {
		input.Delimiter = aws.String(cfg.Delimiter)
	}
	// The cursor is the NextContinuationToken of the previous page. It is
	// opaque, so it goes back as ContinuationToken, never as StartAfter.
	if cfg.Cursor != "" {
		input.ContinuationToken = aws.String(cfg.Cursor)
	}

	result, err := client.ListObjectsV2(ctx, input)
	if err != nil {
		if cErr := classifyErr(err, bucket, ""); cErr != nil {
			return nil, cErr
		}
		return nil, fmt.Errorf("s3driver: list bucket %q: %w", bucket, err)
	}

	infos := make([]driver.ObjectInfo, 0, len(result.Contents))
	for _, obj := range result.Contents {
		etag := ""
		if obj.ETag != nil {
			etag = strings.Trim(*obj.ETag, "\"")
		}
		key := ""
		if obj.Key != nil {
			key = *obj.Key
		}
		var lastMod time.Time
		if obj.LastModified != nil {
			lastMod = *obj.LastModified
		}
		var size int64
		if obj.Size != nil {
			size = *obj.Size
		}

		infos = append(infos, driver.ObjectInfo{
			Key:          key,
			Size:         size,
			ETag:         etag,
			LastModified: lastMod,
			StorageClass: string(obj.StorageClass),
		})
	}

	sort.Slice(infos, func(i, j int) bool {
		return infos[i].Key < infos[j].Key
	})

	prefixes := make([]string, 0, len(result.CommonPrefixes))
	for _, cp := range result.CommonPrefixes {
		if cp.Prefix != nil {
			prefixes = append(prefixes, *cp.Prefix)
		}
	}
	sort.Strings(prefixes)

	nextToken := ""
	if result.NextContinuationToken != nil {
		nextToken = *result.NextContinuationToken
	}

	return driver.NewObjectIteratorWithPrefixes(infos, prefixes, nextToken), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/s3driver && go test ./... && go vet ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: PASS, and no new lint issues.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git add drivers/s3driver/list_test.go
git commit --only -m "fix(s3driver): page with the continuation token and report common prefixes" -- drivers/s3driver/s3.go drivers/s3driver/list_test.go
git show --stat HEAD
```

The body says the cursor used to go in as `StartAfter` while `NextToken` came back as S3's opaque continuation token, so the second page was wrong, that `CommonPrefixes` was discarded, and that `WithMaxKeys(0)` asked for zero keys. The fake server pins all three in plain CI.

---

### Task 4: GCS pages with its page token and reports prefixes

**Files:**
- Modify: `drivers/gcsdriver/gcs.go` (`List`, around lines 254-318, and imports)
- Test: `drivers/gcsdriver/list_test.go` (create)

**Interfaces:**
- Consumes: `driver.NewObjectIteratorWithPrefixes` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `drivers/gcsdriver/list_test.go`:

```go
package gcsdriver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xraph/trove/driver"
)

const gcsPageOne = `{"kind":"storage#objects","prefixes":["logs/"],"items":[{"kind":"storage#object","name":"a.txt","bucket":"data","size":"3","etag":"e1","contentType":"text/plain","updated":"2026-09-30T00:00:00Z"}],"nextPageToken":"opaque-token-2"}`

const gcsPageTwo = `{"kind":"storage#objects","items":[{"kind":"storage#object","name":"z.txt","bucket":"data","size":"5","etag":"e2","contentType":"text/plain","updated":"2026-09-30T00:00:00Z"}]}`

func TestList_PagesWithPageTokenAndReportsPrefixes(t *testing.T) {
	var mu sync.Mutex
	var queries []url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/b/data/o") {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		queries = append(queries, r.URL.Query())
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("pageToken") == "opaque-token-2" {
			fmt.Fprint(w, gcsPageTwo)
			return
		}
		fmt.Fprint(w, gcsPageOne)
	}))
	t.Cleanup(srv.Close)

	drv := New()
	ctx := context.Background()
	require.NoError(t, drv.Open(ctx, "gcs://test-project/data?endpoint="+url.QueryEscape(srv.URL+"/storage/v1/")))

	it, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2))
	require.NoError(t, err)
	objects, err := it.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects, 1, "a prefix must not arrive as an empty-key object")
	assert.Equal(t, "a.txt", objects[0].Key)
	assert.Equal(t, []string{"logs/"}, it.CommonPrefixes())
	assert.Equal(t, "opaque-token-2", it.NextToken())

	it2, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2), driver.WithCursor(it.NextToken()))
	require.NoError(t, err)
	objects2, err := it2.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects2, 1)
	assert.Equal(t, "z.txt", objects2[0].Key)
	assert.Empty(t, it2.NextToken())

	mu.Lock()
	defer mu.Unlock()
	require.NotEmpty(t, queries)
	assert.Equal(t, "/", queries[0].Get("delimiter"))
	assert.Equal(t, "opaque-token-2", queries[len(queries)-1].Get("pageToken"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/gcsdriver && go test -run 'TestList_' -v ./...`
Expected: FAIL. Page one yields two objects (one with an empty key), `CommonPrefixes()` is empty, and `NextToken` is `"a.txt"` or empty rather than `opaque-token-2`. If the storage client's request path does not end in `/b/data/o` against this endpoint, log `r.URL.Path` once and adjust the fake's path match. The assertions stay.

- [ ] **Step 3: Fix the GCS `List`**

In `drivers/gcsdriver/gcs.go`, make sure `google.golang.org/api/iterator` is imported (it already is, for `iterator.Done`). Replace the body of `List` from `maxKeys := cfg.MaxKeys` to the end with:

```go
	maxKeys := cfg.MaxKeys
	if maxKeys <= 0 {
		maxKeys = 1000
	}

	// The cursor is the page token of the previous page. The pager sends it
	// as pageToken and returns the next one, so a page never re-reads the
	// objects before it.
	it := client.Bucket(bucket).Objects(ctx, query)
	pager := iterator.NewPager(it, maxKeys, cfg.Cursor)

	var page []*storage.ObjectAttrs
	nextToken, err := pager.NextPage(&page)
	if err != nil {
		if cErr := classifyErr(err, bucket, ""); cErr != nil {
			return nil, cErr
		}
		return nil, fmt.Errorf("gcsdriver: list bucket %q: %w", bucket, err)
	}

	infos := make([]driver.ObjectInfo, 0, len(page))
	var prefixes []string
	for _, attrs := range page {
		// With a delimiter, GCS returns each common prefix as an entry with
		// only Prefix set.
		if attrs.Name == "" && attrs.Prefix != "" {
			prefixes = append(prefixes, attrs.Prefix)
			continue
		}
		infos = append(infos, driver.ObjectInfo{
			Key:          attrs.Name,
			Size:         attrs.Size,
			ContentType:  attrs.ContentType,
			ETag:         attrs.Etag,
			LastModified: attrs.Updated,
			Metadata:     attrs.Metadata,
			StorageClass: attrs.StorageClass,
		})
	}

	sort.Slice(infos, func(i, j int) bool {
		return infos[i].Key < infos[j].Key
	})
	sort.Strings(prefixes)

	return driver.NewObjectIteratorWithPrefixes(infos, prefixes, nextToken), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/gcsdriver && go test ./... && go vet ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: PASS, no new lint issues.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git add drivers/gcsdriver/list_test.go
git commit --only -m "fix(gcsdriver): page with the page token and report prefixes" -- drivers/gcsdriver/gcs.go drivers/gcsdriver/list_test.go
git show --stat HEAD
```

The body says prefixes used to arrive as objects with an empty key that counted against `MaxKeys`, and each page re-streamed everything before the cursor. The fake server pins the fix in plain CI.

---

### Task 5: Azure pages with its opaque marker and reports blob prefixes

**Files:**
- Modify: `drivers/azuredriver/azure.go` (`List`, around lines 329-416)
- Test: `drivers/azuredriver/list_test.go` (create)

**Interfaces:**
- Consumes: `driver.NewObjectIteratorWithPrefixes` from Task 1.
- Produces (file-local): `func blobItemToInfo(item *container.BlobItem) driver.ObjectInfo`

- [ ] **Step 1: Write the failing test**

Create `drivers/azuredriver/list_test.go`:

```go
package azuredriver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xraph/trove/driver"
)

const azPageOne = `<?xml version="1.0" encoding="utf-8"?><EnumerationResults ServiceEndpoint="http://127.0.0.1/" ContainerName="data"><Delimiter>/</Delimiter><MaxResults>2</MaxResults><Blobs><Blob><Name>a.txt</Name><Properties><Last-Modified>Wed, 30 Sep 2026 00:00:00 GMT</Last-Modified><Etag>0x8D1</Etag><Content-Length>3</Content-Length><Content-Type>text/plain</Content-Type><BlobType>BlockBlob</BlobType></Properties></Blob><BlobPrefix><Name>logs/</Name></BlobPrefix></Blobs><NextMarker>opaque-marker-2</NextMarker></EnumerationResults>`

const azPageTwo = `<?xml version="1.0" encoding="utf-8"?><EnumerationResults ServiceEndpoint="http://127.0.0.1/" ContainerName="data"><Delimiter>/</Delimiter><MaxResults>2</MaxResults><Blobs><Blob><Name>z.txt</Name><Properties><Last-Modified>Wed, 30 Sep 2026 00:00:00 GMT</Last-Modified><Etag>0x8D2</Etag><Content-Length>5</Content-Length><Content-Type>text/plain</Content-Type><BlobType>BlockBlob</BlobType></Properties></Blob></Blobs><NextMarker/></EnumerationResults>`

func TestList_PagesWithMarkerAndReportsPrefixes(t *testing.T) {
	var mu sync.Mutex
	var queries []url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		queries = append(queries, r.URL.Query())
		mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		if r.URL.Query().Get("marker") == "opaque-marker-2" {
			fmt.Fprint(w, azPageTwo)
			return
		}
		fmt.Fprint(w, azPageOne)
	}))
	t.Cleanup(srv.Close)

	drv := New()
	ctx := context.Background()
	require.NoError(t, drv.Open(ctx, "azure://devaccount/data?endpoint="+url.QueryEscape(srv.URL)))

	it, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2))
	require.NoError(t, err)
	objects, err := it.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects, 1)
	assert.Equal(t, "a.txt", objects[0].Key)
	assert.Equal(t, []string{"logs/"}, it.CommonPrefixes())
	assert.Equal(t, "opaque-marker-2", it.NextToken())

	it2, err := drv.List(ctx, "data", driver.WithDelimiter("/"), driver.WithMaxKeys(2), driver.WithCursor(it.NextToken()))
	require.NoError(t, err)
	objects2, err := it2.All(ctx)
	require.NoError(t, err)
	require.Len(t, objects2, 1)
	assert.Equal(t, "z.txt", objects2[0].Key)
	assert.Empty(t, it2.NextToken())

	mu.Lock()
	defer mu.Unlock()
	require.Len(t, queries, 2)
	assert.Equal(t, "/", queries[0].Get("delimiter"))
	assert.Equal(t, "2", queries[0].Get("maxresults"))
	assert.Equal(t, "opaque-marker-2", queries[1].Get("marker"))
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/azuredriver && go test -run 'TestList_' -v ./...`
Expected: FAIL. The flat pager ignores the delimiter, `maxresults` is `3`, `CommonPrefixes()` is empty, and `NextToken` is a blob name. If the fake needs another response header for the SDK to accept it, add the header to the fake. The assertions stay.

- [ ] **Step 3: Fix the Azure `List`**

In `drivers/azuredriver/azure.go`, replace the whole `List` function with the function below, and add `blobItemToInfo` after it:

```go
// List returns one page of objects matching the given options. The cursor
// is the NextMarker of the previous page, passed back as Marker; it is
// opaque, never a blob name.
func (d *AzureDriver) List(ctx context.Context, bucket string, opts ...driver.ListOption) (*driver.ObjectIterator, error) {
	cfg := driver.ApplyListOptions(opts...)
	client, _, err := d.getClient()
	if err != nil {
		return nil, err
	}

	containerClient := client.ServiceClient().NewContainerClient(bucket)

	maxKeys := cfg.MaxKeys
	if maxKeys <= 0 {
		maxKeys = 1000
	}
	maxResults := int32(maxKeys)

	var prefixPtr, markerPtr *string
	if cfg.Prefix != "" {
		prefixPtr = &cfg.Prefix
	}
	if cfg.Cursor != "" {
		markerPtr = &cfg.Cursor
	}

	var (
		items    []*container.BlobItem
		prefixes []string
		next     *string
	)

	if cfg.Delimiter != "" {
		pager := containerClient.NewListBlobsHierarchyPager(cfg.Delimiter, &container.ListBlobsHierarchyOptions{
			Prefix:     prefixPtr,
			Marker:     markerPtr,
			MaxResults: &maxResults,
		})
		resp, pageErr := pager.NextPage(ctx)
		if pageErr != nil {
			return nil, d.listErr(pageErr, bucket)
		}
		items = resp.Segment.BlobItems
		for _, p := range resp.Segment.BlobPrefixes {
			if p != nil && p.Name != nil {
				prefixes = append(prefixes, *p.Name)
			}
		}
		next = resp.NextMarker
	} else {
		pager := containerClient.NewListBlobsFlatPager(&container.ListBlobsFlatOptions{
			Prefix:     prefixPtr,
			Marker:     markerPtr,
			MaxResults: &maxResults,
		})
		resp, pageErr := pager.NextPage(ctx)
		if pageErr != nil {
			return nil, d.listErr(pageErr, bucket)
		}
		items = resp.Segment.BlobItems
		next = resp.NextMarker
	}

	infos := make([]driver.ObjectInfo, 0, len(items))
	for _, item := range items {
		if item == nil || item.Name == nil {
			continue
		}
		infos = append(infos, blobItemToInfo(item))
	}

	sort.Slice(infos, func(i, j int) bool {
		return infos[i].Key < infos[j].Key
	})
	sort.Strings(prefixes)

	nextToken := ""
	if next != nil {
		nextToken = *next
	}

	return driver.NewObjectIteratorWithPrefixes(infos, prefixes, nextToken), nil
}

// listErr classifies a list failure the way every other operation does.
func (d *AzureDriver) listErr(err error, bucket string) error {
	if cErr := classifyErr(err, bucket, ""); cErr != nil {
		return cErr
	}
	return fmt.Errorf("azuredriver: list bucket %q: %w", bucket, err)
}

// blobItemToInfo maps one listed blob to the driver's object info.
func blobItemToInfo(item *container.BlobItem) driver.ObjectInfo {
	info := driver.ObjectInfo{Key: *item.Name}
	if p := item.Properties; p != nil {
		if p.ContentLength != nil {
			info.Size = *p.ContentLength
		}
		if p.ContentType != nil {
			info.ContentType = *p.ContentType
		}
		if p.ETag != nil {
			info.ETag = strings.Trim(string(*p.ETag), "\"")
		}
		if p.LastModified != nil {
			info.LastModified = *p.LastModified
		}
	}
	return info
}
```

If `time` becomes unused in `azure.go`, check other functions first; it very likely stays in use.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/drivers/azuredriver && go test ./... && go vet ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: PASS, no new lint issues.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git add drivers/azuredriver/list_test.go
git commit --only -m "fix(azuredriver): page with the opaque marker and report blob prefixes" -- drivers/azuredriver/azure.go drivers/azuredriver/list_test.go
git show --stat HEAD
```

The body says a blob name used to go in as the opaque `Marker`, which only an emulator would accept, and that the delimiter was ignored. Listing now reads one page and hands back `NextMarker`.

---

### Task 6: CAS and stream accessors for the dashboard

**Files:**
- Modify: `cas/cas.go` (after `Algorithm()`, around line 141)
- Modify: `stream/stream.go` (the `totalSize` field at line 191, its initialiser at line 227, `SetTotalSize` at 243-245, the progress block at 509-515)
- Test: `cas/cas_test.go`
- Test: `stream/stream_test.go`

**Interfaces:**
- Produces:
  - `func (c *CAS) Bucket() string`
  - `func (c *CAS) Stat(ctx context.Context, hash string) (*Entry, error)`, returning `cas.ErrNotFound` (wrapped as the index returns it) when absent
  - `func (s *Stream) TotalSize() int64`, `-1` when unknown

- [ ] **Step 1: Write the failing tests**

Append to `cas/cas_test.go` (package `cas`, so `newTestCAS` is available; check its body first for how it builds the driver and bucket):

```go
func TestCAS_Bucket(t *testing.T) {
	c := newTestCAS(t)
	assert.Equal(t, "cas", c.Bucket())

	custom := New(c.store, WithBucket("blobs"))
	assert.Equal(t, "blobs", custom.Bucket())
}

func TestCAS_StatReportsRefCountWithoutReadingContent(t *testing.T) {
	c := newTestCAS(t)
	ctx := context.Background()

	hash, _, err := c.Store(ctx, strings.NewReader("same bytes"))
	require.NoError(t, err)
	_, _, err = c.Store(ctx, strings.NewReader("same bytes"))
	require.NoError(t, err)

	entry, err := c.Stat(ctx, hash)
	require.NoError(t, err)
	assert.Equal(t, hash, entry.Hash)
	assert.Equal(t, 2, entry.RefCount)
	assert.False(t, entry.Pinned)
}

func TestCAS_StatUnknownHashIsNotFound(t *testing.T) {
	c := newTestCAS(t)
	_, err := c.Stat(context.Background(), "sha256:0000")
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestCAS_StatReturnsACopy(t *testing.T) {
	c := newTestCAS(t)
	ctx := context.Background()
	hash, _, err := c.Store(ctx, strings.NewReader("x"))
	require.NoError(t, err)

	entry, err := c.Stat(ctx, hash)
	require.NoError(t, err)
	entry.RefCount = 99

	again, err := c.Stat(ctx, hash)
	require.NoError(t, err)
	assert.Equal(t, 1, again.RefCount)
}
```

Add `"strings"` to the test file's imports if it is missing.

Append to `stream/stream_test.go`:

```go
func TestStream_TotalSizeUnknownUntilSet(t *testing.T) {
	s, _ := newTestStream(t)
	assert.Equal(t, int64(-1), s.TotalSize())

	s.SetTotalSize(4096)
	assert.Equal(t, int64(4096), s.TotalSize())
}

func TestStream_TotalSizeIsSafeUnderConcurrency(t *testing.T) {
	s, _ := newTestStream(t)
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(2)
		go func() { defer wg.Done(); s.SetTotalSize(int64(i)) }()
		go func() { defer wg.Done(); _ = s.TotalSize() }()
	}
	wg.Wait()
}
```

Add `"sync"` to the stream test imports if it is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && go test ./cas/ ./stream/ 2>&1 | tail -10`
Expected: FAIL to compile with `c.Bucket undefined`, `c.Stat undefined`, `s.TotalSize undefined`.

- [ ] **Step 3: Add the CAS accessors**

In `cas/cas.go`, after `Algorithm()`:

```go
// Bucket returns the bucket this CAS stores content in.
func (c *CAS) Bucket() string {
	return c.bucket
}

// Stat returns the index entry for a hash without reading its content.
//
// It returns ErrNotFound when the index has no entry. With the default
// in-memory index that includes content still present in the bucket after
// a restart, because the index does not survive one.
func (c *CAS) Stat(ctx context.Context, hash string) (*Entry, error) {
	entry, err := c.index.Get(ctx, hash)
	if err != nil {
		return nil, err
	}
	cp := *entry
	return &cp, nil
}
```

- [ ] **Step 4: Make the stream's total size atomic and readable**

In `stream/stream.go`:

1. Change the field `totalSize int64` to `totalSize atomic.Int64`. `sync/atomic` is already imported (the offset uses `atomic.Int64`).
2. Remove `totalSize: -1, // unknown until set` from the struct literal in `NewStream`, and add `s.totalSize.Store(-1) // unknown until set` directly after the literal, before any use of `s`.
3. Replace `SetTotalSize` and add the getter:

```go
// SetTotalSize sets the expected total size of the transfer. This enables
// percentage-based progress reporting.
func (s *Stream) SetTotalSize(n int64) {
	s.totalSize.Store(n)
}

// TotalSize returns the expected total size of the transfer, or -1 when
// nobody has set it.
func (s *Stream) TotalSize() int64 {
	return s.totalSize.Load()
}
```

4. In the progress block, read the value once:

```go
	total := s.totalSize.Load()
	p := Progress{
		StreamID:  s.ID,
		BytesSent: sent,
		BytesRecv: recv,
		TotalSize: total,
		Speed:     s.metrics.Throughput(),
	}

	if total > 0 {
		done := sent + recv
		p.Percent = int(done * 100 / total)
		if p.Percent > 100 {
			p.Percent = 100
		}
	}
```

(The original named the running sum `total`; it is renamed `done` here so it does not shadow the size.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && go test -race ./cas/ ./stream/ && go test ./...`
Expected: PASS, including under `-race`.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
git commit --only -m "feat(cas,stream): expose the CAS bucket, index entries and a stream's total size" -- cas/cas.go cas/cas_test.go stream/stream.go stream/stream_test.go
git show --stat HEAD
```

The body says the dashboard needs to read a CAS entry's refcount and pin without fetching content, and a stream's expected size. It also says `Stat` is honest about the in-memory index forgetting everything on restart, and that the total size is now atomic because the pool reads it from another goroutine.

---

### Task 7: Whole-repo verification

**Files:** none new.

- [ ] **Step 1: Build, vet and test every module**

Run:
```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
go build ./... && go vet ./... && go test -race -count=1 ./...
for m in drivers/s3driver drivers/gcsdriver drivers/azuredriver drivers/sftpdriver extension bench; do
  (cd "$m" && echo "== $m" && go build ./... && go vet ./... && go test -count=1 ./...) || echo "FAILED: $m"
done
```
Expected: every module builds, vets and passes. `extension` and `bench` depend on the root through `replace` and must still compile. `drivers/sftpdriver` has no non-integration List coverage beyond compiling, and that is expected.

- [ ] **Step 2: Lint every module you touched, each with a fresh cache**

Run:
```bash
cd /Users/rexraphael/Work/xraph/forgery/trove
for m in . drivers/s3driver drivers/gcsdriver drivers/azuredriver drivers/sftpdriver; do
  (cd "$m" && echo "== $m" && C=$(mktemp -d) && GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf "$C")
done
```
Expected: no issues in any line this slice changed. If lint reports issues in lines you did not touch, note them and leave them.

- [ ] **Step 3: Check nothing else crept in**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove && git status --short && git log --oneline -6`
Expected: six commits from this slice (Tasks 1 to 6), each touching only the paths listed in its task, and no uncommitted changes of yours. Anything else in `git status` belongs to another session: leave it alone.

- [ ] **Step 4: Record what slice 1 found**

Append a section `## What slice 1 found that slice 2 must know` to the spec (`docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md` in forge-dashboard), covering anything that differed from this plan: SDK response shapes the fakes needed, any driver behaviour that surprised you, lint issues left in untouched code. Commit it with `git commit --only` on that one path. The spec is force-tracked (`/docs/` is in `.gitignore`), so a plain `git commit --only -- <path>` works once the file is already tracked.
