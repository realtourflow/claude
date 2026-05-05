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
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable"),
		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:5173"), ","),
		Auth0Domain:    getEnv("AUTH0_DOMAIN", ""),
		Auth0Audience:  getEnv("AUTH0_AUDIENCE", ""),
		S3Bucket:       getEnv("S3_BUCKET", "realtourflow-documents"),
		AWSRegion:      getEnv("AWS_REGION", "us-east-1"),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
