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
	typeID, err := strconv.ParseInt(input.PointTypeID, 10, 64)
	if err != nil || strconv.FormatInt(typeID, 10) != input.PointTypeID {
		common.ApiErrorT(c, "Invalid point adjustment parameters")
		return
	}
	result, err := model.AdjustUserPoints(id, c.GetInt("id"), c.GetInt("role"), typeID, input.Mode, input.Amount, input.RequestID)
	if err != nil {
		writeUserPointAdjustmentError(c, err)
		return
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
