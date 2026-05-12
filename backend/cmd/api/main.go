package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	appconfig "realtourflow/internal/config"
	"realtourflow/internal/arive"
	"realtourflow/internal/db"
	"realtourflow/internal/docusign"
	"realtourflow/internal/handlers"
	"realtourflow/internal/middleware"
)

func main() {
	cfg := appconfig.Load()

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()

	if err := runMigrations(database); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}

	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.AWSRegion),
	)
	if err != nil {
		log.Fatalf("failed to load AWS config: %v", err)
	}
	s3Client := s3.NewFromConfig(awsCfg)

	ariveClient := arive.New(cfg.AriveAPIURL, cfg.AriveAPIKey, cfg.AriveClientID, cfg.AriveClientSecret)
	if ariveClient.Enabled() && cfg.AriveWebhookURL != "" {
		go func() {
			if err := ariveClient.RegisterWebhooks(context.Background(), cfg.AriveWebhookURL); err != nil {
				log.Printf("warn: arive webhook registration failed: %v", err)
			} else {
				log.Println("arive webhooks registered")
			}
		}()
	}

	dsClient, dsErr := docusign.New(
		cfg.DocuSignIntegrationKey,
		cfg.DocuSignUserID,
		cfg.DocuSignAccountID,
		cfg.DocuSignPrivateKey,
		cfg.DocuSignBaseURL,
	)
	if dsErr != nil {
		log.Printf("warn: docusign init failed: %v", dsErr)
		dsClient, _ = docusign.New("", "", "", "", "")
	} else if dsClient.Enabled() {
		log.Println("docusign configured")
	}

	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CORS(cfg.AllowedOrigins))

	h := handlers.New(database, s3Client, cfg.S3Bucket, ariveClient, cfg.StripeSecretKey, cfg.StripeWebhookSecret, cfg.ResendAPIKey, cfg.FrontendURL, dsClient)
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

func runMigrations(db *sql.DB) error {
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("create migration driver: %w", err)
	}
	m, err := migrate.NewWithDatabaseInstance("file://migrations", "postgres", driver)
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("run migrations: %w", err)
	}
	log.Println("migrations up to date")
	return nil
}
