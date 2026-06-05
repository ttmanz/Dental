-- Development seed — creates one practice with two dentists and sample patients.
-- Run after migrations: psql $DATABASE_URL -f database/seed.sql

BEGIN;

-- Practice
INSERT INTO practices (id, name, country, locale, timezone)
VALUES ('00000000-0000-0000-0000-000000000001',
        'Ιατρείο Παπαδόπουλος', 'GR', 'el', 'Europe/Athens');

-- Admin user  (password: demo1234)
INSERT INTO users (practice_id, email, password_hash, role, first_name, last_name)
VALUES ('00000000-0000-0000-0000-000000000001',
        'admin@demo.gr',
        '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeAn0k2KVMFP3bOuq',
        'admin', 'Admin', 'Demo');

-- Dentists
INSERT INTO dentists (practice_id, first_name, last_name, display_name, color, sort_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Νίκος',   'Παπαδόπουλος', 'Dr. Παπαδόπουλος', '#3D9E8F', 1),
  ('00000000-0000-0000-0000-000000000001', 'Μαρία',   'Ιωάννου',      'Dr. Ιωάννου',      '#8B7CC8', 2);

-- AI settings
INSERT INTO ai_settings (practice_id) VALUES ('00000000-0000-0000-0000-000000000001');

-- Sample patients
INSERT INTO patients (practice_id, first_name, last_name, phone, date_of_birth)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Γιώργος', 'Αλεξίου',   '6971234567', '1985-03-12'),
  ('00000000-0000-0000-0000-000000000001', 'Ελένη',   'Σταύρου',   '6989876543', '1992-07-24'),
  ('00000000-0000-0000-0000-000000000001', 'Κώστας',  'Μιχαλάκης', '6945112233', '1978-11-05');

COMMIT;
