package config

import (
	"os"
	"strings"
)

type Config struct {
	Port           string
	DatabaseURL    string
	AllowedOrigins []string
	Auth0Domain    string
	Auth0Audience  string
	S3Bucket       string
	AWSRegion      string
	AriveAPIURL       string
	AriveAPIKey       string
	AriveClientID     string
	AriveClientSecret string
	AriveWebhookURL   string
	StripeSecretKey    string
	StripeWebhookSecret string
	ResendAPIKey        string
	FrontendURL         string
	DocuSignIntegrationKey string
	DocuSignAccountID      string
	DocuSignUserID         string
	DocuSignPrivateKey     string
	DocuSignBaseURL        string
}

func Load() *Config {
	return &Config{
		Port:            getEnv("PORT", "8080"),
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable"),
		AllowedOrigins:  strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:5173"), ","),
		Auth0Domain:     getEnv("AUTH0_DOMAIN", ""),
		Auth0Audience:   getEnv("AUTH0_AUDIENCE", ""),
		S3Bucket:        getEnv("S3_BUCKET", "realtourflow-documents"),
		AWSRegion:       getEnv("AWS_REGION", "us-east-1"),
		AriveAPIURL:         getEnv("ARIVE_API_URL", "https://2720886.myarive.com"),
		AriveAPIKey:         getEnv("ARIVE_API_KEY", ""),
		AriveClientID:       getEnv("ARIVE_CLIENT_ID", ""),
		AriveClientSecret:   getEnv("ARIVE_CLIENT_SECRET", ""),
		AriveWebhookURL:     getEnv("ARIVE_WEBHOOK_URL", ""),
		StripeSecretKey:     getEnv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET", ""),
		ResendAPIKey:        getEnv("RESEND_API_KEY", ""),
		FrontendURL:         getEnv("FRONTEND_URL", "http://localhost:5173"),
		DocuSignIntegrationKey: getEnv("DOCUSIGN_INTEGRATION_KEY", ""),
		DocuSignAccountID:      getEnv("DOCUSIGN_ACCOUNT_ID", ""),
		DocuSignUserID:         getEnv("DOCUSIGN_USER_ID", ""),
		DocuSignPrivateKey:     getEnv("DOCUSIGN_PRIVATE_KEY", ""),
		DocuSignBaseURL:        getEnv("DOCUSIGN_BASE_URL", "https://demo.docusign.net"),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
