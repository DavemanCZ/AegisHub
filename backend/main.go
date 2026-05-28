package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/aegis/backend/internal/api"
	"github.com/aegis/backend/internal/storage"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbUser := os.Getenv("DB_USER")
	dbPass := os.Getenv("DB_PASSWORD")
	dbName := os.Getenv("DB_NAME")
	jwtSecret := os.Getenv("JWT_SECRET")
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data/files"
	}

	log.Println("Connecting to database...")
	db, err := storage.InitDB(dbHost, dbPort, dbUser, dbPass, dbName)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}
	defer db.Close()
	log.Println("Database connection established.")

	authHandler := &api.AuthHandler{
		DB:        db,
		JWTSecret: []byte(jwtSecret),
	}

	objectsHandler := &api.ObjectsHandler{
		DB: db,
	}

	filesHandler := &api.FilesHandler{
		DB:      db,
		DataDir: dataDir,
	}

	chatHandler := &api.ChatHandler{
		DB: db,
	}

	dmHandler := &api.DMHandler{
		DB: db,
	}

	pubKeyHandler := &api.PubKeyHandler{
		DB: db,
	}

	friendsHandler := &api.FriendsHandler{
		DB: db,
	}

	blocksHandler := &api.BlocksHandler{
		DB: db,
	}

	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok", "service":"aegis-backend"}`)
	})

	http.HandleFunc("/api/auth/register", authHandler.HandleRegister)
	http.HandleFunc("/api/auth/login", authHandler.HandleLogin)
	http.HandleFunc("/api/auth/verify", authHandler.HandleVerify)
	http.HandleFunc("/api/auth/change-password", api.AuthMiddleware([]byte(jwtSecret), authHandler.HandleChangePassword))

	adminHandler := &api.AdminHandler{
		DB: db,
	}

	http.HandleFunc("/api/objects", api.AuthMiddleware([]byte(jwtSecret), objectsHandler.HandleObjects))
	http.HandleFunc("/api/admin/users", api.AuthMiddleware([]byte(jwtSecret), adminHandler.HandleUsers))
	http.HandleFunc("/api/admin/settings", api.AuthMiddleware([]byte(jwtSecret), adminHandler.HandleSettings))
	http.HandleFunc("/api/admin/stats", api.AuthMiddleware([]byte(jwtSecret), adminHandler.HandleStats))
	http.HandleFunc("/api/admin/audit", api.AuthMiddleware([]byte(jwtSecret), adminHandler.HandleAuditLog))
	http.HandleFunc("/api/settings/public", adminHandler.HandlePublicSettings)

	// Files (Cloud)
	http.HandleFunc("/api/files", api.AuthMiddleware([]byte(jwtSecret), filesHandler.HandleFiles))

	// Chat
	http.HandleFunc("/api/chat/channels", api.AuthMiddleware([]byte(jwtSecret), chatHandler.HandleChannels))
	http.HandleFunc("/api/chat/messages", api.AuthMiddleware([]byte(jwtSecret), chatHandler.HandleMessages))
	http.HandleFunc("/api/chat/sse", api.AuthMiddleware([]byte(jwtSecret), chatHandler.HandleSSE))

	// Direct Messages
	http.HandleFunc("/api/dm/conversations", api.AuthMiddleware([]byte(jwtSecret), dmHandler.HandleDMConversations))
	http.HandleFunc("/api/dm/messages", api.AuthMiddleware([]byte(jwtSecret), dmHandler.HandleDMMessages))
	http.HandleFunc("/api/dm/sse", api.AuthMiddleware([]byte(jwtSecret), dmHandler.HandleDMSSE))

	// Public Keys (E2E)
	http.HandleFunc("/api/users/pubkeys", api.AuthMiddleware([]byte(jwtSecret), pubKeyHandler.HandlePubKeys))
	// User search (for friend requests)
	http.HandleFunc("/api/users", api.AuthMiddleware([]byte(jwtSecret), dmHandler.HandleUsers))

	// Friends & Blocks
	http.HandleFunc("/api/friends", api.AuthMiddleware([]byte(jwtSecret), friendsHandler.HandleFriends))
	http.HandleFunc("/api/blocks", api.AuthMiddleware([]byte(jwtSecret), blocksHandler.HandleBlocks))

	log.Printf("Starting Aegis backend on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
