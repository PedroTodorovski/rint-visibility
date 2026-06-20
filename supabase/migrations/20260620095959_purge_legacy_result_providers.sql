-- rint:migration
-- objective: purge validation-phase multi-provider result rows before gemini-only MVP 2026 constraint
-- risk: low
-- rollback: not recoverable — legacy chatgpt/claude validation rows only

-- rint:allow-destructive mvp-2026-gemini-only

delete from rint.results
where provider is distinct from 'gemini';
