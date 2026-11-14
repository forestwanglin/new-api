package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetUserPoints(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	balances, err := model.GetUserPointBalances(id, c.GetInt("role"))
	if err != nil {
		writeUserPointAdjustmentError(c, err)
		return
	}
	common.ApiSuccess(c, balances)
}

func AdjustUserPoints(c *gin.Context) {
	action := "user.points_adjust"
	params := model.AuditFields{"target_user_id": c.Param("id"), "failure_reason": "invalid_parameters"}
	success := false
	defer func() {
		content := "Failed user point adjustment"
		if success {
			content = auditContentEN(action, params)
		}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), content, c.ClientIP(), action, params,
			auditOperatorInfo(c), &model.AuditRequestInfo{Method: c.Request.Method, Route: c.FullPath(), Status: c.Writer.Status(), Success: success}, c)
		markAuditLogged(c)
	}()
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	var fields map[string]common.RawMessage
	if err != nil || common.Unmarshal(body, &fields) != nil || len(fields) != 4 {
		common.ApiErrorT(c, "Invalid point adjustment parameters")
		return
	}
	for key := range fields {
		if key != "point_type_id" && key != "mode" && key != "amount" && key != "request_id" {
			common.ApiErrorT(c, "Invalid point adjustment parameters")
			return
		}
	}
	var input struct {
		PointTypeID string `json:"point_type_id"`
		Mode        string `json:"mode"`
		Amount      string `json:"amount"`
		RequestID   string `json:"request_id"`
	}
	if common.Unmarshal(body, &input) != nil {
		common.ApiErrorT(c, "Invalid point adjustment parameters")
		return
	}
	params["point_type_id"], params["mode"], params["amount"], params["adjustment_request_id"] = input.PointTypeID, input.Mode, input.Amount, input.RequestID
	switch input.Mode {
	case "add":
		action = "user.points_add"
	case "subtract":
		action = "user.points_subtract"
	}
	typeID, err := strconv.ParseInt(input.PointTypeID, 10, 64)
	if err != nil || strconv.FormatInt(typeID, 10) != input.PointTypeID {
		common.ApiErrorT(c, "Invalid point adjustment parameters")
		return
	}
	result, err := model.AdjustUserPoints(id, c.GetInt("id"), c.GetInt("role"), typeID, input.Mode, input.Amount, input.RequestID)
	if err != nil {
		params["failure_reason"] = userPointAdjustmentFailureReason(err)
		writeUserPointAdjustmentError(c, err)
		return
	}
	delete(params, "failure_reason")
	params["target_username"] = result.Username
	params["point_type_code"], params["point_type_name"] = result.Code, result.Name
	params["from"], params["to"] = result.AvailableBefore, result.AvailablePoints
	success = true
	if result.Replayed {
		action = "user.points_replay"
		params["replayed"] = true
	} else {
		operation := model.AuditOperation{Action: action, Params: params}
		model.RecordLogWithAdminInfo(id, model.LogTypeTopup, auditContentEN(action, params), auditOperatorInfo(c), &operation, c)
	}
	common.ApiSuccess(c, result)
}

func writeUserPointAdjustmentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrInvalidUserPointAdjustment):
		common.ApiErrorT(c, "Invalid point adjustment parameters")
	case errors.Is(err, model.ErrUserPointAdjustmentConflict):
		common.ApiErrorT(c, "Point adjustment request conflicts with an existing request")
	case errors.Is(err, model.ErrUserPointAdjustmentOverflow):
		common.ApiErrorT(c, "Point balance exceeds the supported integer range")
	case errors.Is(err, model.ErrPointTypeNotFound):
		common.ApiErrorT(c, "Point type not found")
	case errors.Is(err, model.ErrUserQuotaPermission):
		common.ApiErrorT(c, "No permission to update users of same or higher permission level")
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorT(c, "User does not exist")
	default:
		common.ApiErrorT(c, "Failed to adjust user points")
	}
}

func userPointAdjustmentFailureReason(err error) string {
	switch {
	case errors.Is(err, model.ErrInvalidUserPointAdjustment):
		return "invalid_parameters"
	case errors.Is(err, model.ErrUserPointAdjustmentConflict):
		return "request_conflict"
	case errors.Is(err, model.ErrUserPointAdjustmentOverflow):
		return "points_overflow"
	case errors.Is(err, model.ErrPointTypeNotFound):
		return "point_type_not_found"
	case errors.Is(err, model.ErrUserQuotaPermission):
		return "permission_denied"
	case errors.Is(err, gorm.ErrRecordNotFound):
		return "target_not_found"
	default:
		return "database_error"
	}
}
