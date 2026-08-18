package repository_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/vega-resume/server/internal/model"
	"github.com/vega-resume/server/internal/repository"
)

func TestUserRepositoryEnforcesActiveUniqueEmailAndUsername(t *testing.T) {
	ctx := context.Background()
	store := repository.NewMemoryStore()

	user := &model.User{
		ID:              uuid.New(),
		Username:        "zhangsan",
		Email:           "User@Example.com",
		EmailNormalized: "user@example.com",
		PasswordHash:    "hash",
	}
	if err := store.CreateUser(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}

	_, err := store.FindActiveUserByEmailNormalized(ctx, "user@example.com")
	if err != nil {
		t.Fatalf("lookup normalized email: %v", err)
	}

	err = store.CreateUser(ctx, &model.User{
		ID:              uuid.New(),
		Username:        "lisi",
		Email:           "USER@example.com",
		EmailNormalized: "user@example.com",
		PasswordHash:    "hash",
	})
	if !errors.Is(err, repository.ErrDuplicateEmail) {
		t.Fatalf("expected duplicate email, got %v", err)
	}

	err = store.CreateUser(ctx, &model.User{
		ID:              uuid.New(),
		Username:        "zhangsan",
		Email:           "other@example.com",
		EmailNormalized: "other@example.com",
		PasswordHash:    "hash",
	})
	if !errors.Is(err, repository.ErrDuplicateUsername) {
		t.Fatalf("expected duplicate username, got %v", err)
	}
}

func TestRefreshTokenRepositoryLookupRevokeAndReplacement(t *testing.T) {
	ctx := context.Background()
	store := repository.NewMemoryStore()
	userID := uuid.New()
	oldID := uuid.New()
	newID := uuid.New()

	oldToken := &model.RefreshToken{
		ID:        oldID,
		UserID:    userID,
		TokenHash: "old-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.CreateRefreshToken(ctx, oldToken); err != nil {
		t.Fatalf("create old token: %v", err)
	}
	if _, err := store.FindActiveRefreshTokenByHash(ctx, "old-hash"); err != nil {
		t.Fatalf("lookup old token: %v", err)
	}

	replacement := &model.RefreshToken{
		ID:        newID,
		UserID:    userID,
		TokenHash: "new-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.CreateRefreshToken(ctx, replacement); err != nil {
		t.Fatalf("create replacement token: %v", err)
	}
	if err := store.RevokeRefreshToken(ctx, oldID, &newID, time.Now()); err != nil {
		t.Fatalf("revoke old token: %v", err)
	}

	_, err := store.FindActiveRefreshTokenByHash(ctx, "old-hash")
	if !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("expected revoked token lookup to miss, got %v", err)
	}
	if _, err := store.FindActiveRefreshTokenByHash(ctx, "new-hash"); err != nil {
		t.Fatalf("replacement token should be active: %v", err)
	}
}

func TestMemoryRefreshTokenRotationIsAtomic(t *testing.T) {
	ctx := context.Background()
	store := repository.NewMemoryStore()
	userID := uuid.New()
	oldToken := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    userID,
		TokenHash: "shared-old-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.CreateRefreshToken(ctx, oldToken); err != nil {
		t.Fatalf("create old token: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	for i := 0; i < 2; i++ {
		replacement := &model.RefreshToken{
			ID:        uuid.New(),
			UserID:    userID,
			TokenHash: "replacement-" + uuid.NewString(),
			ExpiresAt: time.Now().Add(time.Hour),
		}
		go func() {
			ready.Done()
			<-start
			results <- store.RotateRefreshToken(ctx, oldToken.ID, replacement, time.Now())
		}()
	}
	ready.Wait()
	close(start)

	successes := 0
	notFound := 0
	for i := 0; i < 2; i++ {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, repository.ErrNotFound):
			notFound++
		default:
			t.Fatalf("unexpected rotation error: %v", err)
		}
	}
	if successes != 1 || notFound != 1 {
		t.Fatalf("expected one success and one consumed-token failure, got success=%d notFound=%d", successes, notFound)
	}
}

func TestGormMigrationDefinesAuthPersistenceConstraints(t *testing.T) {
	db := openTestGormStore(t)
	migrator := db.Migrator()

	for _, table := range []any{
		&model.User{},
		&model.RegistrationEmailVerification{},
		&model.RegistrationInvitation{},
		&model.RefreshToken{},
		&model.Resume{},
	} {
		if !migrator.HasTable(table) {
			t.Fatalf("expected table for %T", table)
		}
	}
	for _, index := range []string{
		"users_email_active_uidx",
		"users_username_active_uidx",
		"registration_email_verifications_email_active_uidx",
		"idx_registration_invitations_code_hash",
		"idx_refresh_tokens_token_hash",
		"idx_refresh_tokens_user_id",
		"idx_resumes_user_updated",
		"idx_resumes_user_status",
	} {
		if !migrator.HasIndex(&model.RefreshToken{}, index) &&
			!migrator.HasIndex(&model.User{}, index) &&
			!migrator.HasIndex(&model.RegistrationEmailVerification{}, index) &&
			!migrator.HasIndex(&model.RegistrationInvitation{}, index) &&
			!migrator.HasIndex(&model.Resume{}, index) {
			t.Fatalf("expected migrated index %q", index)
		}
	}
}

func TestRegistrationInvitationRepositoriesConsumeWithUserTransaction(t *testing.T) {
	type invitationRegistrationStore interface {
		repository.UserRepository
		repository.RegistrationEmailVerificationRepository
		repository.RegistrationInvitationRepository
	}
	testCases := []struct {
		name  string
		store func(t *testing.T) invitationRegistrationStore
	}{
		{
			name: "memory",
			store: func(_ *testing.T) invitationRegistrationStore {
				return repository.NewMemoryStore()
			},
		},
		{
			name: "gorm sqlite",
			store: func(t *testing.T) invitationRegistrationStore {
				return repository.NewGormStore(openTestGormStore(t))
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			store := testCase.store(t)
			now := time.Now().UTC()
			invitation := &model.RegistrationInvitation{
				ID: uuid.New(), CodeHash: strings.Repeat("b", 64),
				ExpiresAt: now.Add(30 * time.Minute), CreatedAt: now,
			}
			if err := store.CreateRegistrationInvitation(ctx, invitation); err != nil {
				t.Fatalf("create invitation: %v", err)
			}
			found, err := store.FindActiveRegistrationInvitationByCodeHash(
				ctx,
				invitation.CodeHash,
				now,
			)
			if err != nil || found.ID != invitation.ID {
				t.Fatalf("find invitation: found=%+v err=%v", found, err)
			}

			firstChallenge := createRegistrationChallenge(t, ctx, store, "first@example.com", now)
			firstUser := verifiedUserForChallenge(firstChallenge, "first-user", now)
			if err := store.CreateVerifiedUser(
				ctx,
				firstChallenge.ID,
				&invitation.ID,
				firstUser,
				now,
			); err != nil {
				t.Fatalf("consume invitation with user: %v", err)
			}
			if _, err := store.FindActiveRegistrationInvitationByCodeHash(
				ctx,
				invitation.CodeHash,
				now,
			); !errors.Is(err, repository.ErrNotFound) {
				t.Fatalf("consumed invitation must be inactive, got %v", err)
			}

			secondChallenge := createRegistrationChallenge(t, ctx, store, "second@example.com", now)
			secondUser := verifiedUserForChallenge(secondChallenge, "second-user", now)
			if err := store.CreateVerifiedUser(
				ctx,
				secondChallenge.ID,
				&invitation.ID,
				secondUser,
				now,
			); !errors.Is(err, repository.ErrInvitationInvalid) {
				t.Fatalf("reused invitation should fail, got %v", err)
			}
			if _, err := store.FindActiveRegistrationEmailVerification(
				ctx,
				secondChallenge.EmailNormalized,
			); err != nil {
				t.Fatalf("failed transaction must preserve email challenge: %v", err)
			}
			if _, err := store.FindActiveUserByEmailNormalized(
				ctx,
				secondChallenge.EmailNormalized,
			); !errors.Is(err, repository.ErrNotFound) {
				t.Fatalf("failed transaction must not create user, got %v", err)
			}
		})
	}
}

func createRegistrationChallenge(
	t *testing.T,
	ctx context.Context,
	store repository.RegistrationEmailVerificationRepository,
	email string,
	now time.Time,
) *model.RegistrationEmailVerification {
	t.Helper()
	challenge := &model.RegistrationEmailVerification{
		ID:              uuid.New(),
		Email:           email,
		EmailNormalized: email,
		CodeMAC:         strings.Repeat("a", 64),
		ExpiresAt:       now.Add(10 * time.Minute),
		CreatedAt:       now,
	}
	if err := store.ReplaceRegistrationEmailVerification(ctx, challenge, now); err != nil {
		t.Fatalf("create registration challenge: %v", err)
	}
	if err := store.MarkRegistrationEmailVerificationSent(ctx, challenge.ID, now); err != nil {
		t.Fatalf("mark registration challenge sent: %v", err)
	}
	return challenge
}

func verifiedUserForChallenge(
	challenge *model.RegistrationEmailVerification,
	username string,
	now time.Time,
) *model.User {
	return &model.User{
		ID:              uuid.New(),
		Username:        username,
		Email:           challenge.Email,
		EmailNormalized: challenge.EmailNormalized,
		PasswordHash:    "hash",
		EmailVerifiedAt: &now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}

func TestGormRepositoryPersistsAuthRecords(t *testing.T) {
	ctx := context.Background()
	db := openTestGormStore(t)
	store := repository.NewGormStore(db)

	user := &model.User{
		ID:              uuid.New(),
		Username:        "wangwu",
		Email:           "Wangwu@Example.com",
		EmailNormalized: "wangwu@example.com",
		PasswordHash:    "hash",
	}
	if err := store.CreateUser(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}
	found, err := store.FindActiveUserByEmailNormalized(ctx, "wangwu@example.com")
	if err != nil {
		t.Fatalf("lookup user: %v", err)
	}
	if found.ID != user.ID || found.Username != "wangwu" {
		t.Fatalf("unexpected user: %+v", found)
	}

	if err := store.CreateUser(ctx, &model.User{
		ID:              uuid.New(),
		Username:        "other",
		Email:           "other@example.com",
		EmailNormalized: "wangwu@example.com",
		PasswordHash:    "hash",
	}); !errors.Is(err, repository.ErrDuplicateEmail) {
		t.Fatalf("expected duplicate email, got %v", err)
	}

	oldToken := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: "gorm-old-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.CreateRefreshToken(ctx, oldToken); err != nil {
		t.Fatalf("create token: %v", err)
	}
	newID := uuid.New()
	if err := store.RevokeRefreshToken(ctx, oldToken.ID, &newID, time.Now()); err != nil {
		t.Fatalf("revoke token: %v", err)
	}
	if _, err := store.FindActiveRefreshTokenByHash(ctx, "gorm-old-hash"); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("expected revoked token lookup to miss, got %v", err)
	}
}

func TestGormRegistrationVerificationCreatesUserAtomically(t *testing.T) {
	ctx := context.Background()
	db := openTestGormStore(t)
	store := repository.NewGormStore(db)
	now := time.Now().UTC()
	challenge := &model.RegistrationEmailVerification{
		ID:              uuid.New(),
		Email:           "User@Example.com",
		EmailNormalized: "user@example.com",
		CodeMAC:         strings.Repeat("a", 64),
		ExpiresAt:       now.Add(10 * time.Minute),
		CreatedAt:       now,
	}
	if err := store.ReplaceRegistrationEmailVerification(ctx, challenge, now); err != nil {
		t.Fatalf("create registration verification: %v", err)
	}
	if err := store.MarkRegistrationEmailVerificationSent(ctx, challenge.ID, now); err != nil {
		t.Fatalf("mark registration verification sent: %v", err)
	}

	verifiedAt := now.Add(time.Second)
	user := &model.User{
		ID:              uuid.New(),
		Username:        "zhangsan",
		Email:           challenge.Email,
		EmailNormalized: challenge.EmailNormalized,
		PasswordHash:    "hash",
		EmailVerifiedAt: &verifiedAt,
		CreatedAt:       verifiedAt,
		UpdatedAt:       verifiedAt,
	}
	if err := store.CreateVerifiedUser(ctx, challenge.ID, nil, user, verifiedAt); err != nil {
		t.Fatalf("create verified user: %v", err)
	}
	if _, err := store.FindActiveUserByEmailNormalized(ctx, challenge.EmailNormalized); err != nil {
		t.Fatalf("find created user: %v", err)
	}
	if _, err := store.FindActiveRegistrationEmailVerification(
		ctx,
		challenge.EmailNormalized,
	); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("consumed challenge must not remain active, got %v", err)
	}
	if err := store.CreateVerifiedUser(ctx, challenge.ID, nil, &model.User{
		ID:              uuid.New(),
		Username:        "lisi",
		Email:           challenge.Email,
		EmailNormalized: challenge.EmailNormalized,
		PasswordHash:    "hash",
	}, verifiedAt); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("consumed challenge must not create another user, got %v", err)
	}
}

func TestGormRepositoryPersistsAndListsResumes(t *testing.T) {
	ctx := context.Background()
	db := openTestGormStore(t)
	store := repository.NewGormStore(db)
	userID := uuid.New()
	now := time.Now().UTC()
	resume := &model.Resume{
		ID:             uuid.New(),
		UserID:         userID,
		Title:          "Frontend 100% Resume",
		Status:         model.ResumeStatusCompleted,
		ContentVersion: 1,
		ContentJSON:    model.JSONDocument(`{"profile":{"name":"Vega"}}`),
		ExportCount:    3,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := store.CreateResume(ctx, resume); err != nil {
		t.Fatalf("create resume: %v", err)
	}

	found, err := store.FindResumeByID(ctx, userID, resume.ID)
	if err != nil {
		t.Fatalf("find resume: %v", err)
	}
	if string(found.ContentJSON) != string(resume.ContentJSON) {
		t.Fatalf("unexpected content: %s", found.ContentJSON)
	}

	items, total, err := store.ListResumes(ctx, userID, repository.ResumeListOptions{
		Query: "100%", Status: model.ResumeStatusCompleted, Sort: "updated_desc", Limit: 6,
	})
	if err != nil {
		t.Fatalf("list resumes: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != resume.ID {
		t.Fatalf("unexpected resume list: total=%d items=%+v", total, items)
	}

	stats, err := store.GetResumeStats(ctx, userID)
	if err != nil {
		t.Fatalf("get resume stats: %v", err)
	}
	if stats.Total != 1 || stats.Completed != 1 || stats.Draft != 0 || stats.Exported != 3 {
		t.Fatalf("unexpected resume stats: %+v", stats)
	}

	if _, err := store.FindResumeByID(ctx, uuid.New(), resume.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("expected cross-user lookup to miss, got %v", err)
	}
}

func TestGormRefreshTokenRotationIsAtomic(t *testing.T) {
	ctx := context.Background()
	db := openTestGormStore(t)
	store := repository.NewGormStore(db)
	user := &model.User{
		ID:              uuid.New(),
		Username:        "rotate-user",
		Email:           "rotate@example.com",
		EmailNormalized: "rotate@example.com",
		PasswordHash:    "hash",
	}
	if err := store.CreateUser(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}

	oldToken := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: "gorm-shared-old-hash",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.CreateRefreshToken(ctx, oldToken); err != nil {
		t.Fatalf("create old token: %v", err)
	}

	firstReplacement := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: "gorm-first-replacement",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.RotateRefreshToken(ctx, oldToken.ID, firstReplacement, time.Now()); err != nil {
		t.Fatalf("rotate token: %v", err)
	}

	secondReplacement := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: "gorm-second-replacement",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := store.RotateRefreshToken(ctx, oldToken.ID, secondReplacement, time.Now()); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("expected consumed old token, got %v", err)
	}
	if _, err := store.FindActiveRefreshTokenByHash(ctx, secondReplacement.TokenHash); !errors.Is(err, repository.ErrNotFound) {
		t.Fatalf("failed rotation must roll back replacement insert, got %v", err)
	}
	if _, err := store.FindActiveRefreshTokenByHash(ctx, firstReplacement.TokenHash); err != nil {
		t.Fatalf("successful replacement should remain active: %v", err)
	}
}

func openTestGormStore(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repository.Migrate(ctxWithTestTimeout(t), db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestResumeMigrationIncludesSchoolLogoKey(t *testing.T) {
	db := openTestGormStore(t)
	if !db.Migrator().HasColumn(&model.Resume{}, "school_logo_key") {
		t.Fatal("resumes.school_logo_key was not migrated")
	}
}

func ctxWithTestTimeout(t *testing.T) context.Context {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}
