package config

import (
	"os"
	"strings"
)

type Config struct {
	Port           string
	DatabaseURL    string
	AllowedOrigins []string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "8080"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable"),
		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:5173"), ","),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
