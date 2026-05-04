package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"

	"realtourflow/internal/config"
	"realtourflow/internal/db"
	"realtourflow/internal/handlers"
	"realtourflow/internal/middleware"
)

func main() {
	cfg := config.Load()

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()

	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CORS(cfg.AllowedOrigins))

	h := handlers.New(database)
	r.Mount("/api", h.Routes(middleware.Auth0(cfg.Auth0Domain, cfg.Auth0Audience)))

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%s", cfg.Port),
		Handler: r,
	}

	go func() {
		log.Printf("server listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down server")
}
