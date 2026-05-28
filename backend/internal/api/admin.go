package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

type AdminHandler struct {
	DB *storage.DB
}

type UserInfo struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	IsAdmin   bool      `json:"is_admin"`
	CreatedAt string    `json:"created_at"`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (h *AdminHandler) isAdmin(r *http.Request) bool {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		return false
	}
	var isAdmin bool
	err := h.DB.QueryRow("SELECT is_admin FROM users WHERE id = $1", userID).Scan(&isAdmin)
	if err != nil {
		return false
	}
	return isAdmin
}

func (h *AdminHandler) logAction(userID uuid.UUID, action, details string) {
	_, err := h.DB.Exec(
		`INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3)`,
		userID, action, details,
	)
	if err != nil {
		log.Printf("audit_log error: %v", err)
	}
}

// ── Users (GET list, DELETE, POST actions) ────────────────────────────────────

func (h *AdminHandler) HandleUsers(w http.ResponseWriter, r *http.Request) {
	if !h.isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	callerID, _ := r.Context().Value(userIDKey).(uuid.UUID)

	switch r.Method {
	case http.MethodGet:
		rows, err := h.DB.Query("SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC")
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var users []UserInfo
		for rows.Next() {
			var u UserInfo
			if err := rows.Scan(&u.ID, &u.Username, &u.IsAdmin, &u.CreatedAt); err == nil {
				users = append(users, u)
			}
		}
		if users == nil {
			users = []UserInfo{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(users)

	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			http.Error(w, "Missing user id", http.StatusBadRequest)
			return
		}
		if idStr == callerID.String() {
			http.Error(w, "Cannot delete yourself", http.StatusBadRequest)
			return
		}
		_, err := h.DB.Exec("DELETE FROM users WHERE id = $1", idStr)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		h.logAction(callerID, "user_deleted", "target_id="+idStr)
		w.WriteHeader(http.StatusNoContent)

	case http.MethodPost:
		// Actions: promote/demote, reset password
		action := r.URL.Query().Get("action")
		targetID := r.URL.Query().Get("id")
		if action == "" || targetID == "" {
			http.Error(w, "Missing params", http.StatusBadRequest)
			return
		}
		switch action {
		case "promote":
			// Cannot demote yourself
			if targetID == callerID.String() {
				http.Error(w, "Cannot change your own admin status", http.StatusForbidden)
				return
			}
			// Check if target is currently admin – if so, ensure there will be another admin
			var targetIsAdmin bool
			h.DB.QueryRow(`SELECT is_admin FROM users WHERE id = $1`, targetID).Scan(&targetIsAdmin)
			if targetIsAdmin {
				// Count remaining admins after demotion
				var adminCount int
				h.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin = true`).Scan(&adminCount)
				if adminCount <= 1 {
					http.Error(w, "Cannot remove the last administrator", http.StatusForbidden)
					return
				}
			}
			h.DB.Exec(`UPDATE users SET is_admin = NOT is_admin WHERE id = $1`, targetID)
			h.logAction(callerID, "user_promote_toggle", "target_id="+targetID)
			w.WriteHeader(http.StatusNoContent)
		case "force_change":
			// Admin only marks flag – user must change password on next login
			_, err := h.DB.Exec(`UPDATE users SET must_change_password = true WHERE id = $1 AND is_admin = false`, targetID)
			if err != nil {
				http.Error(w, "Server error", http.StatusInternalServerError)
				return
			}
			h.logAction(callerID, "user_force_change_password", "target_id="+targetID)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Unknown action", http.StatusBadRequest)
		}

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Instance Settings ─────────────────────────────────────────────────────────

func (h *AdminHandler) HandleSettings(w http.ResponseWriter, r *http.Request) {
	if !h.isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := h.DB.Query(`SELECT key, value FROM instance_settings`)
		if err != nil {
			// Fallback: try old settings table for registration_enabled
			var regEnabled string
			h.DB.QueryRow("SELECT value FROM settings WHERE key = 'registration_enabled'").Scan(&regEnabled)
			if regEnabled == "" {
				regEnabled = "true"
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"registration": regEnabled})
			return
		}
		defer rows.Close()
		settings := map[string]string{
			"registration":  "true",
			"instance_name": "Aegis Hub",
			"instance_desc": "Secure self-hosted platform",
			"max_upload_mb": "100",
			"chat_enabled":  "true",
			"files_enabled": "true",
			"motd":          "",
		}
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			settings[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)

	case http.MethodPost, http.MethodPut:
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		allowed := map[string]bool{
			"instance_name": true, "instance_desc": true, "max_upload_mb": true,
			"registration": true, "chat_enabled": true, "files_enabled": true, "motd": true,
		}
		for k, v := range req {
			if !allowed[k] {
				continue
			}
			h.DB.Exec(`
				INSERT INTO instance_settings (key, value) VALUES ($1, $2)
				ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
			`, k, v)
			// Keep legacy settings table in sync for registration
			if k == "registration" {
				h.DB.Exec(`
					INSERT INTO settings (key, value) VALUES ('registration_enabled', $1)
					ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
				`, v)
			}
		}
		callerID, _ := r.Context().Value(userIDKey).(uuid.UUID)
		h.logAction(callerID, "settings_updated", fmt.Sprintf("%d keys changed", len(req)))
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ── Stats ─────────────────────────────────────────────────────────────────────

func (h *AdminHandler) HandleStats(w http.ResponseWriter, r *http.Request) {
	if !h.isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	var stats struct {
		TotalUsers    int    `json:"total_users"`
		TotalMessages int    `json:"total_messages"`
		TotalDMs      int    `json:"total_dms"`
		TotalFiles    int    `json:"total_files"`
		TotalSizeMB   string `json:"total_size_mb"`
		TotalChannels int    `json:"total_channels"`
	}

	h.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers)
	h.DB.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&stats.TotalMessages)
	h.DB.QueryRow(`SELECT COUNT(*) FROM direct_messages`).Scan(&stats.TotalDMs)
	h.DB.QueryRow(`SELECT COUNT(*) FROM files`).Scan(&stats.TotalFiles)
	h.DB.QueryRow(`SELECT COUNT(*) FROM channels`).Scan(&stats.TotalChannels)

	var totalBytes int64
	h.DB.QueryRow(`SELECT COALESCE(SUM(size_bytes), 0) FROM files`).Scan(&totalBytes)
	stats.TotalSizeMB = fmt.Sprintf("%.1f", float64(totalBytes)/1024/1024)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

func (h *AdminHandler) HandleAuditLog(w http.ResponseWriter, r *http.Request) {
	if !h.isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	rows, err := h.DB.Query(`
		SELECT al.id::text, COALESCE(u.username, 'system'), al.action, al.details, al.created_at::text
		FROM audit_log al
		LEFT JOIN users u ON u.id = al.user_id
		ORDER BY al.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		// Table might not exist yet – return empty
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}
	defer rows.Close()

	type AuditEntry struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		Action    string `json:"action"`
		Details   string `json:"details"`
		CreatedAt string `json:"created_at"`
	}

	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		rows.Scan(&e.ID, &e.Username, &e.Action, &e.Details, &e.CreatedAt)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []AuditEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// HandlePublicSettings vrací veřejné parametry konfigurace bez nutnosti být admin
func (h *AdminHandler) HandlePublicSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := h.DB.Query(`SELECT key, value FROM instance_settings WHERE key IN ('max_upload_mb', 'registration', 'chat_enabled', 'files_enabled', 'instance_name', 'motd')`)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"max_upload_mb": "100"})
		return
	}
	defer rows.Close()
	settings := map[string]string{
		"max_upload_mb": "100", // default
	}
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		settings[k] = v
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}
