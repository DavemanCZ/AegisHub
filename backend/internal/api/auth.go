package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/aegis/backend/internal/storage"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	DB        *storage.DB
	JWTSecret []byte
}

type RegisterRequest struct {
	Username          string `json:"username"`
	AuthToken         string `json:"auth_token"` // Toto je HASH z Master Key (nikoliv heslo)
	Salt              []byte `json:"salt"`
	EncryptedVaultKey []byte `json:"encrypted_vault_key"`
}

type LoginRequest struct {
	Username string `json:"username"`
}

type VerifyRequest struct {
	Username  string `json:"username"`
	AuthToken string `json:"auth_token"`
}

func (h *AuthHandler) HandleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var userCount int
	err := h.DB.QueryRow("SELECT count(*) FROM users").Scan(&userCount)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	isAdmin := userCount == 0

	if !isAdmin {
		var regEnabled string
		err := h.DB.QueryRow("SELECT value FROM settings WHERE key = 'registration_enabled'").Scan(&regEnabled)
		if err == nil && regEnabled == "false" {
			http.Error(w, "Registration is currently disabled", http.StatusForbidden)
			return
		}
	}

	// Hash AuthToken using bcrypt before storing
	hashedAuth, err := bcrypt.GenerateFromPassword([]byte(req.AuthToken), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	userID := uuid.New()
	_, err = h.DB.Exec(
		"INSERT INTO users (id, username, auth_hash, salt, encrypted_vault_key, is_admin) VALUES ($1, $2, $3, $4, $5, $6)",
		userID, req.Username, hashedAuth, req.Salt, req.EncryptedVaultKey, isAdmin,
	)
	if err != nil {
		http.Error(w, "Username may already exist", http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "User registered"})
}

func (h *AuthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var salt []byte
	err := h.DB.QueryRow("SELECT salt FROM users WHERE username = $1", req.Username).Scan(&salt)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"salt": salt})
}

func (h *AuthHandler) HandleVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req VerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var userID uuid.UUID
	var authHash string
	var encVaultKey []byte
	var isAdmin bool
	var mustChange bool

	err := h.DB.QueryRow("SELECT id, auth_hash, encrypted_vault_key, is_admin, COALESCE(must_change_password, false) FROM users WHERE username = $1", req.Username).Scan(&userID, &authHash, &encVaultKey, &isAdmin, &mustChange)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(authHash), []byte(req.AuthToken)); err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID.String(),
		"exp": time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(h.JWTSecret)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":               tokenString,
		"encrypted_vault_key": encVaultKey,
		"is_admin":            isAdmin,
		"must_change_password": mustChange,
	})
}

// HandleChangePassword – user changes their own password (old → new), re-encrypts vault_key
func (h *AuthHandler) HandleChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		OldAuthToken        string `json:"old_auth_token"`
		NewAuthToken        string `json:"new_auth_token"`
		NewEncryptedVaultKey []byte `json:"new_encrypted_vault_key"`
		NewSalt             []byte `json:"new_salt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.OldAuthToken == "" || req.NewAuthToken == "" {
		http.Error(w, "Missing fields", http.StatusBadRequest)
		return
	}

	// Verify old password
	var currentHash string
	if err := h.DB.QueryRow("SELECT auth_hash FROM users WHERE id = $1", userID).Scan(&currentHash); err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.OldAuthToken)); err != nil {
		http.Error(w, "Incorrect current password", http.StatusUnauthorized)
		return
	}

	// Hash new auth token
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewAuthToken), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	// Update: new hash + new encrypted vault key + new salt + clear must_change flag
	_, err = h.DB.Exec(
		`UPDATE users SET auth_hash = $1, encrypted_vault_key = $2, salt = $3, must_change_password = false WHERE id = $4`,
		string(newHash), req.NewEncryptedVaultKey, req.NewSalt, userID,
	)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
