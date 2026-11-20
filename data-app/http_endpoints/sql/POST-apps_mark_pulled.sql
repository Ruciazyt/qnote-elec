USE qnote_catalog;

UPDATE qnote_catalog.published_app
SET pulls = pulls + 1
WHERE id = ${id};
