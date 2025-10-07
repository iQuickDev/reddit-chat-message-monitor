const { Builder, until, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const Database = require('./database');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv')
dotenv.config();

let processedMessages = new Set();

function startServer() {
    const app = express();
    app.use(express.static('public'));
    app.use(express.json());
    
    app.get('/api/stats', async (req, res) => {
        const db = new Database();
        try {
            await db.init();
            
            const totalMessages = await db.getMessageCount();
            const topUsers = await db.getTopUsers(20);
            
            const hourlyStats = await new Promise((resolve, reject) => {
                db.db.all(`
                    SELECT 
                        strftime('%Y-%m-%d %H:', timestamp) || 
                        CASE WHEN CAST(strftime('%M', timestamp) AS INTEGER) < 30 THEN '00' ELSE '30' END || ':00' as hour,
                        COUNT(*) as count
                    FROM messages 
                    WHERE timestamp >= datetime('now', '-24 hours') AND visible = 1
                    GROUP BY hour
                    ORDER BY hour
                `, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            res.json({ totalMessages, topUsers, hourlyStats });
            
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
            const allUsers = await db.getTopUsers(1000);
            res.json({ allUsers });
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
                    WHERE visible = 1
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
    
    app.get('/api/messages', async (req, res) => {
        const db = new Database();
        try {
            await db.init();
            
            let { text, user, startDate, endDate, limit = 100 } = req.query;
            
            // Input validation
            if (text && typeof text !== 'string') text = '';
            if (user && typeof user !== 'string') user = '';
            if (text) text = text.substring(0, 500); // Limit length
            if (user) user = user.substring(0, 100); // Limit length
            
            const parsedLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
            
            let query = 'SELECT message_id, username, message, timestamp FROM messages WHERE visible = 1';
            const params = [];
            
            if (text && text.trim()) {
                query += ' AND message LIKE ?';
                params.push(`%${text.trim()}%`);
            }
            if (user && user.trim()) {
                query += ' AND username LIKE ?';
                params.push(`%${user.trim()}%`);
            }
            if (startDate) {
                query += ' AND timestamp >= ?';
                params.push(startDate);
            }
            if (endDate) {
                query += ' AND timestamp <= ?';
                params.push(endDate);
            }
            
            query += ' ORDER BY timestamp DESC LIMIT ?';
            params.push(parsedLimit);
            
            const messages = await new Promise((resolve, reject) => {
                db.db.all(query, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            res.json({ messages });
        } catch (error) {
            res.status(500).json({ error: error.message });
        } finally {
            db.close();
        }
    });
    

    app.get('/api/do-not-track', async (req, res) => {
        const db = new Database();
        try {
            await db.init();
            const users = await new Promise((resolve, reject) => {
                db.db.all('SELECT username FROM users WHERE track = 0', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => row.username));
                });
            });
            res.json({ users });
        } catch (error) {
            res.status(500).json({ error: error.message });
        } finally {
            db.close();
        }
    });
    
    app.listen(4438, () => {
        console.log('Dashboard server running on http://localhost:4438');
    });
}



async function monitorMessages(driver, db) {
    console.log('Starting message monitoring...');
    
    setInterval(async () => {
        try {
            const messages = await driver.executeScript(`
                const app = document.querySelector("body > faceplate-app > rs-app");
                if (!app) return { debug: 'No app element', messages: [] };
                const appShadow = app.shadowRoot;
                if (!appShadow) return { debug: 'No app shadow', messages: [] };
                const room = appShadow.querySelector("div.rs-app-container > div > rs-page-overlay-manager > rs-room");
                if (!room) return { debug: 'No room element', messages: [] };
                const roomShadow = room.shadowRoot;
                if (!roomShadow) return { debug: 'No room shadow', messages: [] };
                const timeline = roomShadow.querySelector("main > rs-timeline");
                if (!timeline) return { debug: 'No timeline element', messages: [] };
                const timelineShadow = timeline.shadowRoot;
                if (!timelineShadow) return { debug: 'No timeline shadow', messages: [] };
                const virtualScroll = timelineShadow.querySelector("div > rs-virtual-scroll-dynamic");
                if (!virtualScroll) return { debug: 'No virtual scroll element', messages: [] };
                const virtualScrollShadow = virtualScroll.shadowRoot;
                if (!virtualScrollShadow) return { debug: 'No virtual scroll shadow', messages: [] };
                const events = virtualScrollShadow.querySelectorAll("rs-timeline-event");
                
                const messages = Array.from(events).map(event => {
                    const username = event.shadowRoot.querySelector('.room-message').getAttribute('aria-label').split(' ')[0]
                    const dataId = event.getAttribute('data-id');
                    const content = event.shadowRoot?.querySelector('.room-message-text')?.textContent?.trim();
                    return { dataId, username, content };
                }).filter(msg => msg.dataId && msg.username && msg.content);
                
                return messages;
            `);

            const messageList = messages || [];

            for (const message of messageList) {
                if (!processedMessages.has(message.dataId)) {
                    // Check for Italian tracking commands
                    if (message.content.toLowerCase() === '/dt') {
                        await db.setUserTrackStatus(message.username, 0);
                        console.log(`${message.username} disabled tracking`);
                    } else if (message.content.toLowerCase() === '/at') {
                        await db.setUserTrackStatus(message.username, 1);
                        console.log(`${message.username} enabled tracking`);
                    }
                    
                    const trackStatus = await db.getUserTrackStatus(message.username);
                    const visible = trackStatus === 1 ? 1 : 0;
                    const inserted = await db.insertMessage(message.dataId, message.username, message.content, visible);
                    if (inserted) {
                        await db.updateUserStats(message.username);
                        console.log(`${message.username}: ${message.content}`);
                    }
                    processedMessages.add(message.dataId);
                }
            }
        } catch (error) {
            console.error('Error monitoring messages:', error.message);
        }
    }, 5000);
}

async function openReddit() {
    const db = new Database();
    await db.init();
    
    console.log('Starting browser...');
    const userDataDir = path.join(__dirname, 'chrome-user-data');
    
    const options = new chrome.Options();
    options.addArguments(`--user-data-dir=${userDataDir}`);
    options.addArguments('--no-sandbox');
    options.addArguments('--headless');
    options.addArguments('--window-size=1920,1080');
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    options.excludeSwitches(['enable-automation']);
    
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
    
    await driver.executeScript('Object.defineProperty(navigator, "webdriver", {get: () => undefined});');
    
    await driver.executeScript(`
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
    `);
    
    console.log('Browser started successfully');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Browser ready, attempting navigation...');
    const url = 'https://chat.reddit.com/room/!7H3QfsLhRXalKvwGiIDjrw%3Areddit.com';
    
    try {
        console.log('Using driver.get()...');
        await driver.get(url);
        console.log('Navigation complete');
    } catch (error) {
        console.log('driver.get() failed, trying executeScript...');
        await driver.executeScript(`window.location.href = '${url}';`);
        console.log('executeScript navigation complete');
    }
    
    const stateDir = path.join(__dirname, 'state');
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir);
    }

    console.log('Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const pageInfo = await driver.executeScript(`
        return {
            title: document.title,
            url: window.location.href,
            bodyChildren: document.body ? Array.from(document.body.children).map(el => el.tagName) : [],
            faceplateApp: !!document.querySelector('faceplate-app'),
            rsApp: !!document.querySelector('rs-app')
        };
    `);
    
    console.log('Page info:', pageInfo);
    
    if (pageInfo.url.includes('/login/')) {
        console.log('Redirected to login page. Attempting to login...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await driver.findElement(By.name('username')).sendKeys(process.env.REDDIT_USERNAME);
        await driver.findElement(By.name('password')).sendKeys(process.env.REDDIT_PASSWORD);
        await driver.findElement(By.className('login')).click();
        console.log('Waiting for login to complete...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await driver.get(url);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
 
    
    await monitorMessages(driver, db);
    
    // await driver.quit();
    // db.close();
}

// Start both server and monitoring
startServer();
openReddit().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});