-- rint:migration
-- objective: Link prompts to hero SKUs (product_id FK) for SKU×query probe matrix
-- risk: low
-- rollback: ALTER TABLE rint.prompts DROP COLUMN product_id; DROP INDEX IF EXISTS rint.prompts_product_id_idx;

ALTER TABLE rint.prompts
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES rint.products (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS prompts_product_id_idx
  ON rint.prompts (product_id)
  WHERE active AND product_id IS NOT NULL;
