-- Statut à restaurer après désarchivage.
ALTER TABLE "ai_system" ADD COLUMN "statusBeforeArchive" "AiSystemStatus";

-- Recherche plein texte (français), maintenue par trigger (une colonne GENERATED
-- serait vue comme une dérive par Prisma). Référence et nom pondérés A,
-- finalité/description B, cas d'usage/contexte/objectifs C.
ALTER TABLE "ai_system" ADD COLUMN "search" tsvector;

CREATE OR REPLACE FUNCTION chandelier_ai_system_search() RETURNS trigger AS $$
BEGIN
  NEW."search" :=
    setweight(to_tsvector('simple'::regconfig, coalesce(NEW."reference", '')), 'A') ||
    setweight(to_tsvector('french'::regconfig, coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('french'::regconfig, coalesce(NEW."purpose", '') || ' ' || coalesce(NEW."description", '')), 'B') ||
    setweight(to_tsvector('french'::regconfig, coalesce(NEW."useCases", '') || ' ' || coalesce(NEW."operationalContext", '') || ' ' || coalesce(NEW."objectives", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_system_search_trigger
  BEFORE INSERT OR UPDATE OF "reference", "name", "purpose", "description", "useCases", "operationalContext", "objectives"
  ON "ai_system" FOR EACH ROW EXECUTE FUNCTION chandelier_ai_system_search();

CREATE INDEX "ai_system_search_idx" ON "ai_system" USING GIN ("search");