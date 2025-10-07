const express = require('express');
const Database = require('./database');

function convertToRomeTime(utcTimestamp) {
    return new Date(utcTimestamp).toLocaleString('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(', ', 'T');
}

const app = express();
const port = 4438;

app.use(express.static('public'));

app.get('/api/stats', async (req, res) => {
    const db = new Database();
    try {
        await db.init();
        
        const totalMessages = await db.getMessageCount();
        const topUsers = await db.getTopUsers(20);
        
        const hourlyStats = await new Promise((resolve, reject) => {
            db.db.all(`
                SELECT 
                    datetime(timestamp, '+1 hour') as hour,
                    COUNT(*) as count
                FROM messages 
                WHERE timestamp >= datetime('now', '-24 hours')
                GROUP BY strftime('%Y-%m-%d %H', datetime(timestamp, '+1 hour'))
                ORDER BY hour
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => ({
                    hour: convertToRomeTime(row.hour),
                    count: row.count
                })));
            });
        });
        
        res.json({
            totalMessages,
            topUsers,
            hourlyStats
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        db.close();
    }
});

app.get('/api/overall-stats', async (req, res) => {
    const db = new Database();
    try {
        await db.init();
        
        const overallStats = await new Promise((resolve, reject) => {
            db.db.all(`
                SELECT 
                    DATE(timestamp) as date,
                    COUNT(*) as daily_count,
                    SUM(COUNT(*)) OVER (ORDER BY DATE(timestamp)) as cumulative_count
                FROM messages 
                GROUP BY DATE(timestamp)
                ORDER BY date
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ overallStats });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        db.close();
    }
});

app.get('/api/full-leaderboard', async (req, res) => {
    const db = new Database();
    try {
        await db.init();
        
        const allUsers = await new Promise((resolve, reject) => {
            db.db.all('SELECT username, message_count FROM users ORDER BY message_count DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ allUsers });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        db.close();
    }
});

app.listen(port, () => {
    console.log(`Dashboard server running on http://localhost:${port}`);
});