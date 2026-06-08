# Dental Assistant Pro — Setup & Deploy

## Prerequisites
- Node.js 18+
- PostgreSQL 14+ (local or managed — Supabase / Railway / Render / AWS RDS)

---

## 1. Clone & install

```bash
cd backend
npm install
```

---

## 2. Configure environment

Copy and fill in `backend/.env`:

```
DATABASE_URL=postgres://user:pass@host:5432/dental_db
DB_SSL=true               # set true for managed DBs (Supabase, Railway, etc.)
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
APP_URL=https://your-domain.com
SA_USERNAME=TTmanz07
SA_PASSWORD=<your-superadmin-password>
```

---

## 3. Create the database

```sql
-- On your PostgreSQL server:
CREATE DATABASE dental_db;
CREATE USER dental_app WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE dental_db TO dental_app;
```

For **Supabase**: just create a project and copy the connection string into `DATABASE_URL`.

---

## 4. Run migrations

```bash
cd backend
npm run migrate
```

This creates all tables, enums, RLS policies, indexes, and helper functions.

---

## 5. Start the server

```bash
npm start          # production
npm run dev        # development (nodemon)
```

Server starts on port `3001` (or `PORT` env var).

---

## 6. App URLs

| URL | Description |
|-----|-------------|
| `/` | Landing page |
| `/app` | Dental app (staff login) |
| `/portal` | Patient portal |
| `/superadmin` | Platform admin |

---

## 7. First practice setup

Go to `https://your-domain.com/app` and click **Register** — this creates your practice and admin account.
The procedures catalog (43 default procedures) is seeded automatically.

---

## 8. Deploy to AWS EC2 / VPS

```bash
# On the server
git clone <repo> dental-pro
cd dental-pro/backend
npm install --production
cp .env.example .env    # then edit .env
npm run migrate
pm2 start src/index.js --name dental-pro
pm2 save
```

**Nginx config** (proxy to Node):
```nginx
location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

---

## 9. Superadmin portal

Go to `https://your-domain.com/superadmin`

Login: `TTmanz07` / `<your SA_PASSWORD from .env>`

---

## 10. Patient portal

Share the URL with patients:
`https://your-domain.com/portal?practice=<practice-uuid>`

The practice UUID is visible in the admin dashboard under **Patient Portal Link**.
Patients log in with their **email + date of birth**.
