package service

import (
	"context"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
	"sync"
	"sync/atomic"
	"time"
)

var invitationTaskOnce sync.Once
var invitationTaskRunning atomic.Bool

func StartInvitationRewardTask() {
	invitationTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			runInvitationRewardTask()
			for range ticker.C {
				runInvitationRewardTask()
			}
		})
	})
}
func runInvitationRewardTask() {
	if !invitationTaskRunning.CompareAndSwap(false, true) {
		return
	}
	defer invitationTaskRunning.Store(false)
	if _, err := model.ProcessInvitationRewards(100); err != nil {
		logger.LogWarn(context.Background(), common.LogText("invitation reward task failed: %v", err))
	}
}
