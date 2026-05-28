#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Aegis Hub – Setup Script
# Použití: bash setup.sh
# ════════════════════════════════════════════════════════════════════

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BLUE}${BOLD}"
echo "    _            _        _   _       _     "
echo "   / \   ___  _ _(_)___  | | | |_   _| |__  "
echo "  / _ \ / _ \| '_| / __| | |_| | | | | '_ \ "
echo " / ___ \  __/| | | \__ \ |  _  | |_| | |_) |"
echo "/_/   \_\___||_| |_|___/ |_| |_|\__,_|_.__/ "
echo -e "${NC}"
echo -e "${BOLD}Aegis Hub – Self-Hosting Setup${NC}"
echo ""

# Check docker & docker-compose
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker není nainstalován. Instaluj: https://docs.docker.com/engine/install/${NC}"
    exit 1
fi
if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ Docker Compose není dostupný.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker nalezen${NC}"

# Create .env if not exists
if [ -f ".env" ]; then
    echo -e "${YELLOW}⚠  Soubor .env již existuje. Přeskakuji generování.${NC}"
else
    echo -e "\n${BOLD}Generování .env souboru s bezpečnými náhodnými klíči...${NC}"

    DB_PASS=$(openssl rand -base64 32 | tr -d '=/+' | head -c 32)
    JWT_SECRET=$(openssl rand -base64 48 | tr -d '=/+' | head -c 48)

    cat > .env << EOF
# ════════════════════════════════════════════════════
# Aegis Hub – Konfigurace
# Vygenerováno: $(date)
# ════════════════════════════════════════════════════

# Databáze (PostgreSQL)
POSTGRES_USER=aegis
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=aegis_db

# Backend
DB_USER=aegis
DB_PASSWORD=${DB_PASS}
DB_NAME=aegis_db
JWT_SECRET=${JWT_SECRET}
EOF
    echo -e "${GREEN}✓ Soubor .env vygenerován s bezpečnými hesly${NC}"
fi

# Ask for domain
echo ""
echo -e "${BOLD}Konfigurace domény:${NC}"
read -p "  Zadejte vaši doménu (např. aegis.example.com): " DOMAIN

if [ -n "$DOMAIN" ]; then
    # Update Caddyfile
    if [ -f "frontend/Caddyfile" ]; then
        # Backup and update domain
        cp frontend/Caddyfile frontend/Caddyfile.bak
        sed -i "s|aegis\..*\..*\s|${DOMAIN} |g" frontend/Caddyfile
        echo -e "${GREEN}✓ Caddyfile aktualizován pro doménu: ${DOMAIN}${NC}"
    fi
fi

# Build and start
echo ""
echo -e "${BOLD}Spouštím Docker Compose...${NC}"
if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
else
    docker compose up -d --build
fi

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✓ Aegis Hub byl úspěšně spuštěn!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
if [ -n "$DOMAIN" ]; then
    echo -e "  🌐 URL: ${BOLD}https://${DOMAIN}${NC}"
else
    echo -e "  🌐 URL: ${BOLD}http://localhost${NC}"
fi
echo ""
echo -e "  ${BOLD}Další kroky:${NC}"
echo -e "  1. Otevřete aplikaci a zaregistrujte PRVNÍ účet"
echo -e "     → první registrovaný uživatel automaticky dostane práva admina"
echo -e "  2. Přihlaste se jako admin → Administrace → Nastavení"
echo -e "     → nastavte název instance, vypněte veřejné registrace atd."
echo -e "  3. Vytvořte kanály v sekci Chat"
echo ""
echo -e "  ${YELLOW}Pro zastavení:${NC} docker compose down"
echo -e "  ${YELLOW}Pro logy:${NC}     docker compose logs -f"
echo -e "  ${YELLOW}Pro update:${NC}   git pull && bash deploy.sh"
echo ""
