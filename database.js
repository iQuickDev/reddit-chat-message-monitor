const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, 'reddit_chat.db');
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                } else {
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        return new Promise((resolve, reject) => {
            const createMessagesTable = `
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    message_id TEXT UNIQUE
                )
            `;

            const createUsersTable = `
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    message_count INTEGER DEFAULT 0,
                    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;

            this.db.serialize(() => {
                this.db.run(createMessagesTable, (err) => {
                    if (err) reject(err);
                });
                
                this.db.run(createUsersTable, (err) => {
                    if (err) reject(err);
                    else {
                        resolve();
                    }
                });
            });
        });
    }

    async messageExists(messageId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT id FROM messages WHERE message_id = ?', [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });
    }

    async insertMessage(messageId, username, message, roomId = null) {
        const exists = await this.messageExists(messageId);
        if (exists) return null;
        
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('INSERT INTO messages (message_id, username, message) VALUES (?, ?, ?)');
            stmt.run([messageId, username, message], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
            stmt.finalize();
        });
    }

    async updateUserStats(username) {
        return new Promise((resolve, reject) => {
            const updateStmt = `
                INSERT INTO users (username, message_count, last_seen) 
                VALUES (?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET 
                    message_count = message_count + 1,
                    last_seen = CURRENT_TIMESTAMP
            `;
            
            this.db.run(updateStmt, [username], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getMessageCount(username = null) {
        return new Promise((resolve, reject) => {
            let query, params;
            
            if (username) {
                query = 'SELECT COUNT(*) as count FROM messages WHERE username = ?';
                params = [username];
            } else {
                query = 'SELECT COUNT(*) as count FROM messages';
                params = [];
            }

            this.db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    }

    async getTopUsers(limit = 10) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT username, message_count FROM users ORDER BY message_count DESC LIMIT ?';
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                } else {
                    // Connection closed silently
                }
            });
        }
    }
}

module.exports = Database;