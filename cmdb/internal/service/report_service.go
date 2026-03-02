package service

import (
	"context"
	"math"
	"time"

	"cmdb/internal/repository"
)

type ReportService struct {
	repo *repository.CIRepository
}

type ReportAnalysisResult struct {
	Days                    int                          `json:"days"`
	GeneratedAt             time.Time                    `json:"generated_at"`
	Totals                  ReportTotalsResult           `json:"totals"`
	ChangeFrequencyTrend    []ReportTrendPoint           `json:"change_frequency_trend"`
	RelationComplexityTrend []ReportComplexityTrendPoint `json:"relation_complexity_trend"`
}

type ReportTotalsResult struct {
	AssetTotal      int64   `json:"asset_total"`
	ActiveTotal     int64   `json:"active_total"`
	DiscoveryTotal  int64   `json:"discovery_total"`
	CloudTotal      int64   `json:"cloud_total"`
	RelationTotal   int64   `json:"relation_total"`
	ChangeTotal     int64   `json:"change_total"`
	ComplexityIndex float64 `json:"complexity_index"`
}

type ReportTrendPoint struct {
	Date  string `json:"date"`
	Total int64  `json:"total"`
}

type ReportComplexityTrendPoint struct {
	Date            string  `json:"date"`
	RelationTotal   int64   `json:"relation_total"`
	AssetTotal      int64   `json:"asset_total"`
	ComplexityIndex float64 `json:"complexity_index"`
}

func NewReportService(repo *repository.CIRepository) *ReportService {
	return &ReportService{repo: repo}
}

func (s *ReportService) Analysis(ctx context.Context, days int) (*ReportAnalysisResult, error) {
	days = normalizeReportDays(days)

	totalsRow, err := s.repo.GetReportTotals(ctx)
	if err != nil {
		return nil, err
	}
	changeRows, err := s.repo.GetReportChangeDailyCount(ctx, days)
	if err != nil {
		return nil, err
	}
	relationRows, err := s.repo.GetReportRelationDailyNew(ctx, days)
	if err != nil {
		return nil, err
	}
	assetRows, err := s.repo.GetReportAssetDailyNew(ctx, days)
	if err != nil {
		return nil, err
	}

	dayKeys := buildRecentDayKeys(days, time.Now())
	changeByDay := toDayCountMap(changeRows)
	relationByDay := toDayCountMap(relationRows)
	assetByDay := toDayCountMap(assetRows)

	changeTrend := make([]ReportTrendPoint, 0, len(dayKeys))
	var changeTotal int64
	for _, day := range dayKeys {
		total := changeByDay[day]
		changeTotal += total
		changeTrend = append(changeTrend, ReportTrendPoint{
			Date:  day,
			Total: total,
		})
	}

	assetWindowTotal := sumDayCounts(assetByDay)
	relationWindowTotal := sumDayCounts(relationByDay)
	assetBaseline := totalsRow.AssetTotal - assetWindowTotal
	if assetBaseline < 0 {
		assetBaseline = 0
	}
	relationBaseline := totalsRow.RelationTotal - relationWindowTotal
	if relationBaseline < 0 {
		relationBaseline = 0
	}

	complexityTrend := buildRelationComplexityTrendWithBaseline(dayKeys, relationByDay, assetByDay, relationBaseline, assetBaseline)
	currentComplexity := safeRatio(totalsRow.RelationTotal, totalsRow.AssetTotal)
	if len(complexityTrend) > 0 {
		currentComplexity = complexityTrend[len(complexityTrend)-1].ComplexityIndex
	}

	return &ReportAnalysisResult{
		Days:        days,
		GeneratedAt: time.Now(),
		Totals: ReportTotalsResult{
			AssetTotal:      totalsRow.AssetTotal,
			ActiveTotal:     totalsRow.ActiveTotal,
			DiscoveryTotal:  totalsRow.DiscoveryTotal,
			CloudTotal:      totalsRow.CloudTotal,
			RelationTotal:   totalsRow.RelationTotal,
			ChangeTotal:     changeTotal,
			ComplexityIndex: currentComplexity,
		},
		ChangeFrequencyTrend:    changeTrend,
		RelationComplexityTrend: complexityTrend,
	}, nil
}

func buildRelationComplexityTrend(days []string, relationNewByDay, assetNewByDay map[string]int64) []ReportComplexityTrendPoint {
	return buildRelationComplexityTrendWithBaseline(days, relationNewByDay, assetNewByDay, 0, 0)
}

func buildRelationComplexityTrendWithBaseline(
	days []string,
	relationNewByDay map[string]int64,
	assetNewByDay map[string]int64,
	relationBaseline int64,
	assetBaseline int64,
) []ReportComplexityTrendPoint {
	relationTotal := relationBaseline
	assetTotal := assetBaseline
	result := make([]ReportComplexityTrendPoint, 0, len(days))
	for _, day := range days {
		relationTotal += relationNewByDay[day]
		assetTotal += assetNewByDay[day]
		result = append(result, ReportComplexityTrendPoint{
			Date:            day,
			RelationTotal:   relationTotal,
			AssetTotal:      assetTotal,
			ComplexityIndex: safeRatio(relationTotal, assetTotal),
		})
	}
	return result
}

func normalizeReportDays(days int) int {
	if days <= 0 {
		return 30
	}
	if days < 7 {
		return 7
	}
	if days > 90 {
		return 90
	}
	return days
}

func buildRecentDayKeys(days int, now time.Time) []string {
	if days <= 0 {
		days = 30
	}
	result := make([]string, 0, days)
	for i := days - 1; i >= 0; i-- {
		result = append(result, now.AddDate(0, 0, -i).Format("2006-01-02"))
	}
	return result
}

func toDayCountMap(rows []repository.ReportDailyCountRow) map[string]int64 {
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.Day] = row.Total
	}
	return result
}

func sumDayCounts(items map[string]int64) int64 {
	var total int64
	for _, value := range items {
		total += value
	}
	return total
}

func safeRatio(numerator int64, denominator int64) float64 {
	if denominator <= 0 {
		return 0
	}
	value := float64(numerator) / float64(denominator)
	return math.Round(value*1_000_000) / 1_000_000
}
