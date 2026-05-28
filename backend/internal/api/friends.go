package api

import (
	"encoding/json"
	"net/http"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────────
// FriendsHandler – žádosti o přátelství, přijmout/odmítnout, zrušit, blokovat
// ─────────────────────────────────────────────────────────────────────────────

type FriendsHandler struct {
	DB *storage.DB
}

type FriendEntry struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	Status      string `json:"status"`   // pending | accepted
	Direction   string `json:"direction"` // sent | received
	CreatedAt   string `json:"created_at"`
}

// GET  /api/friends         – moji přátelé + čekající žádosti
// POST /api/friends         – odeslat žádost { user_id }
// PUT  /api/friends?id=...&action=accept|decline – přijmout / odmítnout
// DELETE /api/friends?user_id=... – odebrat přítele / zrušit žádost

func (h *FriendsHandler) HandleFriends(w http.ResponseWriter, r *http.Request) {
	callerID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || callerID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.listFriends(w, callerID)
	case http.MethodPost:
		h.sendRequest(w, r, callerID)
	case http.MethodPut:
		h.respondRequest(w, r, callerID)
	case http.MethodDelete:
		h.removeFriend(w, r, callerID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *FriendsHandler) listFriends(w http.ResponseWriter, callerID uuid.UUID) {
	rows, err := h.DB.Query(`
		SELECT
			f.id::text,
			CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS other_user_id,
			CASE WHEN f.requester_id = $1 THEN u2.username    ELSE u1.username    END AS other_username,
			f.status,
			CASE WHEN f.requester_id = $1 THEN 'sent' ELSE 'received' END AS direction,
			f.created_at::text
		FROM friendships f
		JOIN users u1 ON u1.id = f.requester_id
		JOIN users u2 ON u2.id = f.addressee_id
		WHERE f.requester_id = $1 OR f.addressee_id = $1
		ORDER BY f.created_at DESC
	`, callerID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]FriendEntry{})
		return
	}
	defer rows.Close()

	var entries []FriendEntry
	for rows.Next() {
		var e FriendEntry
		rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Status, &e.Direction, &e.CreatedAt)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []FriendEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func (h *FriendsHandler) sendRequest(w http.ResponseWriter, r *http.Request, callerID uuid.UUID) {
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
		http.Error(w, "Missing user_id", http.StatusBadRequest)
		return
	}
	targetID, err := uuid.Parse(req.UserID)
	if err != nil || targetID == callerID {
		http.Error(w, "Invalid user_id", http.StatusBadRequest)
		return
	}

	// Check if blocked
	var cnt int
	h.DB.QueryRow(`SELECT COUNT(*) FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2`, targetID, callerID).Scan(&cnt)
	if cnt > 0 {
		http.Error(w, "Cannot send request", http.StatusForbidden)
		return
	}

	// Check existing friendship/request
	var existing string
	h.DB.QueryRow(`
		SELECT status FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
	`, callerID, targetID).Scan(&existing)
	if existing == "accepted" {
		http.Error(w, "Already friends", http.StatusConflict)
		return
	}
	if existing == "pending" {
		http.Error(w, "Request already exists", http.StatusConflict)
		return
	}

	var id string
	err = h.DB.QueryRow(`
		INSERT INTO friendships (requester_id, addressee_id, status)
		VALUES ($1, $2, 'pending')
		ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'pending'
		RETURNING id::text
	`, callerID, targetID).Scan(&id)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (h *FriendsHandler) respondRequest(w http.ResponseWriter, r *http.Request, callerID uuid.UUID) {
	friendshipID := r.URL.Query().Get("id")
	action := r.URL.Query().Get("action") // accept | decline
	if friendshipID == "" || (action != "accept" && action != "decline") {
		http.Error(w, "Missing id or action", http.StatusBadRequest)
		return
	}

	if action == "accept" {
		res, err := h.DB.Exec(`
			UPDATE friendships SET status = 'accepted'
			WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
		`, friendshipID, callerID)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			http.Error(w, "Not found or already processed", http.StatusNotFound)
			return
		}
	} else {
		h.DB.Exec(`DELETE FROM friendships WHERE id = $1 AND addressee_id = $2`, friendshipID, callerID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *FriendsHandler) removeFriend(w http.ResponseWriter, r *http.Request, callerID uuid.UUID) {
	targetIDStr := r.URL.Query().Get("user_id")
	if targetIDStr == "" {
		http.Error(w, "Missing user_id", http.StatusBadRequest)
		return
	}
	h.DB.Exec(`
		DELETE FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
	`, callerID, targetIDStr)
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────────────────────
// BlocksHandler – blokovat / odblokovat
// ─────────────────────────────────────────────────────────────────────────────

type BlocksHandler struct {
	DB *storage.DB
}

func (h *BlocksHandler) HandleBlocks(w http.ResponseWriter, r *http.Request) {
	callerID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || callerID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := h.DB.Query(`
			SELECT u.id::text, u.username FROM blocked_users b
			JOIN users u ON u.id = b.blocked_id
			WHERE b.blocker_id = $1 ORDER BY b.created_at DESC
		`, callerID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}
		defer rows.Close()
		var list []map[string]string
		for rows.Next() {
			var id, username string
			rows.Scan(&id, &username)
			list = append(list, map[string]string{"id": id, "username": username})
		}
		if list == nil {
			list = []map[string]string{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)

	case http.MethodPost:
		var req struct{ UserID string `json:"user_id"` }
		json.NewDecoder(r.Body).Decode(&req)
		if req.UserID == "" {
			http.Error(w, "Missing user_id", http.StatusBadRequest)
			return
		}
		h.DB.Exec(`INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, callerID, req.UserID)
		// Also remove friendship if exists
		h.DB.Exec(`DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`, callerID, req.UserID)
		w.WriteHeader(http.StatusNoContent)

	case http.MethodDelete:
		targetID := r.URL.Query().Get("user_id")
		if targetID == "" {
			http.Error(w, "Missing user_id", http.StatusBadRequest)
			return
		}
		h.DB.Exec(`DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2`, callerID, targetID)
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// IsFriends checks if two users are friends (accepted friendship)
func IsFriends(db *storage.DB, userA, userB uuid.UUID) bool {
	var cnt int
	db.QueryRow(`
		SELECT COUNT(*) FROM friendships
		WHERE status = 'accepted'
		AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
	`, userA, userB).Scan(&cnt)
	return cnt > 0
}

// IsBlocked checks if userB blocked userA
func IsBlocked(db *storage.DB, sender, recipient uuid.UUID) bool {
	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2`, recipient, sender).Scan(&cnt)
	return cnt > 0
}
