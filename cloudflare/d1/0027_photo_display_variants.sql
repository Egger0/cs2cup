ALTER TABLE photo ADD COLUMN variant_widths TEXT NOT NULL DEFAULT '[]';

DROP VIEW IF EXISTS photo_public;
CREATE VIEW photo_public AS
SELECT p.* FROM photo p JOIN tournament t ON t.id = p.tournament_id WHERE t.status != 'draft';
