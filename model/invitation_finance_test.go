package model

import (
	"github.com/stretchr/testify/require"
	"math"
	"testing"
)

func TestInvitationRewardArithmetic(t *testing.T) {
	for _, tc := range []struct {
		paid int64
		rate int
		want int64
	}{{10000, 500, 5000}, {10000, 700, 7000}, {10000, 1000, 10000}, {7000, 700, 4900}, {1, 1, 0}, {9007199254740993, 1000, 9007199254740993}} {
		got, err := invitationRewardPoints(tc.paid, tc.rate)
		require.NoError(t, err)
		require.Equal(t, tc.want, got)
	}
	_, err := invitationRewardPoints(math.MaxInt64, 10000)
	require.Error(t, err)
	_, err = invitationRewardPoints(-1, 500)
	require.Error(t, err)
}
