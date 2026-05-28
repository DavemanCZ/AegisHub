package api

import (
	"encoding/json"
	"net/http"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

type ObjectsHandler struct {
	DB *storage.DB
}

type EncryptedObject struct {
	ID         uuid.UUID `json:"id"`
	Type       string    `json:"type"`
	Version    int       `json:"version"`
	Ciphertext []byte    `json:"ciphertext"`
	Nonce      []byte    `json:"nonce"`
	UpdatedAt  string    `json:"updated_at"`
}

func (h *ObjectsHandler) HandleObjects(w http.ResponseWriter, r *http.Request) {
	// Příklad jednoduchého routeru
	switch r.Method {
	case http.MethodGet:
		userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
		if !ok || userID == uuid.Nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		rows, err := h.DB.Query("SELECT id, type, version, ciphertext, nonce, updated_at FROM encrypted_objects WHERE user_id = $1", userID)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var objects []EncryptedObject
		for rows.Next() {
			var obj EncryptedObject
			if err := rows.Scan(&obj.ID, &obj.Type, &obj.Version, &obj.Ciphertext, &obj.Nonce, &obj.UpdatedAt); err != nil {
				continue
			}
			objects = append(objects, obj)
		}

		json.NewEncoder(w).Encode(objects)

	case http.MethodPost:
		userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
		if !ok || userID == uuid.Nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var obj EncryptedObject
		if err := json.NewDecoder(r.Body).Decode(&obj); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if obj.ID == uuid.Nil {
			obj.ID = uuid.New()
		}

		_, err := h.DB.Exec(
			`INSERT INTO encrypted_objects (id, user_id, type, version, ciphertext, nonce)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (id) DO UPDATE SET
			 version = EXCLUDED.version,
			 ciphertext = EXCLUDED.ciphertext,
			 nonce = EXCLUDED.nonce,
			 updated_at = CURRENT_TIMESTAMP`,
			obj.ID, userID, obj.Type, obj.Version, obj.Ciphertext, obj.Nonce,
		)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(obj)

	case http.MethodDelete:
		userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
		if !ok || userID == uuid.Nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			http.Error(w, "Missing id", http.StatusBadRequest)
			return
		}

		_, err := h.DB.Exec("DELETE FROM encrypted_objects WHERE id = $1 AND user_id = $2", idStr, userID)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
