package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
)

var (
	ErrNotFound          = errors.New("repository: not found")
	ErrConflict          = errors.New("repository: revision conflict")
	ErrDuplicateEmail    = errors.New("repository: duplicate email")
	ErrDuplicateUsername = errors.New("repository: duplicate username")
	ErrInvitationInvalid = errors.New("repository: invitation invalid")
)

type UserRepository interface {
	CreateUser(ctx context.Context, user *model.User) error
	FindActiveUserByID(ctx context.Context, id uuid.UUID) (*model.User, error)
	FindActiveUserByEmailNormalized(ctx context.Context, emailNormalized string) (*model.User, error)
	FindActiveUserByUsername(ctx context.Context, username string) (*model.User, error)
}

type EmailVerificationRepository interface {
	ReplaceEmailVerificationChallenge(
		ctx context.Context,
		challenge *model.EmailVerificationChallenge,
		invalidatedAt time.Time,
	) error
	FindActiveEmailVerificationChallengeByUserID(
		ctx context.Context,
		userID uuid.UUID,
	) (*model.EmailVerificationChallenge, error)
	IncrementEmailVerificationFailures(ctx context.Context, id uuid.UUID) (int, error)
	MarkEmailVerificationSent(ctx context.Context, id uuid.UUID, sentAt time.Time) error
	ConsumeEmailVerificationChallenge(
		ctx context.Context,
		challengeID, userID uuid.UUID,
		consumedAt time.Time,
	) error
	InvalidateEmailVerificationChallenge(ctx context.Context, id uuid.UUID, invalidatedAt time.Time) error
}

type RegistrationEmailVerificationRepository interface {
	ReplaceRegistrationEmailVerification(
		ctx context.Context,
		challenge *model.RegistrationEmailVerification,
		invalidatedAt time.Time,
	) error
	FindActiveRegistrationEmailVerification(
		ctx context.Context,
		emailNormalized string,
	) (*model.RegistrationEmailVerification, error)
	IncrementRegistrationEmailVerificationFailures(ctx context.Context, id uuid.UUID) (int, error)
	MarkRegistrationEmailVerificationSent(ctx context.Context, id uuid.UUID, sentAt time.Time) error
	InvalidateRegistrationEmailVerification(ctx context.Context, id uuid.UUID, invalidatedAt time.Time) error
	CreateVerifiedUser(
		ctx context.Context,
		challengeID uuid.UUID,
		invitationID *uuid.UUID,
		user *model.User,
		consumedAt time.Time,
	) error
}

type RegistrationInvitationRepository interface {
	CreateRegistrationInvitation(ctx context.Context, invitation *model.RegistrationInvitation) error
	FindActiveRegistrationInvitationByCodeHash(
		ctx context.Context,
		codeHash string,
		now time.Time,
	) (*model.RegistrationInvitation, error)
}

type RefreshTokenRepository interface {
	CreateRefreshToken(ctx context.Context, token *model.RefreshToken) error
	FindActiveRefreshTokenByHash(ctx context.Context, tokenHash string) (*model.RefreshToken, error)
	RevokeRefreshToken(ctx context.Context, id uuid.UUID, replacementID *uuid.UUID, revokedAt time.Time) error
	RotateRefreshToken(ctx context.Context, id uuid.UUID, replacement *model.RefreshToken, revokedAt time.Time) error
}

type ResumeListOptions struct {
	Query  string
	Status model.ResumeStatus
	Sort   string
	Offset int
	Limit  int
}

type ResumeStats struct {
	Total     int
	Draft     int
	Completed int
	Exported  int64
}

type ResumeRepository interface {
	CreateResume(ctx context.Context, resume *model.Resume) error
	FindResumeByID(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error)
	ListResumes(ctx context.Context, userID uuid.UUID, options ResumeListOptions) ([]model.Resume, int, error)
	UpdateResume(ctx context.Context, resume *model.Resume, expectedRevision int64) error
	SetResumeAvatar(ctx context.Context, userID, resumeID uuid.UUID, avatarKey *string) error
	SetResumeSchoolLogo(ctx context.Context, userID, resumeID uuid.UUID, schoolLogoKey *string) error
	IncrementResumeExport(ctx context.Context, userID, resumeID uuid.UUID, updatedAt time.Time) error
	DeleteResume(ctx context.Context, userID, resumeID uuid.UUID) error
	GetResumeStats(ctx context.Context, userID uuid.UUID) (ResumeStats, error)
}

type AnalyticsRepository interface {
	RecordAnalyticsEvent(
		ctx context.Context,
		event *model.AnalyticsEvent,
		dailyLimit int,
	) (AnalyticsRecordResult, error)
	DeleteAnalyticsInstallation(ctx context.Context, visitorHash string) error
	CleanupAnalytics(ctx context.Context, now time.Time) error
}
