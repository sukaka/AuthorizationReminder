package service

import (
	"context"
	"fmt"
	"time"

	"cmdb/internal/repository"
)

type DashboardService struct {
	repo *repository.CIRepository
}

type DashboardOverviewResult struct {
	Totals            DashboardTotalsResult         `json:"totals"`
	TypeDistribution  []DashboardDistributionResult `json:"type_distribution"`
	GrowthTrend       []DashboardTrendResult        `json:"growth_trend"`
	OwnerDistribution []DashboardDistributionResult `json:"owner_distribution"`
	RecentChanges     []DashboardRecentChangeResult `json:"recent_changes"`
}

type DashboardTotalsResult struct {
	AssetTotal   int64 `json:"asset_total"`
	MonthlyNew   int64 `json:"monthly_new"`
	PendingCount int64 `json:"pending_count"`
	AnomalyCount int64 `json:"anomaly_count"`
}

type DashboardDistributionResult struct {
	Key   string `json:"key,omitempty"`
	Name  string `json:"name"`
	Total int64  `json:"total"`
}

type DashboardTrendResult struct {
	Date  string `json:"date"`
	Total int64  `json:"total"`
}

type DashboardRecentChangeResult struct {
	CIUID        string    `json:"ci_uid,omitempty"`
	CIName       string    `json:"ci_name,omitempty"`
	Operation    string    `json:"operation"`
	OperatorName string    `json:"operator_name,omitempty"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func NewDashboardService(repo *repository.CIRepository) *DashboardService {
	return &DashboardService{repo: repo}
}

func (s *DashboardService) Overview(ctx context.Context) (*DashboardOverviewResult, error) {
	totals, err := s.repo.GetDashboardTotals(ctx)
	if err != nil {
		return nil, err
	}

	typeRows, err := s.repo.GetDashboardTypeDistribution(ctx, 8)
	if err != nil {
		return nil, err
	}

	ownerRows, err := s.repo.GetDashboardOwnerDistribution(ctx, 8)
	if err != nil {
		return nil, err
	}

	trendRows, err := s.repo.GetDashboardGrowthTrend(ctx, 7)
	if err != nil {
		return nil, err
	}

	changeRows, err := s.repo.GetDashboardRecentChanges(ctx, 8)
	if err != nil {
		return nil, err
	}

	trend := fillRecentDays(trendRows, 7)

	result := &DashboardOverviewResult{
		Totals: DashboardTotalsResult{
			AssetTotal:   totals.AssetTotal,
			MonthlyNew:   totals.MonthlyNew,
			PendingCount: totals.PendingCount,
			AnomalyCount: totals.AnomalyCount,
		},
		TypeDistribution:  make([]DashboardDistributionResult, 0, len(typeRows)),
		GrowthTrend:       trend,
		OwnerDistribution: make([]DashboardDistributionResult, 0, len(ownerRows)),
		RecentChanges:     make([]DashboardRecentChangeResult, 0, len(changeRows)),
	}

	for _, item := range typeRows {
		result.TypeDistribution = append(result.TypeDistribution, DashboardDistributionResult{
			Key:   item.TypeKey,
			Name:  firstNonEmpty(item.TypeName, item.TypeKey, "未分类"),
			Total: item.Total,
		})
	}

	for _, item := range ownerRows {
		result.OwnerDistribution = append(result.OwnerDistribution, DashboardDistributionResult{
			Name:  firstNonEmpty(item.Owner, "未分配"),
			Total: item.Total,
		})
	}

	for _, item := range changeRows {
		result.RecentChanges = append(result.RecentChanges, DashboardRecentChangeResult{
			CIUID:        item.CIUID,
			CIName:       item.CIName,
			Operation:    mapOperationLabel(item.OpType),
			OperatorName: firstNonEmpty(item.OperatorName, "系统"),
			OccurredAt:   item.CreatedAt,
		})
	}

	return result, nil
}

func mapOperationLabel(op string) string {
	switch op {
	case "create":
		return "新增配置项"
	case "update":
		return "更新配置项"
	case "relation_update":
		return "更新关系"
	case "delete":
		return "删除配置项"
	case "reconcile":
		return "数据对账"
	default:
		if op == "" {
			return "变更操作"
		}
		return fmt.Sprintf("操作：%s", op)
	}
}

func fillRecentDays(rows []repository.DashboardTrendRow, days int) []DashboardTrendResult {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Day] = row.Total
	}

	today := time.Now()
	result := make([]DashboardTrendResult, 0, days)
	for i := days - 1; i >= 0; i-- {
		day := today.AddDate(0, 0, -i)
		dateKey := day.Format("2006-01-02")
		result = append(result, DashboardTrendResult{
			Date:  dateKey,
			Total: counts[dateKey],
		})
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
