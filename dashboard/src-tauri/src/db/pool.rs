use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct ConnectionPoolInner {
    path: Option<String>,
    idle: Vec<rusqlite::Connection>,
}

pub(crate) struct ConnectionPool {
    inner: Mutex<ConnectionPoolInner>,
    max_idle: usize,
}

pub struct PooledConnection {
    conn: Option<rusqlite::Connection>,
    path: String,
    pool: Arc<ConnectionPool>,
}

pub(crate) struct ActiveDbPool(pub Arc<ConnectionPool>);
pub(crate) struct PrimaryDbPool(pub Arc<ConnectionPool>);

impl ConnectionPool {
    pub(crate) fn new(max_idle: usize) -> Self {
        Self {
            inner: Mutex::new(ConnectionPoolInner::default()),
            max_idle,
        }
    }

    pub(crate) fn acquire(self: &Arc<Self>, path: &str) -> Result<PooledConnection, String> {
        let maybe_conn = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "DB connection pool mutex poisoned".to_string())?;
            if inner.path.as_deref() != Some(path) {
                inner.path = Some(path.to_string());
                inner.idle.clear();
            }
            inner.idle.pop()
        };

        let conn = match maybe_conn {
            Some(conn) => conn,
            None => rusqlite_open(path).map_err(|e| e.to_string())?,
        };

        Ok(PooledConnection {
            conn: Some(conn),
            path: path.to_string(),
            pool: Arc::clone(self),
        })
    }

    pub(crate) fn reset(&self, path: &str) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "DB connection pool mutex poisoned".to_string())?;
        inner.path = Some(path.to_string());
        inner.idle.clear();
        Ok(())
    }

    fn release(&self, path: &str, mut conn: rusqlite::Connection) {
        if !prepare_connection_for_pool(&mut conn) {
            return;
        }

        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.path.as_deref() != Some(path) || inner.idle.len() >= self.max_idle {
            return;
        }
        inner.idle.push(conn);
    }
}

impl Deref for PooledConnection {
    type Target = rusqlite::Connection;

    fn deref(&self) -> &Self::Target {
        self.conn
            .as_ref()
            .expect("pooled database connection missing")
    }
}

impl DerefMut for PooledConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.conn
            .as_mut()
            .expect("pooled database connection missing")
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.release(&self.path, conn);
        }
    }
}

fn prepare_connection_for_pool(conn: &mut rusqlite::Connection) -> bool {
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK;");
    }

    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .is_ok()
}

// THREADING: Each call creates a new connection. WAL mode allows concurrent readers.
// busy_timeout=5000ms prevents SQLITE_BUSY on short write contention.
// No PRAGMA locking_mode=EXCLUSIVE — concurrent access is safe.
pub(crate) fn rusqlite_open(path: &str) -> Result<rusqlite::Connection, rusqlite::Error> {
    let conn = rusqlite::Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )?;
    Ok(conn)
}
