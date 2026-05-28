package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)

// ---- WebSocket-less simple implementation using Server-Sent Events + polling ----
// For simplicity and zero external dependencies we use plain HTTP polling for messages.
// Real-time feel is achieved by the frontend polling every 2 seconds.

type ChatHandler struct {
	DB *storage.DB
}

type Channel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
}

type Message struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

// SSE hub for broadcasting new messages
type sseHub struct {
	mu      sync.Mutex
	clients map[string][]chan string // channelID -> list of client channels
}

var hub = &sseHub{clients: make(map[string][]chan string)}

func (h *sseHub) subscribe(channelID string) chan string {
	ch := make(chan string, 8)
	h.mu.Lock()
	h.clients[channelID] = append(h.clients[channelID], ch)
	h.mu.Unlock()
	return ch
}

func (h *sseHub) unsubscribe(channelID string, ch chan string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.clients[channelID]
	for i, c := range clients {
		if c == ch {
			h.clients[channelID] = append(clients[:i], clients[i+1:]...)
			break
		}
	}
}

func (h *sseHub) broadcast(channelID string, msg string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, ch := range h.clients[channelID] {
		select {
		case ch <- msg:
		default:
		}
	}
}

// HandleChannels – GET list, POST create (admin), DELETE (admin)
func (h *ChatHandler) HandleChannels(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := h.DB.Query(`SELECT id, name, description, created_at FROM channels ORDER BY created_at ASC`)
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var channels []Channel
		for rows.Next() {
			var c Channel
			rows.Scan(&c.ID, &c.Name, &c.Description, &c.CreatedAt)
			channels = append(channels, c)
		}
		if channels == nil {
			channels = []Channel{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(channels)

	case http.MethodPost:
		// Only admins can create channels
		var isAdmin bool
		h.DB.QueryRow(`SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin)
		if !isAdmin {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		var c Channel
		err := h.DB.QueryRow(
			`INSERT INTO channels (name, description, created_by) VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
			req.Name, req.Description, userID,
		).Scan(&c.ID, &c.Name, &c.Description, &c.CreatedAt)
		if err != nil {
			http.Error(w, "Server error or duplicate name", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)

	case http.MethodDelete:
		var isAdmin bool
		h.DB.QueryRow(`SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin)
		if !isAdmin {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "Missing id", http.StatusBadRequest)
			return
		}
		h.DB.Exec(`DELETE FROM channels WHERE id = $1`, id)
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleMessages – GET history, POST new message
func (h *ChatHandler) HandleMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	channelID := r.URL.Query().Get("channel")
	if channelID == "" {
		http.Error(w, "Missing channel", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Optional: only return messages after a given ID for polling
		after := r.URL.Query().Get("after")
		var rows interface{ Close() error }
		var err error
		if after != "" {
			rows, err = h.DB.Query(
				`SELECT id, channel_id, user_id, username, content, created_at FROM messages WHERE channel_id = $1 AND created_at > (SELECT created_at FROM messages WHERE id = $2) ORDER BY created_at ASC LIMIT 100`,
				channelID, after,
			)
		} else {
			rows, err = h.DB.Query(
				`SELECT id, channel_id, user_id, username, content, created_at FROM messages WHERE channel_id = $1 ORDER BY created_at ASC LIMIT 100`,
				channelID,
			)
		}
		if err != nil {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		sqlRows, ok := rows.(interface {
			Next() bool
			Scan(dest ...any) error
			Close() error
		})
		if !ok {
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		var messages []Message
		for sqlRows.Next() {
			var m Message
			sqlRows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Username, &m.Content, &m.CreatedAt)
			messages = append(messages, m)
		}
		if messages == nil {
			messages = []Message{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(messages)

	case http.MethodPost:
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Content == "" {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		var username string
		h.DB.QueryRow(`SELECT username FROM users WHERE id = $1`, userID).Scan(&username)

		var m Message
		err := h.DB.QueryRow(
			`INSERT INTO messages (channel_id, user_id, username, content) VALUES ($1, $2, $3, $4) RETURNING id, channel_id, user_id, username, content, created_at`,
			channelID, userID, username, req.Content,
		).Scan(&m.ID, &m.ChannelID, &m.UserID, &m.Username, &m.Content, &m.CreatedAt)
		if err != nil {
			log.Printf("Error inserting message: %v", err)
			http.Error(w, "Server error", http.StatusInternalServerError)
			return
		}

		// Broadcast to SSE clients
		msgJSON, _ := json.Marshal(m)
		hub.broadcast(channelID, string(msgJSON))

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
		err := h.DB.QueryRow(`SELECT user_id FROM messages WHERE id = $1`, msgID).Scan(&senderID)
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		if senderID != userID.String() {
			var isAdmin bool
			h.DB.QueryRow(`SELECT is_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin)
			if !isAdmin {
				http.Error(w, "Forbidden", http.StatusForbidden)
				return
			}
		}
		h.DB.Exec(`DELETE FROM messages WHERE id = $1`, msgID)
		delMsg := map[string]string{"type": "delete", "id": msgID}
		delMsgJSON, _ := json.Marshal(delMsg)
		hub.broadcast(channelID, string(delMsgJSON))
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleSSE – Server-Sent Events stream for real-time messages
func (h *ChatHandler) HandleSSE(w http.ResponseWriter, r *http.Request) {
	_, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	channelID := r.URL.Query().Get("channel")
	if channelID == "" {
		http.Error(w, "Missing channel", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	ch := hub.subscribe(channelID)
	defer hub.unsubscribe(channelID, ch)

	// Send a keepalive comment every 15s
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case msg := <-ch:
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
