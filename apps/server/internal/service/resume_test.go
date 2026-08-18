package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
	"github.com/vega-resume/server/internal/repository"
	"github.com/vega-resume/server/internal/service"
)

func TestResumeServiceLifecycleAndOwnership(t *testing.T) {
	ctx := context.Background()
	store := repository.NewMemoryStore()
	now := time.Date(2026, 7, 21, 10, 0, 0, 0, time.UTC)
	resumes := service.NewResumeService(service.ResumeServiceConfig{
		Resumes: store,
		Now:     func() time.Time { return now },
	})
	ownerID := uuid.New()
	otherUserID := uuid.New()

	created, err := resumes.Create(ctx, ownerID, "  产品经理简历  ")
	if err != nil {
		t.Fatalf("create resume: %v", err)
	}
	if created.Title != "产品经理简历" || created.Status != model.ResumeStatusDraft {
		t.Fatalf("unexpected created resume: %+v", created)
	}
	if created.ContentVersion != 4 || created.TemplateID == nil || *created.TemplateID != "left" {
		t.Fatalf("new resumes must use v4 left alignment, got %+v", created)
	}
	if _, err := resumes.Get(ctx, otherUserID, created.ID); !errors.Is(err, model.ErrResumeNotFound) {
		t.Fatalf("cross-user read must look missing, got %v", err)
	}

	completed := model.ResumeStatusCompleted
	newTitle := "高级产品经理简历"
	updated, err := resumes.Update(ctx, ownerID, created.ID, service.UpdateResumeInput{
		ExpectedRevision: created.Revision, Title: &newTitle, Status: &completed,
	})
	if err != nil {
		t.Fatalf("update resume: %v", err)
	}
	if updated.Title != newTitle || updated.Status != completed {
		t.Fatalf("unexpected updated resume: %+v", updated)
	}

	copied, err := resumes.Copy(ctx, ownerID, created.ID)
	if err != nil {
		t.Fatalf("copy resume: %v", err)
	}
	if copied.Status != model.ResumeStatusDraft || copied.Title != newTitle+" - 副本" {
		t.Fatalf("unexpected copied resume: %+v", copied)
	}

	items, total, err := resumes.List(ctx, ownerID, service.ListResumesInput{
		Query: "高级", Status: model.ResumeStatusDraft, Sort: "title_asc", Page: 1, PageSize: 6,
	})
	if err != nil {
		t.Fatalf("list resumes: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != copied.ID {
		t.Fatalf("unexpected filtered list total=%d items=%+v", total, items)
	}

	stats, err := resumes.Stats(ctx, ownerID)
	if err != nil {
		t.Fatalf("resume stats: %v", err)
	}
	if stats.Total != 2 || stats.Draft != 1 || stats.Completed != 1 {
		t.Fatalf("unexpected stats: %+v", stats)
	}

	if err := resumes.Delete(ctx, ownerID, created.ID); err != nil {
		t.Fatalf("delete resume: %v", err)
	}
	if _, err := resumes.Get(ctx, ownerID, created.ID); !errors.Is(err, model.ErrResumeNotFound) {
		t.Fatalf("deleted resume must look missing, got %v", err)
	}
}

func TestResumeServiceRejectsStaleRevisionAndCountsExports(t *testing.T) {
	ctx := context.Background()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: repository.NewMemoryStore()})
	userID := uuid.New()
	created, err := resumes.Create(ctx, userID, "Revision")
	if err != nil {
		t.Fatalf("create resume: %v", err)
	}
	title := "Updated"
	if _, err := resumes.Update(ctx, userID, created.ID, service.UpdateResumeInput{ExpectedRevision: created.Revision, Title: &title}); err != nil {
		t.Fatalf("first update: %v", err)
	}
	if _, err := resumes.Update(ctx, userID, created.ID, service.UpdateResumeInput{ExpectedRevision: created.Revision, Title: &title}); !errors.Is(err, model.ErrResumeConflict) {
		t.Fatalf("stale update should conflict, got %v", err)
	}
	exported, err := resumes.RecordExport(ctx, userID, created.ID)
	if err != nil || exported.ExportCount != 1 {
		t.Fatalf("record export: resume=%+v err=%v", exported, err)
	}
}

func TestResumeServiceAvatarIsolationCopyAndCleanup(t *testing.T) {
	ctx := context.Background()
	avatarDir := t.TempDir()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: repository.NewMemoryStore(), AvatarDir: avatarDir})
	ownerID, otherID := uuid.New(), uuid.New()
	created, err := resumes.Create(ctx, ownerID, "Avatar")
	if err != nil {
		t.Fatalf("create resume: %v", err)
	}
	avatar := jpegAvatar(t, service.AvatarWidth, service.AvatarHeight)
	withAvatar, err := resumes.PutAvatar(ctx, ownerID, created.ID, avatar)
	if err != nil || withAvatar.AvatarKey == nil {
		t.Fatalf("put avatar: resume=%+v err=%v", withAvatar, err)
	}
	if _, err := resumes.GetAvatar(ctx, otherID, created.ID); !errors.Is(err, model.ErrResumeNotFound) {
		t.Fatalf("cross-user avatar must look missing, got %v", err)
	}
	copied, err := resumes.Copy(ctx, ownerID, created.ID)
	if err != nil || copied.AvatarKey == nil {
		t.Fatalf("copy avatar: resume=%+v err=%v", copied, err)
	}
	if copiedAvatar, err := resumes.GetAvatar(ctx, ownerID, copied.ID); err != nil || !bytes.Equal(copiedAvatar, avatar) {
		t.Fatalf("copied avatar mismatch: len=%d err=%v", len(copiedAvatar), err)
	}
	originalPath := avatarDir + "/" + *withAvatar.AvatarKey
	if err := resumes.Delete(ctx, ownerID, created.ID); err != nil {
		t.Fatalf("delete resume: %v", err)
	}
	if _, err := os.Stat(originalPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("avatar file should be removed, stat err=%v", err)
	}
	if _, err := resumes.PutAvatar(ctx, ownerID, copied.ID, jpegAvatar(t, 300, 300)); !errors.Is(err, model.ErrAvatarInvalid) {
		t.Fatalf("non-500x700 avatar should be rejected, got %v", err)
	}
}

func jpegAvatar(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.Set(x, y, color.RGBA{R: 132, G: 4, B: 119, A: 255})
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, canvas, &jpeg.Options{Quality: 82}); err != nil {
		t.Fatalf("encode avatar: %v", err)
	}
	return output.Bytes()
}

func TestResumeServiceSchoolLogoIsolationCopyAndCleanup(t *testing.T) {
	ctx := context.Background()
	assetDir := t.TempDir()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: repository.NewMemoryStore(), AvatarDir: assetDir})
	ownerID, otherID := uuid.New(), uuid.New()
	created, err := resumes.Create(ctx, ownerID, "School logo")
	if err != nil {
		t.Fatalf("create resume: %v", err)
	}
	logo := pngSchoolLogo(t, service.SchoolLogoWidth, service.SchoolLogoHeight)
	withLogo, err := resumes.PutSchoolLogo(ctx, ownerID, created.ID, logo)
	if err != nil || withLogo.SchoolLogoKey == nil {
		t.Fatalf("put school logo: resume=%+v err=%v", withLogo, err)
	}
	if _, err := resumes.GetSchoolLogo(ctx, otherID, created.ID); !errors.Is(err, model.ErrResumeNotFound) {
		t.Fatalf("cross-user school logo must look missing, got %v", err)
	}
	copied, err := resumes.Copy(ctx, ownerID, created.ID)
	if err != nil || copied.SchoolLogoKey == nil {
		t.Fatalf("copy school logo: resume=%+v err=%v", copied, err)
	}
	if copiedLogo, err := resumes.GetSchoolLogo(ctx, ownerID, copied.ID); err != nil || !bytes.Equal(copiedLogo, logo) {
		t.Fatalf("copied school logo mismatch: len=%d err=%v", len(copiedLogo), err)
	}
	originalPath := filepath.Join(assetDir, filepath.FromSlash(*withLogo.SchoolLogoKey))
	if err := resumes.Delete(ctx, ownerID, created.ID); err != nil {
		t.Fatalf("delete resume: %v", err)
	}
	if _, err := os.Stat(originalPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("school logo file should be removed, stat err=%v", err)
	}
	if _, err := resumes.PutSchoolLogo(ctx, ownerID, copied.ID, pngSchoolLogo(t, 300, 300)); !errors.Is(err, model.ErrSchoolLogoInvalid) {
		t.Fatalf("non-500x500 school logo should be rejected, got %v", err)
	}
}

func pngSchoolLogo(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.Set(x, y, color.RGBA{R: 132, G: 4, B: 119, A: 128})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		t.Fatalf("encode school logo: %v", err)
	}
	return output.Bytes()
}

func TestResumeServiceImportsAndMigratesVersionedContent(t *testing.T) {
	store := repository.NewMemoryStore()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: store})
	userID := uuid.New()

	imported, err := resumes.Import(context.Background(), userID, service.ImportResumeInput{
		Version: 4, Title: "导入简历", Content: service.DefaultResumeContent(),
	})
	if err != nil {
		t.Fatalf("import resume: %v", err)
	}
	if imported.ContentVersion != 4 || string(imported.ContentJSON) == "{}" {
		t.Fatalf("opaque content was not preserved: %+v", imported)
	}

	v2 := service.DefaultResumeContent()
	delete(v2["profile"].(map[string]any), "enabled")
	delete(v2["formatting"].(map[string]any), "entryGapPx")
	classic := "classic-professional"
	migrated, err := resumes.Import(context.Background(), userID, service.ImportResumeInput{
		Version: 2, Title: "旧版导入", TemplateID: &classic, Content: v2,
	})
	if err != nil {
		t.Fatalf("import v2 resume: %v", err)
	}
	if migrated.ContentVersion != 4 || migrated.TemplateID == nil || *migrated.TemplateID != "center" {
		t.Fatalf("v2 import should persist canonical v4: %+v", migrated)
	}
	var migratedContent map[string]any
	if err := json.Unmarshal(migrated.ContentJSON, &migratedContent); err != nil {
		t.Fatalf("decode migrated content: %v", err)
	}
	if got := migratedContent["formatting"].(map[string]any)["entryGapPx"]; got != float64(14) {
		t.Fatalf("v2 entry gap migration mismatch: %v", got)
	}
	if _, err := resumes.Import(context.Background(), userID, service.ImportResumeInput{Version: 1, Title: "旧版本", Content: service.DefaultResumeContent()}); !errors.Is(err, model.ErrResumeInvalidSchema) {
		t.Fatalf("expected unsupported version error, got %v", err)
	}
}

func TestResumeServiceReadsV2LazilyAndUpgradesOnCopy(t *testing.T) {
	ctx := context.Background()
	store := repository.NewMemoryStore()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: store})
	userID := uuid.New()
	v2 := service.DefaultResumeContent()
	delete(v2["profile"].(map[string]any), "enabled")
	delete(v2["formatting"].(map[string]any), "entryGapPx")
	raw, err := json.Marshal(v2)
	if err != nil {
		t.Fatalf("marshal v2 content: %v", err)
	}
	classic := "classic-professional"
	legacy := &model.Resume{
		ID: uuid.New(), UserID: userID, Title: "v2", Status: model.ResumeStatusDraft,
		TemplateID: &classic, ContentVersion: 2, ContentJSON: raw, Revision: 1,
	}
	if err := store.CreateResume(ctx, legacy); err != nil {
		t.Fatalf("seed v2 resume: %v", err)
	}

	read, err := resumes.Get(ctx, userID, legacy.ID)
	if err != nil || read.ContentVersion != 2 || *read.TemplateID != classic {
		t.Fatalf("ordinary read must not persist migration: resume=%+v err=%v", read, err)
	}
	copied, err := resumes.Copy(ctx, userID, legacy.ID)
	if err != nil {
		t.Fatalf("copy v2 resume: %v", err)
	}
	if copied.ContentVersion != 4 || copied.TemplateID == nil || *copied.TemplateID != "center" {
		t.Fatalf("copy should persist canonical v4: %+v", copied)
	}
}

func TestResumeServiceRejectsLegacyResumeUpdates(t *testing.T) {
	store := repository.NewMemoryStore()
	resumes := service.NewResumeService(service.ResumeServiceConfig{Resumes: store})
	userID := uuid.New()
	legacy := &model.Resume{
		ID: uuid.New(), UserID: userID, Title: "旧简历", Status: model.ResumeStatusDraft,
		ContentVersion: 1, ContentJSON: model.JSONDocument(`{}`), Revision: 1,
	}
	if err := store.CreateResume(context.Background(), legacy); err != nil {
		t.Fatalf("create legacy resume: %v", err)
	}
	title := "不能更新"
	if _, err := resumes.Update(context.Background(), userID, legacy.ID, service.UpdateResumeInput{
		ExpectedRevision: 1,
		Title:            &title,
	}); !errors.Is(err, model.ErrResumeInvalidSchema) {
		t.Fatalf("expected legacy format error, got %v", err)
	}
}
