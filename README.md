# 🛡️ Aegis Hub

Aegis Hub is an open-source, zero-knowledge encrypted personal hub, password manager, and private chat platform. It is designed to be fully self-hosted, ensuring that you maintain complete ownership and control over your data.

**Language / Jazyk:** [English](#english) | [Čeština](#čeština)

---

<a name="english"></a>
## 🇬🇧 English

### Features
- **End-to-End Encryption (E2EE):** All passwords, secure notes, bookmarks, and files are encrypted on the client side using AES-GCM-256 before ever reaching the server.
- **Zero-Knowledge Architecture:** The server never sees your Master Password. It authenticates using an Argon2-derived `auth_token` and stores only the encrypted Vault Key.
- **Private E2EE Chat:** Real-time chat (channels and DMs) with forward secrecy using ECDH (Elliptic Curve Diffie-Hellman). Features inline image decrypt/preview and real-time message unsend.
- **Integrated TOTP 2FA Authenticator:** A built-in authenticator tool to manage your two-factor tokens.
- **PWA Ready:** Install Aegis Hub directly to your mobile device as a native app with push capabilities.
- **Modern UI:** Built using a beautiful, responsive "Glassmorphism" design system.

### Quick Start (Docker)

To deploy Aegis Hub on your own server (e.g., VPS or Proxmox VM):

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/aegis-hub.git
   cd aegis-hub
   ```
2. **Run the setup script:**
   ```bash
   bash setup.sh
   ```
   *The script will auto-generate secure passwords in `.env`, ask for your domain name, configure Caddy for automatic HTTPS (Let's Encrypt), and spin up the Docker containers.*

3. **Initialize the Admin:**
   Open the website in your browser. The **first** user to register will automatically be granted **Administrator** privileges. From the Admin Panel, you can disable public registration and manage the instance.

### Tech Stack
- **Frontend:** React, TypeScript, Vite, Web Crypto API
- **Backend:** Go (Golang), net/http, Gorilla Mux (SSE), PostgreSQL
- **Infrastructure:** Docker, Docker Compose, Caddy

---

<a name="čeština"></a>
## 🇨🇿 Čeština

### Funkce
- **End-to-End Šifrování (E2EE):** Všechna hesla, poznámky, záložky a soubory jsou zašifrovány přímo u vás v prohlížeči (klientovi) pomocí AES-GCM-256 ještě předtím, než odejdou na server.
- **Zero-Knowledge Architektura:** Server nikdy nezná vaše Master Heslo. K ověřování používá pouze `auth_token` derivovaný pomocí Argon2 a uchovává pouze váš bezpečně zašifrovaný Trezorový Klíč (Vault Key).
- **Soukromý E2EE Chat:** Real-time komunikace s dopřednou bezpečností přes ECDH. Umožňuje inline zobrazení zašifrovaných médií, sdílení souborů a funkci "Unsend" (Smazání zprávy v reálném čase pro obě strany).
- **Zabudovaný 2FA TOTP:** Integrovaný autentikátor pro generování dvoufázových hesel pro cizí platformy (náhrada za Google Auth).
- **PWA Aplikace:** Možnost instalace rovnou na plochu telefonu jako nativní aplikace.
- **Moderní vzhled:** Nádherný prémiový skleněný design (Glassmorphism).

### Rychlá instalace (Docker)

Instalace Aegis Hub na váš vlastní server nebo Proxmox je díky automatickému instalátoru extrémně jednoduchá:

1. **Stáhněte si repozitář:**
   ```bash
   git clone https://github.com/yourusername/aegis-hub.git
   cd aegis-hub
   ```
2. **Spusťte instalátor:**
   ```bash
   bash setup.sh
   ```
   *Skript vám automaticky vygeneruje bezpečná hesla pro databázi, zeptá se na vaši doménu a nastaví Caddy webový server, který za vás vyřídí HTTPS (Let's Encrypt).*

3. **První spuštění (Admin):**
   Otevřete web a zaregistrujte se. **První vytvořený účet získá automaticky roli Administrátora.** Následně můžete v Administraci vypnout veřejné registrace a nastavit si systém podle sebe.
