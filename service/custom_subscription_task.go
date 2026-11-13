package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

const customSubscriptionExpiryBatchSize = 300

var (
	customSubscriptionExpiryOnce    sync.Once
	customSubscriptionExpiryRunning atomic.Bool
)

func StartCustomSubscriptionExpiryTask() {
	customSubscriptionExpiryOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			runCustomSubscriptionExpiryOnce()
			for range ticker.C {
				runCustomSubscriptionExpiryOnce()
			}
		})
	})
}

func runCustomSubscriptionExpiryOnce() {
	if !customSubscriptionExpiryRunning.CompareAndSwap(false, true) {
		return
	}
	defer customSubscriptionExpiryRunning.Store(false)
	for {
		n, err := model.ExpireDueCustomSubscriptions(customSubscriptionExpiryBatchSize)
		if err != nil {
			logger.LogWarn(context.Background(), common.LogText("custom subscription expiry task failed: %v", err))
			return
		}
		if n < customSubscriptionExpiryBatchSize {
			return
		}
	}
}
