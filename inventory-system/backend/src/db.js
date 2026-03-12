const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_USER || 'juxin';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || '';
const DB_NAME = process.env.MYSQL_DATABASE || 'juxin_inventory';
const DB_CONN_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);
const DB_RETRIES = Number(process.env.DB_CONNECT_RETRIES || 30);
const DB_RETRY_DELAY = Number(process.env.DB_CONNECT_DELAY_MS || 2000);

let pool;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureSafeIdentifier = (value, name) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value || '')) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
};

const buildPool = ({ database, user, password } = {}) =>
  mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: user || DB_USER,
    password: password !== undefined ? password : DB_PASSWORD,
    database,
    waitForConnections: true,
    connectionLimit: DB_CONN_LIMIT,
    dateStrings: true,
  });

const waitForDb = async (targetPool, label = 'database') => {
  for (let i = 0; i < DB_RETRIES; i += 1) {
    try {
      await targetPool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === DB_RETRIES - 1) {
        throw err;
      }
      console.warn(`[db] waiting for ${label}... (${i + 1}/${DB_RETRIES})`);
      await sleep(DB_RETRY_DELAY);
    }
  }
};

const bootstrapDatabase = async () => {
  const adminUser = process.env.MYSQL_ADMIN_USER || DB_USER;
  const adminPassword =
    process.env.MYSQL_ADMIN_PASSWORD !== undefined
      ? process.env.MYSQL_ADMIN_PASSWORD
      : DB_PASSWORD;

  const safeDbName = ensureSafeIdentifier(DB_NAME, 'MYSQL_DATABASE');
  const safeAppUser = ensureSafeIdentifier(DB_USER, 'MYSQL_USER');

  const adminPool = buildPool({ user: adminUser, password: adminPassword });

  await waitForDb(adminPool, 'mysql admin connection');

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    await adminPool.query(`GRANT ALL PRIVILEGES ON \`${safeDbName}\`.* TO '${safeAppUser}'@'%'`);
    await adminPool.query('FLUSH PRIVILEGES');
  } finally {
    await adminPool.end();
  }
};

const query = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

const get = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows[0] || null;
};

const run = async (sql, params = []) => {
  const [result] = await pool.execute(sql, params);
  return result;
};

const transaction = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return rows;
      },
      get: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return rows[0] || null;
      },
      run: async (sql, params = []) => {
        const [result] = await conn.execute(sql, params);
        return result;
      },
    };

    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const columnExists = async (table, column) => {
  const rows = await query(
    `SELECT COUNT(1) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
};

const addColumnIfMissing = async (table, column, definition) => {
  if (await columnExists(table, column)) return;
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_FIELDNAME') return;
    throw err;
  }
};
const indexExists = async (table, indexName) => {
  const rows = await query(
    `SELECT COUNT(1) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(rows[0]?.count || 0) > 0;
};
const addIndexIfMissing = async (table, indexName, columnsSql) => {
  if (await indexExists(table, indexName)) return;
  try {
    await run(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columnsSql})`);
  } catch (err) {
    if (err && err.code === 'ER_DUP_KEYNAME') return;
    throw err;
  }
};

const createSchema = async () => {
  await run(`CREATE TABLE IF NOT EXISTS storage_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    warehouse VARCHAR(128) DEFAULT '',
    area VARCHAR(128) DEFAULT '',
    shelf VARCHAR(128) DEFAULT '',
    slot VARCHAR(128) DEFAULT '',
    description TEXT,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS usage_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(64) DEFAULT '',
    description TEXT,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(128) DEFAULT '',
    unit VARCHAR(32) NOT NULL DEFAULT '件',
    safety_stock DECIMAL(18,3) NOT NULL DEFAULT 0,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS inventory_balances (
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    quantity DECIMAL(18,3) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, storage_location_id),
    CONSTRAINT fk_balance_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_balance_storage_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stock_in_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    supplier VARCHAR(255) DEFAULT '',
    remark TEXT,
    created_by INT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_in_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stock_in_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    quantity DECIMAL(18,3) NOT NULL,
    unit_cost DECIMAL(18,3) NOT NULL DEFAULT 0,
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    serial_no VARCHAR(128) NOT NULL DEFAULT '',
    CONSTRAINT fk_stock_in_item_order FOREIGN KEY (order_id) REFERENCES stock_in_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_in_item_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_stock_in_item_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stock_out_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    usage_location_id INT NOT NULL,
    purpose VARCHAR(255) DEFAULT '',
    remark TEXT,
    created_by INT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_out_created_at (created_at),
    CONSTRAINT fk_stock_out_usage_location FOREIGN KEY (usage_location_id) REFERENCES usage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stock_out_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    quantity DECIMAL(18,3) NOT NULL,
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    serial_no VARCHAR(128) NOT NULL DEFAULT '',
    CONSTRAINT fk_stock_out_item_order FOREIGN KEY (order_id) REFERENCES stock_out_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_out_item_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_stock_out_item_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS shipping_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_no VARCHAR(64) NOT NULL UNIQUE,
    stock_out_order_id INT NOT NULL,
    carrier VARCHAR(128) NOT NULL DEFAULT '',
    tracking_no VARCHAR(128) NOT NULL,
    receiver_name VARCHAR(128) NOT NULL DEFAULT '',
    receiver_phone VARCHAR(64) NOT NULL DEFAULT '',
    receiver_address VARCHAR(255) NOT NULL DEFAULT '',
    shipped_at DATETIME NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    remark TEXT,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_shipping_stock_out_order FOREIGN KEY (stock_out_order_id) REFERENCES stock_out_orders(id),
    UNIQUE KEY uniq_shipping_tracking_no (tracking_no),
    INDEX idx_shipping_stock_out (stock_out_order_id),
    INDEX idx_shipping_status (status),
    INDEX idx_shipping_shipped_at (shipped_at),
    INDEX idx_shipping_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS shipping_alert_notices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipping_order_id INT NOT NULL,
    alert_type VARCHAR(32) NOT NULL,
    first_notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    notify_count INT NOT NULL DEFAULT 1,
    note VARCHAR(255) NULL,
    UNIQUE KEY uniq_shipping_alert (shipping_order_id, alert_type),
    INDEX idx_shipping_alert_resolved (resolved_at),
    CONSTRAINT fk_shipping_alert_order FOREIGN KEY (shipping_order_id) REFERENCES shipping_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS shipping_tracking_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipping_order_id INT NOT NULL,
    event_time DATETIME NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT '',
    location VARCHAR(128) NOT NULL DEFAULT '',
    description VARCHAR(255) NOT NULL DEFAULT '',
    source VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_shipping_track_event (shipping_order_id, event_time, status, location, description),
    INDEX idx_shipping_track_order_time (shipping_order_id, event_time),
    INDEX idx_shipping_track_created_at (created_at),
    CONSTRAINT fk_shipping_track_order FOREIGN KEY (shipping_order_id) REFERENCES shipping_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stocktake_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'POSTED',
    remark TEXT,
    created_by INT NULL,
    created_by_sub VARCHAR(64) NULL,
    created_by_name VARCHAR(128) NULL,
    created_by_role VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at DATETIME
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS stocktake_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    system_qty DECIMAL(18,3) NOT NULL,
    counted_qty DECIMAL(18,3) NOT NULL,
    diff_qty DECIMAL(18,3) NOT NULL,
    CONSTRAINT fk_stocktake_item_order FOREIGN KEY (order_id) REFERENCES stocktake_orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_stocktake_item_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_stocktake_item_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS inventory_ledger (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    usage_location_id INT,
    change_type VARCHAR(32) NOT NULL,
    qty_change DECIMAL(18,3) NOT NULL,
    qty_before DECIMAL(18,3) NOT NULL,
    qty_after DECIMAL(18,3) NOT NULL,
    ref_type VARCHAR(32) NOT NULL,
    ref_id INT,
    operator_id INT NULL,
    operator_sub VARCHAR(64) NULL,
    operator_name VARCHAR(128) NULL,
    operator_role VARCHAR(32) NULL,
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    serial_no VARCHAR(128) NOT NULL DEFAULT '',
    note VARCHAR(255),
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ledger_occurred_at (occurred_at),
    INDEX idx_ledger_product (product_id),
    CONSTRAINT fk_ledger_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_ledger_storage_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id),
    CONSTRAINT fk_ledger_usage_location FOREIGN KEY (usage_location_id) REFERENCES usage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS inventory_batch_balances (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    storage_location_id INT NOT NULL,
    batch_no VARCHAR(64) NOT NULL,
    qty_in DECIMAL(18,3) NOT NULL DEFAULT 0,
    qty_out DECIMAL(18,3) NOT NULL DEFAULT 0,
    qty_balance DECIMAL(18,3) NOT NULL DEFAULT 0,
    last_stock_in_order_id INT NULL,
    last_stock_out_order_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_inventory_batch_balance (product_id, storage_location_id, batch_no),
    INDEX idx_batch_balance_lookup (batch_no, product_id, storage_location_id),
    INDEX idx_batch_balance_updated (updated_at),
    CONSTRAINT fk_batch_balance_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_batch_balance_storage_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS inventory_serial_numbers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    serial_no VARCHAR(128) NOT NULL,
    product_id INT NOT NULL,
    storage_location_id INT NULL,
    batch_no VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'IN_STOCK',
    stock_in_order_id INT NULL,
    stock_in_item_id INT NULL,
    stock_out_order_id INT NULL,
    stock_out_item_id INT NULL,
    remark VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_inventory_serial_no (serial_no),
    INDEX idx_serial_status (status, updated_at),
    INDEX idx_serial_product_location (product_id, storage_location_id, status),
    INDEX idx_serial_batch (batch_no, product_id),
    INDEX idx_serial_stock_in (stock_in_order_id),
    INDEX idx_serial_stock_out (stock_out_order_id),
    CONSTRAINT fk_serial_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_serial_storage_location FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run(`CREATE TABLE IF NOT EXISTS operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    user_sub VARCHAR(64) NULL,
    username VARCHAR(128) NOT NULL DEFAULT '',
    user_role VARCHAR(32) NOT NULL DEFAULT '',
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NULL,
    message VARCHAR(255) NULL,
    before_data LONGTEXT NULL,
    after_data LONGTEXT NULL,
    request_ip VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Compatibility migration for earlier local-account implementation.
  await addColumnIfMissing('stock_in_orders', 'created_by_sub', 'created_by_sub VARCHAR(64) NULL');
  await addColumnIfMissing('stock_in_orders', 'created_by_name', 'created_by_name VARCHAR(128) NULL');
  await addColumnIfMissing('stock_in_orders', 'created_by_role', 'created_by_role VARCHAR(32) NULL');

  await addColumnIfMissing('stock_out_orders', 'created_by_sub', 'created_by_sub VARCHAR(64) NULL');
  await addColumnIfMissing('stock_out_orders', 'created_by_name', 'created_by_name VARCHAR(128) NULL');
  await addColumnIfMissing('stock_out_orders', 'created_by_role', 'created_by_role VARCHAR(32) NULL');

  await addColumnIfMissing('stocktake_orders', 'created_by_sub', 'created_by_sub VARCHAR(64) NULL');
  await addColumnIfMissing('stocktake_orders', 'created_by_name', 'created_by_name VARCHAR(128) NULL');
  await addColumnIfMissing('stocktake_orders', 'created_by_role', 'created_by_role VARCHAR(32) NULL');

  await addColumnIfMissing('inventory_ledger', 'operator_sub', 'operator_sub VARCHAR(64) NULL');
  await addColumnIfMissing('inventory_ledger', 'operator_name', 'operator_name VARCHAR(128) NULL');
  await addColumnIfMissing('inventory_ledger', 'operator_role', 'operator_role VARCHAR(32) NULL');
  await addColumnIfMissing('inventory_ledger', 'batch_no', "batch_no VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('inventory_ledger', 'serial_no', "serial_no VARCHAR(128) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_in_items', 'batch_no', "batch_no VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_in_items', 'serial_no', "serial_no VARCHAR(128) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_out_items', 'batch_no', "batch_no VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_out_items', 'serial_no', "serial_no VARCHAR(128) NOT NULL DEFAULT ''");
  await addColumnIfMissing('shipping_orders', 'created_by_sub', 'created_by_sub VARCHAR(64) NULL');
  await addColumnIfMissing('shipping_orders', 'created_by_name', 'created_by_name VARCHAR(128) NULL');
  await addColumnIfMissing('shipping_orders', 'created_by_role', 'created_by_role VARCHAR(32) NULL');

  // Query-tuning indexes for list pages and dashboard aggregations.
  await addIndexIfMissing('products', 'idx_products_active_name', 'is_active, name');
  await addIndexIfMissing('storage_locations', 'idx_storage_active_code', 'is_active, code');
  await addIndexIfMissing('usage_locations', 'idx_usage_active_code', 'is_active, code');
  await addIndexIfMissing('inventory_balances', 'idx_balances_storage', 'storage_location_id');
  await addIndexIfMissing('inventory_balances', 'idx_balances_updated_at', 'updated_at');
  await addIndexIfMissing('stocktake_orders', 'idx_stocktake_created_at', 'created_at');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_change_occurred', 'change_type, occurred_at');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_storage_occurred', 'storage_location_id, occurred_at');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_usage_occurred', 'usage_location_id, occurred_at');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_ref', 'ref_type, ref_id');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_batch_occurred', 'batch_no, occurred_at');
  await addIndexIfMissing('inventory_ledger', 'idx_ledger_serial_occurred', 'serial_no, occurred_at');
  await addIndexIfMissing('operation_logs', 'idx_op_logs_created_at', 'created_at');
  await addIndexIfMissing('operation_logs', 'idx_op_logs_user_created', 'username, created_at');
  await addIndexIfMissing('operation_logs', 'idx_op_logs_action_created', 'action, created_at');
  await addIndexIfMissing('operation_logs', 'idx_op_logs_entity_created', 'entity, created_at');
  await addIndexIfMissing('shipping_orders', 'idx_shipping_order_status_created', 'stock_out_order_id, status, created_at');
  await addIndexIfMissing('shipping_orders', 'idx_shipping_tracking_created', 'tracking_no, created_at');
  await addIndexIfMissing('shipping_alert_notices', 'idx_shipping_alert_order', 'shipping_order_id');
  await addIndexIfMissing('shipping_tracking_events', 'idx_shipping_track_status_time', 'status, event_time');
  await addIndexIfMissing('stock_in_items', 'idx_stock_in_batch', 'batch_no, product_id, storage_location_id');
  await addIndexIfMissing('stock_in_items', 'idx_stock_in_serial', 'serial_no');
  await addIndexIfMissing('stock_out_items', 'idx_stock_out_batch', 'batch_no, product_id, storage_location_id');
  await addIndexIfMissing('stock_out_items', 'idx_stock_out_serial', 'serial_no');
};

const seedInitialData = async () => {
  const defaultStorage = await get('SELECT id FROM storage_locations WHERE code = ?', ['MAIN-A-01']);
  if (!defaultStorage) {
    await run(
      'INSERT INTO storage_locations (code, name, warehouse, area, shelf, slot, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['MAIN-A-01', '主仓A01', '主仓', 'A区', 'A货架', '01位', '默认主仓库位']
    );
  }

  const defaultUsage = await get('SELECT id FROM usage_locations WHERE code = ?', ['IT-OPS']);
  if (!defaultUsage) {
    await run(
      'INSERT INTO usage_locations (code, name, type, description) VALUES (?, ?, ?, ?)',
      ['IT-OPS', '运维部', '部门', '默认使用位置']
    );
  }
};

const initDb = async () => {
  await bootstrapDatabase();

  pool = buildPool({ database: DB_NAME });
  await waitForDb(pool, 'inventory database');
  await createSchema();
  await seedInitialData();
};

module.exports = {
  initDb,
  query,
  get,
  run,
  transaction,
};
