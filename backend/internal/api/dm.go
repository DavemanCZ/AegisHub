package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

type DMHandler struct {
	DB *storage.DB
}

type DMMessage struct {
	ID              string  `json:"id"`
	SenderID        string  `json:"sender_id"`
	RecipientID     string  `json:"recipient_id"`
	SenderUsername  string  `json:"sender_username"`
	Content         string  `json:"content"`
	ReadAt          *string `json:"read_at"`
	CreatedAt       string  `json:"created_at"`
}

type DMConversation struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	LastMessage  string `json:"last_message"`
	LastAt       string `json:"last_at"`
	UnreadCount  int    `json:"unread_count"`
}

// HandleDMConversations – GET list of conversations for current user
func (h *DMHandler) HandleDMConversations(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get all users I've had a conversation with
	// Get all users with whom the current user has exchanged messages
	rows, err := h.DB.Query(`
		SELECT
			u.id::text AS user_id,
			u.username,
			COALESCE((
				SELECT content FROM direct_messages dm2
				WHERE (dm2.sender_id = $1 AND dm2.recipient_id = u.id)
				   OR (dm2.sender_id = u.id AND dm2.recipient_id = $1)
				ORDER BY dm2.created_at DESC LIMIT 1
			), '') AS last_message,
			COALESCE((
				SELECT dm3.created_at::text FROM direct_messages dm3
				WHERE (dm3.sender_id = $1 AND dm3.recipient_id = u.id)
				   OR (dm3.sender_id = u.id AND dm3.recipient_id = $1)
				ORDER BY dm3.created_at DESC LIMIT 1
			), '') AS last_at,
			(SELECT COUNT(*)::int FROM direct_messages dm4
			 WHERE dm4.sender_id = u.id AND dm4.recipient_id = $1 AND dm4.read_at IS NULL) AS unread_count
		FROM users u
		WHERE u.id != $1
		  AND EXISTS (
			SELECT 1 FROM direct_messages dm5
			WHERE (dm5.sender_id = $1 AND dm5.recipient_id = u.id)
			   OR (dm5.sender_id = u.id AND dm5.recipient_id = $1)
		  )
		ORDER BY last_at DESC NULLS LAST
	`, userID)

	if err != nil {
		// Fallback: return empty list with all users
		users, _ := h.getOtherUsers(userID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"conversations": []DMConversation{},
			"users":         users,
		})
		return
	}
	defer rows.Close()

	var conversations []DMConversation
	for rows.Next() {
		var c DMConversation
		var lastMsg, lastAt *string
		rows.Scan(&c.UserID, &c.Username, &lastMsg, &lastAt, &c.UnreadCount)
		if lastMsg != nil { c.LastMessage = *lastMsg }
		if lastAt != nil { c.LastAt = *lastAt }
		conversations = append(conversations, c)
	}
	if conversations == nil {
		conversations = []DMConversation{}
	}

	users, _ := h.getOtherUsers(userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"conversations": conversations,
		"users":         users,
	})
}

func (h *DMHandler) getOtherUsers(currentID uuid.UUID) ([]map[string]string, error) {
	// Return only accepted friends (not all users) for DM sidebar
	rows, err := h.DB.Query(`
		SELECT DISTINCT u.id::text, u.username
		FROM users u
		WHERE u.id != $1
		  AND EXISTS (
			SELECT 1 FROM friendships f
			WHERE f.status = 'accepted'
			  AND ((f.requester_id = $1 AND f.addressee_id = u.id)
			    OR (f.requester_id = u.id AND f.addressee_id = $1))
		  )
		ORDER BY u.username
	`, currentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []map[string]string
	for rows.Next() {
		var id, username string
		rows.Scan(&id, &username)
		users = append(users, map[string]string{"id": id, "username": username})
	}
	return users, nil
}

// HandleUsers – GET /api/users?search=... – vyhledávání uživatelů (pro přidávání přátel)
func (h *DMHandler) HandleUsers(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	search := r.URL.Query().Get("search")
	rows, err := h.DB.Query(`
		SELECT id::text, username FROM users
		WHERE id != $1 AND ($2 = '' OR username ILIKE '%' || $2 || '%')
		ORDER BY username LIMIT 20
	`, userID, search)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}
	defer rows.Close()
	var users []map[string]string
	for rows.Next() {
		var id, username string
		rows.Scan(&id, &username)
		users = append(users, map[string]string{"id": id, "username": username})
	}
	if users == nil {
		users = []map[string]string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// HandleDMMessages – GET history, POST send
func (h *DMHandler) HandleDMMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	otherIDStr := r.URL.Query().Get("with")
	if otherIDStr == "" {
		http.Error(w, "Missing 'with' parameter", http.StatusBadRequest)
		return
	}
	otherID, err := uuid.Parse(otherIDStr)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Mark messages as read
		h.DB.Exec(`UPDATE direct_messages SET read_at = NOW() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`, otherID, userID)

		rows, err := h.DB.Query(`
			SELECT id, sender_id, recipient_id, sender_username, content, read_at, created_at
			FROM direct_messages
			WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
			ORDER BY created_at ASC LIMIT 200
		`, userID, otherID)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var messages []DMMessage
		for rows.Next() {
			var m DMMessage
			rows.Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.SenderUsername, &m.Content, &m.ReadAt, &m.CreatedAt)
			messages = append(messages, m)
		}
		if messages == nil {
			messages = []DMMessage{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(messages)

	case http.MethodPost:
		// Check friendship
		if !IsFriends(h.DB, userID, otherID) {
			http.Error(w, "You must be friends to send a DM", http.StatusForbidden)
			return
		}
		// Check block
		if IsBlocked(h.DB, userID, otherID) {
			http.Error(w, "You cannot message this user", http.StatusForbidden)
			return
		}

		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		var senderUsername string
		h.DB.QueryRow(`SELECT username FROM users WHERE id = $1`, userID).Scan(&senderUsername)

		var m DMMessage
		err := h.DB.QueryRow(`
			INSERT INTO direct_messages (sender_id, recipient_id, sender_username, content)
			VALUES ($1, $2, $3, $4)
			RETURNING id, sender_id, recipient_id, sender_username, content, read_at, created_at
		`, userID, otherID, senderUsername, req.Content).Scan(
			&m.ID, &m.SenderID, &m.RecipientID, &m.SenderUsername, &m.Content, &m.ReadAt, &m.CreatedAt,
		)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		// Broadcast via SSE – use a DM-specific key
		dmChannelKey := dmKey(userID.String(), otherID.String())
		msgJSON, _ := json.Marshal(m)
		hub.broadcast(dmChannelKey, string(msgJSON))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(m)

	case http.MethodDelete:
		msgID := r.URL.Query().Get("id")
		if msgID == "" {
			http.Error(w, "Missing message id", http.StatusBadRequest)
			return
		}
		var senderID string
		err := h.DB.QueryRow(`SELECT sender_id FROM direct_messages WHERE id = $1`, msgID).Scan(&senderID)
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		if senderID != userID.String() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		h.DB.Exec(`DELETE FROM direct_messages WHERE id = $1`, msgID)

		dmChannelKey := dmKey(userID.String(), otherID.String())
		delMsg := map[string]string{"type": "delete", "id": msgID}
		delMsgJSON, _ := json.Marshal(delMsg)
		hub.broadcast(dmChannelKey, string(delMsgJSON))

		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleDMSSE – SSE stream for a DM conversation
func (h *DMHandler) HandleDMSSE(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	otherIDStr := r.URL.Query().Get("with")
	if otherIDStr == "" {
		http.Error(w, "Missing 'with'", http.StatusBadRequest)
		return
	}
	otherID, _ := uuid.Parse(otherIDStr)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Subscribe to both directions
	key := dmKey(userID.String(), otherIDStr)
	key2 := dmKey(otherIDStr, userID.String())
	ch1 := hub.subscribe(key)
	ch2 := hub.subscribe(key2)
	defer hub.unsubscribe(key, ch1)
	defer hub.unsubscribe(key2, ch2)

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	_ = otherID

	for {
		select {
		case msg := <-ch1:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case msg := <-ch2:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// Helper: canonical DM key (directional, from → to)
func dmKey(fromID, toID string) string {
	return "dm:" + fromID + ":" + toID
}
