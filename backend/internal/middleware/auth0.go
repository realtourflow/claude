package middleware

import (
	"context"
	"net/http"
	"net/url"
	"time"

	jwtmiddleware "github.com/auth0/go-jwt-middleware/v2"
	"github.com/auth0/go-jwt-middleware/v2/jwks"
	"github.com/auth0/go-jwt-middleware/v2/validator"
)

type contextKey string

const ClaimsKey contextKey = "claims"

type CustomClaims struct {
	Roles []string `json:"https://realtourflow.com/roles"`
}

func (c *CustomClaims) Validate(_ context.Context) error { return nil }

func Auth0(domain, audience string) func(http.Handler) http.Handler {
	issuerURL, _ := url.Parse("https://" + domain + "/")
	provider := jwks.NewCachingProvider(issuerURL, 5*time.Minute)

	jwtValidator, _ := validator.New(
		provider.KeyFunc,
		validator.RS256,
		issuerURL.String(),
		[]string{audience},
		validator.WithCustomClaims(func() validator.CustomClaims {
			return &CustomClaims{}
		}),
		validator.WithAllowedClockSkew(time.Minute),
	)

	m := jwtmiddleware.New(jwtValidator.ValidateToken)
	return m.CheckJWT
}

func GetClaims(r *http.Request) *validator.ValidatedClaims {
	claims, _ := r.Context().Value(jwtmiddleware.ContextKey{}).(*validator.ValidatedClaims)
	return claims
}

func GetRoles(r *http.Request) []string {
	claims := GetClaims(r)
	if claims == nil {
		return nil
	}
	custom, ok := claims.CustomClaims.(*CustomClaims)
	if !ok {
		return nil
	}
	return custom.Roles
}
