package api

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/aegis/backend/internal/storage"
	"github.com/google/uuid"
)


// nullableUUID converts a string UUID to *uuid.UUID (nil if empty or invalid)
func nullableUUID(s string) *uuid.UUID {
	if s == "" {
		return nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

type FilesHandler struct {
	DB      *storage.DB
	DataDir string
}

type FileInfo struct {
	ID           string `json:"id"`
	OriginalName string `json:"original_name"`
	MimeType     string `json:"mime_type"`
	SizeBytes    int64  `json:"size_bytes"`
	Nonce        string `json:"nonce"`
	CreatedAt    string `json:"created_at"`
}

func (h *FilesHandler) HandleFiles(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(uuid.UUID)
	if !ok || userID == uuid.Nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Check if requesting a specific file download
		id := r.URL.Query().Get("id")
		if id != "" {
			h.downloadFile(w, r, userID, id)
			return
		}
		h.listFiles(w, r, userID)
	case http.MethodPost:
		h.uploadFile(w, r, userID)
	case http.MethodDelete:
		h.deleteFile(w, r, userID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *FilesHandler) listFiles(w http.ResponseWriter, r *http.Request, userID uuid.UUID) {
	rows, err := h.DB.Query(
		`SELECT id, original_name, mime_type, size_bytes, nonce, created_at FROM files WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var files []FileInfo
	for rows.Next() {
		var f FileInfo
		var nonce []byte
		if err := rows.Scan(&f.ID, &f.OriginalName, &f.MimeType, &f.SizeBytes, &nonce, &f.CreatedAt); err != nil {
			continue
		}
		f.Nonce = hex.EncodeToString(nonce)
		files = append(files, f)
	}
	if files == nil {
		files = []FileInfo{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (h *FilesHandler) uploadFile(w http.ResponseWriter, r *http.Request, userID uuid.UUID) {
	// Dynamically get max file size from settings
	var limitStr string
	h.DB.QueryRow("SELECT value FROM instance_settings WHERE key = 'max_upload_mb'").Scan(&limitStr)
	if limitStr == "" {
		limitStr = "100"
	}
	limitMb, _ := strconv.ParseInt(limitStr, 10, 64)
	if limitMb <= 0 {
		limitMb = 100
	}
	maxBytes := limitMb << 20

	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1024)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, fmt.Sprintf("File too large (max %d MB) or bad request", limitMb), http.StatusBadRequest)
		return
	}

	nonceHex := r.FormValue("nonce")
	originalName := r.FormValue("name")
	mimeType := r.FormValue("mime")
	sizeStr := r.FormValue("size")
	recipientIDStr := r.FormValue("recipient_id") // optional – for DM sharing

	if nonceHex == "" || originalName == "" {
		http.Error(w, "Missing metadata", http.StatusBadRequest)
		return
	}

	nonce, err := hex.DecodeString(nonceHex)
	if err != nil {
		http.Error(w, "Invalid nonce", http.StatusBadRequest)
		return
	}

	var sizeBytes int64
	if sizeStr != "" {
		sizeBytes, _ = strconv.ParseInt(sizeStr, 10, 64)
	}

	file, _, err := r.FormFile("data")
	if err != nil {
		http.Error(w, "No file data", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Sanitize file extension only
	ext := filepath.Ext(originalName)
	ext = strings.ToLower(ext)

	fileID := uuid.New()
	userDir := filepath.Join(h.DataDir, userID.String())
	if err := os.MkdirAll(userDir, 0755); err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	destPath := filepath.Join(userDir, fileID.String()+".enc"+ext)
	dest, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	defer dest.Close()

	written, err := io.Copy(dest, file)
	if err != nil {
		os.Remove(destPath)
		http.Error(w, "Server error during write", http.StatusInternalServerError)
		return
	}
	if sizeBytes == 0 {
		sizeBytes = written
	}

	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	var dbID string
	err = h.DB.QueryRow(
		`INSERT INTO files (id, user_id, original_name, mime_type, size_bytes, nonce, recipient_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		fileID, userID, originalName, mimeType, sizeBytes, nonce, nullableUUID(recipientIDStr),
	).Scan(&dbID)
	if err != nil {
		os.Remove(destPath)
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": dbID})
}

func (h *FilesHandler) downloadFile(w http.ResponseWriter, r *http.Request, userID uuid.UUID, id string) {
	// Allow download if current user is owner OR recipient
	var originalName, mimeType string
	var nonce []byte
	var ownerID uuid.UUID
	err := h.DB.QueryRow(
		`SELECT original_name, mime_type, nonce, user_id FROM files
		 WHERE id = $1 AND (user_id = $2 OR recipient_id = $2)`,
		id, userID,
	).Scan(&originalName, &mimeType, &nonce, &ownerID)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	ext := strings.ToLower(filepath.Ext(originalName))
	// Files are always stored in the OWNER's directory
	ownerDir := filepath.Join(h.DataDir, ownerID.String())
	filePath := filepath.Join(ownerDir, id+".enc"+ext)

	f, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "File not found on disk", http.StatusNotFound)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-File-Nonce", hex.EncodeToString(nonce))
	w.Header().Set("X-Original-Name", originalName)
	w.Header().Set("Access-Control-Expose-Headers", "X-File-Nonce, X-Original-Name")
	fmt.Fprintf(w, "")
	io.Copy(w, f)
}

func (h *FilesHandler) deleteFile(w http.ResponseWriter, r *http.Request, userID uuid.UUID) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}

	var originalName string
	err := h.DB.QueryRow(`SELECT original_name FROM files WHERE id = $1 AND user_id = $2`, id, userID).Scan(&originalName)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	ext := strings.ToLower(filepath.Ext(originalName))
	filePath := filepath.Join(h.DataDir, userID.String(), id+".enc"+ext)
	os.Remove(filePath)

	h.DB.Exec(`DELETE FROM files WHERE id = $1 AND user_id = $2`, id, userID)
	w.WriteHeader(http.StatusNoContent)
}
