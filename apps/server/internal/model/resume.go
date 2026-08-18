package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ResumeStatus string

const (
	ResumeStatusDraft     ResumeStatus = "draft"
	ResumeStatusCompleted ResumeStatus = "completed"
)

type JSONDocument json.RawMessage

func (document JSONDocument) Value() (driver.Value, error) {
	if len(document) == 0 {
		return "{}", nil
	}
	if !json.Valid(document) {
		return nil, fmt.Errorf("invalid JSON document")
	}
	return string(document), nil
}

func (document *JSONDocument) Scan(value any) error {
	if value == nil {
		*document = JSONDocument("{}")
		return nil
	}
	var data []byte
	switch typed := value.(type) {
	case []byte:
		data = typed
	case string:
		data = []byte(typed)
	default:
		return fmt.Errorf("unsupported JSON document value %T", value)
	}
	if !json.Valid(data) {
		return fmt.Errorf("invalid JSON document")
	}
	*document = append((*document)[:0], data...)
	return nil
}

type Resume struct {
	ID             uuid.UUID      `gorm:"type:uuid;primaryKey"`
	UserID         uuid.UUID      `gorm:"type:uuid;not null;index:idx_resumes_user_updated,priority:1"`
	Title          string         `gorm:"type:varchar(80);not null"`
	Status         ResumeStatus   `gorm:"type:varchar(16);not null;default:draft;index:idx_resumes_user_status"`
	TemplateID     *string        `gorm:"type:varchar(80)"`
	ContentVersion int            `gorm:"not null;default:1"`
	ContentJSON    JSONDocument   `gorm:"type:jsonb;not null"`
	Revision       int64          `gorm:"not null;default:1"`
	AvatarKey      *string        `gorm:"type:varchar(160)"`
	SchoolLogoKey  *string        `gorm:"type:varchar(160)"`
	ExportCount    int64          `gorm:"not null;default:0"`
	CreatedAt      time.Time      `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time      `gorm:"not null;autoUpdateTime;index:idx_resumes_user_updated,priority:2,sort:desc"`
	DeletedAt      gorm.DeletedAt `gorm:"index"`
	User           *User          `gorm:"foreignKey:UserID;references:ID;constraint:OnDelete:CASCADE"`
}
