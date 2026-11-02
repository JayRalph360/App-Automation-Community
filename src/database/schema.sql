
CREATE TABLE IF NOT EXISTS merchants (
    number TEXT PRIMARY KEY
        CHECK (number ~ '^233(24|25|53|54|55|59)[0-9]{7}$'),

    business_name TEXT NOT NULL DEFAULT '',
    owner_number TEXT NOT NULL
        CHECK (owner_number ~ '^233(24|25|53|54|55|59)[0-9]{7}$'),
    office_number TEXT NOT NULL
        CHECK (office_number ~ '^233(24|25|53|54|55|59)[0-9]{7}$'),
    merchant_attendant_name TEXT NOT NULL DEFAULT '',
    merchant_payment_code TEXT NOT NULL
        CHECK (merchant_payment_code ~ '^233(24|25|53|54|55|59)[0-9]{7}$'),

    email TEXT NOT NULL DEFAULT '',

    business_registration_type TEXT NOT NULL
        DEFAULT 'Business Certificate',
    business_registration_number TEXT NOT NULL DEFAULT 'N/A',

    business_type TEXT NOT NULL DEFAULT 'Sole Proprietorship'
        CHECK (business_type IN (
            'Non-Governmental Organization',
            'Partnership',
            'Private Company',
            'Public Listed Company',
            'SME',
            'Sole Proprietorship'
        )),

    industry TEXT NOT NULL DEFAULT 'General good retail',
    service_type TEXT NOT NULL DEFAULT 'B2C'
        CHECK (service_type IN ('B2C', 'C2B')),

    tin_number TEXT NOT NULL DEFAULT 'N/A',
    digital_address TEXT NOT NULL DEFAULT '',

    items_given TEXT[] NOT NULL DEFAULT ARRAY['Stickers']::TEXT[],

    status TEXT NOT NULL DEFAULT 'Incompleted'
        CHECK (status IN ('Completed', 'Incompleted', 'Active')),

    visited_status TEXT NOT NULL DEFAULT 'Not completed'
        CHECK (visited_status IN ('Completed', 'Not completed')),

    source TEXT NOT NULL DEFAULT 'manual',
    last_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status_created
    ON merchants (status, created_at);

CREATE INDEX IF NOT EXISTS idx_merchants_updated
    ON merchants (updated_at);

CREATE TABLE IF NOT EXISTS import_batches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_file TEXT NOT NULL,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('csv', 'xlsx', 'manual')),
    status TEXT NOT NULL DEFAULT 'Processing'
        CHECK (status IN (
            'Processing', 'Completed', 'CompletedWithErrors', 'Failed'
        )),
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_row_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id BIGINT NOT NULL
        REFERENCES import_batches(id) ON DELETE RESTRICT,
    row_number INTEGER NOT NULL,
    number TEXT,
    outcome TEXT NOT NULL
        CHECK (outcome IN (
            'Inserted', 'Duplicate', 'Rejected', 'Failed'
        )),
    reason TEXT,
    row_data JSONB NOT NULL DEFAULT '{}'::JSONB,
    handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_logs_batch_outcome
    ON import_row_logs (batch_id, outcome);
