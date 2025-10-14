const Database = require('./database');
const fs = require('fs');
const path = require('path');

async function dumpChat() {
    const db = new Database();
    
    try {
        await db.init();
        
        console.log('Fetching all messages...');
        
        const messages = await new Promise((resolve, reject) => {
            db.db.all(`
                SELECT username, message, timestamp 
                FROM messages 
                ORDER BY timestamp ASC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log(`Found ${messages.length} messages`);
        
        // Format as text
        const chatText = messages.map(msg => {
            const date = new Date(msg.timestamp).toLocaleString();
            return `[${date}] ${msg.username}: ${msg.message}`;
        }).join('\n');
        
        // Save to file
        const filename = `chat-dump-${new Date().toISOString().split('T')[0]}.txt`;
        const filepath = path.join(__dirname, filename);
        
        fs.writeFileSync(filepath, chatText, 'utf8');
        
        console.log(`Chat dump saved to: ${filename}`);
        console.log(`Total messages: ${messages.length}`);
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        db.close();
    }
}

dumpChat();