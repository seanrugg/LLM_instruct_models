# Plesk Deployment Guide

## Overview

This guide walks you through deploying the LLM Instruct Models Repository on Plesk with IONOS hosting for the subdomain `llm.cucorn.com`.

## Prerequisites

- Plesk account with SSH access to your server
- Domain: `cucorn.com`
- Subdomain: `llm.cucorn.com` (already configured in Plesk)
- SSH client (Terminal on macOS/Linux, PuTTY on Windows)

## Step 1: Connect to Your Server via SSH

```bash
ssh your_username@llm.cucorn.com
```

Replace `your_username` with your Plesk SSH username.

## Step 2: Create Application Directory

```bash
# Navigate to web root or create dedicated directory
cd /var/www/vhosts/cucorn.com/subdomains/llm

# Or use Plesk's website root
cd /var/www/vhosts/cucorn.com/httpdocs/llm

# Create app directory
mkdir -p llm-instruct-models
cd llm-instruct-models
```

## Step 3: Clone the Repository

```bash
# If you have the code locally, upload via SFTP/SCP
# Or clone from your git repository:

git clone https://github.com/yourusername/LLM_instruct_models.git .
# Or if using private repo with SSH:
git clone git@github.com:yourusername/LLM_instruct_models.git .
```

**Alternative:** Upload via Plesk File Manager or SFTP client (FileZilla, WinSCP)

## Step 4: Install Docker on Plesk Server

Plesk has a Docker extension. Install it via:

**Via Plesk UI:**
1. Login to Plesk
2. Go to **Extensions** → **My Extensions**
3. Search for **Docker**
4. Click **Install**

**Or via SSH:**
```bash
# Plesk typically has Docker pre-installed
# Verify Docker is running:
docker --version
docker-compose --version

# If not installed, follow Plesk Docker extension installation
```

## Step 5: Choose Your Database

You have two database options in Plesk:

### Option A: PostgreSQL (Recommended for Production)

**Advantages:**
- Better performance for complex queries
- Better JSON support (used for model tags)
- More robust for production workloads

**Steps:**
1. **Login to Plesk**
2. **Go to:** Databases → Add Database
3. **Fill in:**
   - Database name: `llm_models`
   - Database user: `llm_user` (or your preferred username)
   - Password: (generate a strong password)
4. **Click OK**
5. **Note the database host** (usually `localhost` or a specific IP)

### Option B: MySQL/MariaDB

**Advantages:**
- More familiar if you have MySQL experience
- Good performance for this use case
- Well-supported in Plesk

**Steps:**
1. **Login to Plesk**
2. **Go to:** Databases → Add Database
3. **Fill in:**
   - Database name: `llm_models`
   - Database user: `llm_user` (or your preferred username)
   - Password: (generate a strong password)
4. **Click OK**
5. **Note the database host** (usually `localhost` or a specific IP)

---

## Step 6: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models

nano .env
```

### For PostgreSQL (Option A):

```env
# Backend Configuration
DATABASE_URL=postgresql+asyncpg://llm_user:YOUR_PASSWORD@localhost:5432/llm_models
JWT_SECRET_KEY=generate-a-secure-random-key-here
MODEL_STORAGE_PATH=/opt/llm-models
MAX_UPLOAD_SIZE_MB=50000
DEBUG=false

# CORS Configuration
CORS_ORIGINS=https://llm.cucorn.com
```

### For MySQL/MariaDB (Option B):

```env
# Backend Configuration
DATABASE_URL=mysql+aiomysql://llm_user:YOUR_PASSWORD@localhost:3306/llm_models
JWT_SECRET_KEY=generate-a-secure-random-key-here
MODEL_STORAGE_PATH=/opt/llm-models
MAX_UPLOAD_SIZE_MB=50000
DEBUG=false

# CORS Configuration
CORS_ORIGINS=https://llm.cucorn.com
```

**Generate a secure JWT secret:**
```bash
openssl rand -hex 32
```

Copy the output and paste it as `JWT_SECRET_KEY`.

**Important:** Replace `YOUR_PASSWORD` with the actual database password you created in Plesk.

## Step 6: Configure Docker Compose for Production

Edit `docker-compose.yml`:

```bash
nano docker-compose.yml
```

### For PostgreSQL (Option A):

Replace with production-optimized configuration:

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    container_name: llm-backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/app:/app/app
      - model_data:/opt/llm-models
    environment:
      - DATABASE_URL=postgresql+asyncpg://llm_user:YOUR_PASSWORD@db:5432/llm_models
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - MODEL_STORAGE_PATH=/opt/llm-models
      - MAX_UPLOAD_SIZE_MB=50000
      - CORS_ORIGINS=https://llm.cucorn.com
    restart: unless-stopped
    networks:
      - llm-network
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    container_name: llm-db
    environment:
      - POSTGRES_DB=llm_models
      - POSTGRES_USER=llm_user
      - POSTGRES_PASSWORD=YOUR_PASSWORD
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - llm-network
    # Uncomment to expose database port (not recommended for production)
    # ports:
    #   - "5432:5432"

  frontend:
    build: ./frontend
    container_name: llm-frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/public:/app/public
    environment:
      - VITE_API_URL=https://llm.cucorn.com
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - llm-network

volumes:
  model_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/llm-models
  postgres_data:
    driver: local

networks:
  llm-network:
    driver: bridge
```

**Important:** Replace `YOUR_PASSWORD` with your actual database password.

### For MySQL/MariaDB (Option B):

Replace with production-optimized configuration:

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    container_name: llm-backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/app:/app/app
      - model_data:/opt/llm-models
    environment:
      - DATABASE_URL=mysql+aiomysql://llm_user:YOUR_PASSWORD@db:3306/llm_models
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - MODEL_STORAGE_PATH=/opt/llm-models
      - MAX_UPLOAD_SIZE_MB=50000
      - CORS_ORIGINS=https://llm.cucorn.com
    restart: unless-stopped
    networks:
      - llm-network
    depends_on:
      - db

  db:
    image: mysql:8.0
    container_name: llm-db
    environment:
      - MYSQL_DATABASE=llm_models
      - MYSQL_USER=llm_user
      - MYSQL_PASSWORD=YOUR_PASSWORD
      - MYSQL_ROOT_PASSWORD=YOUR_ROOT_PASSWORD
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped
    networks:
      - llm-network
    # Uncomment to expose database port (not recommended for production)
    # ports:
    #   - "3306:3306"

  frontend:
    build: ./frontend
    container_name: llm-frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/public:/app/public
    environment:
      - VITE_API_URL=https://llm.cucorn.com
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - llm-network

volumes:
  model_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/llm-models
  mysql_data:
    driver: local

networks:
  llm-network:
    driver: bridge
```

**Important:** Replace `YOUR_PASSWORD` and `YOUR_ROOT_PASSWORD` with your actual passwords.

**Note:** If you prefer to use the Plesk-managed database instead of a Docker container, you can use the database host provided by Plesk (usually `localhost` or a specific IP) and remove the `db` service from docker-compose.yml.

## Step 7: Update Backend Requirements

The backend needs database drivers. Update `backend/requirements.txt`:

```bash
nano backend/requirements.txt
```

Add the appropriate database driver:

### For PostgreSQL:
```
asyncpg==0.29.0
```

### For MySQL/MariaDB:
```
aiomysql==0.2.0
pymysql==1.1.1
```

**Full requirements.txt for PostgreSQL:**
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
alembic==1.13.2
pydantic==2.8.2
pydantic-settings==2.4.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.9
httpx==0.27.2
aiosqlite==0.20.0
asyncpg==0.29.0
python-dotenv==1.0.1
```

**Full requirements.txt for MySQL:**
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
alembic==1.13.2
pydantic==2.8.2
pydantic-settings==2.4.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.9
httpx==0.27.2
aiosqlite==0.20.0
aiomysql==0.2.0
pymysql==1.1.1
python-dotenv==1.0.1
```

## Step 8: Build and Start Containers

```bash
# Navigate to app directory
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models

# Build and start containers
docker-compose up -d --build

# Check if containers are running
docker-compose ps

# View logs
docker-compose logs -f
```

## Step 8: Configure Plesk Reverse Proxy

### Option A: Using Plesk Nginx Reverse Proxy (Recommended)

1. **Login to Plesk**
2. **Go to:** Domains → llm.cucorn.com → Web Hosting Settings
3. **Scroll to "Additional Nginx Directives"**
4. **Add the following:**

```nginx
location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Increase upload size limit
    client_max_body_size 50G;
}
```

5. **Click OK/Apply**

### Option B: Using Apache (if not using Nginx)

1. **Go to:** Domains → llm.cucorn.com → Apache & Nginx Settings
2. **Add to Additional Apache Directives:**

```apache
<Location />
    ProxyPass http://127.0.0.1:5173/
    ProxyPassReverse http://127.0.0.1:5173/
</Location>

<Location /api/>
    ProxyPass http://127.0.0.1:8000/
    ProxyPassReverse http://127.0.0.1:8000/
    LimitRequestBody 53687091200
</Location>
```

## Step 9: Configure SSL Certificate

### Using Let's Encrypt (Automatic)

1. **Login to Plesk**
2. **Go to:** Domains → llm.cucorn.com → SSL/TLS Certificates
3. **Click "Add Let's Encrypt Certificate"**
4. **Fill in:**
   - Domain: `llm.cucorn.com`
   - SSL/TLS Streaming: On
   - Auto-renew: Enabled
5. **Click OK**

Plesk will automatically obtain and install the certificate.

### Alternative: Use Existing Certificate

If you have an existing certificate for `cucorn.com`, you can use it for the subdomain (if it's a wildcard cert).

## Step 10: Configure Firewall

Ensure ports are accessible (Plesk typically handles this):

- **Port 80** (HTTP) - Already open
- **Port 443** (HTTPS) - Already open
- **Port 8000** (Backend) - Only accessible locally (127.0.0.1)
- **Port 5173** (Frontend) - Only accessible locally (127.0.0.1)

**Verify with:**
```bash
# Check if ports are listening
ss -tlnp | grep -E '8000|5173'

# Should show:
# LISTEN  0  128  127.0.0.1:8000  0.0.0.0:*  users:(("docker-proxy",pid=...,fd=*))
# LISTEN  0  128  127.0.0.1:5173  0.0.0.0:*  users:(("docker-proxy",pid=...,fd=*))
```

## Step 11: Initialize Database (First Time Only)

The application needs to create the database schema on first run.

### Option A: Using Docker Container

```bash
# Enter the backend container
docker exec -it llm-backend bash

# Inside the container, run the application once to initialize
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# You should see tables being created in the logs
# Press Ctrl+C to stop after initialization
```

### Option B: Manual Database Setup (PostgreSQL)

If you want to manually verify the database:

```bash
# Connect to PostgreSQL
docker exec -it llm-db psql -U llm_user -d llm_models

# Inside psql, verify tables exist:
\dt

# Should see:
# public.models
# public.users
```

### Option B: Manual Database Setup (MySQL)

```bash
# Connect to MySQL
docker exec -it llm-db mysql -u llm_user -p llm_models

# Inside MySQL, verify tables exist:
SHOW TABLES;

# Should see:
# models
# users
```

## Step 12: Set Up Database Backup (Optional)

### Backup SQLite Database

```bash
# Create backup script
nano /opt/llm-backup.sh
```

Add:
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/llm"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup database
cp /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models/backend/llm_models.db $BACKUP_DIR/llm_models_$DATE.db

# Backup models (if needed)
# tar -czf $BACKUP_DIR/models_$DATE.tar.gz /opt/llm-models/

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.db" -mtime +7 -delete

echo "Backup completed: $DATE"
```

Make executable and add to cron:
```bash
chmod +x /opt/llm-backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add line:
0 2 * * * /opt/llm-backup.sh >> /var/log/llm-backup.log 2>&1
```

## Step 13: Monitor and Maintain

### View Logs

```bash
# Backend logs
docker-compose -f /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models/docker-compose.yml logs -f backend

# Frontend logs
docker-compose -f /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models/docker-compose.yml logs -f frontend
```

### Update Application

```bash
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models

# Pull latest changes
git pull

# Rebuild and restart
docker-compose up -d --build
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart only backend
docker-compose restart backend

# Restart only frontend
docker-compose restart frontend
```

## Troubleshooting

### Frontend Not Loading

**Check if frontend container is running:**
```bash
docker-compose ps
```

**Check frontend logs:**
```bash
docker-compose logs frontend
```

**Verify Nginx/Apache configuration:**
```bash
# Test Nginx config
nginx -t

# Reload Nginx
systemctl reload nginx
```

### Backend API Not Responding

**Check if backend container is running:**
```bash
docker-compose ps
```

**Check backend logs:**
```bash
docker-compose logs backend
```

**Verify CORS configuration in `.env`:**
```env
CORS_ORIGINS=https://llm.cucorn.com
```

### SSL Certificate Issues

**Check certificate status:**
```bash
# In Plesk UI: Domains → llm.cucorn.com → SSL/TLS Certificates
```

**Renew certificate:**
```bash
# Via Plesk UI or command line
plesk cert --renew llm.cucorn.com
```

### Permission Issues

**Fix file permissions:**
```bash
# Navigate to app directory
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models

# Fix permissions
chown -R www-data:www-data .
chmod -R 755 .
```

### Disk Space Issues

**Check disk usage:**
```bash
df -h

# Check Docker disk usage
docker system df
```

**Clean up unused Docker resources:**
```bash
docker system prune -a
```

## Security Checklist

- [x] SSL certificate installed (HTTPS)
- [x] JWT secret key changed from default
- [x] Strong passwords for all accounts
- [x] Firewall configured (only ports 80, 443 open externally)
- [x] Regular backups configured
- [x] Application logs monitored
- [ ] Rate limiting implemented (consider adding)
- [ ] File upload size limits enforced
- [ ] Database backed up regularly

## Performance Optimization (Optional)

### Enable Gzip Compression

In Plesk → llm.cucorn.com → Apache & Nginx Settings → Additional Nginx Directives:

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
gzip_min_length 1000;
```

### Enable Caching

```nginx
location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2|ttf|svg)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

## Support & Resources

- **Plesk Documentation:** https://docs.plesk.com/
- **Docker Documentation:** https://docs.docker.com/
- **FastAPI Documentation:** https://fastapi.tiangolo.com/
- **Let's Encrypt:** https://letsencrypt.org/

## Next Steps

1. Test the application thoroughly
2. Set up monitoring (optional)
3. Configure email notifications for backups
4. Consider adding API rate limiting
5. Plan for database migration to PostgreSQL if needed

## Contact

For Plesk support: https://www.plesk.com/support/
For IONOS support: https://www.ionos.com/help/
