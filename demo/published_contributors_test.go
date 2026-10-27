package main

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
)

func TestPublishedContributorsRegister(t *testing.T) {
	t.Run("streaming", func(t *testing.T) {
		if ok, detail := checkRealStreamingManifest(); !ok {
			t.Fatalf("installed streaming contract: %s", detail)
		}
	})
	t.Run("authsome", func(t *testing.T) {
		ext, err := newRealAuthsomeExtension()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := ext.Stop(ctx); err != nil {
				t.Error(err)
			}
		})
		if ext.engine.PlatformAppID().IsNil() {
			t.Fatal("platform bootstrap missing")
		}
		plaintext := []byte("fixture-token")
		ciphertext, err := ext.engine.TokenEncryptor().Encrypt(plaintext)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(ciphertext, plaintext) {
			t.Fatal("token encryptor left plaintext unchanged")
		}
		decrypted, err := ext.engine.TokenEncryptor().Decrypt(ciphertext)
		if err != nil || !bytes.Equal(decrypted, plaintext) {
			t.Fatalf("token encryption round trip failed: %v", err)
		}
		if err := ext.RegisterContractContributor(dispatcher.New(nil), contract.NewRegistry(), contract.NewWardenRegistry()); err != nil {
			t.Fatal(err)
		}
	})
}
