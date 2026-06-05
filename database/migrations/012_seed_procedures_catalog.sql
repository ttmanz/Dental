-- Migration 012: seed default procedures catalog for every existing practice
-- Runs once; practices created later get seeded by the register-practice route.

INSERT INTO procedures_catalog (practice_id, code, name_en, name_el, category, default_cost, sort_order)
SELECT
  p.id,
  d.code, d.name_en, d.name_el, d.category::procedure_category, d.default_cost, d.sort_order
FROM practices p
CROSS JOIN (VALUES
  -- Diagnostic
  ('D01', 'Comprehensive Exam',        'Πλήρης Εξέταση',          'diagnostic',   60,  1),
  ('D02', 'Periodic Exam',             'Περιοδική Εξέταση',        'diagnostic',   40,  2),
  ('D03', 'X-Ray (Periapical)',        'Ακτινογραφία (Περιακρορ.)','diagnostic',   25,  3),
  ('D04', 'X-Ray (Panoramic)',         'Πανοραμική Ακτινογραφία',  'diagnostic',   80,  4),
  -- Preventive
  ('P01', 'Scale & Polish',            'Καθαρισμός & Γυάλισμα',   'preventive',   80,  5),
  ('P02', 'Fluoride Treatment',        'Εφαρμογή Φθορίου',        'preventive',   30,  6),
  ('P03', 'Fissure Sealant',           'Σφράγιση Αυλακώσεων',     'preventive',   40,  7),
  -- Restorative
  ('R01', 'Composite Filling (1 surf)','Σύνθετη Σφράγιση (1 επιφ)','restorative', 80,  8),
  ('R02', 'Composite Filling (2 surf)','Σύνθετη Σφράγιση (2 επιφ)','restorative', 110, 9),
  ('R03', 'Composite Filling (3 surf)','Σύνθετη Σφράγιση (3 επιφ)','restorative', 140, 10),
  ('R04', 'Amalgam Filling',           'Αμάλγαμα',                'restorative',  70, 11),
  -- Endodontic
  ('E01', 'Root Canal - Anterior',     'Εμφύτευμα - Πρόσθιο',    'endodontic',  250, 12),
  ('E02', 'Root Canal - Premolar',     'Εμφύτευμα - Προγόμφιο',  'endodontic',  300, 13),
  ('E03', 'Root Canal - Molar',        'Εμφύτευμα - Γόμφιο',     'endodontic',  380, 14),
  -- Prosthetic
  ('PR01','Crown - PFM',               'Κορώνα - PFM',            'prosthetic',  450, 15),
  ('PR02','Crown - Zirconia',          'Κορώνα - Ζιρκόνιο',       'prosthetic',  650, 16),
  ('PR03','Crown - All Ceramic',       'Κορώνα - Ολοκεραμική',    'prosthetic',  700, 17),
  ('PR04','Bridge (per unit)',         'Γέφυρα (ανά μονάδα)',      'prosthetic',  600, 18),
  ('PR05','Partial Denture',           'Μερική Οδοντοστοιχία',    'prosthetic',  800, 19),
  ('PR06','Full Denture',              'Ολική Οδοντοστοιχία',     'prosthetic', 1200, 20),
  ('PR07','Veneer - Porcelain',        'Όψη - Πορσελάνη',         'prosthetic',  550, 21),
  -- Surgical
  ('S01', 'Simple Extraction',         'Απλή Εξαγωγή',            'surgical',    80,  22),
  ('S02', 'Surgical Extraction',       'Χειρουργική Εξαγωγή',     'surgical',   180,  23),
  ('S03', 'Wisdom Tooth Removal',      'Αφαίρεση Φρονιμίτη',      'surgical',   250,  24),
  ('S04', 'Implant (placement)',       'Εμφύτευμα (τοποθέτηση)',  'surgical',  1200,  25),
  -- Periodontic
  ('PE01','Deep Scaling (per quad)',   'Βαθύς Καθαρισμός (τεταρτ)','periodontic',120, 26),
  ('PE02','Gum Surgery (per quad)',    'Χειρ. Ούλων (τεταρτ.)',   'periodontic', 300, 27),
  -- Cosmetic
  ('C01', 'Teeth Whitening (in-office)','Λεύκανση (ιατρείο)',     'cosmetic',   280,  28),
  ('C02', 'Whitening (take-home)',     'Λεύκανση (σπίτι)',        'cosmetic',   180,  29),
  -- Orthodontic
  ('O01', 'Orthodontic Consultation',  'Ορθοδοντικός Έλεγχος',   'orthodontic', 80,  30),
  ('O02', 'Metal Braces (full)',       'Μεταλλικά Σιδεράκια',    'orthodontic',2000,  31),
  ('O03', 'Clear Aligner (full)',      'Διαφανή Νάρθηκες',       'orthodontic',3500,  32)
) AS d(code, name_en, name_el, category, default_cost, sort_order)
ON CONFLICT (practice_id, code) DO NOTHING;
