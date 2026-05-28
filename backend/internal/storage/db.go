package storage

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

type DB struct {
	*sql.DB
}

func InitDB(host, port, user, password, dbname string) (*DB, error) {
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}

	if err := db.Ping(); err != nil {
		return nil, err
	}

	database := &DB{db}
	if err := database.runMigrations(); err != nil {
		return nil, err
	}

	return database, nil
}

func (db *DB) runMigrations() error {
	log.Println("Running database migrations...")

	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id UUID PRIMARY KEY,
		username VARCHAR(255) UNIQUE NOT NULL,
		auth_hash VARCHAR(255) NOT NULL,
		salt BYTEA NOT NULL,
		encrypted_vault_key BYTEA NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		is_admin BOOLEAN DEFAULT FALSE
	);`

	objectsTable := `
	CREATE TABLE IF NOT EXISTS encrypted_objects (
		id UUID PRIMARY KEY,
		user_id UUID REFERENCES users(id) ON DELETE CASCADE,
		type VARCHAR(100) NOT NULL,
		version INTEGER NOT NULL DEFAULT 1,
		ciphertext BYTEA NOT NULL,
		nonce BYTEA NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`

	settingsTable := `
	CREATE TABLE IF NOT EXISTS settings (
		key VARCHAR(255) PRIMARY KEY,
		value VARCHAR(255) NOT NULL
	);`

	filesTable := `
	CREATE TABLE IF NOT EXISTS files (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id) ON DELETE CASCADE,
		original_name TEXT NOT NULL,
		mime_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
		size_bytes BIGINT NOT NULL DEFAULT 0,
		nonce BYTEA NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`

	channelsTable := `
	CREATE TABLE IF NOT EXISTS channels (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		name VARCHAR(255) UNIQUE NOT NULL,
		description TEXT DEFAULT '',
		created_by UUID REFERENCES users(id) ON DELETE SET NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`

	messagesTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
		user_id UUID REFERENCES users(id) ON DELETE CASCADE,
		username VARCHAR(255) NOT NULL,
		content TEXT NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`

	if _, err := db.Exec(usersTable); err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	// Migrace existující tabulky pro přidání is_admin (pokud už existuje)
	db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;")

	if _, err := db.Exec(settingsTable); err != nil {
		return fmt.Errorf("failed to create settings table: %w", err)
	}
	if _, err := db.Exec(objectsTable); err != nil {
		return fmt.Errorf("failed to create encrypted_objects table: %w", err)
	}
	if _, err := db.Exec(filesTable); err != nil {
		return fmt.Errorf("failed to create files table: %w", err)
	}
	if _, err := db.Exec(channelsTable); err != nil {
		return fmt.Errorf("failed to create channels table: %w", err)
	}
	if _, err := db.Exec(messagesTable); err != nil {
		return fmt.Errorf("failed to create messages table: %w", err)
	}

	dmTable := `
	CREATE TABLE IF NOT EXISTS direct_messages (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
		recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
		sender_username VARCHAR(255) NOT NULL,
		content TEXT NOT NULL,
		read_at TIMESTAMP WITH TIME ZONE,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`

	if _, err := db.Exec(dmTable); err != nil {
		return fmt.Errorf("failed to create direct_messages table: %w", err)
	}

	pubKeysTable := `
	CREATE TABLE IF NOT EXISTS public_keys (
		user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		public_key_jwk TEXT NOT NULL,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(pubKeysTable); err != nil {
		return fmt.Errorf("failed to create public_keys table: %w", err)
	}

	instanceSettings := `
	CREATE TABLE IF NOT EXISTS instance_settings (
		key VARCHAR(128) PRIMARY KEY,
		value TEXT NOT NULL DEFAULT '',
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(instanceSettings); err != nil {
		return fmt.Errorf("failed to create instance_settings table: %w", err)
	}

	auditLog := `
	CREATE TABLE IF NOT EXISTS audit_log (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id) ON DELETE SET NULL,
		action VARCHAR(128) NOT NULL,
		details TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(auditLog); err != nil {
		return fmt.Errorf("failed to create audit_log table: %w", err)
	}

	// Friendships
	friendships := `
	CREATE TABLE IF NOT EXISTS friendships (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		status VARCHAR(20) NOT NULL DEFAULT 'pending',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(requester_id, addressee_id)
	);`
	if _, err := db.Exec(friendships); err != nil {
		return fmt.Errorf("failed to create friendships table: %w", err)
	}

	// Blocked users
	blockedUsers := `
	CREATE TABLE IF NOT EXISTS blocked_users (
		blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (blocker_id, blocked_id)
	);`
	if _, err := db.Exec(blockedUsers); err != nil {
		return fmt.Errorf("failed to create blocked_users table: %w", err)
	}

	// Migrations for existing tables
	_, _ = db.Exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`)
	_, _ = db.Exec(`ALTER TABLE files ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id) ON DELETE SET NULL`)

	log.Println("Migrations completed successfully.")
	return nil
}
