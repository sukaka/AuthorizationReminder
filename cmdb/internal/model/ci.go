package model

import "time"

type CI struct {
	ID         uint64
	CIUID      string
	CITypeID   uint64
	Name       string
	UniqueKey  string
	Status     string
	Owner      string
	Source     string
	SourceRef  string
	ExtraAttrs []byte
	Version    uint32
	Deleted    bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type CIRelation struct {
	ID           uint64
	FromCIID     uint64
	ToCIID       uint64
	RelationType string
	Attributes   []byte
	Version      uint32
	Deleted      bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
