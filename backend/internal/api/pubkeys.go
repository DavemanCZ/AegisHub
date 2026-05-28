package api

import (
	"encoding/json"
	"net/http"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

type PubKeyHandler struct {
	DB *storage.DB
}

type UserPubKey struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	PublicKeyJWK string `json:"public_key_jwk"`
}

// HandlePubKeys – GET all users' public keys, PUT upload own key
func (h *PubKeyHandler) HandlePubKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := h.DB.Query(`
			SELECT u.id::text, u.username, COALESCE(pk.public_key_jwk, '')
			FROM users u
			LEFT JOIN public_keys pk ON pk.user_id = u.id
			ORDER BY u.username
		`)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var keys []UserPubKey
		for rows.Next() {
			var k UserPubKey
			rows.Scan(&k.UserID, &k.Username, &k.PublicKeyJWK)
			keys = append(keys, k)
		}
		if keys == nil {
			keys = []UserPubKey{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(keys)

	case http.MethodPut:
		var req struct {
			PublicKeyJWK string `json:"public_key_jwk"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PublicKeyJWK == "" {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		_, err := h.DB.Exec(`
			INSERT INTO public_keys (user_id, public_key_jwk, updated_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (user_id) DO UPDATE SET public_key_jwk = EXCLUDED.public_key_jwk, updated_at = NOW()
		`, userID, req.PublicKeyJWK)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
