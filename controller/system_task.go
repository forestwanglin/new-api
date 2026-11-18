package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func CreateLogCleanupSystemTask(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}

	task, err := service.StartLogCleanupTask(targetTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    task.ToResponse(),
	})
}

func GetCurrentSystemTask(c *gin.Context) {
	taskType := c.Query("type")
	if taskType == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "type is required",
		})
		return
	}

	task, err := model.GetActiveSystemTask(taskType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if task == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    nil,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    task.ToResponse(),
	})
}

func ListSystemTasks(c *gin.Context) {
	var query struct {
		model.SystemTaskFilter
		Offset int `form:"offset" binding:"gte=0"`
		Limit  int `form:"limit"`
	}
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid system task filters"})
		return
	}

	tasks, total, err := model.ListSystemTasks(query.SystemTaskFilter, query.Offset, query.Limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	responses := make([]model.SystemTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		responses = append(responses, task.ToResponse())
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    responses,
		"total":   total,
	})
}

func DeleteSystemTaskHistory(c *gin.Context) {
	var filter model.SystemTaskFilter
	if err := c.ShouldBindQuery(&filter); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid system task filters"})
		return
	}
	deleted, err := model.DeleteSystemTaskHistory(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"deleted_count": deleted},
	})
}

func GetSystemTask(c *gin.Context) {
	taskID := c.Param("task_id")
	if taskID == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "task id is required",
		})
		return
	}

	task, err := model.GetSystemTaskByTaskID(taskID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if task == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "task not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    task.ToResponse(),
	})
}

// CorrectTaskBilling permits one root-initiated, fenced read of fresh upstream
// facts. task_id is the local numeric row ID, not the provider's task identity.
func CorrectTaskBilling(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("task_id"), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		return
	}
	summary, err := service.CorrectArkSeedanceTaskBilling(c.Request.Context(), id)
	params := map[string]any{"task_id": id, "success": err == nil, "adjusted_quota": summary.AdjustedQuota}
	defer func() {
		const action = "task.billing_correct"
		audit := &model.AuditRequestInfo{Method: c.Request.Method, Route: c.FullPath(), Path: c.FullPath(), Status: c.Writer.Status(), Success: err == nil}
		model.RecordOperationAuditLog(c.GetInt("id"), c.GetInt("role"), auditContentEN(action, params), c.ClientIP(), action, params, auditOperatorInfo(c), audit, c)
		markAuditLogged(c)
	}()
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invalid request"))
		case errors.Is(err, service.ErrTaskBillingCorrectionIneligible):
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request"))
		case errors.Is(err, model.ErrStaleTaskOutcome):
			common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Operation failed"))
		default:
			common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Operation failed"))
		}
		return
	}
	common.ApiSuccess(c, summary)
}
