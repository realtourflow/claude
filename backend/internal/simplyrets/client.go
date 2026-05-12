package simplyrets

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const baseURL = "https://api.simplyrets.com"

type Client struct {
	key    string
	secret string
	http   *http.Client
}

func New(key, secret string) *Client {
	return &Client{
		key:    key,
		secret: secret,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

type SearchParams struct {
	MinPrice int
	MaxPrice int
	Cities   []string
	MinBeds  int
	Status   string
	Limit    int
}

type ListingAddress struct {
	Full       string `json:"full"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postalCode"`
}

type ListingProperty struct {
	Bedrooms  int     `json:"bedrooms"`
	BathsFull int     `json:"bathsFull"`
	Area      float64 `json:"area"`
	SubType   string  `json:"subType"`
}

type ListingMLS struct {
	Status       string `json:"status"`
	DaysOnMarket int    `json:"daysOnMarket"`
	MlsID        string `json:"mlsId"`
}

type Listing struct {
	MlsID     string          `json:"mlsId"`
	ListPrice float64         `json:"listPrice"`
	Address   ListingAddress  `json:"address"`
	Property  ListingProperty `json:"property"`
	Photos    []string        `json:"photos"`
	MLS       ListingMLS      `json:"mls"`
	Remarks   string          `json:"remarks"`
}

func (c *Client) SearchListings(params SearchParams) ([]Listing, error) {
	q := url.Values{}
	if params.MinPrice > 0 {
		q.Set("minprice", strconv.Itoa(params.MinPrice))
	}
	if params.MaxPrice > 0 {
		q.Set("maxprice", strconv.Itoa(params.MaxPrice))
	}
	for _, city := range params.Cities {
		q.Add("cities", city)
	}
	if params.MinBeds > 0 {
		q.Set("minbeds", strconv.Itoa(params.MinBeds))
	}
	status := "Active"
	if params.Status != "" {
		status = params.Status
	}
	q.Set("status", status)
	limit := 12
	if params.Limit > 0 {
		limit = params.Limit
	}
	q.Set("limit", strconv.Itoa(limit))

	req, err := http.NewRequest("GET", baseURL+"/properties?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.key, c.secret)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("invalid MLS credentials")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("simplyrets: %s", resp.Status)
	}

	var listings []Listing
	if err := json.NewDecoder(resp.Body).Decode(&listings); err != nil {
		return nil, err
	}
	return listings, nil
}
