package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cmdb/internal/config"
	"cmdb/internal/db"
	"cmdb/internal/events"
	"cmdb/internal/handler"
	"cmdb/internal/repository"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	sqlDB, err := db.NewMySQL(cfg)
	if err != nil {
		log.Fatalf("mysql connect failed: %v", err)
	}
	defer sqlDB.Close()

	mongoClient, err := db.NewMongo(cfg)
	if err != nil {
		log.Fatalf("mongo connect failed: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = mongoClient.Disconnect(ctx)
	}()

	r := handler.NewRouter(cfg, sqlDB, mongoClient)

	var relay *events.OutboxRelay
	relayCtx, relayCancel := context.WithCancel(context.Background())
	defer relayCancel()
	if cfg.OutboxEnabled {
		outboxRepo := repository.NewOutboxRepository(sqlDB)
		relay = events.NewOutboxRelay(cfg, outboxRepo)
		go relay.Run(relayCtx)
		log.Printf("outbox relay enabled")
	}

	srv := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      r,
		ReadTimeout:  time.Duration(cfg.ReadTimeoutSec) * time.Second,
		WriteTimeout: time.Duration(cfg.WriteTimeoutSec) * time.Second,
	}

	go func() {
		log.Printf("cmdb listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	relayCancel()
	if relay != nil {
		relay.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown failed: %v", err)
	}
}
