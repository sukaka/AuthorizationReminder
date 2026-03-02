package service

import (
	"math"
	"testing"
)

func TestBuildRelationComplexityTrend(t *testing.T) {
	days := []string{"2026-02-27", "2026-02-28", "2026-03-01"}
	relationNew := map[string]int64{
		"2026-02-27": 1,
		"2026-02-28": 2,
	}
	assetNew := map[string]int64{
		"2026-02-27": 2,
		"2026-02-28": 1,
		"2026-03-01": 1,
	}

	trend := buildRelationComplexityTrend(days, relationNew, assetNew)
	if len(trend) != 3 {
		t.Fatalf("expected 3 points, got %d", len(trend))
	}

	assertFloatClose(t, trend[0].ComplexityIndex, 0.5)
	assertFloatClose(t, trend[1].ComplexityIndex, 1.0)
	assertFloatClose(t, trend[2].ComplexityIndex, 0.75)

	if trend[2].RelationTotal != 3 {
		t.Fatalf("expected final relation total 3, got %d", trend[2].RelationTotal)
	}
	if trend[2].AssetTotal != 4 {
		t.Fatalf("expected final asset total 4, got %d", trend[2].AssetTotal)
	}
}

func assertFloatClose(t *testing.T, got float64, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.000001 {
		t.Fatalf("float mismatch: got=%f want=%f", got, want)
	}
}
