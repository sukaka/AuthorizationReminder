package service

import (
	"context"
	"strings"
	"time"

	"cmdb/internal/repository"
)

type RelationService struct {
	repo *repository.CIRepository
}

type ListRelationInput struct {
	RelationType string
	FromCIUID    string
	ToCIUID      string
	Keyword      string
	Page         int
	PageSize     int
}

type RelationListItemResult struct {
	FromCIUID    string    `json:"from_ci_uid"`
	FromCIName   string    `json:"from_ci_name"`
	FromTypeKey  string    `json:"from_ci_type_key"`
	FromStatus   string    `json:"from_status"`
	FromOwner    string    `json:"from_owner,omitempty"`
	ToCIUID      string    `json:"to_ci_uid"`
	ToCIName     string    `json:"to_ci_name"`
	ToTypeKey    string    `json:"to_ci_type_key"`
	ToStatus     string    `json:"to_status"`
	ToOwner      string    `json:"to_owner,omitempty"`
	RelationType string    `json:"relation_type"`
	Version      uint32    `json:"version"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type RelationListResult struct {
	Items    []RelationListItemResult `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
}

type TopologyNodeResult struct {
	CIUID     string `json:"ci_uid"`
	Name      string `json:"name"`
	CITypeKey string `json:"ci_type_key"`
	Status    string `json:"status"`
	Owner     string `json:"owner,omitempty"`
}

type TopologyEdgeResult struct {
	FromCIUID    string `json:"from_ci_uid"`
	ToCIUID      string `json:"to_ci_uid"`
	RelationType string `json:"relation_type"`
	Version      uint32 `json:"version"`
}

type TopologyResult struct {
	Nodes      []TopologyNodeResult `json:"nodes"`
	Edges      []TopologyEdgeResult `json:"edges"`
	TotalNodes int                  `json:"total_nodes"`
	TotalEdges int                  `json:"total_edges"`
}

type PathHopResult struct {
	FromCIUID    string `json:"from_ci_uid"`
	FromCIName   string `json:"from_ci_name"`
	ToCIUID      string `json:"to_ci_uid"`
	ToCIName     string `json:"to_ci_name"`
	RelationType string `json:"relation_type"`
}

type PathResult struct {
	Found   bool            `json:"found"`
	Hops    []PathHopResult `json:"hops"`
	Message string          `json:"message,omitempty"`
}

func NewRelationService(repo *repository.CIRepository) *RelationService {
	return &RelationService{repo: repo}
}

func (s *RelationService) ListRelations(ctx context.Context, in ListRelationInput) (*RelationListResult, error) {
	if err := validateListRelationInput(&in); err != nil {
		return nil, err
	}

	rows, total, err := s.repo.ListRelations(ctx, repository.RelationListParams{
		RelationType: in.RelationType,
		FromCIUID:    in.FromCIUID,
		ToCIUID:      in.ToCIUID,
		Keyword:      in.Keyword,
		Page:         in.Page,
		PageSize:     in.PageSize,
	})
	if err != nil {
		return nil, err
	}

	items := make([]RelationListItemResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, toRelationListItemResult(row))
	}

	return &RelationListResult{
		Items:    items,
		Total:    total,
		Page:     in.Page,
		PageSize: in.PageSize,
	}, nil
}

func (s *RelationService) Topology(ctx context.Context, keyword string, focusCIUID string, limit int) (*TopologyResult, error) {
	keyword = strings.TrimSpace(keyword)
	focusCIUID = strings.TrimSpace(focusCIUID)
	if limit <= 0 {
		limit = 300
	}
	if limit > 3000 {
		limit = 3000
	}

	rows, err := s.repo.ListRelationEdgesForTopology(ctx, keyword, focusCIUID, limit)
	if err != nil {
		return nil, err
	}

	nodes := make([]TopologyNodeResult, 0, len(rows)*2)
	nodeSet := make(map[string]struct{}, len(rows)*2)
	edges := make([]TopologyEdgeResult, 0, len(rows))

	for _, row := range rows {
		if _, ok := nodeSet[row.FromCIUID]; !ok {
			nodeSet[row.FromCIUID] = struct{}{}
			nodes = append(nodes, TopologyNodeResult{
				CIUID:     row.FromCIUID,
				Name:      row.FromCIName,
				CITypeKey: row.FromTypeKey,
				Status:    row.FromStatus,
				Owner:     row.FromOwner,
			})
		}
		if _, ok := nodeSet[row.ToCIUID]; !ok {
			nodeSet[row.ToCIUID] = struct{}{}
			nodes = append(nodes, TopologyNodeResult{
				CIUID:     row.ToCIUID,
				Name:      row.ToCIName,
				CITypeKey: row.ToTypeKey,
				Status:    row.ToStatus,
				Owner:     row.ToOwner,
			})
		}
		edges = append(edges, TopologyEdgeResult{
			FromCIUID:    row.FromCIUID,
			ToCIUID:      row.ToCIUID,
			RelationType: row.RelationType,
			Version:      row.Version,
		})
	}

	return &TopologyResult{
		Nodes:      nodes,
		Edges:      edges,
		TotalNodes: len(nodes),
		TotalEdges: len(edges),
	}, nil
}

func (s *RelationService) FindPath(ctx context.Context, fromCIUID string, toCIUID string, maxDepth int) (*PathResult, error) {
	fromCIUID = strings.TrimSpace(fromCIUID)
	toCIUID = strings.TrimSpace(toCIUID)
	if fromCIUID == "" || toCIUID == "" {
		return nil, ErrInvalidInput
	}
	if maxDepth <= 0 {
		maxDepth = 6
	}
	if maxDepth > 12 {
		maxDepth = 12
	}
	if fromCIUID == toCIUID {
		return &PathResult{Found: true, Hops: []PathHopResult{}}, nil
	}

	rows, err := s.repo.ListRelationEdgesForTopology(ctx, "", "", 5000)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return &PathResult{Found: false, Hops: []PathHopResult{}, Message: "暂无关系数据"}, nil
	}

	type bfsNode struct {
		CIUID string
		Depth int
	}
	type edgeRef struct {
		From string
		To   string
		Rel  string
	}

	adj := make(map[string][]edgeRef, len(rows))
	nameMap := make(map[string]string, len(rows)*2)
	for _, row := range rows {
		adj[row.FromCIUID] = append(adj[row.FromCIUID], edgeRef{
			From: row.FromCIUID,
			To:   row.ToCIUID,
			Rel:  row.RelationType,
		})
		nameMap[row.FromCIUID] = row.FromCIName
		nameMap[row.ToCIUID] = row.ToCIName
	}

	queue := make([]bfsNode, 0, 128)
	queue = append(queue, bfsNode{CIUID: fromCIUID, Depth: 0})

	visited := map[string]struct{}{fromCIUID: {}}
	parent := make(map[string]string, 128)
	parentEdge := make(map[string]edgeRef, 128)

	found := false
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur.Depth >= maxDepth {
			continue
		}
		for _, edge := range adj[cur.CIUID] {
			if _, ok := visited[edge.To]; ok {
				continue
			}
			visited[edge.To] = struct{}{}
			parent[edge.To] = cur.CIUID
			parentEdge[edge.To] = edge
			if edge.To == toCIUID {
				found = true
				break
			}
			queue = append(queue, bfsNode{CIUID: edge.To, Depth: cur.Depth + 1})
		}
		if found {
			break
		}
	}

	if !found {
		return &PathResult{
			Found:   false,
			Hops:    []PathHopResult{},
			Message: "在最大深度内未找到依赖路径",
		}, nil
	}

	reversed := make([]PathHopResult, 0, maxDepth)
	cur := toCIUID
	for cur != fromCIUID {
		edge := parentEdge[cur]
		reversed = append(reversed, PathHopResult{
			FromCIUID:    edge.From,
			FromCIName:   nameMap[edge.From],
			ToCIUID:      edge.To,
			ToCIName:     nameMap[edge.To],
			RelationType: edge.Rel,
		})
		cur = parent[cur]
	}

	hops := make([]PathHopResult, 0, len(reversed))
	for i := len(reversed) - 1; i >= 0; i-- {
		hops = append(hops, reversed[i])
	}

	return &PathResult{
		Found: true,
		Hops:  hops,
	}, nil
}

func validateListRelationInput(in *ListRelationInput) error {
	in.RelationType = strings.TrimSpace(in.RelationType)
	in.FromCIUID = strings.TrimSpace(in.FromCIUID)
	in.ToCIUID = strings.TrimSpace(in.ToCIUID)
	in.Keyword = strings.TrimSpace(in.Keyword)

	if in.RelationType != "" && !allowedRelationType(in.RelationType) {
		return ErrInvalidInput
	}
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize <= 0 {
		in.PageSize = 20
	}
	if in.PageSize > 200 {
		in.PageSize = 200
	}
	return nil
}

func toRelationListItemResult(row repository.RelationEdgeRow) RelationListItemResult {
	return RelationListItemResult{
		FromCIUID:    row.FromCIUID,
		FromCIName:   row.FromCIName,
		FromTypeKey:  row.FromTypeKey,
		FromStatus:   row.FromStatus,
		FromOwner:    row.FromOwner,
		ToCIUID:      row.ToCIUID,
		ToCIName:     row.ToCIName,
		ToTypeKey:    row.ToTypeKey,
		ToStatus:     row.ToStatus,
		ToOwner:      row.ToOwner,
		RelationType: row.RelationType,
		Version:      row.Version,
		UpdatedAt:    row.UpdatedAt,
	}
}
