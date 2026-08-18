package repository

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"github.com/vega-resume/server/internal/model"
)

type GormStore struct {
	db *gorm.DB
}

const analyticsEventInstallationConstraint = `
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'analytics_events_visitor_hash_fkey'
			AND conrelid = 'analytics_events'::regclass
	) THEN
		ALTER TABLE analytics_events
			ADD CONSTRAINT analytics_events_visitor_hash_fkey
			FOREIGN KEY (visitor_hash)
			REFERENCES analytics_installations(visitor_hash)
			ON DELETE CASCADE;
	END IF;
END
$$`

func OpenPostgres(databaseURL string) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: logger.New(
			log.New(os.Stdout, "\r\n", log.LstdFlags),
			logger.Config{
				SlowThreshold:             200 * time.Millisecond,
				LogLevel:                  logger.Warn,
				IgnoreRecordNotFoundError: true,
				ParameterizedQueries:      true,
				Colorful:                  false,
			},
		),
	})
}

func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

func Migrate(ctx context.Context, db *gorm.DB) error {
	gdb := db.WithContext(ctx)
	hadEmailVerifiedAt := gdb.Migrator().HasColumn(&model.User{}, "email_verified_at")
	if err := gdb.AutoMigrate(
		&model.User{},
		&model.EmailVerificationChallenge{},
		&model.RegistrationEmailVerification{},
		&model.RegistrationInvitation{},
		&model.RefreshToken{},
		&model.Resume{},
		&model.AnalyticsInstallation{},
		&model.AnalyticsEvent{},
		&model.AnalyticsDailyAggregate{},
	); err != nil {
		return err
	}
	if !hadEmailVerifiedAt {
		if err := gdb.Exec(
			`UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL`,
		).Error; err != nil {
			return err
		}
	}
	if gdb.Dialector.Name() == "postgres" {
		if err := gdb.Exec(analyticsEventInstallationConstraint).Error; err != nil {
			return err
		}
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_uidx ON users (email_normalized) WHERE deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS users_username_active_uidx ON users (username) WHERE deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS email_verification_challenges_user_active_uidx ON email_verification_challenges (user_id) WHERE consumed_at IS NULL AND invalidated_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS registration_email_verifications_email_active_uidx ON registration_email_verifications (email_normalized) WHERE consumed_at IS NULL AND invalidated_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS analytics_workspace_activated_visitor_uidx ON analytics_events (visitor_hash) WHERE event_name = 'workspace_activated'`,
	} {
		if err := gdb.Exec(statement).Error; err != nil {
			return err
		}
	}
	return nil
}

type AnalyticsRecordResult string

const (
	AnalyticsRecordInserted  AnalyticsRecordResult = "inserted"
	AnalyticsRecordDuplicate AnalyticsRecordResult = "duplicate"
	AnalyticsRecordQuota     AnalyticsRecordResult = "quota"
)

func (s *GormStore) RecordAnalyticsEvent(
	ctx context.Context,
	event *model.AnalyticsEvent,
	dailyLimit int,
) (AnalyticsRecordResult, error) {
	result := AnalyticsRecordDuplicate
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		installation := model.AnalyticsInstallation{
			VisitorHash: event.VisitorHash,
			FirstSeenAt: event.RecordedAt,
			LastSeenAt:  event.RecordedAt,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "visitor_hash"}},
			DoUpdates: clause.Assignments(map[string]any{"last_seen_at": event.RecordedAt}),
		}).Create(&installation).Error; err != nil {
			return err
		}

		var duplicateCount int64
		if err := tx.Model(&model.AnalyticsEvent{}).
			Where("event_id = ?", event.EventID).
			Count(&duplicateCount).Error; err != nil {
			return err
		}
		if duplicateCount > 0 {
			result = AnalyticsRecordDuplicate
			return nil
		}

		dayStart := time.Date(
			event.RecordedAt.Year(),
			event.RecordedAt.Month(),
			event.RecordedAt.Day(),
			0, 0, 0, 0,
			time.UTC,
		)
		var acceptedToday int64
		if err := tx.Model(&model.AnalyticsEvent{}).
			Where("visitor_hash = ? AND recorded_at >= ? AND recorded_at < ?", event.VisitorHash, dayStart, dayStart.AddDate(0, 0, 1)).
			Count(&acceptedToday).Error; err != nil {
			return err
		}
		if acceptedToday >= int64(dailyLimit) {
			result = AnalyticsRecordQuota
			return nil
		}

		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(event)
		if insert.Error != nil {
			return insert.Error
		}
		if insert.RowsAffected == 0 {
			result = AnalyticsRecordDuplicate
			return nil
		}

		aggregate := model.AnalyticsDailyAggregate{
			Day:       dayStart,
			EventName: event.EventName,
			Mode:      event.Mode,
			Count:     1,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "day"},
				{Name: "event_name"},
				{Name: "mode"},
			},
			DoUpdates: clause.Assignments(map[string]any{
				"count": gorm.Expr("analytics_daily_aggregates.count + 1"),
			}),
		}).Create(&aggregate).Error; err != nil {
			return err
		}
		result = AnalyticsRecordInserted
		return nil
	})
	return result, err
}

func (s *GormStore) DeleteAnalyticsInstallation(ctx context.Context, visitorHash string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("visitor_hash = ?", visitorHash).Delete(&model.AnalyticsEvent{}).Error; err != nil {
			return err
		}
		return tx.Where("visitor_hash = ?", visitorHash).Delete(&model.AnalyticsInstallation{}).Error
	})
}

func (s *GormStore) CleanupAnalytics(ctx context.Context, now time.Time) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("recorded_at < ?", now.AddDate(0, 0, -180)).
			Delete(&model.AnalyticsEvent{}).Error; err != nil {
			return err
		}
		return tx.Where("last_seen_at < ?", now.AddDate(-1, -1, 0)).
			Delete(&model.AnalyticsInstallation{}).Error
	})
}

func (s *GormStore) CreateResume(ctx context.Context, resume *model.Resume) error {
	return s.db.WithContext(ctx).Create(resume).Error
}

func (s *GormStore) FindResumeByID(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	var resume model.Resume
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", resumeID, userID).
		First(&resume).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &resume, nil
}

func (s *GormStore) ListResumes(ctx context.Context, userID uuid.UUID, options ResumeListOptions) ([]model.Resume, int, error) {
	query := s.db.WithContext(ctx).Model(&model.Resume{}).Where("user_id = ?", userID)
	if options.Query != "" {
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(options.Query))
		query = query.Where(`LOWER(title) LIKE ? ESCAPE '\'`, "%"+escaped+"%")
	}
	if options.Status != "" {
		query = query.Where("status = ?", options.Status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "updated_at DESC, id DESC"
	switch options.Sort {
	case "updated_asc":
		order = "updated_at ASC, id ASC"
	case "created_desc":
		order = "created_at DESC, id DESC"
	case "title_asc":
		order = "LOWER(title) ASC, updated_at DESC"
	}
	var resumes []model.Resume
	if err := query.Order(order).Offset(options.Offset).Limit(options.Limit).Find(&resumes).Error; err != nil {
		return nil, 0, err
	}
	return resumes, int(total), nil
}

func (s *GormStore) UpdateResume(ctx context.Context, resume *model.Resume, expectedRevision int64) error {
	result := s.db.WithContext(ctx).
		Model(&model.Resume{}).
		Where("id = ? AND user_id = ? AND revision = ?", resume.ID, resume.UserID, expectedRevision).
		Select("title", "status", "template_id", "content_version", "content_json", "revision", "export_count", "updated_at").
		Updates(resume)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := s.db.WithContext(ctx).Model(&model.Resume{}).Where("id = ? AND user_id = ?", resume.ID, resume.UserID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrConflict
		}
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) SetResumeAvatar(ctx context.Context, userID, resumeID uuid.UUID, avatarKey *string) error {
	result := s.db.WithContext(ctx).Model(&model.Resume{}).
		Where("id = ? AND user_id = ?", resumeID, userID).
		Updates(map[string]any{"avatar_key": avatarKey, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) SetResumeSchoolLogo(ctx context.Context, userID, resumeID uuid.UUID, schoolLogoKey *string) error {
	result := s.db.WithContext(ctx).Model(&model.Resume{}).
		Where("id = ? AND user_id = ?", resumeID, userID).
		Updates(map[string]any{"school_logo_key": schoolLogoKey, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) IncrementResumeExport(ctx context.Context, userID, resumeID uuid.UUID, updatedAt time.Time) error {
	result := s.db.WithContext(ctx).Model(&model.Resume{}).
		Where("id = ? AND user_id = ?", resumeID, userID).
		Updates(map[string]any{"export_count": gorm.Expr("export_count + 1"), "updated_at": updatedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) DeleteResume(ctx context.Context, userID, resumeID uuid.UUID) error {
	result := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", resumeID, userID).Delete(&model.Resume{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) GetResumeStats(ctx context.Context, userID uuid.UUID) (ResumeStats, error) {
	var rows []struct {
		Status      model.ResumeStatus
		Count       int
		ExportCount int64
	}
	err := s.db.WithContext(ctx).
		Model(&model.Resume{}).
		Select("status, COUNT(*) AS count, COALESCE(SUM(export_count), 0) AS export_count").
		Where("user_id = ?", userID).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return ResumeStats{}, err
	}
	stats := ResumeStats{}
	for _, row := range rows {
		stats.Total += row.Count
		stats.Exported += row.ExportCount
		switch row.Status {
		case model.ResumeStatusDraft:
			stats.Draft += row.Count
		case model.ResumeStatusCompleted:
			stats.Completed += row.Count
		}
	}
	return stats, nil
}

func (s *GormStore) CreateUser(ctx context.Context, user *model.User) error {
	if err := s.db.WithContext(ctx).Create(user).Error; err != nil {
		return mapUserCreateError(err)
	}
	return nil
}

func (s *GormStore) FindActiveUserByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	var user model.User
	if err := s.db.WithContext(ctx).
		Where("id = ? AND deleted_at IS NULL", id).
		First(&user).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &user, nil
}

func (s *GormStore) FindActiveUserByEmailNormalized(ctx context.Context, emailNormalized string) (*model.User, error) {
	var user model.User
	if err := s.db.WithContext(ctx).
		Where("email_normalized = ? AND deleted_at IS NULL", emailNormalized).
		First(&user).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &user, nil
}

func (s *GormStore) FindActiveUserByUsername(ctx context.Context, username string) (*model.User, error) {
	var user model.User
	if err := s.db.WithContext(ctx).
		Where("username = ? AND deleted_at IS NULL", username).
		First(&user).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &user, nil
}

func (s *GormStore) ReplaceEmailVerificationChallenge(
	ctx context.Context,
	challenge *model.EmailVerificationChallenge,
	invalidatedAt time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.EmailVerificationChallenge{}).
			Where("user_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", challenge.UserID).
			Update("invalidated_at", invalidatedAt).Error; err != nil {
			return err
		}
		return tx.Create(challenge).Error
	})
}

func (s *GormStore) FindActiveEmailVerificationChallengeByUserID(
	ctx context.Context,
	userID uuid.UUID,
) (*model.EmailVerificationChallenge, error) {
	var challenge model.EmailVerificationChallenge
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", userID).
		Order("created_at DESC").
		First(&challenge).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &challenge, nil
}

func (s *GormStore) IncrementEmailVerificationFailures(ctx context.Context, id uuid.UUID) (int, error) {
	result := s.db.WithContext(ctx).
		Model(&model.EmailVerificationChallenge{}).
		Where("id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", id).
		UpdateColumn("attempts", gorm.Expr("attempts + 1"))
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, ErrNotFound
	}
	var challenge model.EmailVerificationChallenge
	if err := s.db.WithContext(ctx).Select("attempts").First(&challenge, "id = ?", id).Error; err != nil {
		return 0, mapNotFound(err)
	}
	return challenge.Attempts, nil
}

func (s *GormStore) MarkEmailVerificationSent(ctx context.Context, id uuid.UUID, sentAt time.Time) error {
	result := s.db.WithContext(ctx).
		Model(&model.EmailVerificationChallenge{}).
		Where("id = ? AND invalidated_at IS NULL", id).
		Update("sent_at", sentAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) ConsumeEmailVerificationChallenge(
	ctx context.Context,
	challengeID, userID uuid.UUID,
	consumedAt time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.EmailVerificationChallenge{}).
			Where(
				"id = ? AND user_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL",
				challengeID,
				userID,
			).
			Update("consumed_at", consumedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		result = tx.Model(&model.User{}).
			Where("id = ? AND deleted_at IS NULL", userID).
			Updates(map[string]any{"email_verified_at": consumedAt, "updated_at": consumedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func (s *GormStore) InvalidateEmailVerificationChallenge(
	ctx context.Context,
	id uuid.UUID,
	invalidatedAt time.Time,
) error {
	result := s.db.WithContext(ctx).
		Model(&model.EmailVerificationChallenge{}).
		Where("id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", id).
		Update("invalidated_at", invalidatedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) ReplaceRegistrationEmailVerification(
	ctx context.Context,
	challenge *model.RegistrationEmailVerification,
	invalidatedAt time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.RegistrationEmailVerification{}).
			Where("email_normalized = ? AND consumed_at IS NULL AND invalidated_at IS NULL", challenge.EmailNormalized).
			Update("invalidated_at", invalidatedAt).Error; err != nil {
			return err
		}
		return tx.Create(challenge).Error
	})
}

func (s *GormStore) FindActiveRegistrationEmailVerification(
	ctx context.Context,
	emailNormalized string,
) (*model.RegistrationEmailVerification, error) {
	var challenge model.RegistrationEmailVerification
	if err := s.db.WithContext(ctx).
		Where("email_normalized = ? AND consumed_at IS NULL AND invalidated_at IS NULL", emailNormalized).
		First(&challenge).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &challenge, nil
}

func (s *GormStore) IncrementRegistrationEmailVerificationFailures(
	ctx context.Context,
	id uuid.UUID,
) (int, error) {
	var challenge model.RegistrationEmailVerification
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.RegistrationEmailVerification{}).
			Where("id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", id).
			UpdateColumn("attempts", gorm.Expr("attempts + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return tx.First(&challenge, "id = ?", id).Error
	})
	return challenge.Attempts, mapNotFound(err)
}

func (s *GormStore) MarkRegistrationEmailVerificationSent(
	ctx context.Context,
	id uuid.UUID,
	sentAt time.Time,
) error {
	result := s.db.WithContext(ctx).
		Model(&model.RegistrationEmailVerification{}).
		Where("id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", id).
		Update("sent_at", sentAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) InvalidateRegistrationEmailVerification(
	ctx context.Context,
	id uuid.UUID,
	invalidatedAt time.Time,
) error {
	result := s.db.WithContext(ctx).
		Model(&model.RegistrationEmailVerification{}).
		Where("id = ? AND consumed_at IS NULL AND invalidated_at IS NULL", id).
		Update("invalidated_at", invalidatedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) CreateVerifiedUser(
	ctx context.Context,
	challengeID uuid.UUID,
	invitationID *uuid.UUID,
	user *model.User,
	consumedAt time.Time,
) error {
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.RegistrationEmailVerification{}).
			Where(
				"id = ? AND email_normalized = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > ?",
				challengeID,
				user.EmailNormalized,
				consumedAt,
			).
			Update("consumed_at", consumedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		if invitationID != nil {
			result = tx.Model(&model.RegistrationInvitation{}).
				Where(
					"id = ? AND consumed_at IS NULL AND expires_at > ?",
					*invitationID,
					consumedAt,
				).
				Update("consumed_at", consumedAt)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrInvitationInvalid
			}
		}
		return tx.Create(user).Error
	})
	return mapUserCreateError(err)
}

func (s *GormStore) CreateRegistrationInvitation(
	ctx context.Context,
	invitation *model.RegistrationInvitation,
) error {
	return s.db.WithContext(ctx).Create(invitation).Error
}

func (s *GormStore) FindActiveRegistrationInvitationByCodeHash(
	ctx context.Context,
	codeHash string,
	now time.Time,
) (*model.RegistrationInvitation, error) {
	var invitation model.RegistrationInvitation
	if err := s.db.WithContext(ctx).
		Where("code_hash = ? AND consumed_at IS NULL AND expires_at > ?", codeHash, now).
		First(&invitation).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &invitation, nil
}

func (s *GormStore) CreateRefreshToken(ctx context.Context, token *model.RefreshToken) error {
	return s.db.WithContext(ctx).Create(token).Error
}

func (s *GormStore) FindActiveRefreshTokenByHash(ctx context.Context, tokenHash string) (*model.RefreshToken, error) {
	var token model.RefreshToken
	if err := s.db.WithContext(ctx).
		Where("token_hash = ? AND revoked_at IS NULL", tokenHash).
		First(&token).Error; err != nil {
		return nil, mapNotFound(err)
	}
	return &token, nil
}

func (s *GormStore) RevokeRefreshToken(ctx context.Context, id uuid.UUID, replacementID *uuid.UUID, revokedAt time.Time) error {
	result := s.db.WithContext(ctx).
		Model(&model.RefreshToken{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Updates(map[string]any{
			"revoked_at":           revokedAt,
			"replaced_by_token_id": replacementID,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *GormStore) RotateRefreshToken(ctx context.Context, id uuid.UUID, replacement *model.RefreshToken, revokedAt time.Time) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(replacement).Error; err != nil {
			return err
		}

		result := tx.Model(&model.RefreshToken{}).
			Where("id = ? AND revoked_at IS NULL", id).
			Updates(map[string]any{
				"revoked_at":           revokedAt,
				"replaced_by_token_id": replacement.ID,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func mapNotFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}

func mapUserCreateError(err error) error {
	if err == nil {
		return nil
	}
	if isUniqueConstraint(err, "users_email_active_uidx", "users.email_normalized") {
		return ErrDuplicateEmail
	}
	if isUniqueConstraint(err, "users_username_active_uidx", "users.username") {
		return ErrDuplicateUsername
	}
	return err
}

func isUniqueConstraint(err error, identifiers ...string) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		for _, identifier := range identifiers {
			if pgErr.ConstraintName == identifier {
				return true
			}
		}
		return false
	}

	message := strings.ToLower(err.Error())
	for _, identifier := range identifiers {
		if strings.Contains(message, strings.ToLower(identifier)) {
			return true
		}
	}
	return false
}
