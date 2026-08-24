package service

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

const (
	DefaultProfileAlignment    = "left"
	ContentVersionV2           = 2
	ContentVersionV3           = 3
	ContentVersionV4           = 4
	MaxResumeContentBytes      = 512 << 10
	MaxResumeDescriptionRunes  = 20_000
	maxResumeIDRunes           = 128
	maxResumeTitleRunes        = 120
	maxResumeProfileFieldRunes = 320
	maxResumeItemFieldRunes    = 500
	maxResumeLinkURLRunes      = 2_048
)

var validProfileAlignments = map[string]struct{}{
	"left":   {},
	"center": {},
	"right":  {},
}

func DefaultResumeContent() map[string]any {
	return map[string]any{
		"profile": map[string]any{
			"enabled": true, "fullName": "", "targetRole": "", "phone": "", "email": "", "location": "",
			"politicalStatus": "", "links": []any{},
		},
		"sections": []any{
			map[string]any{"id": "summary", "type": "summary", "title": "个人简介", "enabled": true, "text": ""},
			map[string]any{"id": "work", "type": "work", "title": "工作经历", "enabled": true, "items": []any{}},
			map[string]any{"id": "education", "type": "education", "title": "教育背景", "enabled": true, "items": []any{}},
			map[string]any{"id": "project", "type": "project", "title": "项目经历", "enabled": true, "items": []any{}},
			map[string]any{"id": "skills", "type": "skills", "title": "技能", "enabled": true, "description": ""},
			map[string]any{"id": "awards", "type": "awards", "title": "奖项荣誉", "enabled": false, "items": []any{}},
		},
		"formatting": map[string]any{
			"nameFontSizePx": 20, "sectionTitleFontSizePx": 16, "entryTitleFontSizePx": 14,
			"bodyFontSizePx": 14, "lineHeightRatio": 1.5,
			"pageMarginPx": map[string]any{"top": 33, "right": 33, "bottom": 33, "left": 33},
			"sectionGapPx": 8, "entryGapPx": 14, "fontFamily": "source-han-sans", "accentColor": "plum",
		},
	}
}

func ValidateResumeContent(content map[string]any) error {
	return ValidateResumeContentVersion(content, ContentVersionV4)
}

func ValidateResumeContentVersion(content map[string]any, version int) error {
	if version != ContentVersionV2 && version != ContentVersionV3 && version != ContentVersionV4 {
		return fmt.Errorf("unsupported content version")
	}
	serialized, err := json.Marshal(content)
	if err != nil || len(serialized) > MaxResumeContentBytes {
		return fmt.Errorf("content exceeds size limit")
	}
	if content == nil || len(content) != 3 {
		return fmt.Errorf("content must contain profile, sections and formatting")
	}
	profile, ok := content["profile"].(map[string]any)
	if !ok || !validateProfile(profile, version) {
		return fmt.Errorf("invalid profile")
	}
	sections, ok := content["sections"].([]any)
	if !ok || len(sections) > 64 || !validateSections(sections, version) {
		return fmt.Errorf("invalid sections")
	}
	formatting, ok := content["formatting"].(map[string]any)
	if !ok || !validateFormatting(formatting, version) {
		return fmt.Errorf("invalid formatting")
	}
	return nil
}

func validateProfile(profile map[string]any, version int) bool {
	allowed := map[string]bool{"fullName": true, "targetRole": true, "phone": true, "email": true, "location": true, "links": true}
	if version == ContentVersionV4 {
		allowed["enabled"] = true
		allowed["politicalStatus"] = true
		if _, ok := profile["enabled"].(bool); !ok {
			return false
		}
		if value, exists := profile["politicalStatus"]; exists && !boundedString(value, maxResumeProfileFieldRunes) {
			return false
		}
	}
	if !onlyAllowed(profile, allowed) {
		return false
	}
	for _, key := range []string{"fullName", "targetRole", "phone", "email", "location"} {
		if !boundedString(profile[key], maxResumeProfileFieldRunes) {
			return false
		}
	}
	links, ok := profile["links"].([]any)
	if !ok || len(links) > 20 {
		return false
	}
	for _, raw := range links {
		link, ok := raw.(map[string]any)
		if !ok ||
			!stringFields(link, []string{"id", "label", "url"}, nil, nil) ||
			!boundedString(link["id"], maxResumeIDRunes) ||
			!boundedString(link["label"], maxResumeTitleRunes) ||
			!boundedString(link["url"], maxResumeLinkURLRunes) {
			return false
		}
	}
	return true
}

func validateFormatting(formatting map[string]any, version int) bool {
	allowed := map[string]bool{
		"nameFontSizePx": true, "sectionTitleFontSizePx": true, "entryTitleFontSizePx": true,
		"bodyFontSizePx": true, "lineHeightRatio": true, "pageMarginPx": true,
		"sectionGapPx": true, "fontFamily": true, "accentColor": true,
	}
	if version >= ContentVersionV3 {
		allowed["entryGapPx"] = true
	}
	if !onlyAllowed(formatting, allowed) ||
		!integerBetween(formatting["nameFontSizePx"], 12, 48) ||
		!integerBetween(formatting["sectionTitleFontSizePx"], 10, 32) ||
		!integerBetween(formatting["entryTitleFontSizePx"], 8, 28) ||
		!integerBetween(formatting["bodyFontSizePx"], 8, 24) ||
		!numberBetween(formatting["lineHeightRatio"], 1, 2.5) ||
		!integerBetween(formatting["sectionGapPx"], 0, 64) ||
		!oneOf(formatting["fontFamily"], "source-han-sans", "source-han-serif") ||
		!validAccentColor(formatting["accentColor"]) {
		return false
	}
	if version >= ContentVersionV3 && !integerBetween(formatting["entryGapPx"], 0, 64) {
		return false
	}
	margins, ok := formatting["pageMarginPx"].(map[string]any)
	if !ok || !onlyAllowed(margins, map[string]bool{"top": true, "right": true, "bottom": true, "left": true}) {
		return false
	}
	for _, key := range []string{"top", "right", "bottom", "left"} {
		if !integerBetween(margins[key], 0, 160) {
			return false
		}
	}
	return true
}

func validAccentColor(value any) bool {
	color, ok := value.(string)
	if !ok {
		return false
	}
	if oneOf(color, "plum", "navy", "teal", "rust", "charcoal", "black") {
		return true
	}
	if len(color) != 7 || color[0] != '#' {
		return false
	}
	for _, char := range color[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return false
		}
	}
	return true
}

func validateSections(sections []any, version int) bool {
	ids := map[string]bool{}
	builtins := map[string]bool{}
	for _, raw := range sections {
		section, ok := raw.(map[string]any)
		if !ok {
			return false
		}
		id, idOK := section["id"].(string)
		typeName, typeOK := section["type"].(string)
		title, titleOK := section["title"].(string)
		_, enabledOK := section["enabled"].(bool)
		if !idOK ||
			!typeOK ||
			!titleOK ||
			!enabledOK ||
			strings.TrimSpace(id) == "" ||
			strings.TrimSpace(title) == "" ||
			utf8.RuneCountInString(id) > maxResumeIDRunes ||
			utf8.RuneCountInString(typeName) > maxResumeIDRunes ||
			utf8.RuneCountInString(title) > maxResumeTitleRunes ||
			ids[id] {
			return false
		}
		ids[id] = true
		optionalSpacing := []string(nil)
		if version >= ContentVersionV3 {
			optionalSpacing = []string{"spacingBeforePx"}
			if !optionalIntegerBetween(section, "spacingBeforePx", 0, 64) {
				return false
			}
		}
		switch typeName {
		case "summary":
			if builtins[typeName] ||
				id != "summary" ||
				!stringFields(section, []string{"id", "type", "title", "text"}, []string{"enabled"}, optionalSpacing) ||
				!boundedString(section["text"], MaxResumeDescriptionRunes) {
				return false
			}
			builtins[typeName] = true
		case "skills":
			if builtins[typeName] ||
				id != "skills" ||
				!stringFields(section, []string{"id", "type", "title", "description"}, []string{"enabled"}, optionalSpacing) ||
				!boundedString(section["description"], MaxResumeDescriptionRunes) {
				return false
			}
			builtins[typeName] = true
		case "work", "education", "project", "awards":
			if builtins[typeName] || id != typeName || !validateItemSection(section, typeName, version) {
				return false
			}
			builtins[typeName] = true
		case "custom":
			if !validateItemSection(section, typeName, version) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validateItemSection(section map[string]any, typeName string, version int) bool {
	items, ok := section["items"].([]any)
	optionalSectionFields := []string(nil)
	if version >= ContentVersionV3 {
		optionalSectionFields = []string{"spacingBeforePx"}
	}
	if !ok || len(items) > 100 || !stringFields(section, []string{"id", "type", "title"}, []string{"enabled", "items"}, optionalSectionFields) {
		return false
	}
	allowed := map[string]bool{"id": true}
	if version >= ContentVersionV3 {
		allowed["spacingBeforePx"] = true
	}
	switch typeName {
	case "awards":
		allowed["title"], allowed["issuer"], allowed["date"], allowed["description"] = true, true, true, true
	case "education":
		for _, key := range []string{"school", "major", "degree", "startDate", "endDate", "description"} {
			allowed[key] = true
		}
	case "work":
		for _, key := range []string{"company", "role", "location", "startDate", "endDate", "isCurrent", "description"} {
			allowed[key] = true
		}
	case "project":
		for _, key := range []string{"name", "role", "startDate", "endDate", "isCurrent", "description"} {
			allowed[key] = true
		}
	case "custom":
		for _, key := range []string{"title", "subtitle", "location", "startDate", "endDate", "isCurrent", "description"} {
			allowed[key] = true
		}
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !onlyAllowed(item, allowed) {
			return false
		}
		if id, ok := item["id"].(string); !ok || id == "" || utf8.RuneCountInString(id) > maxResumeIDRunes {
			return false
		}
		if version >= ContentVersionV3 && !optionalIntegerBetween(item, "spacingBeforePx", 0, 64) {
			return false
		}
		for key, value := range item {
			if key == "id" || key == "spacingBeforePx" {
				continue
			}
			if key == "isCurrent" {
				if _, ok := value.(bool); !ok {
					return false
				}
				continue
			}
			maxRunes := maxResumeItemFieldRunes
			if key == "description" {
				maxRunes = MaxResumeDescriptionRunes
			}
			if !boundedString(value, maxRunes) {
				return false
			}
		}
	}
	return true
}

func ValidProfileAlignment(alignment string) bool {
	_, ok := validProfileAlignments[alignment]
	return ok
}

func NormalizeProfileAlignment(profileAlignment, templateID *string) (string, error) {
	alignment := ""
	if profileAlignment != nil && strings.TrimSpace(*profileAlignment) != "" {
		alignment = strings.TrimSpace(*profileAlignment)
		if !ValidProfileAlignment(alignment) {
			return "", fmt.Errorf("invalid profile alignment")
		}
	}
	legacyAlignment := ""
	if templateID != nil && strings.TrimSpace(*templateID) != "" {
		switch strings.TrimSpace(*templateID) {
		case "modern-editorial", "left":
			legacyAlignment = "left"
		case "classic-professional", "center":
			legacyAlignment = "center"
		case "right":
			legacyAlignment = "right"
		default:
			return "", fmt.Errorf("invalid template id")
		}
	}
	if alignment != "" && legacyAlignment != "" && alignment != legacyAlignment {
		return "", fmt.Errorf("conflicting profile alignment")
	}
	if alignment != "" {
		return alignment, nil
	}
	if legacyAlignment != "" {
		return legacyAlignment, nil
	}
	return DefaultProfileAlignment, nil
}

func LegacyTemplateIDForAlignment(alignment string) *string {
	var templateID string
	switch alignment {
	case "left":
		templateID = "modern-editorial"
	case "center":
		templateID = "classic-professional"
	default:
		return nil
	}
	return &templateID
}

func MigrateResumeContentV2(content map[string]any) (map[string]any, error) {
	if err := ValidateResumeContentVersion(content, ContentVersionV2); err != nil {
		return nil, err
	}
	serialized, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	migrated := map[string]any{}
	if err := json.Unmarshal(serialized, &migrated); err != nil {
		return nil, err
	}
	formatting := migrated["formatting"].(map[string]any)
	formatting["entryGapPx"] = formatting["bodyFontSizePx"]
	profile := migrated["profile"].(map[string]any)
	profile["enabled"] = true
	profile["politicalStatus"] = ""
	if err := ValidateResumeContentVersion(migrated, ContentVersionV4); err != nil {
		return nil, err
	}
	return migrated, nil
}

func MigrateResumeContentV3(content map[string]any) (map[string]any, error) {
	if err := ValidateResumeContentVersion(content, ContentVersionV3); err != nil {
		return nil, err
	}
	serialized, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	migrated := map[string]any{}
	if err := json.Unmarshal(serialized, &migrated); err != nil {
		return nil, err
	}
	profile := migrated["profile"].(map[string]any)
	profile["enabled"] = true
	profile["politicalStatus"] = ""
	if err := ValidateResumeContentVersion(migrated, ContentVersionV4); err != nil {
		return nil, err
	}
	return migrated, nil
}

func onlyAllowed(values map[string]any, allowed map[string]bool) bool {
	for key := range values {
		if !allowed[key] {
			return false
		}
	}
	return true
}

func stringFields(values map[string]any, stringsRequired, otherRequired, optional []string) bool {
	allowed := map[string]bool{}
	for _, key := range stringsRequired {
		allowed[key] = true
		if _, ok := values[key].(string); !ok {
			return false
		}
	}
	for _, key := range otherRequired {
		allowed[key] = true
		if _, ok := values[key]; !ok {
			return false
		}
	}
	for _, key := range optional {
		allowed[key] = true
	}
	return onlyAllowed(values, allowed)
}

func optionalIntegerBetween(values map[string]any, key string, minimum, maximum float64) bool {
	value, ok := values[key]
	return !ok || integerBetween(value, minimum, maximum)
}

func boundedString(value any, maxRunes int) bool {
	text, ok := value.(string)
	return ok && utf8.RuneCountInString(text) <= maxRunes
}

func oneOf(value any, choices ...string) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	for _, choice := range choices {
		if text == choice {
			return true
		}
	}
	return false
}

func integerBetween(value any, minimum, maximum float64) bool {
	number, ok := numericValue(value)
	return ok && math.Trunc(number) == number && number >= minimum && number <= maximum
}

func numberBetween(value any, minimum, maximum float64) bool {
	number, ok := numericValue(value)
	return ok && number >= minimum && number <= maximum
}

func numericValue(value any) (float64, bool) {
	switch number := value.(type) {
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case float64:
		return number, true
	default:
		return 0, false
	}
}
