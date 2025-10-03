const express = require('express');
const Database = require('./database');

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
                    strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
                    COUNT(*) as count
                FROM messages 
                WHERE timestamp >= datetime('now', '-24 hours')
                GROUP BY hour
                ORDER BY hour
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
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

app.listen(port, () => {
    console.log(`Dashboard server running on http://localhost:${port}`);
});