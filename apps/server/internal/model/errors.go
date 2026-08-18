package model

import (
	"errors"
	"net/http"
)

type AppError struct {
	Code       int
	Message    string
	HTTPStatus int
}

func (e *AppError) Error() string {
	return e.Message
}

func (e *AppError) Is(target error) bool {
	var appErr *AppError
	if !errors.As(target, &appErr) {
		return false
	}
	return e.Code == appErr.Code
}

var (
	ErrInvalidParam          = &AppError{Code: 100001, Message: "请求参数格式错误", HTTPStatus: http.StatusBadRequest}
	ErrMissingParam          = &AppError{Code: 100002, Message: "缺少必填参数", HTTPStatus: http.StatusBadRequest}
	ErrUnauthorized          = &AppError{Code: 100003, Message: "未登录或 Token 缺失", HTTPStatus: http.StatusUnauthorized}
	ErrTooManyRequests       = &AppError{Code: 100006, Message: "请求过于频繁", HTTPStatus: http.StatusTooManyRequests}
	ErrInternalServer        = &AppError{Code: 200001, Message: "服务器内部错误", HTTPStatus: http.StatusInternalServerError}
	ErrDBError               = &AppError{Code: 200002, Message: "数据库操作异常", HTTPStatus: http.StatusInternalServerError}
	ErrEmailExists           = &AppError{Code: 101001, Message: "邮箱已注册", HTTPStatus: http.StatusConflict}
	ErrInvalidCredential     = &AppError{Code: 101002, Message: "邮箱或密码不正确", HTTPStatus: http.StatusUnauthorized}
	ErrTokenExpired          = &AppError{Code: 101003, Message: "Token 已过期，请重新登录", HTTPStatus: http.StatusUnauthorized}
	ErrTokenInvalid          = &AppError{Code: 101004, Message: "Token 无效或已被篡改", HTTPStatus: http.StatusUnauthorized}
	ErrPasswordTooWeak       = &AppError{Code: 101005, Message: "密码强度不足", HTTPStatus: http.StatusBadRequest}
	ErrEmailFormatInvalid    = &AppError{Code: 101006, Message: "邮箱格式不正确", HTTPStatus: http.StatusBadRequest}
	ErrUsernameExists        = &AppError{Code: 101007, Message: "用户名已被使用", HTTPStatus: http.StatusConflict}
	ErrUsernameFormatInvalid = &AppError{Code: 101008, Message: "用户名格式不正确", HTTPStatus: http.StatusBadRequest}
	ErrAccountLocked         = &AppError{Code: 101009, Message: "账号已临时锁定", HTTPStatus: http.StatusLocked}
	ErrRefreshTokenInvalid   = &AppError{Code: 101010, Message: "Refresh Token 无效或已失效", HTTPStatus: http.StatusUnauthorized}
	ErrEmailNotVerified      = &AppError{Code: 101011, Message: "邮箱尚未验证", HTTPStatus: http.StatusForbidden}
	ErrVerificationInvalid   = &AppError{Code: 101012, Message: "验证码错误或已过期", HTTPStatus: http.StatusBadRequest}
	ErrEmailDeliveryFailed   = &AppError{Code: 101013, Message: "验证邮件发送失败，请稍后重试", HTTPStatus: http.StatusServiceUnavailable}
	ErrInvitationInvalid     = &AppError{Code: 101014, Message: "邀请码无效或已过期", HTTPStatus: http.StatusBadRequest}
	ErrRegistrationClosed    = &AppError{Code: 101015, Message: "注册暂未开放", HTTPStatus: http.StatusForbidden}
	ErrInvitationAnswerWrong = &AppError{Code: 101016, Message: "暗号不正确", HTTPStatus: http.StatusBadRequest}
	ErrResumeNotFound        = &AppError{Code: 103001, Message: "简历不存在", HTTPStatus: http.StatusNotFound}
	ErrResumeInvalidSchema   = &AppError{Code: 103004, Message: "简历数据结构不合法", HTTPStatus: http.StatusBadRequest}
	ErrResumeConflict        = &AppError{Code: 103005, Message: "简历已在其他页面更新", HTTPStatus: http.StatusConflict}
	ErrAvatarInvalid         = &AppError{Code: 105003, Message: "头像必须是 500×700 的 JPEG 图片", HTTPStatus: http.StatusBadRequest}
	ErrSchoolLogoInvalid     = &AppError{Code: 105004, Message: "校徽必须是 500×500 的 PNG 图片", HTTPStatus: http.StatusBadRequest}
	ErrFileTooLarge          = &AppError{Code: 105002, Message: "上传文件超过大小限制", HTTPStatus: http.StatusBadRequest}
	ErrPdfRenderFailed       = &AppError{Code: 106001, Message: "PDF 生成失败，请稍后重试", HTTPStatus: http.StatusInternalServerError}
	ErrPdfBusy               = &AppError{Code: 106002, Message: "PDF 导出繁忙，请稍后重试", HTTPStatus: http.StatusServiceUnavailable}
)
