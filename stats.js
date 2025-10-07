const Database = require('./database');

async function showStats() {
    const db = new Database();
    
    try {
        await db.init();
        
        const totalMessages = await db.getMessageCount();
        console.log(`Total messages: ${totalMessages}`);
        
        const topUsers = await db.getTopUsers(10);
        console.log('\nTop 10 users:');
        topUsers.forEach((user, index) => {
            console.log(`${index + 1}. ${user.username}: ${user.message_count} messages`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        db.close();
    }
}

showStats();