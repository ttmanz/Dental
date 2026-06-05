-- Migration 016: seed 8 built-in consent templates for every existing practice

INSERT INTO consent_templates
  (practice_id, title_en, title_el, body_en, body_el, fields, category, sort_order)
SELECT p.id, t.title_en, t.title_el, t.body_en, t.body_el, t.fields::jsonb, t.category, t.sort_order
FROM practices p
CROSS JOIN (VALUES

  -- 1. General Treatment Consent
  ('General Treatment Consent',
   'Γενική Συναίνεση Θεραπείας',
   'I consent to the dental examination, diagnosis, and recommended treatment by the dental team. I understand that dental treatment involves certain risks, including but not limited to: temporary soreness, swelling, infection, bleeding, and rare complications. I have been given the opportunity to ask questions and have had my concerns addressed satisfactorily.',
   'Συναινώ στην οδοντιατρική εξέταση, διάγνωση και προτεινόμενη θεραπεία από την οδοντιατρική ομάδα. Κατανοώ ότι η οδοντιατρική θεραπεία ενέχει ορισμένους κινδύνους, συμπεριλαμβανομένων ευαισθησίας, οιδήματος, λοίμωξης, αιμορραγίας και σπάνιων επιπλοκών. Μου δόθηκε η ευκαιρία να υποβάλω ερωτήσεις.',
   '[{"key":"medical_changes","label_en":"Any recent changes to your medical history or medications?","label_el":"Πρόσφατες αλλαγές στο ιατρικό ιστορικό ή φαρμακευτική αγωγή;","type":"text","required":false},{"key":"agree","label_en":"I have read and understand this consent form","label_el":"Διάβασα και κατανοώ αυτή τη φόρμα συναίνεσης","type":"checkbox","required":true}]',
   'general', 1),

  -- 2. Local Anaesthesia Consent
  ('Local Anaesthesia Consent',
   'Συναίνεση Τοπικής Αναισθησίας',
   'I consent to the administration of local anaesthesia for my dental treatment. I understand that local anaesthesia temporarily numbs the treated area. Possible side effects include temporary numbness, tingling, or soreness at the injection site. In rare cases, allergic reactions can occur. I will inform the dental team of any known allergies.',
   'Συναινώ στη χορήγηση τοπικής αναισθησίας για τη θεραπεία μου. Κατανοώ ότι η τοπική αναισθησία μουδιάζει προσωρινά την περιοχή θεραπείας. Πιθανές παρενέργειες περιλαμβάνουν μούδιασμα, μυρμήγκιασμα ή ευαισθησία στο σημείο ένεσης. Σε σπάνιες περιπτώσεις μπορεί να εμφανιστεί αλλεργική αντίδραση.',
   '[{"key":"allergies_la","label_en":"Known allergies to anaesthetics or medications","label_el":"Γνωστές αλλεργίες σε αναισθητικά ή φάρμακα","type":"text","required":false},{"key":"agree","label_en":"I consent to local anaesthesia","label_el":"Συναινώ στην τοπική αναισθησία","type":"checkbox","required":true}]',
   'anaesthesia', 2),

  -- 3. Tooth Extraction Consent
  ('Tooth Extraction Consent',
   'Συναίνεση Εξαγωγής Δοντιού',
   'I consent to the extraction of the tooth/teeth specified. I understand the risks include: pain, swelling, infection, dry socket, nerve injury, and sinus involvement (upper teeth). Post-operative instructions will be provided. I understand the need for possible future replacement options.',
   'Συναινώ στην εξαγωγή του/των δοντιού/δοντιών που ορίζεται. Κατανοώ τους κινδύνους, που περιλαμβάνουν: πόνο, οίδημα, λοίμωξη, ξηρή κυψέλη, βλάβη νεύρου. Θα λάβω οδηγίες μετεγχειρητικής φροντίδας.',
   '[{"key":"tooth_number","label_en":"Tooth number(s) for extraction","label_el":"Αριθμός/οί δοντιού/ών","type":"text","required":true},{"key":"alternative_explained","label_en":"Alternatives to extraction have been explained to me","label_el":"Μου έχουν εξηγηθεί οι εναλλακτικές της εξαγωγής","type":"checkbox","required":true},{"key":"agree","label_en":"I consent to the extraction","label_el":"Συναινώ στην εξαγωγή","type":"checkbox","required":true}]',
   'surgical', 3),

  -- 4. Root Canal Treatment Consent
  ('Root Canal Treatment Consent',
   'Συναίνεση Ενδοδοντικής Θεραπείας',
   'I consent to root canal treatment on the specified tooth/teeth. I understand this procedure involves removing the dental pulp and sealing the root canal. Risks include: instrument fracture, perforation, post-operative discomfort, and the need for retreatment. A crown is often recommended after root canal treatment.',
   'Συναινώ στην ενδοδοντική θεραπεία στο/στα συγκεκριμένο/α δόντι/α. Κατανοώ ότι η διαδικασία περιλαμβάνει αφαίρεση του οδοντικού πολφού και σφράγιση του ριζικού σωλήνα. Κίνδυνοι: θραύση εργαλείου, διάτρηση, μετεγχειρητική ενόχληση.',
   '[{"key":"tooth_number","label_en":"Tooth number(s)","label_el":"Αριθμός δοντιού/ών","type":"text","required":true},{"key":"crown_discussed","label_en":"The need for a crown after treatment has been discussed","label_el":"Συζητήθηκε η ανάγκη κορώνας μετά τη θεραπεία","type":"checkbox","required":false},{"key":"agree","label_en":"I consent to root canal treatment","label_el":"Συναινώ στην ενδοδοντική θεραπεία","type":"checkbox","required":true}]',
   'endodontic', 4),

  -- 5. Implant Consent
  ('Dental Implant Consent',
   'Συναίνεση Οδοντικού Εμφυτεύματος',
   'I consent to dental implant treatment. I understand this is a surgical procedure involving placement of a titanium post into the jawbone. Risks include: infection, nerve damage, sinus involvement, implant failure, and the need for bone grafting. Success depends on bone quality, oral hygiene, and systemic health. I commit to the required follow-up appointments.',
   'Συναινώ στη θεραπεία οδοντικού εμφυτεύματος. Κατανοώ ότι πρόκειται για χειρουργική επέμβαση τοποθέτησης τιτανίου στο οστό. Κίνδυνοι: λοίμωξη, βλάβη νεύρου, αποτυχία εμφυτεύματος.',
   '[{"key":"medical_clearance","label_en":"I have disclosed all relevant medical conditions (diabetes, bisphosphonates, blood thinners, smoking)","label_el":"Έχω αναφέρει όλες τις ιατρικές παθήσεις","type":"checkbox","required":true},{"key":"agree","label_en":"I consent to implant placement","label_el":"Συναινώ στην τοποθέτηση εμφυτεύματος","type":"checkbox","required":true}]',
   'surgical', 5),

  -- 6. Teeth Whitening Consent
  ('Teeth Whitening Consent',
   'Συναίνεση Λεύκανσης Δοντιών',
   'I consent to professional teeth whitening treatment. I understand that: whitening may cause temporary tooth sensitivity and gum irritation; results vary between individuals; existing restorations (crowns, veneers, fillings) will not whiten; results are not permanent. I have been advised to avoid staining foods and drinks for 48 hours post-treatment.',
   'Συναινώ στην επαγγελματική λεύκανση δοντιών. Κατανοώ ότι η λεύκανση μπορεί να προκαλέσει προσωρινή ευαισθησία και ερεθισμό ούλων. Τα αποτελέσματα δεν είναι μόνιμα. Συνιστάται αποφυγή χρωματιστών τροφών για 48 ώρες.',
   '[{"key":"sensitive_teeth","label_en":"Do you currently have sensitive teeth?","label_el":"Έχετε ευαίσθητα δόντια;","type":"text","required":false},{"key":"agree","label_en":"I consent to teeth whitening","label_el":"Συναινώ στη λεύκανση","type":"checkbox","required":true}]',
   'cosmetic', 6),

  -- 7. Orthodontic Treatment Consent
  ('Orthodontic Treatment Consent',
   'Συναίνεση Ορθοδοντικής Θεραπείας',
   'I consent to orthodontic treatment as described by the treating orthodontist. I understand treatment duration may vary, and that results depend on patient compliance. Risks include: root resorption, temporary discomfort, white spot lesions (if oral hygiene is poor), and relapse without retainer use.',
   'Συναινώ στην ορθοδοντική θεραπεία. Κατανοώ ότι η διάρκεια θεραπείας ποικίλλει και τα αποτελέσματα εξαρτώνται από τη συμμόρφωση. Κίνδυνοι: απορρόφηση ρίζας, ενόχληση, υποτροπή χωρίς συγκρατητήρα.',
   '[{"key":"agree_compliance","label_en":"I understand that compliance with wearing appliances is essential","label_el":"Κατανοώ ότι η συμμόρφωση είναι απαραίτητη","type":"checkbox","required":true},{"key":"agree","label_en":"I consent to orthodontic treatment","label_el":"Συναινώ στην ορθοδοντική θεραπεία","type":"checkbox","required":true}]',
   'orthodontic', 7),

  -- 8. GDPR Data Processing Consent
  ('GDPR Data Processing Consent',
   'Συναίνεση Επεξεργασίας Δεδομένων (ΓΚΠΔ)',
   'In accordance with EU Regulation 2016/679 (GDPR), I consent to the collection, storage, and processing of my personal and health data for the purposes of dental treatment. I understand my rights: access, rectification, erasure, portability, and the right to withdraw consent. Data is stored securely and not shared without my consent except as required by law.',
   'Σύμφωνα με τον Κανονισμό (ΕΕ) 2016/679 (ΓΚΠΔ), συναινώ στη συλλογή, αποθήκευση και επεξεργασία των προσωπικών και υγειονομικών μου δεδομένων για τους σκοπούς οδοντιατρικής θεραπείας. Γνωρίζω τα δικαιώματά μου: πρόσβαση, διόρθωση, διαγραφή, φορητότητα.',
   '[{"key":"marketing","label_en":"I consent to receive appointment reminders and practice news","label_el":"Συναινώ να λαμβάνω υπενθυμίσεις και νέα ιατρείου","type":"checkbox","required":false},{"key":"agree","label_en":"I consent to data processing as described","label_el":"Συναινώ στην επεξεργασία δεδομένων όπως περιγράφεται","type":"checkbox","required":true}]',
   'gdpr', 8)

) AS t(title_en, title_el, body_en, body_el, fields, category, sort_order)
ON CONFLICT DO NOTHING;
